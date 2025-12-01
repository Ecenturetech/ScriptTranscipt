import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import generateQA, { generateEnhancedTranscript } from "./ai_qa_generator.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function extractVideoId(url) {
  const regex = /vimeo\.com\/(\d+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

function vttToVimeoStyle(vtt) {
  const lines = vtt.split("\n");

  let rawText = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) continue;
    if (trimmed === "WEBVTT") continue;
    if (/^\d+$/.test(trimmed)) continue;
    if (/^\d{2}:\d{2}:\d{2}\.\d{3}/.test(trimmed)) continue;

    rawText.push(trimmed);
  }

  return rawText.join(" ");
}

function getStoragePath() {
  // Obter data atual no formato YYYY-MM-DD
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateFolder = `${year}-${month}-${day}`;
  
  // Criar caminho: storage/YYYY-MM-DD
  const storagePath = path.join(__dirname, 'storage', dateFolder);
  
  // Criar pasta se não existir
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
    console.log(`📁 Pasta criada: ${storagePath}`);
  }
  
  return storagePath;
}

async function downloadTranscript(videoUrl) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) {
    const error = "URL inválida.";
    console.error(error);
    return { success: false, error };
  }

  const apiUrl = `https://api.vimeo.com/videos/${videoId}/texttracks`;

  const response = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${process.env.VIMEO_TOKEN}` },
  });

  const data = await response.json();

  // Verificar se houve erro na API
  if (data.error) {
    const error = data.developer_message || data.error || "Erro ao acessar API do Vimeo";
    console.error("Erro na API:", error);
    return { success: false, error };
  }

  console.log(JSON.stringify(data, null, 2));

  if (!data.data || data.data.length === 0) {
    const error = "Nenhuma transcrição encontrada!";
    console.error(error);
    return { success: false, error };
  }

  let track =
    // Português
    data.data.find((t) => t.language === "pt-BR") ||
    data.data.find((t) => t.language === "pt") ||
    data.data.find((t) => t.language === "pt-x-autogen") ||
    // Espanhol
    data.data.find((t) => t.language === "es") ||
    data.data.find((t) => t.language === "es-ES") ||
    data.data.find((t) => t.language === "es-x-autogen");

  if (!track) {
    const error = "Não existe transcrição em português ou espanhol neste vídeo!";
    console.error(error);
    return { success: false, error };
  }

  console.log("Track selecionado:", track.language, track.name);

  const vttResponse = await fetch(track.link);
  const vttText = await vttResponse.text();

  const txtFormatted = vttToVimeoStyle(vttText);

  // Obter caminho da pasta de storage com data atual
  const storagePath = getStoragePath();

  // Nomes dos arquivos
  const outputTxtName = `transcript-${videoId}-${track.language}.txt`;
  const outputVttName = `transcript-${videoId}-${track.language}.vtt`;
  const enhancedName = `transcricaoAprimorada-${videoId}-${track.language}.txt`;
  const qaName = `resultado_qa-${videoId}-${track.language}.txt`;

  // Caminhos completos
  const outputTxtPath = path.join(storagePath, outputTxtName);
  const outputVttPath = path.join(storagePath, outputVttName);
  const enhancedPath = path.join(storagePath, enhancedName);
  const qaPath = path.join(storagePath, qaName);

  // Salvar arquivos
  fs.writeFileSync(outputVttPath, vttText);
  fs.writeFileSync(outputTxtPath, txtFormatted);

  console.log("Transcrição salva em:");
  console.log("→", outputTxtPath);
  console.log("→", outputVttPath);

  // Gerar transcrição aprimorada automaticamente
  // IMPORTANTE: Passar o caminho completo do arquivo que acabamos de salvar
  console.log("\n✨ Iniciando geração de transcrição aprimorada...");
  await generateEnhancedTranscript(outputTxtPath, enhancedPath);

  // Gerar Q&A automaticamente após baixar a transcrição
  // IMPORTANTE: Passar o caminho completo do arquivo que acabamos de salvar
  console.log("\n🔄 Iniciando geração de Q&A...");
  await generateQA(outputTxtPath, qaPath);

  // Retornar caminhos relativos para o front-end
  const relativePath = path.relative(__dirname, storagePath).replace(/\\/g, '/');
  
  return {
    success: true,
    files: [
      `${relativePath}/${outputTxtName}`,
      `${relativePath}/${outputVttName}`,
      `${relativePath}/${enhancedName}`,
      `${relativePath}/${qaName}`
    ],
    storagePath: relativePath
  };
}

// Exportar para uso no servidor
export { downloadTranscript };

// Executar via linha de comando se chamado diretamente
if (process.argv[1] && process.argv[1].includes('downloadTranscript.js')) {
  downloadTranscript(process.argv[2]).catch(console.error);
}

