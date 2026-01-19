import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import path from 'path';
import fs from 'fs';
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatOpenAI } from '@langchain/openai';
import dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import pool from '../db/connection.js';
import { applyDictionaryReplacements } from './videoTranscription.js';
import { getStoragePath } from '../utils/storage.js';
import generateQA, { generateEnhancedTranscript } from '../ai_qa_generator.js';
import { enrichTranscriptFromCatalog } from '../culture_enricher.js';
import { splitAudioFile, cleanupChunks } from '../utils/audioSplitter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

const BAYER_FRONT_API_BASE_URL = process.env.BAYER_FRONT_API_BASE_URL || 'https://ctb-bayer-staging.web.app';
const CONTENT_QUERY_API_URL = `${BAYER_FRONT_API_BASE_URL}/api/_content/query`;

async function getPromptsFromDatabase() {
  const { rows } = await pool.query('SELECT * FROM settings WHERE id = 1');
  
  if (rows.length === 0) {
    throw new Error('Configurações de prompts não encontradas no banco de dados.');
  }
  
  return {
    transcriptPrompt: rows[0].transcript_prompt || '',
    qaPrompt: rows[0].qa_prompt || '',
    additionalPrompt: rows[0].additional_prompt || ''
  };
}

async function extractTextFromScormContent(scormId, videoTranscripts = []) {
  try {
    const contentResponse = await axios.get(`${BAYER_FRONT_API_BASE_URL}/api/content-report`);
    const contentData = contentResponse.data || {};
    
    let content = null;
    for (const [coursePath, courseInfo] of Object.entries(contentData)) {
      if (courseInfo.id === scormId) {
        content = courseInfo;
        break;
      }
    }

    if (!content) {
      throw new Error(`SCORM não encontrado com o ID: ${scormId}`);
    }

    let extractedText = `Título do Curso: ${content.title}\n\n`;
    extractedText += `Número de páginas: ${content.pagesCount}\n\n`;
    
    if (content.lessons && Object.keys(content.lessons).length > 0) {
      extractedText += `=== LIÇÕES ===\n\n`;
      const lessonsArray = Object.values(content.lessons).sort((a, b) => a.lessonPage - b.lessonPage);
      for (const lesson of lessonsArray) {
        extractedText += `Página ${lesson.lessonPage}: ${lesson.lesson}\n`;
      }
      extractedText += `\n`;
    }

    if (content.questions && Object.keys(content.questions).length > 0) {
      extractedText += `=== PERGUNTAS E RESPOSTAS ===\n\n`;
      const questionsArray = Object.values(content.questions);
      for (const question of questionsArray) {
        extractedText += `Pergunta (Página ${question.lessonPage}): ${question.question}\n`;
        if (question.answers && Array.isArray(question.answers)) {
          for (const answer of question.answers) {
            const marker = answer.correct ? '[CORRETO]' : '';
            extractedText += `  - ${marker} ${answer.text}\n`;
          }
        }
        extractedText += `\n`;
      }
    }

    if (content.medias && Object.keys(content.medias).length > 0) {
      extractedText += `=== MÍDIAS (VÍDEOS) ===\n\n`;
      const mediasArray = Object.values(content.medias).sort((a, b) => a.lessonPage - b.lessonPage);
      
      for (const media of mediasArray) {
        extractedText += `**Vídeo (Página ${media.lessonPage}):** ${media.title || media.id}\n`;
        if (media.src) {
          extractedText += `  URL: ${media.src}\n`;
        }
        
        const videoTranscript = videoTranscripts.find(vt => 
          vt.lessonPage === media.lessonPage && 
          (vt.title === media.title || vt.id === media.id || vt.originalSrc === media.src)
        );
        
        if (videoTranscript) {
          if (videoTranscript.transcript) {
            extractedText += `  **Transcrição:**\n  ${videoTranscript.transcript}\n\n`;
          }
          if (videoTranscript.structuredTranscript) {
            extractedText += `  **Transcrição Estruturada:**\n  ${videoTranscript.structuredTranscript}\n\n`;
          }
          if (videoTranscript.questionsAnswers) {
            extractedText += `  **Perguntas e Respostas:**\n  ${videoTranscript.questionsAnswers}\n\n`;
          }
        }
        
        extractedText += `\n`;
      }
    }

    return extractedText.trim();
  } catch (error) {
    console.error('[SCORM] Erro ao extrair texto do SCORM:', error);
    throw new Error(`Erro ao extrair texto do SCORM: ${error.message}`);
  }
}

