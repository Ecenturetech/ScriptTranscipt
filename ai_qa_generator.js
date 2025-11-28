import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatOpenAI } from '@langchain/openai';
import fs from 'fs';

const generateQA = async (context, question) => {
  try {
    console.log("🔄 Iniciando o processo...");

    // 1. Carregar o arquivo de texto
    // O TextLoader lê o arquivo do disco
    const loader = new TextLoader("./transcript_doc.txt");
    const docs = await loader.load();

    const fullText = docs.map((doc) => doc.pageContent).join("\n");

    console.log(`📄 Texto carregado. Tamanho: ${fullText.length} caracteres.`);

    // 2. Configurar o Modelo (LLM)
    // Usamos o gpt-3.5-turbo ou gpt-4o-mini por serem rápidos e baratos
    const model = new ChatOpenAI({
      modelName: "gpt-4o-mini", // ou "gpt-3.5-turbo"
      temperature: 0.7, // Criatividade moderada
      apiKey:
        "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",
    });

    // 3. Criar o Prompt
    // Instruímos a IA sobre como formatar a saída
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

    // 4. Criar a Cadeia (Chain) usando LCEL
    // Prompt -> Modelo -> Parser de String
    const chain = prompt.pipe(model).pipe(new StringOutputParser());

    console.log("🧠 Gerando perguntas e respostas...");

    // 5. Executar a cadeia
    const result = await chain.invoke({
      text: fullText,
    });

    // 6. Salvar o resultado em um arquivo .txt
    const outputFilename = "resultado_qa_doc.txt";
    fs.writeFileSync(outputFilename, result);

    console.log(`✅ Sucesso! O arquivo "${outputFilename}" foi gerado.`);
    console.log("\n--- Prévia do Resultado ---\n");
    console.log(result.slice(0, 200) + "..."); // Mostra o começo do resultado
  } catch (error) {
    console.error("Erro ao gerar pergunta e resposta:", error);
    return null;
  }
};

export default generateQA;