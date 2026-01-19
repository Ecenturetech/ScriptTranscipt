import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { resolve } from 'path';
import generateQA, { generateEnhancedTranscript } from '../ai_qa_generator.js';
import { enrichTranscriptFromCatalog } from '../culture_enricher.js';
import pool from '../db/connection.js';
import { getStoragePath } from '../utils/storage.js';
import { splitAudioFile, cleanupChunks } from '../utils/audioSplitter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function applyDictionaryReplacements(text) {
  try {
    if (!text || typeof text !== 'string') {
      return text;
    }

    const { rows } = await pool.query(
      'SELECT term, replacement FROM dictionary_terms ORDER BY LENGTH(term) DESC'
    );

    if (rows.length === 0) {
      return text;
    }
    
    let processedText = text;
    
    for (const { term, replacement } of rows) {
      if (!term || !replacement) {
        continue;
      }

      const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      const regex = new RegExp(`\\b${escapedTerm}\\b`, 'gi');
      processedText = processedText.replace(regex, replacement);
    }
    
    return processedText;
  } catch (error) {
    console.error('Erro ao aplicar substituições do dicionário:', error);
    console.error('Stack:', error.stack);
    return text;
  }
}

// Wrapper para manter compatibilidade com videos
export async function processVideoFile(filePath, fileName) {
  return processMediaFile(filePath, fileName, 'videos');
}

// Wrapper para audios
export async function processAudioFile(filePath, fileName) {
  return processMediaFile(filePath, fileName, 'audios');
}

export async function processMediaFile(filePath, fileName, tableName = 'videos') {
  try {
    const storagePath = getStoragePath();
    const mediaId = uuidv4();
    
    const fileExtension = path.extname(fileName);
    const savedFileName = `${tableName === 'audios' ? 'audio' : 'video'}-${mediaId}${fileExtension}`;
    const savedFilePath = path.join(storagePath, savedFileName);
    
    if (filePath !== savedFilePath) {
      fs.copyFileSync(filePath, savedFilePath);
    }
    
    const dbId = uuidv4();
    
    await pool.query(
      `INSERT INTO ${tableName} (id, file_name, source_type, source_url, status, transcript, structured_transcript, questions_answers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        dbId,
        fileName,
        'upload',
        null,
        'processing',
        null,
        null,
        null
      ]
    );
    
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.length < 10) {
      const keyError = 'OPENAI_API_KEY ausente ou inválida no .env. A transcrição de upload requer esta chave.';
      await pool.query(
        `UPDATE ${tableName} SET status = $1, transcript = $2 WHERE id = $3`,
        ['error', keyError, dbId]
      );
      throw new Error(keyError);
    }
    
    let transcriptText = '';
    let chunkPaths = [];
    try {
      const fileStats = fs.statSync(savedFilePath);
      const fileSizeMB = fileStats.size / (1024 * 1024);
      
      if (fileSizeMB > 25) {
        console.log(`Arquivo maior que 25MB (${fileSizeMB.toFixed(2)} MB). Tentando dividir em chunks menores...`);
        chunkPaths = await splitAudioFile(savedFilePath, storagePath, mediaId);
        
        if (chunkPaths.length === 1 && chunkPaths[0] === savedFilePath && fileSizeMB > 25) {
          console.warn('Arquivo grande detectado mas não foi possível dividir (ffmpeg pode não estar instalado)');
          console.warn('Tentando processar mesmo assim. Se falhar, instale o FFmpeg: https://ffmpeg.org/download.html');
        }
      } else {
        chunkPaths = [savedFilePath];
      }
      
      const transcriptParts = [];
      
      for (let i = 0; i < chunkPaths.length; i++) {
        const chunkPath = chunkPaths[i];
        const chunkSizeMB = fs.statSync(chunkPath).size / (1024 * 1024);
        
        console.log(`Processando chunk ${i + 1}/${chunkPaths.length} (${chunkSizeMB.toFixed(2)} MB)...`);
        
        try {
          const fileStream = fs.createReadStream(chunkPath);
          
          const transcription = await openai.audio.transcriptions.create({
            file: fileStream,
            model: 'whisper-1',
            language: 'pt',
            response_format: 'text',
          });
          
          let chunkTranscript = '';
          if (typeof transcription === 'string') {
            chunkTranscript = transcription.trim();
          } else if (transcription && typeof transcription === 'object') {
            chunkTranscript = (transcription.text || transcription.transcript || String(transcription)).trim();
          } else {
            chunkTranscript = String(transcription).trim();
          }
          
          if (chunkTranscript && chunkTranscript.length > 0) {
            transcriptParts.push(chunkTranscript);
          }
        } catch (chunkError) {
          if (chunkError.message && (
            chunkError.message.includes('25') || 
            chunkError.message.includes('file too large') ||
            chunkError.message.includes('size limit')
          )) {
            throw new Error(
              `Arquivo muito grande (${chunkSizeMB.toFixed(2)} MB). ` +
              `A API Whisper tem limite de 25MB. ` +
              `Por favor, instale o FFmpeg para dividir arquivos grandes automaticamente: https://ffmpeg.org/download.html`
            );
          }
          throw chunkError;
        }
      }
      
      transcriptText = transcriptParts.join(' ').trim();
      
      if (!transcriptText || transcriptText.trim().length === 0) {
        throw new Error('Transcrição retornou vazia');
      }
      
      transcriptText = await applyDictionaryReplacements(transcriptText);
      
      await pool.query(
        `UPDATE ${tableName} SET transcript = $1 WHERE id = $2`,
        [transcriptText, dbId]
      );
      
      if (chunkPaths.length > 1 || (chunkPaths.length === 1 && chunkPaths[0] !== savedFilePath)) {
        const tempChunks = chunkPaths.filter(p => p !== savedFilePath);
        cleanupChunks(tempChunks);
      }
      
    } catch (transcriptionError) {
      if (chunkPaths.length > 0) {
        const tempChunks = chunkPaths.filter(p => p !== savedFilePath);
        cleanupChunks(tempChunks);
      }
      
      const errorMessage = `Erro na transcrição: ${transcriptionError.message}`;
      await pool.query(
        `UPDATE ${tableName} SET status = $1, transcript = $2 WHERE id = $3`,
        ['error', errorMessage, dbId]
      );
      
      throw new Error(`Erro ao transcrever arquivo: ${transcriptionError.message}`);
    }
    
    let processedResult;
    try {
      processedResult = await processMediaTranscript(dbId, transcriptText, tableName);
    } catch (processError) {
      console.error(`[${tableName.toUpperCase()}] Erro ao processar transcrição completa, mas transcript básico foi salvo:`, processError.message);
      // Mesmo se houver erro no processamento completo, garantir que o status seja atualizado
      // com pelo menos o transcript básico
      try {
        await pool.query(
          `UPDATE ${tableName} SET status = $1 WHERE id = $2`,
          ['completed', dbId]
        );
        console.log(`[${tableName.toUpperCase()}] Status atualizado para 'completed' mesmo com erro no processamento completo`);
      } catch (updateError) {
        console.error(`[${tableName.toUpperCase()}] Erro ao atualizar status:`, updateError.message);
      }
      
      // Retornar resultado parcial
      processedResult = {
        success: true,
        transcript: transcriptText,
        structuredTranscript: null,
        questionsAnswers: null
      };
    }
    
    return {
      success: true,
      id: dbId, // renomeado de videoId para id genérico, mas mantemos compatibilidade se o caller checar id
      videoId: dbId, // legacy support
      audioId: dbId, // audio support
      fileName: savedFileName,
      storagePath: path.relative(path.join(__dirname, '..'), storagePath).replace(/\\/g, '/'),
      transcript: transcriptText,
      structuredTranscript: processedResult.structuredTranscript,
      questionsAnswers: processedResult.questionsAnswers,
      message: 'Arquivo processado e transcrito com sucesso!'
    };
    
  } catch (error) {
    console.error(`[${tableName.toUpperCase()}] Erro ao processar arquivo de mídia:`, error);
    console.error(`[${tableName.toUpperCase()}] Stack:`, error.stack);
    throw error;
  }
}

