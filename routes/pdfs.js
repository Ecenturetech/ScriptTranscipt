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
    
    const pdfs = rows.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      status: row.status,
      extractedText: row.extracted_text || undefined,
      structuredSummary: row.structured_summary || undefined,
      questionsAnswers: row.questions_answers || undefined,
      elyMetadata: row.ely_metadata || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
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
    
    const pdfData = {
      id: row.id,
      fileName: row.file_name,
      status: row.status,
      extractedText: row.extracted_text || undefined,
      structuredSummary: row.structured_summary || undefined,
      questionsAnswers: row.questions_answers || undefined,
      elyMetadata: row.ely_metadata || undefined,
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
    
    const pdf = {
      id: row.id,
      fileName: row.file_name,
      status: row.status,
      extractedText: row.extracted_text || undefined,
      structuredSummary: row.structured_summary || undefined,
      questionsAnswers: row.questions_answers || undefined,
      elyMetadata: row.ely_metadata || undefined,
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
      questionsAnswers,
      elyMetadata
    } = req.body;
    
    const id = uuidv4();
    
    try {
      await pool.query(`
        ALTER TABLE pdfs 
        ADD COLUMN IF NOT EXISTS questions_answers TEXT,
        ADD COLUMN IF NOT EXISTS ely_metadata TEXT
      `).catch(() => {});
      
      await pool.query(
        `INSERT INTO pdfs (id, file_name, status, extracted_text, structured_summary, questions_answers, ely_metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, fileName, status, extractedText || null, structuredSummary || null, questionsAnswers || null, elyMetadata || null]
      );
    } catch (err) {
      if (err.message && (err.message.includes('questions_answers') || err.message.includes('ely_metadata'))) {
        await pool.query(`
          ALTER TABLE pdfs 
          ADD COLUMN IF NOT EXISTS questions_answers TEXT,
          ADD COLUMN IF NOT EXISTS ely_metadata TEXT
        `).catch(() => {});
        await pool.query(
          `INSERT INTO pdfs (id, file_name, status, extracted_text, structured_summary, questions_answers, ely_metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, fileName, status, extractedText || null, structuredSummary || null, questionsAnswers || null, elyMetadata || null]
        );
      } else {
        throw err;
      }
    }
    
    const { rows } = await pool.query('SELECT * FROM pdfs WHERE id = $1', [id]);
    const row = rows[0];
    
    const pdf = {
      id: row.id,
      fileName: row.file_name,
      status: row.status,
      extractedText: row.extracted_text || undefined,
      structuredSummary: row.structured_summary || undefined,
      questionsAnswers: row.questions_answers || undefined,
      elyMetadata: row.ely_metadata || undefined,
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
      questionsAnswers,
      elyMetadata
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
    if (elyMetadata !== undefined) {
      updates.push(`ely_metadata = $${paramIndex++}`);
      values.push(elyMetadata || null);
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
    
    const pdf = {
      id: row.id,
      fileName: row.file_name,
      status: row.status,
      extractedText: row.extracted_text || undefined,
      structuredSummary: row.structured_summary || undefined,
      questionsAnswers: row.questions_answers || undefined,
      elyMetadata: row.ely_metadata || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
    
    res.json(pdf);
  } catch (error) {
    console.error('Erro ao atualizar PDF:', error);
    res.status(500).json({ error: 'Erro ao atualizar PDF' });
  }
});

router.post('/:id/process', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pdfs WHERE id = $1', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'PDF não encontrado' });
    }
    
    const row = rows[0];
    
    if (row.status !== 'completed') {
      return res.status(400).json({ error: 'Apenas PDFs concluídos podem ser processados' });
    }
    
    // Aplicar substituições do dicionário
    const processedExtractedText = row.extracted_text ? await applyDictionaryReplacements(row.extracted_text) : null;
    const processedStructuredSummary = row.structured_summary ? await applyDictionaryReplacements(row.structured_summary) : null;
    const processedQuestionsAnswers = row.questions_answers ? await applyDictionaryReplacements(row.questions_answers) : null;
    const processedElyMetadata = row.ely_metadata ? await applyDictionaryReplacements(row.ely_metadata) : null;
    
    // Atualizar no banco de dados
    await pool.query(
      `UPDATE pdfs SET extracted_text = $1, structured_summary = $2, questions_answers = $3, ely_metadata = $4, updated_at = NOW() WHERE id = $5`,
      [processedExtractedText, processedStructuredSummary, processedQuestionsAnswers, processedElyMetadata, req.params.id]
    );
    
    // Buscar o registro atualizado
    const { rows: updatedRows } = await pool.query('SELECT * FROM pdfs WHERE id = $1', [req.params.id]);
    const updatedRow = updatedRows[0];
    
    const pdf = {
      id: updatedRow.id,
      fileName: updatedRow.file_name,
      status: updatedRow.status,
      extractedText: processedExtractedText || undefined,
      structuredSummary: processedStructuredSummary || undefined,
      questionsAnswers: processedQuestionsAnswers || undefined,
      elyMetadata: processedElyMetadata || undefined,
      createdAt: new Date(updatedRow.created_at),
      updatedAt: new Date(updatedRow.updated_at)
    };
    
    res.json(pdf);
  } catch (error) {
    console.error('Erro ao processar PDF com dicionário:', error);
    res.status(500).json({ error: 'Erro ao processar PDF com dicionário' });
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
      'UPDATE pdfs SET status = $1, extracted_text = NULL, structured_summary = NULL, questions_answers = NULL, ely_metadata = NULL WHERE id = $2',
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
      'UPDATE pdfs SET status = $1, extracted_text = NULL, structured_summary = NULL, questions_answers = NULL, ely_metadata = NULL WHERE id = $2',
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


