import '../utils/polyfills.js';
import { loadDOMMatrixPolyfill } from '../utils/polyfills.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { createCanvas, Image } from 'canvas';
import { PromptTemplate } from "@langchain/core/prompts";

if (typeof global.Image === 'undefined') {
  global.Image = Image;
}

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return {
      canvas,
      context,
    };
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatOpenAI } from '@langchain/openai';
import dotenv from 'dotenv';
import { resolve } from 'path';
import pool from '../db/connection.js';
import { getStoragePath } from '../utils/storage.js';
import { applyDictionaryReplacements } from './videoTranscription.js';
import { correctTranscriptFromCatalog } from '../catalogCorrector.js';
import { improveTextReadability } from '../ai_qa_generator.js';
import { generateElyMetadata } from './metadataGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

async function extractRawTextFromPDF(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo não encontrado: ${filePath}`);
    }
    
    const buffer = fs.readFileSync(filePath);
    const dados = await pdf(buffer);
    const textoExtraido = dados.text;
    
    if (!textoExtraido || textoExtraido.trim().length === 0) {
      throw new Error('Nenhum texto foi extraído do PDF');
    }
    
    return textoExtraido.trim();
    
  } catch (error) {
    console.error('[PDF] Erro ao extrair texto bruto do PDF:', error);
    console.error('[PDF] Stack:', error.stack);
    throw new Error(`Erro ao extrair texto bruto do PDF: ${error.message}`);
  }
}

async function extractTextViaVision(filePath) {
  try {
    console.log(`[PDF-VISION] Iniciando extração visual para: ${filePath}`);
    
    await loadDOMMatrixPolyfill();
    
    if (typeof globalThis.DOMMatrix === 'undefined') {
      throw new Error('DOMMatrix polyfill não foi carregado corretamente');
    }
    
    try {
      const testMatrix = new globalThis.DOMMatrix();
      console.log('[PDF-VISION] DOMMatrix disponível e funcional:', typeof globalThis.DOMMatrix);
      
      if (typeof global !== 'undefined' && !global.DOMMatrix) {
        global.DOMMatrix = globalThis.DOMMatrix;
      }
    } catch (testError) {
      console.error('[PDF-VISION] Erro ao testar DOMMatrix:', testError);
      throw new Error(`DOMMatrix não é uma função construtora válida: ${testError.message}`);
    }
    
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    
    const data = new Uint8Array(fs.readFileSync(filePath));
    
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      const workerPath = path.join(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
    }

    const loadingTask = pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
      canvasFactory: new NodeCanvasFactory()
    });
    
    const pdfDocument = await loadingTask.promise;
    console.log(`[PDF-VISION] PDF carregado. Total de páginas: ${pdfDocument.numPages}`);
    
    const images = [];
    const maxPages = 100;
    const pagesToProcess = Math.min(pdfDocument.numPages, maxPages);

    for (let i = 1; i <= pagesToProcess; i++) {
      try {
        const page = await pdfDocument.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvasFactory = new NodeCanvasFactory();
        const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);
        
        await page.render({
          canvasContext: context,
          viewport: viewport,
          canvasFactory: canvasFactory
        }).promise;
        
        images.push(canvas.toBuffer('image/png').toString('base64'));
        if (i % 5 === 0) console.log(`[PDF-VISION] Renderizadas ${i} páginas...`);
      } catch (pageError) {
        console.error(`[PDF-VISION] Erro ao renderizar página ${i}:`, pageError);
      }
    }
    
    if (images.length === 0) {
      throw new Error('Nenhuma página pôde ser renderizada como imagem.');
    }
    
    console.log(`[PDF-VISION] Renderização concluída. Processando ${images.length} páginas com GPT-4o-mini Vision...`);
    
    let combinedText = '';
    
    const batchSize = 4;
    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);
      console.log(`[PDF-VISION] Enviando lote ${Math.floor(i/batchSize) + 1} de ${Math.ceil(images.length/batchSize)} para OpenAI...`);
      
      let success = false;
      let retries = 0;
      const maxRetries = 3;
      
      while (!success && retries < maxRetries) {
        try {
          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "Você é um assistente especializado em OCR técnico. Transcreva o conteúdo das imagens ignorando marcas d'água repetitivas e textos de segurança. Foque em dados técnicos e tabelas."
              },
              {
                role: "user",
                content: [
                  { type: "text", text: "Transcreva o conteúdo técnico destas páginas:" },
                  ...batch.map(img => ({
                    type: "image_url",
                    image_url: { url: `data:image/png;base64,${img}` }
                  }))
                ]
              }
            ],
            max_tokens: 4096,
            temperature: 0
          });
          
          combinedText += response.choices[0].message.content.trim() + '\n\n';
          success = true;
        } catch (error) {
          if (error.status === 429) {
            retries++;
            const waitTime = 5000 * retries;
            console.warn(`[PDF-VISION] Rate limit atingido. Tentativa ${retries}/${maxRetries}. Esperando ${waitTime/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
            throw error;
          }
        }
      }
      
      if (!success) throw new Error(`Falha ao processar lote ${Math.floor(i/batchSize) + 1} após ${maxRetries} tentativas.`);
      
      if (i + batchSize < images.length) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    return combinedText.trim();
  } catch (error) {
    console.error('[PDF-VISION] Erro na extração via visão:', error);
    throw new Error(`Erro na extração visual (OCR): ${error.message}`);
  }
}

