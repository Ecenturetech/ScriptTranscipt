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
      ? prompts.qaPrompt + '\n\nOBRIGATÓRIO: Gere as perguntas e respostas NO MESMO IDIOMA do texto (espanhol, inglês, português, etc.). NUNCA traduza.'
      : `${prompts.qaPrompt}\n\nTexto base:\n"{text}"\n\nGere o Q&A agora NO MESMO IDIOMA do texto. NUNCA traduza.`;
    
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
      template = prompts.transcriptPrompt + '\n\nOBRIGATÓRIO: Mantenha o texto NO MESMO IDIOMA do original (espanhol, inglês, português, etc.). NUNCA traduza.';
      if (prompts.additionalPrompt && prompts.additionalPrompt.trim() !== '') {
        template = template.replace('{text}', `{text}\n\nInstruções adicionais:\n${prompts.additionalPrompt}`);
      }
    } else {
      template = `
      Você é um especialista em transcrições e formatação de conteúdo técnico.
      
      ${prompts.transcriptPrompt}
      
      Instruções OBRIGATÓRIAS de formatação:
      0. MANTENHA O MESMO IDIOMA: O texto de saída deve estar no mesmo idioma do texto original (espanhol, inglês, português, etc.). NUNCA traduza.
      1. Comece com um Título Principal baseado no conteúdo.
      2. Divida o texto em parágrafos curtos e claros (máximo 4-5 linhas) para facilitar a leitura.
      3. Identifique falantes se houver (ex: "Especialista:", "Produtor:").
      4. Use **Negrito** para termos técnicos importantes, nomes de produtos ou ênfases chave.
      5. Use Listas (bullet points) sempre que houver enumeração de passos, processos, itens ou características.
      6. Crie subtítulos (## Subtítulo) para separar diferentes assuntos ou seções abordados.
      7. Corrija pontuação e gramática mantendo o tom original, eliminando vícios de linguagem excessivos.
      
      EXEMPLO DE SAÍDA DESEJADA:
      
      # Título do Assunto
      
      [Introdução clara do tema...]
      
      ## Tópico Abordado
      
      Explicação do tópico com **termos importantes** em destaque.
      
      * Ponto importante 1
      * Ponto importante 2
      
      [Conclusão ou próximos passos...]
      
      Agora transforme a transcrição original abaixo seguindo este padrão:
      
      Transcrição original:
      "{text}"
      
      Gere agora a transcrição estruturada:
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
      Agora transforme a transcrição original abaixo seguindo o mesmo formato e estilo do exemplo. MANTENHA O MESMO IDIOMA do texto original. Não traduza.
      
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

const IMPROVE_READABILITY_CHUNK_SIZE = 12000;
const IMPROVE_READABILITY_CHUNK_THRESHOLD = 15000;

function splitTextIntoChunks(fullText, maxChunkSize) {
  const trimmed = fullText.substring(0, 100000);
  if (trimmed.length <= maxChunkSize) return [trimmed];

  const chunks = [];
  let start = 0;

  while (start < trimmed.length) {
    let end = Math.min(start + maxChunkSize, trimmed.length);
    if (end < trimmed.length) {
      const lastParagraph = trimmed.lastIndexOf('\n\n', end);
      if (lastParagraph > start) {
        end = lastParagraph + 2;
      } else {
        const lastSpace = trimmed.lastIndexOf(' ', end);
        if (lastSpace > start) end = lastSpace + 1;
      }
    }
    chunks.push(trimmed.slice(start, end).trim());
    start = end;
  }

  return chunks.filter((c) => c.length > 0);
}

const improveTextReadability = async (text) => {
  try {
    if (!text || text.length < 50) return text;

    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.3,
    });

    const template = `
      Você é um assistente de revisão de texto. Sua única função é formatar a transcrição bruta abaixo para torná-la legível.
      
      Regras Rígidas:
      1. MANTENHA O MESMO IDIOMA: O texto deve permanecer no mesmo idioma em que foi escrito (espanhol, inglês, português, etc.). NUNCA traduza.
      2. MANTENHA O CONTEÚDO INTEGRAL: Não remova palavras, não resuma, não mude o estilo.
      3. PARÁGRAFOS: Quebre o texto em parágrafos lógicos (pule uma linha entre eles) para evitar blocos gigantes de texto.
      4. PONTUAÇÃO: Corrija pontuação (pontos, vírgulas, interrogações) para que as frases façam sentido.
      5. CAIXA ALTA: Ajuste maiúsculas/minúsculas adequadamente (início de frases, nomes próprios).
      6. SEM FORMATAÇÃO EXTRA: Não adicione títulos, negrito, itálico ou marcadores. Apenas texto puro.
      
      Texto para formatar:
      "{text}"
      
      Texto formatado:
    `;

    const prompt = PromptTemplate.fromTemplate(template);
    const chain = prompt.pipe(model).pipe(new StringOutputParser());

    const safeText = text.substring(0, 100000);
    if (safeText.length <= IMPROVE_READABILITY_CHUNK_THRESHOLD) {
      const result = await chain.invoke({ text: safeText });
      return result.trim();
    }

    const chunks = splitTextIntoChunks(safeText, IMPROVE_READABILITY_CHUNK_SIZE);
    const total = chunks.length;
    const parts = [];

    for (let i = 0; i < chunks.length; i++) {
      console.log(`[Legibilidade] Processando bloco ${i + 1}/${total} (${chunks[i].length} caracteres)...`);
      const result = await chain.invoke({ text: chunks[i] });
      parts.push(result.trim());
      if (i < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    return parts.join('\n\n');
  } catch (error) {
    console.error("Erro ao melhorar legibilidade do texto original:", error);
    return text;
  }
};

export default generateQA;
export { generateEnhancedTranscript, improveTextReadability };