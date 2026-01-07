import express from 'express';
import axios from 'axios';
import queue from '../services/queue.js';
import pool from '../db/connection.js';
import { applyDictionaryReplacements } from '../services/videoTranscription.js';

const router = express.Router();
const BAYER_FRONT_API_BASE_URL = process.env.BAYER_FRONT_API_BASE_URL || 'https://ctb-bayer-staging.web.app';

// GET /api/scorms/available - Lista SCORMs disponíveis da API content-report
router.get('/available', async (req, res) => {
  try {
    // Usa a API content-report que é a fonte oficial de dados
    const response = await axios.get(`${BAYER_FRONT_API_BASE_URL}/api/content-report`, {
      headers: {
        'Content-Type': 'application/json',
      }
    });

    const contentData = response.data || {};
    
    // Converte o objeto de cursos em array de SCORMs
    const scorms = Object.entries(contentData).map(([coursePath, courseInfo]) => ({
      id: courseInfo.id,
      name: courseInfo.title,
      coursePath: coursePath,
      pagesCount: courseInfo.pagesCount,
      lessonsCount: Object.keys(courseInfo.lessons || {}).length,
      mediasCount: Object.keys(courseInfo.medias || {}).length,
      questionsCount: Object.keys(courseInfo.questions || {}).length
    }));

    res.json({
      success: true,
      scorms
    });
  } catch (error) {
    console.error('Erro ao buscar SCORMs disponíveis:', error.message);
    
    if (error.response) {
      res.status(error.response.status).json({
        success: false,
        error: error.response.data?.error || 'Erro ao buscar SCORMs da API',
        details: error.response.data
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Erro ao conectar com a API de conteúdo',
        details: error.message
      });
    }
  }
});

// GET /api/scorms - Lista SCORMs processados (transcritos) do banco de dados
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM scorms ORDER BY created_at DESC'
    );
    
    const scorms = await Promise.all(rows.map(async (row) => {
      const extractedText = row.extracted_text ? await applyDictionaryReplacements(row.extracted_text) : undefined;
      const structuredSummary = row.structured_summary ? await applyDictionaryReplacements(row.structured_summary) : undefined;
      const questionsAnswers = row.questions_answers ? await applyDictionaryReplacements(row.questions_answers) : undefined;
      
      return {
        id: row.id,
        scormId: row.scorm_id,
        scormName: row.scorm_name,
        coursePath: row.course_path,
        status: row.status,
        extractedText,
        structuredSummary,
        questionsAnswers,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at)
      };
    }));
    
    res.json(scorms);
  } catch (error) {
    console.error('Erro ao buscar SCORMs processados:', error);
    res.status(500).json({ error: 'Erro ao buscar SCORMs processados' });
  }
});

// GET /api/scorms/:id/content - Busca conteúdo de um SCORM específico da API
router.get('/:id/content', async (req, res) => {
  try {
    const { id } = req.params;

    // Busca todos os cursos da API content-report
    const contentResponse = await axios.get(`${BAYER_FRONT_API_BASE_URL}/api/content-report`);
    const contentData = contentResponse.data || {};
    
    // Tenta encontrar o curso pelo ID (que é o UUID do curso)
    let content = null;
    let coursePath = null;
    
    for (const [path, courseInfo] of Object.entries(contentData)) {
      if (courseInfo.id === id) {
        content = courseInfo;
        coursePath = path;
        break;
      }
    }

    if (!content) {
      return res.status(404).json({
        success: false,
        error: 'SCORM não encontrado',
        note: `Nenhum curso encontrado com o ID: ${id}`
      });
    }

    res.json({
      success: true,
      scorm: {
        id: content.id,
        name: content.title,
        coursePath: coursePath
      },
      content: content
    });
  } catch (error) {
    console.error('Erro ao buscar conteúdo do SCORM:', error.message);
    if (error.response) {
      res.status(error.response.status).json({
        success: false,
        error: error.response.data?.error || 'Erro ao buscar conteúdo do SCORM',
        details: error.response.data
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Erro ao conectar com a API',
        details: error.message
      });
    }
  }
});

// POST /api/scorms/:id/transcribe - Inicia transcrição de um SCORM
router.post('/:id/transcribe', async (req, res) => {
  try {
    const { id } = req.params;

    // Busca todos os cursos da API content-report
    const contentResponse = await axios.get(`${BAYER_FRONT_API_BASE_URL}/api/content-report`);
    const contentData = contentResponse.data || {};
    
    // Tenta encontrar o curso pelo ID (que é o UUID do curso)
    let content = null;
    let coursePath = null;
    
    for (const [path, courseInfo] of Object.entries(contentData)) {
      if (courseInfo.id === id) {
        content = courseInfo;
        coursePath = path;
        break;
      }
    }

    if (!content) {
      return res.status(404).json({
        success: false,
        error: `SCORM não encontrado com o ID: ${id}`,
        scormId: id
      });
    }
    
    // Adiciona o job na fila de processamento
    const jobId = queue.addJob({
      type: 'scorm',
      data: {
        scormId: id,
        scormName: content.title,
        coursePath: coursePath
      }
    });
    
    res.json({
      success: true,
      message: 'Transcrição do SCORM iniciada',
      jobId: jobId,
      scormId: id,
      scormName: content.title,
      scormCoursePath: coursePath,
      contentInfo: {
        id: content.id,
        title: content.title,
        pagesCount: content.pagesCount,
        lessonsCount: Object.keys(content.lessons || {}).length,
        mediasCount: Object.keys(content.medias || {}).length,
        questionsCount: Object.keys(content.questions || {}).length
      }
    });

  } catch (error) {
    console.error('Erro ao iniciar transcrição do SCORM:', error.message);
    if (error.response) {
      res.status(error.response.status).json({
        success: false,
        error: error.response.data?.error || 'Erro ao iniciar transcrição do SCORM',
        details: error.response.data
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Erro ao conectar com a API',
        details: error.message
      });
    }
  }
});

// GET /api/scorms/:id - Busca um SCORM processado específico
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { rows } = await pool.query(
      'SELECT * FROM scorms WHERE id = $1',
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'SCORM não encontrado' });
    }
    
    const row = rows[0];
    
    const extractedText = row.extracted_text ? await applyDictionaryReplacements(row.extracted_text) : undefined;
    const structuredSummary = row.structured_summary ? await applyDictionaryReplacements(row.structured_summary) : undefined;
    const questionsAnswers = row.questions_answers ? await applyDictionaryReplacements(row.questions_answers) : undefined;
    
    const scorm = {
      id: row.id,
      scormId: row.scorm_id,
      scormName: row.scorm_name,
      coursePath: row.course_path,
      status: row.status,
      extractedText,
      structuredSummary,
      questionsAnswers,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
    
    res.json(scorm);
  } catch (error) {
    console.error('Erro ao buscar SCORM processado:', error);
    res.status(500).json({ error: 'Erro ao buscar SCORM processado' });
  }
});

// DELETE /api/scorms/:id - Deleta um SCORM processado
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { rows } = await pool.query(
      'SELECT * FROM scorms WHERE id = $1',
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'SCORM não encontrado' });
    }
    
    await pool.query('DELETE FROM scorms WHERE id = $1', [id]);
    
    res.json({ message: 'SCORM deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar SCORM:', error);
    res.status(500).json({ error: 'Erro ao deletar SCORM' });
  }
});

export default router;
