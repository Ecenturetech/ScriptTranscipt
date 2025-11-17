import fetch from "node-fetch";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

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
    if (/^\d+$/.test(trimmed)) continue; // número da cue
    if (/^\d{2}:\d{2}:\d{2}\.\d{3}/.test(trimmed)) continue; // timestamp

    rawText.push(trimmed);
  }

  const fullText = rawText.join(" ");

  let pieces = fullText
    .split(".")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const seen = new Set();
  const unique = [];

  for (const p of pieces) {
    if (!seen.has(p.toLowerCase())) {
      seen.add(p.toLowerCase());
      unique.push(p);
    }
  }

  return unique.map((p) => p + ".").join("\n");
}

/**
 * Buscar transcrições via API Vimeo
 */
async function downloadTranscript(videoUrl) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) {
    console.error("URL inválida.");
    return;
  }

  const apiUrl = `https://api.vimeo.com/videos/${videoId}/texttracks`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.VIMEO_TOKEN}`,
    },
  });

  const data = await response.json();

  if (data.error) {
    console.error(" Erro:", data);
    return;
  }

  if (!data.data || data.data.length === 0) {
    console.error(" Nenhuma transcrição encontrada!");
    return;
  }

  const track = data.data[0];
  const vttUrl = track.link;

  const vttResponse = await fetch(vttUrl);
  const vttText = await vttResponse.text();

  const txtFormatted = vttToVimeoStyle(vttText);

  const outputTxt = `transcript-${videoId}.txt`;
  const outputVtt = `transcript-${videoId}.vtt`;

  fs.writeFileSync(outputVtt, vttText);
  fs.writeFileSync(outputTxt, txtFormatted);
}

// Executa via CLI
downloadTranscript(process.argv[2]);
