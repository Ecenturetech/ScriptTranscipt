import express from 'express';
import pool from '../db/connection.js';

const router = express.Router();

/**
 * GET /api/catalogo
 * Query: search, classe, empresa, limit, offset
 */
router.get('/', async (req, res) => {
  try {
    const { search = '', classe = '', empresa = '', limit = 50, offset = 0 } = req.query;
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (search && String(search).trim()) {
      const term = `%${String(search).trim()}%`;
      conditions.push(`(
        nome_produto ILIKE $${paramIndex}
        OR culturas_registradas ILIKE $${paramIndex}
        OR doencas_pragas_plantas_daninhas_controladas ILIKE $${paramIndex}
        OR classe ILIKE $${paramIndex}
        OR empresa ILIKE $${paramIndex}
      )`);
      params.push(term);
      paramIndex += 1;
    }
    if (classe && String(classe).trim()) {
      conditions.push(`classe ILIKE $${paramIndex}`);
      params.push(`%${String(classe).trim()}%`);
      paramIndex += 1;
    }
    if (empresa && String(empresa).trim()) {
      conditions.push(`empresa ILIKE $${paramIndex}`);
      params.push(`%${String(empresa).trim()}%`);
      paramIndex += 1;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM catalogo_produto ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    params.push(limitNum, offsetNum);
    const { rows } = await pool.query(
      `SELECT id, nome_produto, culturas_registradas, doencas_pragas_plantas_daninhas_controladas,
              dose_recomendada, volume_calda, classe, empresa, pais
       FROM catalogo_produto ${whereClause}
       ORDER BY nome_produto, id
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    const items = rows.map((row) => ({
      id: row.id,
      nomeProduto: row.nome_produto || '',
      culturasRegistradas: row.culturas_registradas || '',
      doencasPragasPlantasDaninhasControladas: row.doencas_pragas_plantas_daninhas_controladas || '',
      doseRecomendada: row.dose_recomendada || '',
      volumeCalda: row.volume_calda || '',
      classe: row.classe || '',
      empresa: row.empresa || '',
      pais: row.pais || '',
    }));

    res.json({ items, total });
  } catch (error) {
    console.error('Erro ao buscar catálogo:', error);
    res.status(500).json({ error: 'Erro ao buscar catálogo de produtos' });
  }
});

/**
 * GET /api/catalogo/classes
 * Lista valores distintos de classe (para filtros)
 */
router.get('/classes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT classe FROM catalogo_produto WHERE classe IS NOT NULL AND classe != '' ORDER BY classe`
    );
    res.json(rows.map((r) => r.classe));
  } catch (error) {
    console.error('Erro ao buscar classes:', error);
    res.status(500).json({ error: 'Erro ao buscar classes' });
  }
});

/**
 * GET /api/catalogo/empresas
 * Lista valores distintos de empresa (para filtros)
 */
router.get('/empresas', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT empresa FROM catalogo_produto WHERE empresa IS NOT NULL AND empresa != '' ORDER BY empresa`
    );
    res.json(rows.map((r) => r.empresa));
  } catch (error) {
    console.error('Erro ao buscar empresas:', error);
    res.status(500).json({ error: 'Erro ao buscar empresas' });
  }
});

export default router;
