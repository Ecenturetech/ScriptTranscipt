import express from 'express';
import pool from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';
import { applyDictionaryReplacements } from '../services/videoTranscription.js';
import { processPDFFile } from '../services/pdfProcessing.js';
import { getStoragePath } from '../utils/storage.js';
import fs from 'fs';
import path from 'path';
import queue from '../services/queue.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM pdfs ORDER BY created_at DESC'
    );
    
    const pdfs = await Promise.all(rows.map(async (row) => {
      const extractedText = row.extracted_text ? await applyDictionaryReplacements(row.extracted_text) : undefined;
      const structuredSummary = row.structured_summary ? await applyDictionaryReplacements(row.structured_summary) : undefined;
      const questionsAnswers = row.questions_answers ? await applyDictionaryReplacements(row.questions_answers) : undefined;
      
      return {
        id: row.id,
        fileName: row.file_name,
        status: row.status,
        extractedText,
        structuredSummary,
        questionsAnswers,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at)
      };
    }));
    
    res.json(pdfs);
  } catch (error) {
    console.error('Erro ao buscar PDFs:', error);
    res.status(500).json({ error: 'Erro ao buscar PDFs' });
  }
});

router.get('/:id/download', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM pdfs WHERE id = $1',
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'PDF não encontrado' });
    }
    
    const row = rows[0];
    
    const extractedText = row.extracted_text ? await applyDictionaryReplacements(row.extracted_text) : undefined;
    const structuredSummary = row.structured_summary ? await applyDictionaryReplacements(row.structured_summary) : undefined;
    const questionsAnswers = row.questions_answers ? await applyDictionaryReplacements(row.questions_answers) : undefined;
    
    const pdfData = {
      id: row.id,
      fileName: row.file_name,
      status: row.status,
      extractedText,
      structuredSummary,
      questionsAnswers,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${row.file_name.replace(/\.[^/.]+$/, '')}_output.json"`);
    res.json(pdfData);
  } catch (error) {
    console.error('Erro ao fazer download do PDF:', error);
    res.status(500).json({ error: 'Erro ao fazer download do PDF' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM pdfs WHERE id = $1',
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'PDF não encontrado' });
    }
    
    const row = rows[0];
    
    const extractedText = row.extracted_text ? await applyDictionaryReplacements(row.extracted_text) : undefined;
    const structuredSummary = row.structured_summary ? await applyDictionaryReplacements(row.structured_summary) : undefined;
    const questionsAnswers = row.questions_answers ? await applyDictionaryReplacements(row.questions_answers) : undefined;
    
    const pdf = {
      id: row.id,
      fileName: row.file_name,
      status: row.status,
      extractedText,
      structuredSummary,
      questionsAnswers,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
    
    res.json(pdf);
  } catch (error) {
    console.error('Erro ao buscar PDF:', error);
    res.status(500).json({ error: 'Erro ao buscar PDF' });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      fileName,
      status = 'processing',
      extractedText,
      structuredSummary,
      questionsAnswers
    } = req.body;
    
    const id = uuidv4();
    
    try {
      await pool.query(
        `INSERT INTO pdfs (id, file_name, status, extracted_text, structured_summary, questions_answers)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, fileName, status, extractedText || null, structuredSummary || null, questionsAnswers || null]
      );
    } catch (err) {
      if (err.message && err.message.includes('questions_answers')) {
        await pool.query(`
          ALTER TABLE pdfs 
          ADD COLUMN IF NOT EXISTS questions_answers TEXT
        `).catch(() => {});
        await pool.query(
          `INSERT INTO pdfs (id, file_name, status, extracted_text, structured_summary, questions_answers)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, fileName, status, extractedText || null, structuredSummary || null, questionsAnswers || null]
        );
      } else {
        throw err;
      }
    }
    
    const { rows } = await pool.query('SELECT * FROM pdfs WHERE id = $1', [id]);
    const row = rows[0];
    
    const processedExtractedText = row.extracted_text ? await applyDictionaryReplacements(row.extracted_text) : undefined;
    const processedStructuredSummary = row.structured_summary ? await applyDictionaryReplacements(row.structured_summary) : undefined;
    const processedQuestionsAnswers = row.questions_answers ? await applyDictionaryReplacements(row.questions_answers) : undefined;
    
    const pdf = {
      id: row.id,
      fileName: row.file_name,
      status: row.status,
      extractedText: processedExtractedText,
      structuredSummary: processedStructuredSummary,
      questionsAnswers: processedQuestionsAnswers,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
    
    res.status(201).json(pdf);
  } catch (error) {
    console.error('Erro ao criar PDF:', error);
    res.status(500).json({ error: 'Erro ao criar PDF' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const {
      fileName,
      status,
      extractedText,
      structuredSummary,
      questionsAnswers
    } = req.body;
    
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (fileName !== undefined) {
      updates.push(`file_name = $${paramIndex++}`);
      values.push(fileName);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    if (extractedText !== undefined) {
      updates.push(`extracted_text = $${paramIndex++}`);
      values.push(extractedText || null);
    }
    if (structuredSummary !== undefined) {
      updates.push(`structured_summary = $${paramIndex++}`);
      values.push(structuredSummary || null);
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
      `UPDATE pdfs SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
    
    const { rows } = await pool.query('SELECT * FROM pdfs WHERE id = $1', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'PDF não encontrado' });
    }
    
    const row = rows[0];
    
    const processedExtractedText = row.extracted_text ? await applyDictionaryReplacements(row.extracted_text) : undefined;
    const processedStructuredSummary = row.structured_summary ? await applyDictionaryReplacements(row.structured_summary) : undefined;
    const processedQuestionsAnswers = row.questions_answers ? await applyDictionaryReplacements(row.questions_answers) : undefined;
    
    const pdf = {
      id: row.id,
      fileName: row.file_name,
      status: row.status,
      extractedText: processedExtractedText,
      structuredSummary: processedStructuredSummary,
      questionsAnswers: processedQuestionsAnswers,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
    
    res.json(pdf);
  } catch (error) {
    console.error('Erro ao atualizar PDF:', error);
    res.status(500).json({ error: 'Erro ao atualizar PDF' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM pdfs WHERE id = $1', [req.params.id]);
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'PDF não encontrado' });
    }
    
    res.json({ message: 'PDF deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar PDF:', error);
    res.status(500).json({ error: 'Erro ao deletar PDF' });
  }
});

router.post('/:id/reprocess', async (req, res) => {
  try {
    const { forceVision = false } = req.body;
    const pdfId = req.params.id;

    // Buscar o PDF no banco de dados
    const { rows } = await pool.query('SELECT * FROM pdfs WHERE id = $1', [pdfId]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'PDF não encontrado' });
    }

    const pdf = rows[0];
    
    // Procurar o arquivo no storage
    const storagePath = getStoragePath();
    const files = fs.readdirSync(storagePath);
    
    // Procurar arquivo que começa com "pdf-" e tem a extensão do arquivo original
    const fileExtension = path.extname(pdf.file_name);
    const pdfFile = files.find(file => 
      file.startsWith('pdf-') && file.endsWith(fileExtension)
    );

    if (!pdfFile) {
      // Se não encontrar, tentar procurar pelo nome original
      const originalFile = files.find(file => file === pdf.file_name);
      if (!originalFile) {
        return res.status(404).json({ 
          error: 'Arquivo PDF não encontrado no storage. O arquivo pode ter sido removido.' 
        });
      }
      
      const filePath = path.join(storagePath, originalFile);
      
      // Atualizar status para processing
      await pool.query(
        'UPDATE pdfs SET status = $1, extracted_text = NULL, structured_summary = NULL, questions_answers = NULL WHERE id = $2',
        ['processing', pdfId]
      );

      // Adicionar à fila de processamento
      const jobId = queue.addJob({
        type: 'pdf',
        data: {
          filePath,
          fileName: pdf.file_name,
          forceVision: forceVision === true || forceVision === 'true'
        }
      });

      return res.json({
        success: true,
        message: 'PDF adicionado à fila para reprocessamento com Modo Visão Inteligente',
        jobId,
        queueInfo: queue.getQueueInfo()
      });
    }

    const filePath = path.join(storagePath, pdfFile);
    
    // Verificar se o arquivo existe
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ 
        error: 'Arquivo PDF não encontrado no storage' 
      });
    }

    // Atualizar status para processing
    await pool.query(
      'UPDATE pdfs SET status = $1, extracted_text = NULL, structured_summary = NULL, questions_answers = NULL WHERE id = $2',
      ['processing', pdfId]
    );

    // Adicionar à fila de processamento
    const jobId = queue.addJob({
      type: 'pdf',
      data: {
        filePath,
        fileName: pdf.file_name,
        forceVision: forceVision === true || forceVision === 'true'
      }
    });

    res.json({
      success: true,
      message: 'PDF adicionado à fila para reprocessamento com Modo Visão Inteligente',
      jobId,
      queueInfo: queue.getQueueInfo()
    });

  } catch (error) {
    console.error('Erro ao reprocessar PDF:', error);
    res.status(500).json({ error: `Erro ao reprocessar PDF: ${error.message}` });
  }
});

export default router;


