import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadTranscript } from './downloadTranscript.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.post('/api/transcribe', async (req, res) => {
  try {
    const { videoUrl } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ 
        success: false, 
        error: 'URL do vídeo é obrigatória' 
      });
    }

    if (!videoUrl.includes('vimeo.com')) {
      return res.status(400).json({ 
        success: false, 
        error: 'URL inválida. Forneça uma URL do Vimeo.' 
      });
    }

    const result = await downloadTranscript(videoUrl);

    if (!result || !result.success) {
      return res.status(500).json({ 
        success: false, 
        error: result?.error || 'Erro desconhecido ao processar transcrição' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Transcrição processada com sucesso!',
      files: result.files || []
    });

  } catch (error) {
    console.error('Erro ao processar transcrição:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Erro ao processar transcrição' 
    });
  }
});

app.get('/api/download/:path(*)', (req, res) => {
  try {
    const requestedPath = req.params.path || '';
    const fullPath = path.join(__dirname, requestedPath);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ 
        success: false, 
        error: 'Arquivo não encontrado' 
      });
    }

    const ext = path.extname(fullPath);
    if (ext !== '.txt' && ext !== '.vtt') {
      return res.status(400).json({ 
        success: false, 
        error: 'Tipo de arquivo não permitido' 
      });
    }

    const filename = path.basename(fullPath);

    res.download(fullPath, filename, (err) => {
      if (err) {
        console.error('Erro ao fazer download:', err);
        res.status(500).json({ 
          success: false, 
          error: 'Erro ao fazer download do arquivo' 
        });
      }
    });

  } catch (error) {
    console.error('Erro ao processar download:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Erro ao processar download' 
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});