async function generateQuestionsAnswers(text) {
  try {
    const prompts = await getPromptsFromDatabase();
    
    if (!prompts.qaPrompt || prompts.qaPrompt.trim() === '') {
      throw new Error('Prompt de Q&A (qa_prompt) não configurado no banco de dados. Configure através da interface de settings.');
    }
    
    const textoLimitado = text.substring(0, 60000);
    
    let promptContent = '';
    
    if (prompts.qaPrompt.includes('{text}')) {
      promptContent = prompts.qaPrompt.replace('{text}', textoLimitado) + '\n\nOBRIGATÓRIO: Gere as perguntas e respostas NO MESMO IDIOMA do texto. NUNCA traduza.';
    } else {
      promptContent = `${prompts.qaPrompt}

Texto base:
"""
${textoLimitado}
"""

Gere o Q&A agora NO MESMO IDIOMA do texto. NUNCA traduza.`;
    }
    
    if (prompts.additionalPrompt && prompts.additionalPrompt.trim() !== '') {
      promptContent += `\n\nInstruções adicionais:\n${prompts.additionalPrompt}`;
    }
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Você deve seguir estritamente as instruções e não adicionar conhecimento externo.',
        },
        {
          role: 'user',
          content: promptContent,
        },
      ],
      temperature: 0,
    });
    
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Erro ao gerar perguntas e respostas:', error);
    throw new Error(`Erro ao gerar perguntas e respostas: ${error.message}`);
  }
}

async function generateStructuredSummary(text) {
  try {
    const prompts = await getPromptsFromDatabase();
    
    if (!prompts.transcriptPrompt || prompts.transcriptPrompt.trim() === '') {
      throw new Error('Prompt de transcrição (transcript_prompt) não configurado no banco de dados. Configure através da interface de settings.');
    }
    
    const textoLimitado = text.substring(0, 60000);
    
    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.3,
    });
    
    let template = '';
    
    if (prompts.transcriptPrompt.includes('{text}')) {
      template = prompts.transcriptPrompt + '\n\nOBRIGATÓRIO: Mantenha o texto NO MESMO IDIOMA do original. NUNCA traduza.';
      if (prompts.additionalPrompt && prompts.additionalPrompt.trim() !== '') {
        template = template.replace('{text}', `{text}\n\nInstruções adicionais:\n${prompts.additionalPrompt}`);
      }
    } else {
      template = prompts.transcriptPrompt;
      
      if (prompts.additionalPrompt && prompts.additionalPrompt.trim() !== '') {
        template += `\n\nInstruções adicionais:\n${prompts.additionalPrompt}`;
      }
      
      template += `\n\nTranscrição original:\n"{text}"\n\nGere agora a transcrição aprimorada no mesmo formato do exemplo. MANTENHA O MESMO IDIOMA do texto original. Não traduza.`;
    }
    
    const prompt = PromptTemplate.fromTemplate(template);
    const chain = prompt.pipe(model).pipe(new StringOutputParser());
    
    const result = await chain.invoke({
      text: textoLimitado,
    });

    const finalText = result.trim();
    
    if (finalText.length === 0) {
      throw new Error('Nenhum texto foi retornado pela OpenAI');
    }
    
    return finalText;
  } catch (error) {
    console.error('Erro ao gerar resumo estruturado:', error);
    throw new Error(`Erro ao gerar resumo estruturado: ${error.message}`);
  }
}

