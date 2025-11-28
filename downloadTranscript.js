import fetch from "node-fetch";
import fs from "fs";
import dotenv from "dotenv";
import generateQA from "./ai_qa_generator.js";
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
    if (/^\d+$/.test(trimmed)) continue;
    if (/^\d{2}:\d{2}:\d{2}\.\d{3}/.test(trimmed)) continue;

    rawText.push(trimmed);
  }

  return rawText.join(" ");
}

async function downloadTranscript(videoUrl) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) {
    console.error("URL inválida.");
    return;
  }

  const apiUrl = `https://api.vimeo.com/videos/${videoId}/texttracks`;

  const response = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${process.env.VIMEO_TOKEN}` },
  });

  const data = await response.json();

  console.log(JSON.stringify(data, null, 2));

  if (!data.data || data.data.length === 0) {
    console.error("Nenhuma transcrição encontrada!");
    return;
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
    console.error(
      "Não existe transcrição em português ou espanhol neste vídeo!"
    );
    return;
  }

  console.log("Track selecionado:", track.language, track.name);

  const vttResponse = await fetch(track.link);
  const vttText = await vttResponse.text();

  const txtFormatted = vttToVimeoStyle(vttText);

  const outputTxt = `transcript-${videoId}-${track.language}.txt`;
  const outputVtt = `transcript-${videoId}-${track.language}.vtt`;

  fs.writeFileSync(outputVtt, vttText);
  fs.writeFileSync(outputTxt, txtFormatted);

  console.log("Transcrição salva em:");
  console.log("→", outputTxt);
  console.log("→", outputVtt);
}

// downloadTranscript(process.argv[2]);

generateQA();
