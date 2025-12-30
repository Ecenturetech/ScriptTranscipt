import express from 'express';
import pool from '../db/connection.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// GET /api/dictionary - Listar todos os termos
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM dictionary_terms ORDER BY term ASC'
    );
    
    const terms = rows.map(row => ({
      id: row.id,
      term: row.term,
      replacement: row.replacement
    }));
    
    res.json(terms);
  } catch (error) {
    console.error('Erro ao buscar termos:', error);
    res.status(500).json({ error: 'Erro ao buscar termos do dicionário' });
  }
});

// GET /api/dictionary/:id - Buscar termo por ID
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM dictionary_terms WHERE id = $1',
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Termo não encontrado' });
    }
    
    const row = rows[0];
    res.json({
      id: row.id,
      term: row.term,
      replacement: row.replacement
    });
  } catch (error) {
    console.error('Erro ao buscar termo:', error);
    res.status(500).json({ error: 'Erro ao buscar termo' });
  }
});

// POST /api/dictionary - Criar novo termo
router.post('/', async (req, res) => {
  try {
    const { term, replacement } = req.body;
    
    if (!term || !replacement) {
      return res.status(400).json({ error: 'Termo e substituição são obrigatórios' });
    }
    
    const id = uuidv4();
    
    await pool.query(
      'INSERT INTO dictionary_terms (id, term, replacement) VALUES ($1, $2, $3)',
      [id, term, replacement]
    );
    
    const { rows } = await pool.query('SELECT * FROM dictionary_terms WHERE id = $1', [id]);
    const row = rows[0];
    
    res.status(201).json({
      id: row.id,
      term: row.term,
      replacement: row.replacement
    });
  } catch (error) {
    if (error.code === '23505') { // PostgreSQL unique violation
      return res.status(409).json({ error: 'Termo já existe no dicionário' });
    }
    console.error('Erro ao criar termo:', error);
    res.status(500).json({ error: 'Erro ao criar termo' });
  }
});

// PUT /api/dictionary/:id - Atualizar termo
router.put('/:id', async (req, res) => {
  try {
    const { term, replacement } = req.body;
    
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (term !== undefined) {
      updates.push(`term = $${paramIndex++}`);
      values.push(term);
    }
    if (replacement !== undefined) {
      updates.push(`replacement = $${paramIndex++}`);
      values.push(replacement);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }
    
    values.push(req.params.id);
    
    await pool.query(
      `UPDATE dictionary_terms SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
    
    const { rows } = await pool.query('SELECT * FROM dictionary_terms WHERE id = $1', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Termo não encontrado' });
    }
    
    const row = rows[0];
    res.json({
      id: row.id,
      term: row.term,
      replacement: row.replacement
    });
  } catch (error) {
    if (error.code === '23505') { // PostgreSQL unique violation
      return res.status(409).json({ error: 'Termo já existe no dicionário' });
    }
    console.error('Erro ao atualizar termo:', error);
    res.status(500).json({ error: 'Erro ao atualizar termo' });
  }
});

// DELETE /api/dictionary/:id - Deletar termo
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM dictionary_terms WHERE id = $1', [req.params.id]);
    
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Termo não encontrado' });
    }
    
    res.json({ message: 'Termo deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar termo:', error);
    res.status(500).json({ error: 'Erro ao deletar termo' });
  }
});

export default router;

