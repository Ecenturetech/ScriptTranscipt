import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatOpenAI } from '@langchain/openai';
import fs from 'fs';
import dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import pool from './db/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '.env');

if (!process.env.OPENAI_API_KEY) {
  dotenv.config({ path: envPath });
}

/**
 * @returns {Promise<{transcriptPrompt: string, qaPrompt: string, additionalPrompt: string}>}
 * @throws {Error}
 */
async function getPromptsFromDatabase() {
  const { rows } = await pool.query('SELECT * FROM settings WHERE id = 1');
  
  if (rows.length === 0) {
    throw new Error('Configurações de prompts não encontradas no banco de dados. Execute: npm run migrate');
  }
  
  return {
    transcriptPrompt: rows[0].transcript_prompt || '',
    qaPrompt: rows[0].qa_prompt || '',
    additionalPrompt: rows[0].additional_prompt || ''
  };
}

const generateQA = async (inputFile = "./transcript_doc.txt", outputFile = "resultado_qa_doc.txt") => {
  try {
    const fullText = fs.readFileSync(inputFile, 'utf-8');
    
    const prompts = await getPromptsFromDatabase();
    
    if (!prompts.qaPrompt || prompts.qaPrompt.trim() === '') {
      throw new Error('Prompt de Q&A não configurado no banco de dados. Configure através da interface de settings.');
    }

    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.7,
    });

    let template = prompts.qaPrompt.includes('{text}') 
      ? prompts.qaPrompt 
      : `${prompts.qaPrompt}\n\nTexto base:\n"{text}"\n\nGere o Q&A agora e utilize a língua do texto original:`;
    
    if (prompts.additionalPrompt && prompts.additionalPrompt.trim() !== '') {
      template += `\n\nInstruções adicionais:\n${prompts.additionalPrompt}`;
    }

    const prompt = PromptTemplate.fromTemplate(template);

    const chain = prompt.pipe(model).pipe(new StringOutputParser());

    const result = await chain.invoke({
      text: fullText,
    });

    fs.writeFileSync(outputFile, result);
  } catch (error) {
    console.error("Erro ao gerar pergunta e resposta:", error);
    throw error;
  }
};

const generateEnhancedTranscript = async (inputFile = "./transcript_doc.txt", outputFile = "transcricaoAprimorada.txt") => {
  try {
    const fullText = fs.readFileSync(inputFile, 'utf-8');
    
    const prompts = await getPromptsFromDatabase();
    
    if (!prompts.transcriptPrompt || prompts.transcriptPrompt.trim() === '') {
      throw new Error('Prompt de transcrição não configurado no banco de dados. Configure através da interface de settings.');
    }

    let exampleText = "";
    try {
      exampleText = fs.readFileSync("./ExemploTranscricaoMelhorada.txt", 'utf-8');
    } catch (error) {
    }

    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.3,
    });

    let template = '';
    
    if (prompts.transcriptPrompt.includes('{text}')) {
      template = prompts.transcriptPrompt;
      if (prompts.additionalPrompt && prompts.additionalPrompt.trim() !== '') {
        template = template.replace('{text}', `{text}\n\nInstruções adicionais:\n${prompts.additionalPrompt}`);
      }
    } else {
      template = `
      Você é um especialista em transcrições e formatação de conteúdo.
      
      ${prompts.transcriptPrompt}
      
      Instruções adicionais:
      1. Comece com "[Transcrição melhorada do material]" na primeira linha
      2. Identifique e mantenha os falantes (identifique por contexto como "Agrônomo:", "Apresentador:", "Falante 1:", etc.)
      3. Use o formato: [Nome do Falante]: [Texto formatado e aprimorado]
      4. Organize o texto em parágrafos coerentes e bem estruturados
      5. Corrija erros de transcrição óbvios, mas mantenha a fidelidade ao conteúdo original
      6. Melhore a pontuação e a estrutura das frases para melhor legibilidade
      7. Mantenha o tom e o estilo original
      8. Não invente informações que não estão no texto original
      9. Cada fala do mesmo falante deve estar em uma linha separada com o formato: [Nome do Falante]: [Texto]
    `;

      if (prompts.additionalPrompt && prompts.additionalPrompt.trim() !== '') {
        template += `\n\nPrompt adicional customizado:\n${prompts.additionalPrompt}\n`;
      }

      if (exampleText) {
        const exampleLines = exampleText.split('\n');
        const exampleTranscript = [];
        for (const line of exampleLines) {
          if (line.includes('🔍 Perguntas')) break;
          exampleTranscript.push(line);
        }
        const exampleOnly = exampleTranscript.join('\n');
        
        template += `
      
      EXEMPLO DE FORMATO (siga este padrão exatamente):
      ${exampleOnly}
      
      ---
      `;
      }

      template += `
      Agora transforme a transcrição original abaixo seguindo o mesmo formato e estilo do exemplo:
      
      Transcrição original:
      "{text}"
      
      Gere agora a transcrição aprimorada no mesmo formato do exemplo:
    `;
    }

    const prompt = PromptTemplate.fromTemplate(template);

    const chain = prompt.pipe(model).pipe(new StringOutputParser());

    const result = await chain.invoke({
      text: fullText,
    });

    fs.writeFileSync(outputFile, result);
  } catch (error) {
    console.error("Erro ao gerar transcrição aprimorada:", error);
    throw error;
  }
};

export default generateQA;
export { generateEnhancedTranscript };