import express from 'express';
import pool from '../db/connection.js';

const router = express.Router();

// GET /api/settings - Buscar configurações
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM settings WHERE id = 1');
    
    if (rows.length === 0) {
      return res.status(404).json({ 
        error: 'Configurações não encontradas. Execute: npm run migrate para criar as configurações iniciais.' 
      });
    }
    
    const row = rows[0];
    res.json({
      transcriptPrompt: row.transcript_prompt,
      qaPrompt: row.qa_prompt,
      additionalPrompt: row.additional_prompt
    });
  } catch (error) {
    console.error('Erro ao buscar configurações:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

// PUT /api/settings - Atualizar configurações
router.put('/', async (req, res) => {
  try {
    const { transcriptPrompt, qaPrompt, additionalPrompt } = req.body;
    
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (transcriptPrompt !== undefined) {
      updates.push(`transcript_prompt = $${paramIndex++}`);
      values.push(transcriptPrompt);
    }
    if (qaPrompt !== undefined) {
      updates.push(`qa_prompt = $${paramIndex++}`);
      values.push(qaPrompt);
    }
    if (additionalPrompt !== undefined) {
      updates.push(`additional_prompt = $${paramIndex++}`);
      values.push(additionalPrompt);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }
    
    values.push(1);
    
    await pool.query(
      `UPDATE settings SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
    
    const { rows } = await pool.query('SELECT * FROM settings WHERE id = 1');
    const row = rows[0];
    
    res.json({
      transcriptPrompt: row.transcript_prompt,
      qaPrompt: row.qa_prompt,
      additionalPrompt: row.additional_prompt
    });
  } catch (error) {
    console.error('Erro ao atualizar configurações:', error);
    res.status(500).json({ error: 'Erro ao atualizar configurações' });
  }
});

export default router;

