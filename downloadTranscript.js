import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import generateQA, { generateEnhancedTranscript } from "./ai_qa_generator.js";
import { enrichTranscriptFromCatalog } from "./culture_enricher.js";

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
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateFolder = `${year}-${month}-${day}`;
  
  const storagePath = path.join(__dirname, 'storage', dateFolder);
  
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

  const storagePath = getStoragePath();

  const outputTxtName = `transcript-${videoId}-${track.language}.txt`;
  const outputVttName = `transcript-${videoId}-${track.language}.vtt`;

  const outputTxtPath = path.join(storagePath, outputTxtName);
  const outputVttPath = path.join(storagePath, outputVttName);

  fs.writeFileSync(outputVttPath, vttText);
  console.log("📄 Arquivo VTT (com timestamps) salvo em:");
  console.log("→", outputVttPath);

  const tempTxtPath = path.join(storagePath, `temp-transcript-${videoId}.txt`);
  const tempEnhancedPath = path.join(storagePath, `temp-enhanced-${videoId}.txt`);
  const tempQAPath = path.join(storagePath, `temp-qa-${videoId}.txt`);

  fs.writeFileSync(tempTxtPath, txtFormatted);

  const enrichedText = enrichTranscriptFromCatalog(txtFormatted);

  console.log("\n✨ Iniciando geração de transcrição aprimorada...");
  let enhancedText = "";
  try {
    await generateEnhancedTranscript(tempTxtPath, tempEnhancedPath);
    enhancedText = fs.readFileSync(tempEnhancedPath, 'utf-8');
    console.log("✅ Transcrição aprimorada gerada com sucesso!");
  } catch (error) {
    console.error("❌ Erro ao gerar transcrição aprimorada:", error.message);
    console.error("   Continuando com os outros processos...");
  }

  console.log("\n🔄 Iniciando geração de Q&A...");
  let qaText = "";
  try {
    await generateQA(tempTxtPath, tempQAPath);
    qaText = fs.readFileSync(tempQAPath, 'utf-8');
    console.log("✅ Q&A gerado com sucesso!");
  } catch (error) {
    console.error("❌ Erro ao gerar Q&A:", error.message);
    console.error("   Continuando...");
  }

  const consolidatedContent = [
    "=".repeat(80),
    "TRANSCRIÇÃO COMPLETA",
    `Video ID: ${videoId}`,
    `Idioma: ${track.language}`,
    `Data: ${new Date().toLocaleString('pt-BR')}`,
    "=".repeat(80),
    "",
    "─".repeat(80),
    "1. TRANSCRIÇÃO ORIGINAL (sem timestamps)",
    "─".repeat(80),
    "",
    txtFormatted,
    "",
    "─".repeat(80),
    "2. TRANSCRIÇÃO ENRIQUECIDA COM PRODUTOS",
    "─".repeat(80),
    "",
    enrichedText,
    "",
  ];

  if (enhancedText) {
    consolidatedContent.push(
      "─".repeat(80),
      "3. TRANSCRIÇÃO APRIMORADA",
      "─".repeat(80),
      "",
      enhancedText,
      ""
    );
  }

  if (qaText) {
    consolidatedContent.push(
      "─".repeat(80),
      "4. PERGUNTAS E RESPOSTAS (Q&A)",
      "─".repeat(80),
      "",
      qaText,
      ""
    );
  }

  consolidatedContent.push("=".repeat(80));

  fs.writeFileSync(outputTxtPath, consolidatedContent.join("\n"));
  console.log("\n📝 Arquivo consolidado salvo em:");
  console.log("→", outputTxtPath);

  try {
    if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath);
    if (fs.existsSync(tempEnhancedPath)) fs.unlinkSync(tempEnhancedPath);
    if (fs.existsSync(tempQAPath)) fs.unlinkSync(tempQAPath);
  } catch (error) {
    console.warn("⚠️ Aviso: Não foi possível limpar alguns arquivos temporários");
  }

  const relativePath = path.relative(__dirname, storagePath).replace(/\\/g, '/');
  
  return {
    success: true,
    files: [
      `${relativePath}/${outputTxtName}`,
      `${relativePath}/${outputVttName}`
    ],
    storagePath: relativePath
  };
}

export { downloadTranscript };

if (process.argv[1] && process.argv[1].includes('downloadTranscript.js')) {
  downloadTranscript(process.argv[2]).catch(console.error);
}

