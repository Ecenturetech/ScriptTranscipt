import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatOpenAI } from '@langchain/openai';
import dotenv from 'dotenv';
import { resolve } from 'path';
import pool from '../db/connection.js';
import { getStoragePath } from '../utils/storage.js';
import { applyDictionaryReplacements } from './videoTranscription.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

async function generateQuestionsAnswers(text) {
  try {
    const prompts = await getPromptsFromDatabase();
    
    if (!prompts.qaPrompt || prompts.qaPrompt.trim() === '') {
      throw new Error('Prompt de Q&A (qa_prompt) não configurado no banco de dados. Configure através da interface de settings.');
    }
    
    const textoLimitado = text.substring(0, 100000);
    
    let promptContent = '';
    
    if (prompts.qaPrompt.includes('{text}')) {
      promptContent = prompts.qaPrompt.replace('{text}', textoLimitado);
    } else {
      promptContent = `${prompts.qaPrompt}

Texto base:
"""
${textoLimitado}
"""

Gere o Q&A agora e utilize a língua do texto original:`;
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
    
    const textoLimitado = text.substring(0, 100000);
    
    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.3,
    });
    
    let template = '';
    
    if (prompts.transcriptPrompt.includes('{text}')) {
      template = prompts.transcriptPrompt;
    } else {
      template = prompts.transcriptPrompt;
      
      if (prompts.additionalPrompt && prompts.additionalPrompt.trim() !== '') {
        template += `\n\n${prompts.additionalPrompt}`;
      }
      
      template += `\n\nTranscrição original:\n"{text}"\n\nGere agora a transcrição aprimorada no mesmo formato do exemplo:`;
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

export async function processPDFFile(filePath, fileName) {
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
    
    try {
      extractedText = await extractRawTextFromPDF(savedFilePath);
      
      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error('Nenhum texto foi extraído do PDF');
      }
      
      extractedText = await applyDictionaryReplacements(extractedText);
      
      await pool.query(
        `UPDATE pdfs SET extracted_text = $1 WHERE id = $2`,
        [extractedText, pdfId_db]
      );
      
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
      try {
        await pool.query(
          `UPDATE pdfs SET status = $1, structured_summary = $2, questions_answers = $3 WHERE id = $4`,
          ['completed', structuredSummary || null, questionsAnswers || null, pdfId_db]
        );
      } catch (err) {
        if (err.message && err.message.includes('questions_answers')) {
          await pool.query(`
            ALTER TABLE pdfs 
            ADD COLUMN IF NOT EXISTS questions_answers TEXT
          `);
          await pool.query(
            `UPDATE pdfs SET status = $1, structured_summary = $2, questions_answers = $3 WHERE id = $4`,
            ['completed', structuredSummary || null, questionsAnswers || null, pdfId_db]
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
      message: 'PDF processado com sucesso!'
    };
    
  } catch (error) {
    console.error('Erro ao processar arquivo PDF:', error);
    throw error;
  }
}


