import './utils/polyfills.js';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path, { resolve } from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { downloadTranscript } from './downloadTranscript.js';
import { processVideoFile } from './services/videoTranscription.js';
import queue from './services/queue.js';
import videoRoutes from './routes/videos.js';
import pdfRoutes from './routes/pdfs.js';
import settingsRoutes from './routes/settings.js';
import dictionaryRoutes from './routes/dictionary.js';
import scormRoutes from './routes/scorms.js';
import { getStoragePath } from './utils/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = resolve(__dirname, '.env');
dotenv.config({ path: envPath });

if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️  AVISO: OPENAI_API_KEY não encontrada no .env');
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = getStoragePath();
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 10241
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'video/webm',
      'audio/mpeg',
      'audio/wav',
      'audio/x-m4a',
      'audio/ogg',
      'audio/mp4'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não suportado. Use vídeo (MP4, MOV, AVI...) ou áudio (MP3, WAV, M4A...).'));
    }
  }
});

const uploadMultiple = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 10241,
    files: 5
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'video/webm',
      'audio/mpeg',
      'audio/wav',
      'audio/x-m4a',
      'audio/ogg',
      'audio/mp4'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não suportado. Use vídeo (MP4, MOV, AVI...) ou áudio (MP3, WAV, M4A...).'));
    }
  }
});

app.use('/api/videos', videoRoutes);
app.use('/api/pdfs', pdfRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dictionary', dictionaryRoutes);
app.use('/api/scorms', scormRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'API está funcionando' });
});

app.post('/api/transcribe', async (req, res) => {
  try {
    const { videoUrl, videoUrls } = req.body;

    const urls = videoUrls && Array.isArray(videoUrls) ? videoUrls : (videoUrl ? [videoUrl] : []);

    if (urls.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'URL(s) do vídeo é obrigatória' 
      });
    }

    if (urls.length > 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Máximo de 5 URLs por vez' 
      });
    }

    for (const url of urls) {
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ 
          success: false, 
          error: 'URL inválida' 
        });
      }
      if (!url.includes('vimeo.com')) {
        return res.status(400).json({ 
          success: false, 
          error: `URL inválida: ${url}. Forneça uma URL do Vimeo.` 
        });
      }
    }

    const jobIds = [];
    for (const url of urls) {
      const jobId = queue.addJob({
        type: 'url',
        data: { videoUrl: url }
      });
      jobIds.push(jobId);
    }

    res.json({ 
      success: true, 
      message: `${jobIds.length} job(s) adicionado(s) à fila`,
      jobIds,
      queueInfo: queue.getQueueInfo()
    });

  } catch (error) {
    console.error('Erro ao adicionar job à fila:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Erro ao adicionar job à fila' 
    });
  }
});

app.post('/api/transcribe/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nenhum arquivo enviado' 
      });
    }

    const jobId = queue.addJob({
      type: 'upload',
      data: {
        filePath: req.file.path,
        fileName: req.file.originalname
      }
    });

    res.json({ 
      success: true, 
      message: 'Vídeo adicionado à fila!',
      jobId,
      queueInfo: queue.getQueueInfo()
    });

  } catch (error) {
    console.error('Erro ao adicionar upload à fila:', error);
    console.error('   Stack:', error.stack);
    
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Erro ao limpar arquivo:', cleanupError);
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Erro ao adicionar upload à fila' 
    });
  }
});

const uploadPDFMultiple = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
    files: 5
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não suportado. Use PDF.'));
    }
  }
});

app.post('/api/transcribe/upload-multiple', uploadMultiple.array('videos', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nenhum arquivo enviado' 
      });
    }

    if (req.files.length > 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Máximo de 5 arquivos por vez' 
      });
    }

    const jobIds = [];
    for (const file of req.files) {
      const jobId = queue.addJob({
        type: 'upload',
        data: {
          filePath: file.path,
          fileName: file.originalname
        }
      });
      jobIds.push(jobId);
    }

    res.json({ 
      success: true, 
      message: `${jobIds.length} vídeo(s) adicionado(s) à fila!`,
      jobIds,
      queueInfo: queue.getQueueInfo()
    });

  } catch (error) {
    console.error('Erro ao adicionar uploads à fila:', error);
    console.error('   Stack:', error.stack);
    
    if (req.files) {
      for (const file of req.files) {
        if (fs.existsSync(file.path)) {
          try {
            fs.unlinkSync(file.path);
          } catch (cleanupError) {
            console.error('Erro ao limpar arquivo:', cleanupError);
          }
        }
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Erro ao adicionar uploads à fila' 
    });
  }
});

app.get('/api/queue/status', (req, res) => {
  try {
    const queueInfo = queue.getQueueInfo();
    res.json({
      success: true,
      ...queueInfo
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao obter status da fila'
    });
  }
});

app.get('/api/queue/jobs', (req, res) => {
  try {
    const jobs = queue.getAllJobsStatus();
    res.json({
      success: true,
      jobs
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao obter jobs'
    });
  }
});

app.get('/api/queue/job/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;
    const jobStatus = queue.getJobStatus(jobId);
    
    if (!jobStatus) {
      return res.status(404).json({
        success: false,
        error: 'Job não encontrado'
      });
    }

    res.json({
      success: true,
      job: jobStatus
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao obter status do job'
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

app.post('/api/pdfs/upload-multiple', uploadPDFMultiple.array('pdfs', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nenhum arquivo enviado' 
      });
    }

    if (req.files.length > 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Máximo de 5 arquivos por vez' 
      });
    }

    const jobIds = [];
    const forceVision = req.body.forceVision === 'true';
    
    for (const file of req.files) {
      const jobId = queue.addJob({
        type: 'pdf',
        data: {
          filePath: file.path,
          fileName: file.originalname,
          forceVision
        }
      });
      jobIds.push(jobId);
    }

    res.json({ 
      success: true, 
      message: `${jobIds.length} PDF(s) adicionado(s) à fila!`,
      jobIds,
      queueInfo: queue.getQueueInfo()
    });

  } catch (error) {
    console.error('Erro ao adicionar uploads de PDFs à fila:', error);
    console.error('   Stack:', error.stack);
    
    if (req.files) {
      for (const file of req.files) {
        if (fs.existsSync(file.path)) {
          try {
            fs.unlinkSync(file.path);
          } catch (cleanupError) {
            console.error('Erro ao limpar arquivo:', cleanupError);
          }
        }
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Erro ao adicionar uploads de PDFs à fila' 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});

