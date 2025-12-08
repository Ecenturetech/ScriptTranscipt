import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatOpenAI } from '@langchain/openai';
import fs from 'fs';

const generateQA = async (inputFile = "./transcript_doc.txt", outputFile = "resultado_qa_doc.txt") => {
  try {
    console.log("🔄 Iniciando o processo...");

    const fullText = fs.readFileSync(inputFile, 'utf-8');

    console.log(`📄 Texto carregado. Tamanho: ${fullText.length} caracteres.`);

    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.7,
      apiKey:
        "openai-api-key",
    });

    const template = `
      Você é um assistente educacional especialista.
      Sua tarefa é ler o texto abaixo e gerar um conjunto de Perguntas e Respostas (Q&A) detalhadas baseadas APENAS nesse texto.
      
      Formato desejado:
      P: [Pergunta]
      R: [Resposta]
      ---
      
      Texto base:
      "{text}"
      
      Gere o Q&A agora e utilize a língua do texto original:
    `;

    const prompt = PromptTemplate.fromTemplate(template);

    const chain = prompt.pipe(model).pipe(new StringOutputParser());

    console.log("🧠 Gerando perguntas e respostas...");

    const result = await chain.invoke({
      text: fullText,
    });

    fs.writeFileSync(outputFile, result);

    console.log(`✅ Sucesso! O arquivo "${outputFile}" foi gerado.`);
    console.log("\n--- Prévia do Resultado ---\n");
    console.log(result.slice(0, 200) + "...");
  } catch (error) {
    console.error("Erro ao gerar pergunta e resposta:", error);
    return null;
  }
};

const generateEnhancedTranscript = async (inputFile = "./transcript_doc.txt", outputFile = "transcricaoAprimorada.txt") => {
  try {
    console.log("🔄 Iniciando aprimoramento da transcrição...");

    const fullText = fs.readFileSync(inputFile, 'utf-8');

    let exampleText = "";
    try {
      exampleText = fs.readFileSync("./ExemploTranscricaoMelhorada.txt", 'utf-8');
      console.log("📋 Exemplo de referência carregado.");
    } catch (error) {
      console.log("⚠️ Arquivo de exemplo não encontrado, usando instruções padrão.");
    }

    console.log(`📄 Texto carregado. Tamanho: ${fullText.length} caracteres.`);

    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.3,
      apiKey:
        "openai-api-key",
    });

    let template = `
      Você é um especialista em transcrições e formatação de conteúdo.
      
      Sua tarefa é transformar a transcrição bruta abaixo em uma versão aprimorada e bem formatada, seguindo EXATAMENTE o formato e estilo do exemplo fornecido.
      
      Instruções:
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

    const prompt = PromptTemplate.fromTemplate(template);

    const chain = prompt.pipe(model).pipe(new StringOutputParser());

    console.log("✨ Gerando transcrição aprimorada...");

    const result = await chain.invoke({
      text: fullText,
    });

    fs.writeFileSync(outputFile, result);

    console.log(`✅ Sucesso! O arquivo "${outputFile}" foi gerado.`);
    console.log("\n--- Prévia do Resultado ---\n");
    console.log(result.slice(0, 300) + "...");
  } catch (error) {
    console.error("Erro ao gerar transcrição aprimorada:", error);
    return null;
  }
};

export default generateQA;
export { generateEnhancedTranscript };