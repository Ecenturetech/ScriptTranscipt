import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import path from 'path';
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatOpenAI } from '@langchain/openai';
import dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import pool from '../db/connection.js';
import { applyDictionaryReplacements } from './videoTranscription.js';

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

    return {
      success: true,
      scormId: scormDbId,
      scormIdOriginal: scormId,
      scormName,
      coursePath,
      extractedText: textWithReplacements,
      structuredSummary,
      questionsAnswers
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

