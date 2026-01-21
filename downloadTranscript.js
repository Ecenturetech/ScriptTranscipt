import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import generateQA, { generateEnhancedTranscript } from "./ai_qa_generator.js";
import { enrichTranscriptFromCatalog } from "./culture_enricher.js";
import { applyDictionaryReplacements } from "./services/videoTranscription.js";
import { processVideoFile } from "./services/videoTranscription.js";
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

async function downloadVideoFromVimeo(videoId, fileName) {
  try {
    console.log(`[VIMEO] Obtendo informações do vídeo ${videoId} para download...`);
    
    const videoInfoUrl = `https://api.vimeo.com/videos/${videoId}`;
    const videoInfoResponse = await fetch(videoInfoUrl, {
      headers: { Authorization: `Bearer ${process.env.VIMEO_TOKEN}` },
    });

    if (!videoInfoResponse.ok) {
      const errorText = await videoInfoResponse.text();
      console.error(`[VIMEO] Erro ao obter informações do vídeo: ${videoInfoResponse.status} - ${errorText}`);
      throw new Error(`Erro ao obter informações do vídeo: ${videoInfoResponse.status} ${videoInfoResponse.statusText}`);
    }

    const videoInfo = await videoInfoResponse.json();
    
    if (videoInfo.error) {
      throw new Error(videoInfo.developer_message || videoInfo.error || "Erro ao obter informações do vídeo");
    }

    let downloadUrl = null;
    if (videoInfo.download && videoInfo.download.length > 0) {
      const sortedDownloads = videoInfo.download.sort((a, b) => {
        const qualityA = parseInt(a.quality) || 0;
        const qualityB = parseInt(b.quality) || 0;
        return qualityB - qualityA;
      });
      downloadUrl = sortedDownloads[0].link;
      console.log(`[VIMEO] URL de download encontrada (qualidade: ${sortedDownloads[0].quality})`);
    } else if (videoInfo.files && videoInfo.files.length > 0) {
      const sortedFiles = videoInfo.files.sort((a, b) => {
        const widthA = parseInt(a.width) || 0;
        const widthB = parseInt(b.width) || 0;
        return widthB - widthA;
      });
      downloadUrl = sortedFiles[0].link;
      console.log(`[VIMEO] URL de download encontrada via files (resolução: ${sortedFiles[0].width}x${sortedFiles[0].height})`);
    }

    if (!downloadUrl) {
      throw new Error("URL de download não disponível. O vídeo pode estar protegido ou privado.");
    }

    console.log(`[VIMEO] Baixando vídeo de: ${downloadUrl.substring(0, 100)}...`);
    
    const storagePath = getStoragePath();
    const filePath = path.join(storagePath, fileName);
    
    const response = await axios({
      method: 'GET',
      url: downloadUrl,
      responseType: 'stream',
      headers: {
        Authorization: `Bearer ${process.env.VIMEO_TOKEN}`,
      },
      timeout: 600000,
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 400;
      }
    });
    
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`[VIMEO] Vídeo baixado com sucesso: ${filePath}`);
        resolve(filePath);
      });
      writer.on('error', (error) => {
        console.error(`[VIMEO] Erro ao escrever arquivo:`, error);
        reject(error);
      });
      response.data.on('error', (error) => {
        console.error(`[VIMEO] Erro ao baixar vídeo:`, error);
        reject(error);
      });
    });
  } catch (error) {
    console.error(`[VIMEO] Erro ao baixar vídeo do Vimeo:`, error);
    throw error;
  }
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

function sanitizeFileName(name) {
  if (!name) return '';
  // Remove caracteres especiais e substitui espaços por hífens
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // Remove caracteres inválidos para nomes de arquivo
    .replace(/\s+/g, '-') // Substitui espaços múltiplos por hífen
    .replace(/-+/g, '-') // Remove hífens duplicados
    .replace(/^-|-$/g, '') // Remove hífens no início e fim
    .substring(0, 100); // Limita o tamanho
}

