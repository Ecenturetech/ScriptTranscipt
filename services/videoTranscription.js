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
import ffmpeg from 'fluent-ffmpeg';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SUPPORTED_FORMATS = ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm'];

const KNOWN_FFMPEG_PATHS = [
  path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-8.0.1-full_build', 'bin', 'ffmpeg.exe'),
  path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
  'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
];

async function setupFFmpegPath() {
  try {
    await execAsync('ffmpeg -version');
    return true;
  } catch (e) {
    for (const knownPath of KNOWN_FFMPEG_PATHS) {
      if (fs.existsSync(knownPath)) {
        console.log(`💡 FFmpeg encontrado em caminho alternativo: ${knownPath}`);
        ffmpeg.setFfmpegPath(knownPath);
        
        const ffprobePath = knownPath.replace('ffmpeg.exe', 'ffprobe.exe');
        if (fs.existsSync(ffprobePath)) {
          ffmpeg.setFfprobePath(ffprobePath);
        }
        
        return true;
      }
    }
  }
  return false;
}

async function checkFFmpegAvailable() {
  return await setupFFmpegPath();
}

function isFormatSupported(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  return SUPPORTED_FORMATS.includes(ext);
}

async function convertToSupportedFormat(inputPath, outputDir, mediaId, isVideo = false) {
  const ffmpegAvailable = await checkFFmpegAvailable();
  
  if (!ffmpegAvailable) {
    throw new Error(
      'Formato de arquivo não suportado pela API Whisper e FFmpeg não está disponível. ' +
      'Formatos suportados: ' + SUPPORTED_FORMATS.join(', ') + '. ' +
      'Instale o FFmpeg para conversão automática: https://ffmpeg.org/download.html'
    );
  }

  const outputPath = path.join(outputDir, `converted-${mediaId}.mp3`);
  
  return new Promise((resolve, reject) => {
    console.log(`Convertendo arquivo para formato suportado (MP3)...`);
    
    const command = ffmpeg(inputPath);
    
    command
      .audioCodec('libmp3lame')
      .audioBitrate(128)
      .format('mp3')
      .output(outputPath);
    
    command
      .on('end', () => {
        console.log(`Conversão concluída: ${path.basename(outputPath)}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Erro ao converter arquivo:', err);
        reject(new Error(`Erro ao converter arquivo: ${err.message}`));
      })
      .run();
  });
}

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

export async function processVideoFile(filePath, fileName) {
  return processMediaFile(filePath, fileName, 'videos');
}

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
    let convertedFilePath = savedFilePath;
    let needsCleanup = false;
    
    try {
      if (!isFormatSupported(savedFilePath)) {
        const fileExtension = path.extname(savedFilePath).toLowerCase();
        console.log(`Formato ${fileExtension} não é suportado pela API Whisper. Convertendo...`);
        
        const isVideo = tableName === 'videos';
        convertedFilePath = await convertToSupportedFormat(savedFilePath, storagePath, mediaId, isVideo);
        needsCleanup = true;
        console.log(`Arquivo convertido para: ${path.basename(convertedFilePath)}`);
      }
      
      const fileStats = fs.statSync(convertedFilePath);
      const fileSizeMB = fileStats.size / (1024 * 1024);
      
      if (fileSizeMB > 25) {
        console.log(`Arquivo maior que 25MB (${fileSizeMB.toFixed(2)} MB). Tentando dividir em chunks menores...`);
        chunkPaths = await splitAudioFile(convertedFilePath, storagePath, mediaId);
        
        if (chunkPaths.length === 1 && chunkPaths[0] === convertedFilePath && fileSizeMB > 25) {
          console.warn('Arquivo grande detectado mas não foi possível dividir (ffmpeg pode não estar instalado)');
          console.warn('Tentando processar mesmo assim. Se falhar, instale o FFmpeg: https://ffmpeg.org/download.html');
        }
      } else {
        chunkPaths = [convertedFilePath];
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
      
      const filesToKeep = [savedFilePath];
      const tempChunks = chunkPaths.filter(p => !filesToKeep.includes(p));
      
      if (tempChunks.length > 0) {
        cleanupChunks(tempChunks);
      }
      
      if (needsCleanup && convertedFilePath !== savedFilePath && fs.existsSync(convertedFilePath)) {
        try {
          fs.unlinkSync(convertedFilePath);
          console.log(`Arquivo convertido temporário removido: ${path.basename(convertedFilePath)}`);
        } catch (cleanupError) {
          console.warn(`Erro ao remover arquivo convertido: ${cleanupError.message}`);
        }
      }
      
    } catch (transcriptionError) {
      if (chunkPaths.length > 0) {
        const tempChunks = chunkPaths.filter(p => p !== savedFilePath && p !== convertedFilePath);
        cleanupChunks(tempChunks);
      }
      
      if (needsCleanup && convertedFilePath !== savedFilePath && fs.existsSync(convertedFilePath)) {
        try {
          fs.unlinkSync(convertedFilePath);
        } catch (cleanupError) {
          console.warn(`Erro ao remover arquivo convertido após erro: ${cleanupError.message}`);
        }
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
      try {
        await pool.query(
          `UPDATE ${tableName} SET status = $1 WHERE id = $2`,
          ['completed', dbId]
        );
        console.log(`[${tableName.toUpperCase()}] Status atualizado para 'completed' mesmo com erro no processamento completo`);
      } catch (updateError) {
        console.error(`[${tableName.toUpperCase()}] Erro ao atualizar status:`, updateError.message);
      }
      
      processedResult = {
        success: true,
        transcript: transcriptText,
        structuredTranscript: null,
        questionsAnswers: null
      };
    }
    
    return {
      success: true,
      id: dbId,
      videoId: dbId,
      audioId: dbId,
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
