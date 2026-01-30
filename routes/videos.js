import express from 'express';
import pool from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';
import { applyDictionaryReplacements } from '../services/videoTranscription.js';
import { generatePDF, generateDOCX } from '../services/exportService.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM videos ORDER BY created_at DESC'
    );
    
    const videos = rows.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      sourceType: row.source_type,
      sourceUrl: row.source_url || undefined,
      status: row.status,
      transcript: row.transcript || undefined,
      structuredTranscript: row.structured_transcript || undefined,
      questionsAnswers: row.questions_answers || undefined,
      elyMetadata: row.ely_metadata || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    }));
    
    res.json(videos);
  } catch (error) {
    console.error('Erro ao buscar vídeos:', error);
    res.status(500).json({ error: 'Erro ao buscar vídeos' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM videos WHERE id = $1',
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Vídeo não encontrado' });
    }
    
    const row = rows[0];
    
    const video = {
      id: row.id,
      fileName: row.file_name,
      sourceType: row.source_type,
      sourceUrl: row.source_url || undefined,
      status: row.status,
      transcript: row.transcript || undefined,
      structuredTranscript: row.structured_transcript || undefined,
      questionsAnswers: row.questions_answers || undefined,
      elyMetadata: row.ely_metadata || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
    
    res.json(video);
  } catch (error) {
    console.error('Erro ao buscar vídeo:', error);
    res.status(500).json({ error: 'Erro ao buscar vídeo' });
  }
});

router.get('/:id/download/pdf', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM videos WHERE id = $1',
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Vídeo não encontrado' });
    }
    
    const row = rows[0];
    const data = {
      title: row.file_name,
      rawText: row.transcript,
      summary: row.structured_transcript,
      qa: row.questions_answers,
      metadata: row.ely_metadata
    };

    const buffer = await generatePDF(data);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${row.file_name.replace(/\.[^/.]+$/, '')}_output.pdf"`);
    res.send(buffer);

  } catch (error) {
    console.error('Erro ao gerar PDF:', error);
    res.status(500).json({ error: 'Erro ao gerar PDF' });
  }
});

router.get('/:id/download/docx', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM videos WHERE id = $1',
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Vídeo não encontrado' });
    }
    
    const row = rows[0];
    const data = {
      title: row.file_name,
      rawText: row.transcript,
      summary: row.structured_transcript,
      qa: row.questions_answers,
      metadata: row.ely_metadata
    };

    const buffer = await generateDOCX(data);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${row.file_name.replace(/\.[^/.]+$/, '')}_output.docx"`);
    res.send(buffer);

  } catch (error) {
    console.error('Erro ao gerar DOCX:', error);
    res.status(500).json({ error: 'Erro ao gerar DOCX' });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      fileName,
      sourceType,
      sourceUrl,
      status = 'processing',
      transcript,
      structuredTranscript,
      questionsAnswers,
      elyMetadata
    } = req.body;
    
    const id = uuidv4();
    
    // Ensure ely_metadata column exists
    await pool.query(`
      ALTER TABLE videos 
      ADD COLUMN IF NOT EXISTS ely_metadata TEXT
    `).catch(() => {});

    await pool.query(
      `INSERT INTO videos (id, file_name, source_type, source_url, status, transcript, structured_transcript, questions_answers, ely_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, fileName, sourceType, sourceUrl || null, status, transcript || null, structuredTranscript || null, questionsAnswers || null, elyMetadata || null]
    );
    
    const { rows } = await pool.query('SELECT * FROM videos WHERE id = $1', [id]);
    const row = rows[0];
    
    const video = {
      id: row.id,
      fileName: row.file_name,
      sourceType: row.source_type,
      sourceUrl: row.source_url || undefined,
      status: row.status,
      transcript: row.transcript || undefined,
      structuredTranscript: row.structured_transcript || undefined,
      questionsAnswers: row.questions_answers || undefined,
      elyMetadata: row.ely_metadata || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
    
    res.status(201).json(video);
  } catch (error) {
    console.error('Erro ao criar vídeo:', error);
    res.status(500).json({ error: 'Erro ao criar vídeo' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const {
      fileName,
      sourceType,
      sourceUrl,
      status,
      transcript,
      structuredTranscript,
      questionsAnswers,
      elyMetadata
    } = req.body;
    
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    // Ensure ely_metadata column exists
    await pool.query(`
      ALTER TABLE videos 
      ADD COLUMN IF NOT EXISTS ely_metadata TEXT
    `).catch(() => {});
    
    if (fileName !== undefined) {
      updates.push(`file_name = $${paramIndex++}`);
      values.push(fileName);
    }
    if (sourceType !== undefined) {
      updates.push(`source_type = $${paramIndex++}`);
      values.push(sourceType);
    }
    if (sourceUrl !== undefined) {
      updates.push(`source_url = $${paramIndex++}`);
      values.push(sourceUrl || null);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    if (transcript !== undefined) {
      updates.push(`transcript = $${paramIndex++}`);
      values.push(transcript || null);
    }
    if (structuredTranscript !== undefined) {
      updates.push(`structured_transcript = $${paramIndex++}`);
      values.push(structuredTranscript || null);
    }
    if (questionsAnswers !== undefined) {
      updates.push(`questions_answers = $${paramIndex++}`);
      values.push(questionsAnswers || null);
    }
    if (elyMetadata !== undefined) {
      updates.push(`ely_metadata = $${paramIndex++}`);
      values.push(elyMetadata || null);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }
    
    values.push(req.params.id);
    
    await pool.query(
      `UPDATE videos SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
    
    const { rows } = await pool.query('SELECT * FROM videos WHERE id = $1', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Vídeo não encontrado' });
    }
    
    const row = rows[0];
    
    const video = {
      id: row.id,
      fileName: row.file_name,
      sourceType: row.source_type,
      sourceUrl: row.source_url || undefined,
      status: row.status,
      transcript: row.transcript || undefined,
      structuredTranscript: row.structured_transcript || undefined,
      questionsAnswers: row.questions_answers || undefined,
      elyMetadata: row.ely_metadata || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
    
    res.json(video);
  } catch (error) {
    console.error('Erro ao atualizar vídeo:', error);
    res.status(500).json({ error: 'Erro ao atualizar vídeo' });
  }
});