async function getVimeoVideoInfo(videoId) {
  try {
    const videoInfoUrl = `https://api.vimeo.com/videos/${videoId}`;
    const videoInfoResponse = await fetch(videoInfoUrl, {
      headers: { Authorization: `Bearer ${process.env.VIMEO_TOKEN}` },
    });

    if (!videoInfoResponse.ok) {
      const errorText = await videoInfoResponse.text();
      console.error(`[VIMEO] Erro ao obter informações do vídeo: ${videoInfoResponse.status} - ${errorText}`);
      return null;
    }

    const videoInfo = await videoInfoResponse.json();
    
    if (videoInfo.error) {
      console.error(`[VIMEO] Erro na resposta: ${videoInfo.developer_message || videoInfo.error}`);
      return null;
    }

    return videoInfo;
  } catch (error) {
    console.error(`[VIMEO] Erro ao buscar informações do vídeo:`, error.message);
    return null;
  }
}

async function downloadTranscript(videoUrl) {
  console.log(`[VIMEO] Processando URL: ${videoUrl}`);
  
  const videoId = extractVideoId(videoUrl);
  if (!videoId) {
    const error = `URL inválida: ${videoUrl}. Formato esperado: https://vimeo.com/VIDEO_ID`;
    console.error(`[VIMEO] ${error}`);
    return { success: false, error };
  }

  console.log(`[VIMEO] Video ID extraído: ${videoId}`);

  if (!process.env.VIMEO_TOKEN) {
    const error = "VIMEO_TOKEN não configurado no arquivo .env";
    console.error(`[VIMEO] ${error}`);
    return { success: false, error };
  }

  // Buscar informações do vídeo para obter o título
  let videoTitle = null;
  const videoInfo = await getVimeoVideoInfo(videoId);
  if (videoInfo && videoInfo.name) {
    videoTitle = videoInfo.name;
    console.log(`[VIMEO] Título do vídeo encontrado: ${videoTitle}`);
  } else {
    console.log(`[VIMEO] Título do vídeo não encontrado, usando ID como fallback`);
  }

  // Criar nome do arquivo com título ou fallback para ID
  const sanitizedTitle = videoTitle ? sanitizeFileName(videoTitle) : null;
  const baseFileName = sanitizedTitle 
    ? `${sanitizedTitle}-${videoId}` 
    : `vimeo-${videoId}`;

  let videoId_db = null;
  try {
    console.log(`[VIMEO] Criando registro no banco de dados com status 'processing'...`);
    const videoId_db_uuid = uuidv4();
    const fileName = `${baseFileName}.txt`;
    
    await pool.query(
      `INSERT INTO videos (id, file_name, source_type, source_url, status, transcript, structured_transcript, questions_answers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        videoId_db_uuid,
        fileName,
        'vimeo',
        videoUrl,
        'processing',
        null,
        null,
        null
      ]
    );
    videoId_db = videoId_db_uuid;
    console.log(`[VIMEO] Registro criado no banco de dados com ID: ${videoId_db_uuid}`);
  } catch (error) {
    console.error("[VIMEO] Erro ao criar registro no banco de dados:", error.message);
  }

  const apiUrl = `https://api.vimeo.com/videos/${videoId}/texttracks`;
  console.log(`[VIMEO] Fazendo requisição para: ${apiUrl}`);

  let track;
  try {
    const response = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${process.env.VIMEO_TOKEN}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[VIMEO] Erro na resposta da API: ${response.status} - ${errorText}`);
      const error = `Erro ao acessar API do Vimeo: ${response.status} ${response.statusText}`;
      return { success: false, error };
    }

    const data = await response.json();

    if (data.error) {
      const error = data.developer_message || data.error || "Erro ao acessar API do Vimeo";
      console.error(`[VIMEO] Erro retornado pela API: ${error}`);
      return { success: false, error };
    }

    if (!data.data || data.data.length === 0) {
      console.log(`[VIMEO] Nenhuma legenda encontrada. Fazendo fallback: baixando vídeo e transcrevendo com Whisper...`);
      return await downloadAndTranscribeVideo(videoId, videoUrl, videoId_db);
    }

    console.log(`[VIMEO] Encontradas ${data.data.length} transcrição(ões) disponível(is)`);

    const availableLanguages = data.data.map(t => t.language).join(', ');
    console.log(`[VIMEO] Idiomas disponíveis: ${availableLanguages}`);

    track =
      data.data.find((t) => t.language === "pt-BR") ||
      data.data.find((t) => t.language === "pt") ||
      data.data.find((t) => t.language === "pt-x-autogen") ||
      data.data.find((t) => t.language === "es") ||
      data.data.find((t) => t.language === "es-ES") ||
      data.data.find((t) => t.language === "es-x-autogen");

    if (!track) {
      console.log(`[VIMEO] Nenhuma legenda em português ou espanhol encontrada. Idiomas disponíveis: ${availableLanguages}`);
      console.log(`[VIMEO] Fazendo fallback: baixando vídeo e transcrevendo com Whisper...`);
      return await downloadAndTranscribeVideo(videoId, videoUrl, videoId_db);
    }

    console.log(`[VIMEO] Usando transcrição no idioma: ${track.language}`);

    console.log(`[VIMEO] Baixando arquivo VTT de: ${track.link}`);
    const vttResponse = await fetch(track.link);
    
    if (!vttResponse.ok) {
      const error = `Erro ao baixar arquivo VTT: ${vttResponse.status} ${vttResponse.statusText}`;
      console.error(`[VIMEO] ${error}`);
      return { success: false, error };
    }
    
    const vttText = await vttResponse.text();
    console.log(`[VIMEO] Arquivo VTT baixado com sucesso (${vttText.length} caracteres)`);

    let txtFormatted = vttToVimeoStyle(vttText);
  
  txtFormatted = await applyDictionaryReplacements(txtFormatted);

  const storagePath = getStoragePath();

  const outputTxtName = `${baseFileName}-${track.language}.txt`;
  const outputVttName = `${baseFileName}-${track.language}.vtt`;

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
    videoTitle ? `Título: ${videoTitle}` : `Video ID: ${videoId}`,
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
  }

  const relativePath = path.relative(__dirname, storagePath).replace(/\\/g, '/');
  
    if (videoId_db) {
      try {
        console.log(`[VIMEO] Atualizando registro no banco de dados com dados processados...`);
        const fileName = `${baseFileName}-${track.language}.txt`;
        
        await pool.query(
          `UPDATE videos SET status = $1, file_name = $2, transcript = $3, structured_transcript = $4, questions_answers = $5 WHERE id = $6`,
          [
            'completed',
            fileName,
            txtFormatted,
            enhancedText || null,
            qaText || null,
            videoId_db
          ]
        );
        console.log(`[VIMEO] Registro atualizado no banco de dados com sucesso`);
      } catch (error) {
        console.error("[VIMEO] Erro ao atualizar registro no banco de dados:", error.message);
      }
    } else {
      try {
        console.log(`[VIMEO] Criando registro no banco de dados (fallback)...`);
        const videoId_db_uuid = uuidv4();
        const fileName = `${baseFileName}-${track.language}.txt`;
        
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
        console.log(`[VIMEO] Registro criado no banco de dados com ID: ${videoId_db_uuid}`);
      } catch (error) {
        console.error("[VIMEO] Erro ao criar registro no banco de dados:", error.message);
      }
    }
  } catch (fetchError) {
    console.error(`[VIMEO] Erro ao fazer requisição ou processar:`, fetchError);
    const error = `Erro ao fazer requisição para API do Vimeo: ${fetchError.message}`;
    
    if (videoId_db) {
      try {
        await pool.query(
          `UPDATE videos SET status = $1, transcript = $2 WHERE id = $3`,
          ['error', error, videoId_db]
        );
      } catch (dbError) {
        console.error("[VIMEO] Erro ao atualizar status de erro no banco:", dbError.message);
      }
    }
    
    return { success: false, error };
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

async function downloadAndTranscribeVideo(videoId, videoUrl, existingVideoIdDb = null) {
  try {
    console.log(`[VIMEO] Iniciando download e transcrição do vídeo ${videoId}...`);
    
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.length < 10) {
      const error = "OPENAI_API_KEY ausente ou inválida. É necessária para transcrição com Whisper.";
      console.error(`[VIMEO] ${error}`);
      
      if (existingVideoIdDb) {
        try {
          await pool.query(
            `UPDATE videos SET status = $1, transcript = $2 WHERE id = $3`,
            ['error', error, existingVideoIdDb]
          );
        } catch (dbError) {
          console.error("[VIMEO] Erro ao atualizar status de erro no banco:", dbError.message);
        }
      }
      
      return { success: false, error };
    }

    // Buscar informações do vídeo para obter o título
    let videoTitle = null;
    const videoInfo = await getVimeoVideoInfo(videoId);
    if (videoInfo && videoInfo.name) {
      videoTitle = videoInfo.name;
      console.log(`[VIMEO] Título do vídeo encontrado: ${videoTitle}`);
    }

    // Criar nome do arquivo com título ou fallback para ID
    const sanitizedTitle = videoTitle ? sanitizeFileName(videoTitle) : null;
    const baseFileName = sanitizedTitle 
      ? `${sanitizedTitle}-${videoId}` 
      : `vimeo-${videoId}`;

    const storagePath = getStoragePath();
    const fileName = `${baseFileName}.mp4`;
    const filePath = await downloadVideoFromVimeo(videoId, fileName);

    console.log(`[VIMEO] Vídeo baixado. Iniciando transcrição com Whisper...`);
    
    let result;
    if (existingVideoIdDb) {
      result = await processVideoFile(filePath, fileName);
      
      if (result.videoId && result.videoId !== existingVideoIdDb) {
        try {
          await pool.query(`DELETE FROM videos WHERE id = $1`, [result.videoId]);
        } catch (deleteError) {
          console.error("[VIMEO] Erro ao deletar registro duplicado:", deleteError.message);
        }
      }
      
      try {
        await pool.query(
          `UPDATE videos SET status = $1, source_type = $2, source_url = $3, transcript = $4, structured_transcript = $5, questions_answers = $6 WHERE id = $7`,
          [
            'completed',
            'vimeo',
            videoUrl,
            result.transcript || null,
            result.structuredTranscript || null,
            result.questionsAnswers || null,
            existingVideoIdDb
          ]
        );
        result.videoId = existingVideoIdDb;
        console.log(`[VIMEO] Registro existente atualizado com dados processados`);
      } catch (updateError) {
        console.error("[VIMEO] Erro ao atualizar registro existente:", updateError.message);
          }
    } else {
      result = await processVideoFile(filePath, fileName);
      
      if (result.videoId) {
        await pool.query(
          `UPDATE videos SET source_type = $1, source_url = $2 WHERE id = $3`,
          ['vimeo', videoUrl, result.videoId]
        );
      }
    }
    
    console.log(`[VIMEO] Transcrição concluída com sucesso usando Whisper!`);
    
    return {
      success: true,
      videoId: result.videoId,
      transcript: result.transcript,
      structuredTranscript: result.structuredTranscript,
      questionsAnswers: result.questionsAnswers,
      message: 'Vídeo baixado e transcrito com Whisper (fallback - sem legendas disponíveis)'
    };
  } catch (error) {
    console.error(`[VIMEO] Erro ao baixar e transcrever vídeo:`, error);
    
    if (existingVideoIdDb) {
      try {
        await pool.query(
          `UPDATE videos SET status = $1, transcript = $2 WHERE id = $3`,
          ['error', `Erro ao baixar e transcrever vídeo: ${error.message}`, existingVideoIdDb]
        );
      } catch (dbError) {
        console.error("[VIMEO] Erro ao atualizar status de erro no banco:", dbError.message);
      }
    }
    
    return { 
      success: false, 
      error: `Erro ao baixar e transcrever vídeo: ${error.message}` 
    };
  }
}

export { downloadTranscript };

if (process.argv[1] && process.argv[1].includes('downloadTranscript.js')) {
  downloadTranscript(process.argv[2]).catch(console.error);
}