// Wrapper para compatibilidade
export async function processVideoTranscript(videoId, transcriptText) {
  return processMediaTranscript(videoId, transcriptText, 'videos');
}

export async function processMediaTranscript(id, transcriptText, tableName = 'videos') {
  try {
    const storagePath = getStoragePath();
    const tempTxtPath = path.join(storagePath, `temp-transcript-${id}.txt`);
    const tempEnhancedPath = path.join(storagePath, `temp-enhanced-${id}.txt`);
    const tempQAPath = path.join(storagePath, `temp-qa-${id}.txt`);
    
    fs.writeFileSync(tempTxtPath, transcriptText);
    
    const enrichedText = enrichTranscriptFromCatalog(transcriptText);
    
    let enhancedText = "";
    try {
      await generateEnhancedTranscript(tempTxtPath, tempEnhancedPath);
      enhancedText = fs.readFileSync(tempEnhancedPath, 'utf-8');
      enhancedText = await applyDictionaryReplacements(enhancedText);
    } catch (error) {
      console.error("Erro ao gerar transcrição aprimorada:", error.message);
    }
    
    let qaText = "";
    try {
      await generateQA(tempTxtPath, tempQAPath);
      qaText = fs.readFileSync(tempQAPath, 'utf-8');
      qaText = await applyDictionaryReplacements(qaText);
    } catch (error) {
      console.error("Erro ao gerar Q&A:", error.message);
    }
    
    console.log(`[${tableName.toUpperCase()}] Atualizando status para 'completed' no banco para ID: ${id}`);
    
    await pool.query(
      `UPDATE ${tableName} SET status = $1, transcript = $2, structured_transcript = $3, questions_answers = $4 WHERE id = $5`,
      ['completed', transcriptText, enhancedText || null, qaText || null, id]
    );
    
    console.log(`[${tableName.toUpperCase()}] Status atualizado com sucesso para ID: ${id}`);
    
    try {
      if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath);
      if (fs.existsSync(tempEnhancedPath)) fs.unlinkSync(tempEnhancedPath);
      if (fs.existsSync(tempQAPath)) fs.unlinkSync(tempQAPath);
    } catch (error) {
      console.warn(`[${tableName.toUpperCase()}] Erro ao limpar arquivos temporários:`, error.message);
    }
    
    return {
      success: true,
      transcript: transcriptText,
      structuredTranscript: enhancedText,
      questionsAnswers: qaText
    };
    
  } catch (error) {
    console.error(`[${tableName.toUpperCase()}] Erro ao processar transcrição:`, error);
    console.error(`[${tableName.toUpperCase()}] Stack:`, error.stack);
    
    // Tentar atualizar o status para erro se possível
    try {
      await pool.query(
        `UPDATE ${tableName} SET status = $1 WHERE id = $2`,
        ['error', id]
      );
    } catch (updateError) {
      console.error(`[${tableName.toUpperCase()}] Erro ao atualizar status para 'error':`, updateError.message);
    }
    
    throw error;
  }
}