export async function processPDFFile(filePath, fileName, forceVision = false) {
  try {
    const storagePath = getStoragePath();
    const pdfId = uuidv4();
    
    const fileExtension = path.extname(fileName);
    const savedFileName = `pdf-${pdfId}${fileExtension}`;
    const savedFilePath = path.join(storagePath, savedFileName);
    
    if (filePath !== savedFilePath) {
      fs.copyFileSync(filePath, savedFilePath);
    }
    
    const pdfId_db = uuidv4();
    
    await pool.query(
      `INSERT INTO pdfs (id, file_name, status, extracted_text, structured_summary)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        pdfId_db,
        fileName,
        'processing',
        null,
        null
      ]
    ).catch(async (err) => {
      if (err.message && err.message.includes('questions_answers')) {
        await pool.query(`
          ALTER TABLE pdfs 
          ADD COLUMN IF NOT EXISTS questions_answers TEXT
        `).catch(() => {});
      }
      throw err;
    });
    
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.length < 10) {
      const keyError = 'OPENAI_API_KEY ausente ou inválida no .env. O processamento de PDF requer esta chave.';
      await pool.query(
        `UPDATE pdfs SET status = $1, extracted_text = $2 WHERE id = $3`,
        ['error', keyError, pdfId_db]
      );
      throw new Error(keyError);
    }
    
    let extractedText = '';
    let structuredSummary = '';
    let elyMetadata = '';
    
    try {
      if (forceVision) {
        console.log(`[PDF] Extração via Visão forçada para: ${fileName}`);
        try {
          extractedText = await extractTextViaVision(savedFilePath);
        } catch (visionError) {
          extractedText = await extractRawTextFromPDF(savedFilePath);
        }
      } else {
        extractedText = await extractRawTextFromPDF(savedFilePath);
      }
      
      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error('Nenhum texto foi extraído do PDF (mesmo após tentativa com Visão)');
      }

      const textLen = extractedText.length;
      console.log(`[PDF] Melhorando legibilidade do texto extraído (${textLen} caracteres)...`);
      try {
        extractedText = await improveTextReadability(extractedText);
      } catch (improveError) {
        console.warn('[PDF] Falha ao melhorar legibilidade, mantendo original:', improveError.message);
      }
      
      extractedText = await applyDictionaryReplacements(extractedText);
      
      await pool.query(
        `UPDATE pdfs SET extracted_text = $1 WHERE id = $2`,
        [extractedText, pdfId_db]
      );
      
      // Gerar metadados ELY
      console.log('[PDF] Gerando metadados ELY...');
      try {
        elyMetadata = await generateElyMetadata(extractedText, fileName);
        elyMetadata = await applyDictionaryReplacements(elyMetadata);

        // Salvar metadados imediatamente para garantir persistência
        try {
            await pool.query(`
                ALTER TABLE pdfs 
                ADD COLUMN IF NOT EXISTS ely_metadata TEXT
            `).catch(() => {});

            await pool.query(
                `UPDATE pdfs SET ely_metadata = $1 WHERE id = $2`,
                [elyMetadata, pdfId_db]
            );
            console.log('[PDF] Metadados ELY salvos no banco com sucesso.');
        } catch (saveError) {
            console.error('[PDF] Erro ao salvar metadados intermediários:', saveError);
        }

      } catch (metadataError) {
        console.error('[PDF] Erro ao gerar metadados ELY:', metadataError);
        // Não interrompe o processo se a geração de metadados falhar
      }
      
      structuredSummary = await generateStructuredSummary(extractedText);
      structuredSummary = await applyDictionaryReplacements(structuredSummary);
      
    } catch (extractionError) {
      console.error(`[PDF] Erro na extração:`, extractionError);
      const errorMessage = `Erro na extração de texto: ${extractionError.message}`;
      await pool.query(
        `UPDATE pdfs SET status = $1, extracted_text = $2 WHERE id = $3`,
        ['error', errorMessage, pdfId_db]
      );
      
      throw new Error(`Erro ao extrair texto do PDF: ${extractionError.message}`);
    }
    
    if (!structuredSummary || structuredSummary.trim().length === 0) {
      try {
        structuredSummary = await generateStructuredSummary(extractedText);
        structuredSummary = await applyDictionaryReplacements(structuredSummary);
      } catch (summaryError) {
        console.error('[PDF] Erro ao gerar resumo estruturado:', summaryError);
      }
    }
    
    let questionsAnswers = '';
    try {
      const textoParaQA = structuredSummary || extractedText;
      questionsAnswers = await generateQuestionsAnswers(textoParaQA);
      questionsAnswers = await applyDictionaryReplacements(questionsAnswers);
      
    } catch (qaError) {
      console.error('[PDF] Erro ao gerar perguntas e respostas:', qaError);
    }
    
    try {
      // Verificar e adicionar colunas se necessário
      try {
        await pool.query(`
          ALTER TABLE pdfs 
          ADD COLUMN IF NOT EXISTS questions_answers TEXT,
          ADD COLUMN IF NOT EXISTS ely_metadata TEXT
        `).catch(() => {});
      } catch (alterError) {
        // Ignora erro se as colunas já existirem
      }
      
      try {
        await pool.query(
          `UPDATE pdfs SET status = $1, structured_summary = $2, questions_answers = $3, ely_metadata = $4 WHERE id = $5`,
          ['completed', structuredSummary || null, questionsAnswers || null, elyMetadata || null, pdfId_db]
        );
      } catch (err) {
        if (err.message && err.message.includes('questions_answers') || err.message.includes('ely_metadata')) {
          await pool.query(`
            ALTER TABLE pdfs 
            ADD COLUMN IF NOT EXISTS questions_answers TEXT,
            ADD COLUMN IF NOT EXISTS ely_metadata TEXT
          `);
          await pool.query(
            `UPDATE pdfs SET status = $1, structured_summary = $2, questions_answers = $3, ely_metadata = $4 WHERE id = $5`,
            ['completed', structuredSummary || null, questionsAnswers || null, elyMetadata || null, pdfId_db]
          );
        } else {
          await pool.query(
            `UPDATE pdfs SET status = $1, structured_summary = $2 WHERE id = $3`,
            ['completed', structuredSummary || null, pdfId_db]
          );
        }
      }
      
    } catch (updateError) {
      console.error('[PDF] Erro ao atualizar banco de dados:', updateError);
      await pool.query(
        `UPDATE pdfs SET status = $1 WHERE id = $2`,
        ['completed', pdfId_db]
      ).catch(() => {});
    }
    
    return {
      success: true,
      pdfId: pdfId_db,
      fileName: savedFileName,
      storagePath: path.relative(path.join(__dirname, '..'), storagePath).replace(/\\/g, '/'),
      extractedText,
      structuredSummary,
      questionsAnswers,
      elyMetadata,
      message: 'PDF processado com sucesso!'
    };
    
  } catch (error) {
    console.error('Erro ao processar arquivo PDF:', error);
    throw error;
  }
}