async function generateStructuredSummary(text) {
  try {
    const prompts = await getPromptsFromDatabase();
    
    if (!prompts.transcriptPrompt || prompts.transcriptPrompt.trim() === '') {
      throw new Error('Prompt de transcrição não configurado no banco de dados.');
    }
    
    const textoLimitado = text.substring(0, 100000);
    
    let promptContent = '';
    
    if (prompts.transcriptPrompt.includes('{text}')) {
      promptContent = prompts.transcriptPrompt.replace('{text}', textoLimitado);
    } else {
      promptContent = `${prompts.transcriptPrompt}\n\nTexto do SCORM:\n${textoLimitado}`;
    }
    
    if (prompts.additionalPrompt && prompts.additionalPrompt.trim() !== '') {
      promptContent += `\n\nInstruções adicionais:\n${prompts.additionalPrompt}`;
    }

    if (!openai) {
      throw new Error('OpenAI API Key não configurada. Configure OPENAI_API_KEY no .env');
    }

    const model = new ChatOpenAI({
      modelName: 'gpt-4o-mini',
      temperature: 0.3,
    });

    const prompt = PromptTemplate.fromTemplate(promptContent);
    const outputParser = new StringOutputParser();
    const chain = prompt.pipe(model).pipe(outputParser);

    const structuredSummary = await chain.invoke({});
    return structuredSummary.trim();
  } catch (error) {
    console.error('[SCORM] Erro ao gerar resumo estruturado:', error);
    throw new Error(`Erro ao gerar resumo estruturado: ${error.message}`);
  }
}

async function findScormVideos(coursePath) {
  try {
    console.log(`[SCORM-VIDEOS] Buscando vídeos para curso: ${coursePath}`);
    
    const response = await axios.get(CONTENT_QUERY_API_URL, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const allContent = Array.isArray(response.data) ? response.data : [];
    console.log(`[SCORM-VIDEOS] API retornou ${allContent.length} itens`);
    
    let normalizedPath = coursePath;
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = `/${normalizedPath}`;
    }
    if (!normalizedPath.startsWith('/course/')) {
      normalizedPath = `/course/${normalizedPath.replace(/^\//, '')}`;
    }
    
    const courseDir = normalizedPath.split('/').slice(0, 3).join('/');
    const infoPath = `${courseDir}/_info`;
    
    const infoFile = allContent.find(item => 
      item._path === infoPath || item._path?.endsWith('/_info')
    );
    
    const assetsPath = infoFile?.assetsPath || null;
    console.log(`[SCORM-VIDEOS] assetsPath encontrado: ${assetsPath || 'não encontrado'}`);
    
    const findVideos = (children, pagePath, pageTitle) => {
      const videos = [];
      
      if (!Array.isArray(children)) return videos;
      
      children.forEach(child => {
        if (child.tag === 'content-video') {
          const videoSrc = child.props?.src || '';
          
          let fullVideoSrc = videoSrc;
          if (videoSrc && !videoSrc.startsWith('http://') && !videoSrc.startsWith('https://')) {
            if (assetsPath) {
              const basePath = assetsPath.endsWith('/') ? assetsPath : assetsPath + '/';
              const relativePath = videoSrc.startsWith('/') ? videoSrc.substring(1) : videoSrc;
              fullVideoSrc = basePath + relativePath;
            }
          }
          
          videos.push({
            id: child.props?.id || uuidv4(),
            title: child.props?.title || 'Sem título',
            src: fullVideoSrc,
            originalSrc: videoSrc,
            pagePath: pagePath,
            pageTitle: pageTitle,
            assetsPath: assetsPath
          });
        }
        
        if (child.children && Array.isArray(child.children)) {
          videos.push(...findVideos(child.children, pagePath, pageTitle));
        }
      });
      
      return videos;
    };
    
    const videosList = [];
    
    allContent.forEach(item => {
      if (!item._path || item._path.endsWith('/_info') || !item.body) {
        return;
      }
      
      if (item._path.startsWith(courseDir)) {
        const pageVideos = findVideos(item.body.children || [], item._path, item.title || 'Sem título');
        
        if (pageVideos.length > 0) {
          videosList.push(...pageVideos);
        }
      }
    });
    
    console.log(`[SCORM-VIDEOS] Encontrados ${videosList.length} vídeos no curso`);
    
    return videosList;
  } catch (error) {
    console.error('[SCORM-VIDEOS] Erro ao buscar vídeos:', error);
    throw new Error(`Erro ao buscar vídeos do SCORM: ${error.message}`);
  }
}

