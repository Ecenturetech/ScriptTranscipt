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
import { applyDictionaryReplacements, processVideoFile } from './videoTranscription.js';
import { getStoragePath } from '../utils/storage.js';

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

/**
 * Busca os prompts do banco de dados
 */
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

/**
 * Extrai texto do conteúdo SCORM
 */
async function extractTextFromScormContent(scormId) {
  try {
    // Busca o conteúdo do SCORM da API
    const contentResponse = await axios.get(`${BAYER_FRONT_API_BASE_URL}/api/content-report`);
    const contentData = contentResponse.data || {};
    
    // Encontra o curso pelo ID
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

    // Extrai texto das lições, perguntas e mídias
    let extractedText = `Título do Curso: ${content.title}\n\n`;
    extractedText += `Número de páginas: ${content.pagesCount}\n\n`;
    
    // Extrai texto das lições
    if (content.lessons && Object.keys(content.lessons).length > 0) {
      extractedText += `=== LIÇÕES ===\n\n`;
      const lessonsArray = Object.values(content.lessons).sort((a, b) => a.lessonPage - b.lessonPage);
      for (const lesson of lessonsArray) {
        extractedText += `Página ${lesson.lessonPage}: ${lesson.lesson}\n`;
      }
      extractedText += `\n`;
    }

    // Extrai texto das perguntas
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

    // Extrai informação das mídias (vídeos)
    if (content.medias && Object.keys(content.medias).length > 0) {
      extractedText += `=== MÍDIAS (VÍDEOS) ===\n\n`;
      const mediasArray = Object.values(content.medias);
      for (const media of mediasArray) {
        extractedText += `Vídeo (Página ${media.lessonPage}): ${media.title || media.id}\n`;
        if (media.src) {
          extractedText += `  URL: ${media.src}\n`;
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

/**
 * Gera resumo estruturado do texto extraído
 */
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

/**
 * Busca vídeos do SCORM usando a API _content/query
 */
async function findScormVideos(coursePath) {
  try {
    console.log(`[SCORM-VIDEOS] Buscando vídeos para curso: ${coursePath}`);
    
    // Faz GET na API para buscar todos os conteúdos
    const response = await axios.get(CONTENT_QUERY_API_URL, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const allContent = Array.isArray(response.data) ? response.data : [];
    console.log(`[SCORM-VIDEOS] API retornou ${allContent.length} itens`);
    
    // Normaliza o coursePath
    let normalizedPath = coursePath;
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = `/${normalizedPath}`;
    }
    if (!normalizedPath.startsWith('/course/')) {
      normalizedPath = `/course/${normalizedPath.replace(/^\//, '')}`;
    }
    
    // Encontra o _info.yaml para pegar o assetsPath
    const courseDir = normalizedPath.split('/').slice(0, 3).join('/'); // /course/nome-curso
    const infoPath = `${courseDir}/_info`;
    
    const infoFile = allContent.find(item => 
      item._path === infoPath || item._path?.endsWith('/_info')
    );
    
    const assetsPath = infoFile?.assetsPath || null;
    console.log(`[SCORM-VIDEOS] assetsPath encontrado: ${assetsPath || 'não encontrado'}`);
    
    // Função recursiva para buscar vídeos no body
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
        
        // Busca recursivamente em children
        if (child.children && Array.isArray(child.children)) {
          videos.push(...findVideos(child.children, pagePath, pageTitle));
        }
      });
      
      return videos;
    };
    
    // Filtra páginas do curso e busca vídeos
    const videosList = [];
    
    allContent.forEach(item => {
      // Ignora arquivos _info e outros arquivos especiais
      if (!item._path || item._path.endsWith('/_info') || !item.body) {
        return;
      }
      
      // Filtra apenas páginas do curso específico
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

/**
 * Baixa vídeo de uma URL e salva localmente
 */
async function downloadVideoFromUrl(videoUrl, fileName) {
  try {
    console.log(`[SCORM-VIDEO] Baixando vídeo: ${videoUrl}`);
    
    const response = await axios({
      method: 'GET',
      url: videoUrl,
      responseType: 'stream',
      timeout: 300000 // 5 minutos
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
    throw new Error(`Erro ao baixar vídeo: ${error.message}`);
  }
}

/**
 * Processa vídeos do SCORM
 */
async function processScormVideos(videos, scormId, scormName) {
  const processedVideos = [];
  const errors = [];
  
  for (const video of videos) {
    try {
      console.log(`[SCORM-VIDEO] Processando vídeo: ${video.title} (${video.src})`);
      
      // Baixa o vídeo
      const fileExtension = path.extname(video.originalSrc) || '.mp4';
      const fileName = `scorm-${scormId}-${video.id}${fileExtension}`;
      const filePath = await downloadVideoFromUrl(video.src, fileName);
      
      // Processa o vídeo (transcreve)
      const result = await processVideoFile(filePath, fileName);
      
      processedVideos.push({
        videoId: result.videoId,
        title: video.title,
        src: video.src,
        pagePath: video.pagePath,
        pageTitle: video.pageTitle,
        transcript: result.transcript,
        structuredTranscript: result.structuredTranscript,
        questionsAnswers: result.questionsAnswers
      });
      
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
 * Gera perguntas e respostas baseado no texto
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
 * Processa conteúdo SCORM
 */
export async function processScormContent(scormId, scormName, coursePath) {
  try {
    console.log(`[SCORM] Iniciando processamento do SCORM: ${scormName} (${scormId})`);
    
    const scormDbId = uuidv4();
    
    // Cria registro no banco de dados
    await pool.query(
      `INSERT INTO scorms (id, scorm_id, scorm_name, course_path, status) 
       VALUES ($1, $2, $3, $4, 'processing')`,
      [scormDbId, scormId, scormName, coursePath]
    );

    console.log(`[SCORM] Registro criado no banco: ${scormDbId}`);

    // Busca e processa vídeos do SCORM
    let videosResult = { processed: [], errors: [], total: 0, success: 0 };
    try {
      console.log(`[SCORM] Buscando vídeos do SCORM...`);
      const videos = await findScormVideos(coursePath);
      
      if (videos.length > 0) {
        console.log(`[SCORM] Encontrados ${videos.length} vídeos, iniciando processamento...`);
        videosResult = await processScormVideos(videos, scormId, scormName);
        console.log(`[SCORM] Vídeos processados: ${videosResult.success}/${videosResult.total}`);
      } else {
        console.log(`[SCORM] Nenhum vídeo encontrado no SCORM`);
      }
    } catch (videoError) {
      console.error(`[SCORM] Erro ao processar vídeos (continuando com texto):`, videoError.message);
      videosResult.errors.push({ error: videoError.message });
    }

    // Extrai texto do conteúdo SCORM
    console.log(`[SCORM] Extraindo texto do conteúdo...`);
    const extractedText = await extractTextFromScormContent(scormId);
    
    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error('Nenhum texto foi extraído do SCORM');
    }

    console.log(`[SCORM] Texto extraído (${extractedText.length} caracteres)`);

    // Aplica substituições do dicionário
    const textWithReplacements = await applyDictionaryReplacements(extractedText);

    // Gera resumo estruturado
    console.log(`[SCORM] Gerando resumo estruturado...`);
    const structuredSummary = await generateStructuredSummary(textWithReplacements);

    // Gera perguntas e respostas
    console.log(`[SCORM] Gerando perguntas e respostas...`);
    const questionsAnswers = await generateQuestionsAnswers(textWithReplacements);

    // Atualiza o banco de dados com os resultados
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
    
    // Atualiza status para erro no banco
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

