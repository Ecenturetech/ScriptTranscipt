/**
 * Script para importar catálogo de produtos a partir de arquivo XLSX ou CSV.
 *
 * Uso:
 *   node scripts/importCatalogoProduto.js <caminho-do-arquivo>
 *
 * Exemplos:
 *   node scripts/importCatalogoProduto.js "../catalogo.xlsx"
 *   node scripts/importCatalogoProduto.js "../product_catalog_Relação de Produtos de Crop Protection COMPLETO – Brasil.csv"
 *
 * O arquivo deve ter as colunas (primeira linha = cabeçalho):
 *   Nome produto, Culturas registradas, Doenças pragas..., Dose recomendada, Volume calda, Classe, Empresa, Pais
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pkg from 'pg';
import XLSX from 'xlsx';

/** Tenta decodificar buffer como UTF-8; se houver caracteres de substituição, tenta Latin-1 (comum em CSV do Excel no Windows). Remove BOM se presente. */
function readTextWithEncoding(absolutePath) {
  const buffer = readFileSync(absolutePath);
  let content = buffer.toString('utf-8');
  if (content.includes('\uFFFD')) {
    content = buffer.toString('latin1');
  }
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  return content;
}

const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

const DB_HOST = String(process.env.DB_HOST || 'localhost');
const DB_PORT = parseInt(process.env.DB_PORT || '5432');
const DB_USER = String(process.env.DB_USER || 'root');
const DB_PASSWORD = process.env.DB_PASSWORD ? String(process.env.DB_PASSWORD) : '';
const DB_NAME = String(process.env.DB_NAME || 'video_db');

// Mapeamento: nome da coluna no arquivo -> coluna no banco
const HEADER_TO_COLUMN = {
  'Nome produto': 'nome_produto',
  'Culturas registradas': 'culturas_registradas',
  'Doenças, pragas e plantas daninhas controladas': 'doencas_pragas_plantas_daninhas_controladas',
  'Dose recomendada': 'dose_recomendada',
  'Volume calda': 'volume_calda',
  'Classe': 'classe',
  'Empresa': 'empresa',
  'Pais': 'pais',
};

const COLUMNS = [
  'nome_produto',
  'culturas_registradas',
  'doencas_pragas_plantas_daninhas_controladas',
  'dose_recomendada',
  'volume_calda',
  'classe',
  'empresa',
  'pais',
];

function parseCSV(content) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = content.includes(';') ? ';' : ',';
  const rows = [];
  // CSV: usar ordem das colunas (cabeçalho pode ter problemas de encoding)
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(sep).map((v) => (v !== undefined ? String(v).trim() : ''));
    const row = {};
    COLUMNS.forEach((col, j) => {
      row[col] = values[j] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function readXLSX(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return data;
}

function rowToDbRow(row, fromCSV = false) {
  if (fromCSV) return row;
  const dbRow = {};
  for (const [header, col] of Object.entries(HEADER_TO_COLUMN)) {
    let val = row[header];
    if (val === undefined || val === null) val = '';
    dbRow[col] = String(val).trim();
  }
  return dbRow;
}

async function importFile(filePath) {
  const absolutePath = resolve(process.cwd(), filePath);
  if (!existsSync(absolutePath)) {
    console.error('❌ Arquivo não encontrado:', absolutePath);
    process.exit(1);
  }

  const ext = absolutePath.toLowerCase().slice(-5);
  const isCsv = absolutePath.toLowerCase().endsWith('.csv');

  let rows;
  let fromCSV = false;
  if (isCsv) {
    console.log('📄 Lendo CSV (detectando encoding: UTF-8 ou Latin-1)...');
    const content = readTextWithEncoding(absolutePath);
    rows = parseCSV(content);
    fromCSV = true;
  } else {
    console.log('📄 Lendo XLSX...');
    rows = readXLSX(absolutePath);
  }

  if (!rows.length) {
    console.log('⚠️ Nenhuma linha de dados encontrada.');
    process.exit(0);
  }

  const dbRows = rows.map((r) => rowToDbRow(r, fromCSV)).filter((r) => {
    const hasData = COLUMNS.some((c) => r[c] && r[c].length > 0);
    return hasData;
  });

  console.log(`📊 ${rows.length} linhas no arquivo, ${dbRows.length} com dados para importar.`);

  const pool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  const BATCH = 500;
  let inserted = 0;

  try {
    for (let i = 0; i < dbRows.length; i += BATCH) {
      const batch = dbRows.slice(i, i + BATCH);
      const placeholders = batch
        .map(
          (_, b) =>
            `(${COLUMNS.map((_, k) => `$${b * COLUMNS.length + k + 1}`).join(', ')})`
        )
        .join(', ');
      const values = batch.flatMap((r) => COLUMNS.map((c) => r[c] ?? ''));
      await pool.query(
        `INSERT INTO catalogo_produto (${COLUMNS.join(', ')}) VALUES ${placeholders}`,
        values
      );
      inserted += batch.length;
      console.log(`   Inseridas ${inserted}/${dbRows.length} linhas...`);
    }
    console.log(`✅ Importação concluída: ${inserted} registros em catalogo_produto.`);
  } catch (err) {
    console.error('❌ Erro ao importar:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

const fileArg = process.argv[2];
if (!fileArg) {
  console.log('Uso: node scripts/importCatalogoProduto.js <caminho-do-arquivo.xlsx ou .csv>');
  console.log('Exemplo: node scripts/importCatalogoProduto.js "../catalogo.xlsx"');
  process.exit(1);
}

importFile(fileArg);