async function downloadVideoFromUrl(videoUrl, fileName) {
  let encodedUrl = videoUrl;
  
  try {
    console.log(`[SCORM-VIDEO] Baixando vídeo: ${videoUrl}`);
    
    encodedUrl = videoUrl;
    try {
      const urlObj = new URL(videoUrl);
      const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);
      const encodedPathParts = pathParts.map(part => {
        try {
          const decoded = decodeURIComponent(part);
          return encodeURIComponent(decoded);
        } catch {
          return encodeURIComponent(part);
        }
      });
      urlObj.pathname = '/' + encodedPathParts.join('/');
      encodedUrl = urlObj.toString();
    } catch (urlError) {
      console.warn(`[SCORM-VIDEO] Aviso ao processar URL: ${urlError.message}`);
      encodedUrl = videoUrl.replace(/ /g, '%20').replace(/\[/g, '%5B').replace(/\]/g, '%5D');
    }
    
    if (encodedUrl !== videoUrl) {
      console.log(`[SCORM-VIDEO] URL codificada: ${encodedUrl}`);
    }
    
    const response = await axios({
      method: 'GET',
      url: encodedUrl,
      responseType: 'stream',
      timeout: 300000,
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 400;
      }
    });
    
    const storagePath = getStoragePath();
    const filePath = path.join(storagePath, fileName);
    
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`[SCORM-VIDEO] Vídeo baixado: ${filePath}`);
        resolve(filePath);
      });
      writer.on('error', reject);
    });
  } catch (error) {
    console.error(`[SCORM-VIDEO] Erro ao baixar vídeo: ${error.message}`);
    if (error.response) {
      console.error(`[SCORM-VIDEO] Status HTTP: ${error.response.status}`);
      console.error(`[SCORM-VIDEO] URL original: ${videoUrl}`);
      if (typeof encodedUrl !== 'undefined') {
        console.error(`[SCORM-VIDEO] URL tentada: ${encodedUrl}`);
      }
    }
    throw new Error(`Erro ao baixar vídeo: ${error.message}`);
  }
}

async function processScormVideos(videos, scormId, scormName, contentMedias) {
  const processedVideos = [];
  const errors = [];
  
  for (const video of videos) {
    try {
      console.log(`[SCORM-VIDEO] Processando vídeo: ${video.title} (${video.src})`);
      
      const fileExtension = path.extname(video.originalSrc) || '.mp4';
      const fileName = `scorm-${scormId}-${video.id}${fileExtension}`;
      const filePath = await downloadVideoFromUrl(video.src, fileName);
      
      const transcriptText = await transcribeVideoFile(filePath);
      
      const processedResult = await processVideoTranscriptOnly(transcriptText);
      
      let lessonPage = null;
      
      if (contentMedias) {
        for (const media of Object.values(contentMedias)) {
          const mediaSrcNormalized = media.src?.replace(/^\/+/, '');
          const videoSrcNormalized = video.originalSrc?.replace(/^\/+/, '');
          
          if (media.src === video.originalSrc || 
              media.src === video.src ||
              mediaSrcNormalized === videoSrcNormalized) {
            lessonPage = media.lessonPage;
            break;
          }
        }
      }

      if (!lessonPage && contentMedias) {
        for (const media of Object.values(contentMedias)) {
          if (media.id === video.id) {
            lessonPage = media.lessonPage;
            break;
          }
        }
      }
      
      if (!lessonPage && contentMedias) {
        for (const media of Object.values(contentMedias)) {
          if (media.title === video.title || 
              (media.title && video.title && media.title.toLowerCase() === video.title.toLowerCase())) {
            lessonPage = media.lessonPage;
            break;
          }
        }
      }
      
      if (!lessonPage && video.pagePath) {
        try {
          const contentQueryResponse = await axios.get(CONTENT_QUERY_API_URL);
          const allContent = Array.isArray(contentQueryResponse.data) ? contentQueryResponse.data : [];
          const page = allContent.find(item => item._path === video.pagePath);
          if (page && page.pageNumber) {
            lessonPage = page.pageNumber;
          }
        } catch (error) {
          console.warn(`[SCORM-VIDEO] Não foi possível buscar pageNumber do path: ${error.message}`);
        }
      }
      
      console.log(`[SCORM-VIDEO] Vídeo "${video.title}" associado à página ${lessonPage || 'desconhecida'}`);
      
      processedVideos.push({
        id: video.id,
        title: video.title,
        src: video.originalSrc,
        lessonPage: lessonPage,
        transcript: processedResult.transcript,
        structuredTranscript: processedResult.structuredTranscript,
        questionsAnswers: processedResult.questionsAnswers
      });
      
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (cleanupError) {
        console.warn(`[SCORM-VIDEO] Erro ao remover arquivo temporário: ${cleanupError.message}`);
      }
      
      console.log(`[SCORM-VIDEO] Vídeo processado com sucesso: ${video.title}`);
    } catch (error) {
      console.error(`[SCORM-VIDEO] Erro ao processar vídeo ${video.title}:`, error.message);
      errors.push({
        video: video.title,
        error: error.message
      });
    }
  }
  
  return {
    processed: processedVideos,
    errors: errors,
    total: videos.length,
    success: processedVideos.length
  };
}

