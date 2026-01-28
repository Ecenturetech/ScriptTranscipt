import pkg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const { Client } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env');

const result = dotenv.config({ path: envPath });
if (result.error) {
  console.warn('⚠️  Aviso: Não foi possível carregar .env:', result.error.message);
  console.warn('   Tentando carregar do diretório atual...');
  dotenv.config();
}

const DB_HOST = String(process.env.DB_HOST || 'localhost');
const DB_PORT = parseInt(process.env.DB_PORT || '5432');
const DB_USER = String(process.env.DB_USER || 'root');
const DB_PASSWORD = process.env.DB_PASSWORD ? String(process.env.DB_PASSWORD) : '';
const DB_NAME = String(process.env.DB_NAME || 'video_db');

async function migrateAllColumns() {
  let client;
  
  try {
    console.log('🔌 Conectando ao PostgreSQL...');
    client = new Client({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME
    });
    
    await client.connect();
    console.log('✅ Conectado ao banco de dados');
    
    const tables = ['videos', 'audios', 'scorms'];
    
    for (const table of tables) {
      console.log(`\n📝 Verificando tabela ${table}...`);
      
      // Verificar se tabela existe
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        );
      `, [table]);
      
      if (!tableCheck.rows[0].exists) {
        console.log(`⚠️  Tabela ${table} não existe, pulando...`);
        continue;
      }

      // Adicionar coluna ely_metadata
      try {
        await client.query(`
          ALTER TABLE ${table}
          ADD COLUMN IF NOT EXISTS ely_metadata TEXT;
        `);
        console.log(`✅ Coluna "ely_metadata" verificada/adicionada em ${table}`);
      } catch (error) {
        console.warn(`⚠️  Erro ao alterar ${table}:`, error.message);
      }
    }
    
    console.log('\n✅ Migração concluída com sucesso!');
    
  } catch (error) {
    console.error('❌ Erro crítico:', error);
  } finally {
    if (client) await client.end();
  }
}

migrateAllColumns();
