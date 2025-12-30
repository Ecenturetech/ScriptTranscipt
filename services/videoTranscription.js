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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Aplica as substituições do dicionário no texto
 * @param {string} text - Texto a ser processado
 * @returns {Promise<string>} - Texto com substituições aplicadas
 */
export async function applyDictionaryReplacements(text) {
  try {
    if (!text || typeof text !== 'string') {
      return text;
    }

    // Buscar todos os termos do dicionário
    const { rows } = await pool.query(
      'SELECT term, replacement FROM dictionary_terms ORDER BY LENGTH(term) DESC'
    );

    if (rows.length === 0) {
      return text;
    }
    
    let processedText = text;
    
    // Aplicar substituições (ordenadas por tamanho para evitar substituições parciais)
    for (const { term, replacement } of rows) {
      if (!term || !replacement) {
        continue;
      }

      // Escapar caracteres especiais do termo para uso em regex
      const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Usar regex com palavra completa (case-insensitive)
      // \b é limite de palavra, funciona mesmo com pontuação
      const regex = new RegExp(`\\b${escapedTerm}\\b`, 'gi');
      processedText = processedText.replace(regex, replacement);
    }
    
    return processedText;
  } catch (error) {
    console.error('Erro ao aplicar substituições do dicionário:', error);
    console.error('Stack:', error.stack);
    // Em caso de erro, retornar o texto original
    return text;
  }
}


export async function processVideoFile(filePath, fileName) {
  try {
    const storagePath = getStoragePath();
    const videoId = uuidv4();
    
    const fileExtension = path.extname(fileName);
    const savedFileName = `video-${videoId}${fileExtension}`;
    const savedFilePath = path.join(storagePath, savedFileName);
    
    if (filePath !== savedFilePath) {
      fs.copyFileSync(filePath, savedFilePath);
    }
    
    const videoId_db = uuidv4();
    
    await pool.query(
      `INSERT INTO videos (id, file_name, source_type, source_url, status, transcript, structured_transcript, questions_answers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        videoId_db,
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
        `UPDATE videos SET status = $1, transcript = $2 WHERE id = $3`,
        ['error', keyError, videoId_db]
      );
      throw new Error(keyError);
    }
    
    let transcriptText = '';
    try {
      const fileStats = fs.statSync(savedFilePath);
      const fileSizeMB = fileStats.size / (1024 * 1024);
      
      if (fileSizeMB > 25) {
        console.warn(`Arquivo maior que 25MB (${fileSizeMB.toFixed(2)} MB). A API Whisper tem limite de 25MB.`);
      }
      
      const fileStream = fs.createReadStream(savedFilePath);
      
      const transcription = await openai.audio.transcriptions.create({
        file: fileStream,
        model: 'whisper-1',
        language: 'pt',
        response_format: 'text',
      });
      
      if (typeof transcription === 'string') {
        transcriptText = transcription.trim();
      } else if (transcription && typeof transcription === 'object') {
        transcriptText = (transcription.text || transcription.transcript || String(transcription)).trim();
      } else {
        transcriptText = String(transcription).trim();
      }
      
      if (!transcriptText || transcriptText.trim().length === 0) {
        throw new Error('Transcrição retornou vazia');
      }
      
      // Aplicar substituições do dicionário
      transcriptText = await applyDictionaryReplacements(transcriptText);
      
      await pool.query(
        `UPDATE videos SET transcript = $1 WHERE id = $2`,
        [transcriptText, videoId_db]
      );
      
    } catch (transcriptionError) {
      const errorMessage = `Erro na transcrição: ${transcriptionError.message}`;
      await pool.query(
        `UPDATE videos SET status = $1, transcript = $2 WHERE id = $3`,
        ['error', errorMessage, videoId_db]
      );
      
      throw new Error(`Erro ao transcrever vídeo: ${transcriptionError.message}`);
    }
    
    const processedResult = await processVideoTranscript(videoId_db, transcriptText);
    
    return {
      success: true,
      videoId: videoId_db,
      fileName: savedFileName,
      storagePath: path.relative(path.join(__dirname, '..'), storagePath).replace(/\\/g, '/'),
      transcript: transcriptText,
      structuredTranscript: processedResult.structuredTranscript,
      questionsAnswers: processedResult.questionsAnswers,
      message: 'Vídeo processado e transcrito com sucesso!'
    };
    
  } catch (error) {
    console.error('Erro ao processar arquivo de vídeo:', error);
    throw error;
  }
}

export async function processVideoTranscript(videoId, transcriptText) {
  try {
    const storagePath = getStoragePath();
    const tempTxtPath = path.join(storagePath, `temp-transcript-${videoId}.txt`);
    const tempEnhancedPath = path.join(storagePath, `temp-enhanced-${videoId}.txt`);
    const tempQAPath = path.join(storagePath, `temp-qa-${videoId}.txt`);
    
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
    
    await pool.query(
      `UPDATE videos SET status = $1, transcript = $2, structured_transcript = $3, questions_answers = $4 WHERE id = $5`,
      ['completed', transcriptText, enhancedText || null, qaText || null, videoId]
    );
    
    try {
      if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath);
      if (fs.existsSync(tempEnhancedPath)) fs.unlinkSync(tempEnhancedPath);
      if (fs.existsSync(tempQAPath)) fs.unlinkSync(tempQAPath);
    } catch (error) {
      // Silenciosamente ignora erros de limpeza
    }
    
    return {
      success: true,
      transcript: transcriptText,
      structuredTranscript: enhancedText,
      questionsAnswers: qaText
    };
    
  } catch (error) {
    console.error('Erro ao processar transcrição:', error);
    throw error;
  }
}

