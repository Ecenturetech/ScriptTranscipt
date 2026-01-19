import express from 'express';
import pool from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';
import { applyDictionaryReplacements } from '../services/videoTranscription.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM audios ORDER BY created_at DESC'
    );
    
    const audios = await Promise.all(rows.map(async (row) => {
      const transcript = row.transcript ? await applyDictionaryReplacements(row.transcript) : undefined;
      const structuredTranscript = row.structured_transcript ? await applyDictionaryReplacements(row.structured_transcript) : undefined;
      const questionsAnswers = row.questions_answers ? await applyDictionaryReplacements(row.questions_answers) : undefined;
      
      return {
        id: row.id,
        fileName: row.file_name,
        sourceType: row.source_type,
        sourceUrl: row.source_url || undefined,
        status: row.status,
        transcript,
        structuredTranscript,
        questionsAnswers,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at)
      };
    }));
    
    res.json(audios);
  } catch (error) {
    console.error('Erro ao buscar áudios:', error);
    res.status(500).json({ error: 'Erro ao buscar áudios' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM audios WHERE id = $1',
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Áudio não encontrado' });
    }
    
    const row = rows[0];
    
    const transcript = row.transcript ? await applyDictionaryReplacements(row.transcript) : undefined;
    const structuredTranscript = row.structured_transcript ? await applyDictionaryReplacements(row.structured_transcript) : undefined;
    const questionsAnswers = row.questions_answers ? await applyDictionaryReplacements(row.questions_answers) : undefined;
    
    const audio = {
      id: row.id,
      fileName: row.file_name,
      sourceType: row.source_type,
      sourceUrl: row.source_url || undefined,
      status: row.status,
      transcript,
      structuredTranscript,
      questionsAnswers,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
    
    res.json(audio);
  } catch (error) {
    console.error('Erro ao buscar áudio:', error);
    res.status(500).json({ error: 'Erro ao buscar áudio' });
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
      questionsAnswers
    } = req.body;
    
    const id = uuidv4();
    
    await pool.query(
      `INSERT INTO audios (id, file_name, source_type, source_url, status, transcript, structured_transcript, questions_answers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, fileName, sourceType, sourceUrl || null, status, transcript || null, structuredTranscript || null, questionsAnswers || null]
    );
    
    const { rows } = await pool.query('SELECT * FROM audios WHERE id = $1', [id]);
    const row = rows[0];
    
    const processedTranscript = row.transcript ? await applyDictionaryReplacements(row.transcript) : undefined;
    const processedStructuredTranscript = row.structured_transcript ? await applyDictionaryReplacements(row.structured_transcript) : undefined;
    const processedQuestionsAnswers = row.questions_answers ? await applyDictionaryReplacements(row.questions_answers) : undefined;
    
    const audio = {
      id: row.id,
      fileName: row.file_name,
      sourceType: row.source_type,
      sourceUrl: row.source_url || undefined,
      status: row.status,
      transcript: processedTranscript,
      structuredTranscript: processedStructuredTranscript,
      questionsAnswers: processedQuestionsAnswers,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
    
    res.status(201).json(audio);
  } catch (error) {
    console.error('Erro ao criar áudio:', error);
    res.status(500).json({ error: 'Erro ao criar áudio' });
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
      questionsAnswers
    } = req.body;
    
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
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
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }
    
    values.push(req.params.id);
    
    await pool.query(
      `UPDATE audios SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
    
    const { rows } = await pool.query('SELECT * FROM audios WHERE id = $1', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Áudio não encontrado' });
    }
    
    const row = rows[0];
    
    const processedTranscript = row.transcript ? await applyDictionaryReplacements(row.transcript) : undefined;
    const processedStructuredTranscript = row.structured_transcript ? await applyDictionaryReplacements(row.structured_transcript) : undefined;
    const processedQuestionsAnswers = row.questions_answers ? await applyDictionaryReplacements(row.questions_answers) : undefined;
    
    const audio = {
      id: row.id,
      fileName: row.file_name,
      sourceType: row.source_type,
      sourceUrl: row.source_url || undefined,
      status: row.status,
      transcript: processedTranscript,
      structuredTranscript: processedStructuredTranscript,
      questionsAnswers: processedQuestionsAnswers,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
    
    res.json(audio);
  } catch (error) {
    console.error('Erro ao atualizar áudio:', error);
    res.status(500).json({ error: 'Erro ao atualizar áudio' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM audios WHERE id = $1', [req.params.id]);
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Áudio não encontrado' });
    }
    
    res.json({ message: 'Áudio deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar áudio:', error);
    res.status(500).json({ error: 'Erro ao deletar áudio' });
  }
});

export default router;
