import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

const MAX_FILE_SIZE_MB = 25;
const CHUNK_SIZE_MB = 20;

const KNOWN_FFMPEG_PATHS = [
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-8.0.1-full_build', 'bin', 'ffmpeg.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
];

async function setupFFmpegPath() {
    try {
        await execAsync('ffmpeg -version');
        return true;
    } catch (e) {
        for (const knownPath of KNOWN_FFMPEG_PATHS) {
            if (fs.existsSync(knownPath)) {
                console.log(`💡 FFmpeg encontrado em caminho alternativo: ${knownPath}`);
                ffmpeg.setFfmpegPath(knownPath);
                
                const ffprobePath = knownPath.replace('ffmpeg.exe', 'ffprobe.exe');
                if (fs.existsSync(ffprobePath)) {
                    ffmpeg.setFfprobePath(ffprobePath);
                }
                
                return true;
            }
        }
    }
    return false;
}

async function checkFFmpegAvailable() {
  return await setupFFmpegPath();
}

async function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      const duration = metadata.format.duration;
      resolve(duration);
    });
  });
}

function getFileSizeMB(filePath) {
  const stats = fs.statSync(filePath);
  return stats.size / (1024 * 1024);
}

export async function splitAudioFile(inputPath, outputDir, baseName) {
  try {
    const fileSizeMB = getFileSizeMB(inputPath);
    
    if (fileSizeMB <= MAX_FILE_SIZE_MB) {
      return [inputPath];
    }

    console.log(`Arquivo de ${fileSizeMB.toFixed(2)} MB detectado. Verificando disponibilidade do ffmpeg...`);
    
    const ffmpegAvailable = await checkFFmpegAvailable();
    
    if (!ffmpegAvailable) {
      console.warn('FFmpeg não encontrado no sistema. Tentando processar arquivo completo...');
      console.warn('Para melhor suporte a arquivos grandes, instale o FFmpeg: https://ffmpeg.org/download.html');
      console.warn('A API Whisper pode rejeitar arquivos maiores que 25MB, mas vamos tentar mesmo assim...');
      
      return [inputPath];
    }

    console.log('✅ FFmpeg encontrado. Dividindo arquivo em chunks menores...');
    
    let totalDuration;
    try {
      totalDuration = await getAudioDuration(inputPath);
    } catch (error) {
      console.warn('⚠️  Erro ao obter duração do áudio. Tentando processar arquivo completo...');
      return [inputPath];
    }
    
    const estimatedChunks = Math.ceil(fileSizeMB / CHUNK_SIZE_MB);
    const chunkDuration = totalDuration / estimatedChunks;
    
    const chunkPaths = [];
    const actualChunks = [];
    
    const tempDir = path.join(outputDir, `chunks-${baseName}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    for (let i = 0; i < estimatedChunks; i++) {
      const startTime = i * chunkDuration;
      const chunkPath = path.join(tempDir, `chunk-${i + 1}.mp3`);
      
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .setStartTime(startTime)
          .setDuration(chunkDuration)
          .audioCodec('libmp3lame')
          .audioBitrate(128)
          .on('end', () => {
            const chunkSizeMB = getFileSizeMB(chunkPath);
            
            if (chunkSizeMB > MAX_FILE_SIZE_MB) {
              console.warn(`Chunk ${i + 1} ainda é grande (${chunkSizeMB.toFixed(2)} MB). Comprimindo mais...`);
              fs.unlinkSync(chunkPath);
              ffmpeg(inputPath)
                .setStartTime(startTime)
                .setDuration(chunkDuration)
                .audioCodec('libmp3lame')
                .audioBitrate(64)
                .on('end', () => {
                  const newSize = getFileSizeMB(chunkPath);
                  if (newSize > MAX_FILE_SIZE_MB) {
                    reject(new Error(`Não foi possível reduzir o chunk ${i + 1} abaixo de 25MB`));
                  } else {
                    chunkPaths.push(chunkPath);
                    actualChunks.push(chunkPath);
                    resolve();
                  }
                })
                .on('error', reject)
                .save(chunkPath);
            } else {
              chunkPaths.push(chunkPath);
              actualChunks.push(chunkPath);
              resolve();
            }
          })
          .on('error', reject)
          .save(chunkPath);
      });
    }
    
    console.log(`✅ Arquivo dividido em ${actualChunks.length} chunks`);
    return actualChunks;
    
  } catch (error) {
    console.error('Erro ao dividir arquivo de áudio:', error);
    
    if (fs.existsSync(inputPath)) {
      console.warn('⚠️  Tentando processar arquivo original como fallback...');
      return [inputPath];
    }
    
    throw error;
  }
}

export function cleanupChunks(chunkPaths) {
  try {
    if (!chunkPaths || chunkPaths.length === 0) {
      return;
    }
    
    chunkPaths.forEach(chunkPath => {
      if (chunkPath && fs.existsSync(chunkPath)) {
        try {
          fs.unlinkSync(chunkPath);
        } catch (err) {
          console.warn(`Erro ao remover chunk ${chunkPath}:`, err.message);
        }
      }
    });
    
    if (chunkPaths.length > 0 && chunkPaths[0]) {
      const chunkDir = path.dirname(chunkPaths[0]);
      if (fs.existsSync(chunkDir)) {
        try {
          const files = fs.readdirSync(chunkDir);
          if (files.length === 0) {
            fs.rmdirSync(chunkDir);
          }
        } catch (err) {
        }
      }
    }
  } catch (error) {
    console.error('Erro ao limpar chunks:', error);
  }
}