/**
 */
async function transcribeVideoFile(filePath) {
  if (!openai) {
    throw new Error('OpenAI API Key não configurada. Configure OPENAI_API_KEY no .env');
  }
  
  let chunkPaths = [];
  try {
    const fileStats = fs.statSync(filePath);
    const fileSizeMB = fileStats.size / (1024 * 1024);
    
    const storagePath = getStoragePath();
    const baseName = path.basename(filePath, path.extname(filePath));
    
    if (fileSizeMB > 25) {
      console.log(`Arquivo maior que 25MB (${fileSizeMB.toFixed(2)} MB). Tentando dividir em chunks menores...`);
      chunkPaths = await splitAudioFile(filePath, storagePath, baseName);
      
      if (chunkPaths.length === 1 && chunkPaths[0] === filePath && fileSizeMB > 25) {
        console.warn('Arquivo grande detectado mas não foi possível dividir (ffmpeg pode não estar instalado)');
        console.warn('Tentando processar mesmo assim. Se falhar, instale o FFmpeg: https://ffmpeg.org/download.html');
      }
    } else {
      chunkPaths = [filePath];
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
    
    let transcriptText = transcriptParts.join(' ').trim();
    
    if (!transcriptText || transcriptText.trim().length === 0) {
      throw new Error('Transcrição retornou vazia');
    }
    
    transcriptText = await applyDictionaryReplacements(transcriptText);
    
    if (chunkPaths.length > 1 || (chunkPaths.length === 1 && chunkPaths[0] !== filePath)) {
      const tempChunks = chunkPaths.filter(p => p !== filePath);
      cleanupChunks(tempChunks);
    }
    
    return transcriptText;
  } catch (error) {
    if (chunkPaths.length > 0) {
      const tempChunks = chunkPaths.filter(p => p !== filePath);
      cleanupChunks(tempChunks);
    }
    throw new Error(`Erro ao transcrever vídeo: ${error.message}`);
  }
}

/**
 */
async function processVideoTranscriptOnly(transcriptText) {
  try {
    const storagePath = getStoragePath();
    const tempId = uuidv4();
    const tempTxtPath = path.join(storagePath, `temp-transcript-${tempId}.txt`);
    const tempEnhancedPath = path.join(storagePath, `temp-enhanced-${tempId}.txt`);
    const tempQAPath = path.join(storagePath, `temp-qa-${tempId}.txt`);
    
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
    
    try {
      if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath);
      if (fs.existsSync(tempEnhancedPath)) fs.unlinkSync(tempEnhancedPath);
      if (fs.existsSync(tempQAPath)) fs.unlinkSync(tempQAPath);
    } catch (error) {
    }
    
    return {
      transcript: transcriptText,
      structuredTranscript: enhancedText,
      questionsAnswers: qaText
    };
  } catch (error) {
    console.error('Erro ao processar transcrição:', error);
    throw error;
  }
}

/**
 */
