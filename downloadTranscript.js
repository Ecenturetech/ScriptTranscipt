import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import generateQA, { generateEnhancedTranscript } from "./ai_qa_generator.js";
import { enrichTranscriptFromCatalog } from "./culture_enricher.js";
import { applyDictionaryReplacements } from "./services/videoTranscription.js";
import pool from "./db/connection.js";
import { getStoragePath } from "./utils/storage.js";

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

async function downloadTranscript(videoUrl) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) {
    const error = "URL inválida.";
    return { success: false, error };
  }

  const apiUrl = `https://api.vimeo.com/videos/${videoId}/texttracks`;

  const response = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${process.env.VIMEO_TOKEN}` },
  });

  const data = await response.json();

  if (data.error) {
    const error = data.developer_message || data.error || "Erro ao acessar API do Vimeo";
    return { success: false, error };
  }

  if (!data.data || data.data.length === 0) {
    const error = "Nenhuma transcrição encontrada!";
    return { success: false, error };
  }

  let track =
    data.data.find((t) => t.language === "pt-BR") ||
    data.data.find((t) => t.language === "pt") ||
    data.data.find((t) => t.language === "pt-x-autogen") ||
    data.data.find((t) => t.language === "es") ||
    data.data.find((t) => t.language === "es-ES") ||
    data.data.find((t) => t.language === "es-x-autogen");

  if (!track) {
    const error = "Não existe transcrição em português ou espanhol neste vídeo!";
    return { success: false, error };
  }

  const vttResponse = await fetch(track.link);
  const vttText = await vttResponse.text();

  let txtFormatted = vttToVimeoStyle(vttText);
  
  txtFormatted = await applyDictionaryReplacements(txtFormatted);

  const storagePath = getStoragePath();

  const outputTxtName = `transcript-${videoId}-${track.language}.txt`;
  const outputVttName = `transcript-${videoId}-${track.language}.vtt`;

  const outputTxtPath = path.join(storagePath, outputTxtName);
  const outputVttPath = path.join(storagePath, outputVttName);

  fs.writeFileSync(outputVttPath, vttText);

  const tempTxtPath = path.join(storagePath, `temp-transcript-${videoId}.txt`);
  const tempEnhancedPath = path.join(storagePath, `temp-enhanced-${videoId}.txt`);
  const tempQAPath = path.join(storagePath, `temp-qa-${videoId}.txt`);

  fs.writeFileSync(tempTxtPath, txtFormatted);

  let enrichedText = enrichTranscriptFromCatalog(txtFormatted);
  enrichedText = await applyDictionaryReplacements(enrichedText);

  let enhancedText = "";
  try {
    await generateEnhancedTranscript(tempTxtPath, tempEnhancedPath);
    enhancedText = fs.readFileSync(tempEnhancedPath, 'utf-8');
    enhancedText = await applyDictionaryReplacements(enhancedText);
  } catch (error) {
    console.error("Erro ao gerar transcrição aprimorada:", error.message);
  }

  let qaText = "";
  try {
    await generateQA(tempTxtPath, tempQAPath);
    qaText = fs.readFileSync(tempQAPath, 'utf-8');
    qaText = await applyDictionaryReplacements(qaText);
  } catch (error) {
    console.error("Erro ao gerar Q&A:", error.message);
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

  try {
    if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath);
    if (fs.existsSync(tempEnhancedPath)) fs.unlinkSync(tempEnhancedPath);
    if (fs.existsSync(tempQAPath)) fs.unlinkSync(tempQAPath);
  } catch (error) {
    // Silenciosamente ignora erros de limpeza
  }

  const relativePath = path.relative(__dirname, storagePath).replace(/\\/g, '/');
  
  let videoId_db = null;
  try {
    const videoId_db_uuid = uuidv4();
    const fileName = `transcript-${videoId}-${track.language}.txt`;
    
    await pool.query(
      `INSERT INTO videos (id, file_name, source_type, source_url, status, transcript, structured_transcript, questions_answers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        videoId_db_uuid,
        fileName,
        'vimeo',
        videoUrl,
        'completed',
        txtFormatted,
        enhancedText || null,
        qaText || null
      ]
    );
    
    videoId_db = videoId_db_uuid;
  } catch (error) {
    console.error("Erro ao salvar no banco de dados:", error.message);
  }
  
  return {
    success: true,
    videoId: videoId_db,
    files: [
      `${relativePath}/${outputTxtName}`,
      `${relativePath}/${outputVttName}`
    ],
    storagePath: relativePath,
    transcript: txtFormatted,
    structuredTranscript: enhancedText || null,
    questionsAnswers: qaText || null
  };
}

export { downloadTranscript };

if (process.argv[1] && process.argv[1].includes('downloadTranscript.js')) {
  downloadTranscript(process.argv[2]).catch(console.error);
}

