import pkg from 'pg';
import dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const DB_HOST = String(process.env.DB_HOST || 'localhost');
const DB_PORT = parseInt(process.env.DB_PORT || '5432');
const DB_USER = String(process.env.DB_USER || 'root');
const DB_PASSWORD = process.env.DB_PASSWORD ? String(process.env.DB_PASSWORD) : '';
const DB_NAME = String(process.env.DB_NAME || 'video_db');

const pool = new Pool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.query('SELECT NOW()')
  .then(() => {
    console.log('✅ Conectado ao banco de dados PostgreSQL');
  })
  .catch(err => {
    console.error('❌ Erro ao conectar ao banco de dados:', err.message);
  });

export default pool;