async function generateQuestionsAnswers(text) {
  try {
    const prompts = await getPromptsFromDatabase();
    
    if (!prompts.qaPrompt || prompts.qaPrompt.trim() === '') {
      throw new Error('Prompt de Q&A não configurado no banco de dados.');
    }
    
    const textoLimitado = text.substring(0, 100000);
    
    let promptContent = '';
    
    if (prompts.qaPrompt.includes('{text}')) {
      promptContent = prompts.qaPrompt.replace('{text}', textoLimitado);
    } else {
      promptContent = `${prompts.qaPrompt}\n\nTexto do SCORM:\n${textoLimitado}`;
    }
    
    if (prompts.additionalPrompt && prompts.additionalPrompt.trim() !== '') {
      promptContent += `\n\nInstruções adicionais:\n${prompts.additionalPrompt}`;
    }

    if (!openai) {
      throw new Error('OpenAI API Key não configurada. Configure OPENAI_API_KEY no .env');
    }

    const model = new ChatOpenAI({
      modelName: 'gpt-4o-mini',
      temperature: 0.5,
    });

    const prompt = PromptTemplate.fromTemplate(promptContent);
    const outputParser = new StringOutputParser();
    const chain = prompt.pipe(model).pipe(outputParser);

    const questionsAnswers = await chain.invoke({});
    return questionsAnswers.trim();
  } catch (error) {
    console.error('[SCORM] Erro ao gerar perguntas e respostas:', error);
    throw new Error(`Erro ao gerar perguntas e respostas: ${error.message}`);
  }
}

/**
 */
export async function processScormContent(scormId, scormName, coursePath) {
  try {
    console.log(`[SCORM] Iniciando processamento do SCORM: ${scormName} (${scormId})`);
    
    const scormDbId = uuidv4();
    
    await pool.query(
      `INSERT INTO scorms (id, scorm_id, scorm_name, course_path, status) 
       VALUES ($1, $2, $3, $4, 'processing')`,
      [scormDbId, scormId, scormName, coursePath]
    );

    console.log(`[SCORM] Registro criado no banco: ${scormDbId}`);

    const contentResponse = await axios.get(`${BAYER_FRONT_API_BASE_URL}/api/content-report`);
    const contentData = contentResponse.data || {};
    
    let content = null;
    for (const [path, courseInfo] of Object.entries(contentData)) {
      if (courseInfo.id === scormId) {
        content = courseInfo;
        break;
      }
    }
    
    if (!content) {
      throw new Error(`SCORM não encontrado com o ID: ${scormId}`);
    }

    let videosResult = { processed: [], errors: [], total: 0, success: 0 };
    try {
      console.log(`[SCORM] Buscando vídeos do SCORM...`);
      const videos = await findScormVideos(coursePath);
      
      if (videos.length > 0) {
        console.log(`[SCORM] Encontrados ${videos.length} vídeos, iniciando processamento...`);
        videosResult = await processScormVideos(videos, scormId, scormName, content.medias);
        console.log(`[SCORM] Vídeos processados: ${videosResult.success}/${videosResult.total}`);
      } else {
        console.log(`[SCORM] Nenhum vídeo encontrado no SCORM`);
      }
    } catch (videoError) {
      console.error(`[SCORM] Erro ao processar vídeos (continuando com texto):`, videoError.message);
      videosResult.errors.push({ error: videoError.message });
    }

    console.log(`[SCORM] Extraindo texto do conteúdo...`);
    const extractedText = await extractTextFromScormContent(scormId, videosResult.processed);
    
    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error('Nenhum texto foi extraído do SCORM');
    }

    console.log(`[SCORM] Texto extraído (${extractedText.length} caracteres)`);

    const textWithReplacements = await applyDictionaryReplacements(extractedText);

    console.log(`[SCORM] Gerando resumo estruturado...`);
    const structuredSummary = await generateStructuredSummary(textWithReplacements);

    console.log(`[SCORM] Gerando perguntas e respostas...`);
    const questionsAnswers = await generateQuestionsAnswers(textWithReplacements);

    await pool.query(
      `UPDATE scorms 
       SET status = 'completed', 
           extracted_text = $1, 
           structured_summary = $2, 
           questions_answers = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [textWithReplacements, structuredSummary, questionsAnswers, scormDbId]
    );

    console.log(`[SCORM] Processamento concluído com sucesso: ${scormDbId}`);
    console.log(`[SCORM] Resumo: ${videosResult.success} vídeos processados, ${videosResult.errors.length} erros`);

    return {
      success: true,
      scormId: scormDbId,
      scormIdOriginal: scormId,
      scormName,
      coursePath,
      extractedText: textWithReplacements,
      structuredSummary,
      questionsAnswers,
      videos: {
        total: videosResult.total,
        processed: videosResult.processed.length,
        errors: videosResult.errors.length,
        details: videosResult
      }
    };
  } catch (error) {
    console.error('[SCORM] Erro no processamento:', error);
    
    try {
      await pool.query(
        `UPDATE scorms SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE scorm_id = $1 AND status = 'processing'`,
        [scormId]
      );
    } catch (dbError) {
      console.error('[SCORM] Erro ao atualizar status de erro no banco:', dbError);
    }
    
    throw error;
  }
}