router.post('/:id/process', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM videos WHERE id = $1', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Vídeo não encontrado' });
    }
    
    const row = rows[0];
    
    if (row.status !== 'completed') {
      return res.status(400).json({ error: 'Apenas vídeos concluídos podem ser processados' });
    }
    
    // Aplicar substituições do dicionário
    const processedTranscript = row.transcript ? await applyDictionaryReplacements(row.transcript) : null;
    const processedStructuredTranscript = row.structured_transcript ? await applyDictionaryReplacements(row.structured_transcript) : null;
    const processedQuestionsAnswers = row.questions_answers ? await applyDictionaryReplacements(row.questions_answers) : null;
    
    // Atualizar no banco de dados
    await pool.query(
      `UPDATE videos SET transcript = $1, structured_transcript = $2, questions_answers = $3, updated_at = NOW() WHERE id = $4`,
      [processedTranscript, processedStructuredTranscript, processedQuestionsAnswers, req.params.id]
    );
    
    // Buscar o registro atualizado
    const { rows: updatedRows } = await pool.query('SELECT * FROM videos WHERE id = $1', [req.params.id]);
    const updatedRow = updatedRows[0];
    
    const video = {
      id: updatedRow.id,
      fileName: updatedRow.file_name,
      sourceType: updatedRow.source_type,
      sourceUrl: updatedRow.source_url || undefined,
      status: updatedRow.status,
      transcript: processedTranscript || undefined,
      structuredTranscript: processedStructuredTranscript || undefined,
      questionsAnswers: processedQuestionsAnswers || undefined,
      createdAt: new Date(updatedRow.created_at),
      updatedAt: new Date(updatedRow.updated_at)
    };
    
    res.json(video);
  } catch (error) {
    console.error('Erro ao processar vídeo com dicionário:', error);
    res.status(500).json({ error: 'Erro ao processar vídeo com dicionário' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM videos WHERE id = $1', [req.params.id]);
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Vídeo não encontrado' });
    }
    
    res.json({ message: 'Vídeo deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar vídeo:', error);
    res.status(500).json({ error: 'Erro ao deletar vídeo' });
  }
});

export default router;

