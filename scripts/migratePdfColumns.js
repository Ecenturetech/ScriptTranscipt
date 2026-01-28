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

async function migratePdfColumns() {
  let client;
  
  try {
    console.log('🔌 Conectando ao PostgreSQL...');
    console.log(`   Host: ${DB_HOST}`);
    console.log(`   Port: ${DB_PORT}`);
    console.log(`   User: ${DB_USER}`);
    console.log(`   Database: ${DB_NAME}`);
    
    client = new Client({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME
    });
    
    await client.connect();
    console.log('✅ Conectado ao banco de dados');
    
    // Verificar se a tabela pdfs existe
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'pdfs'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.error('❌ Erro: A tabela "pdfs" não existe. Execute primeiro o script initDatabase.js');
      process.exit(1);
    }
    
    console.log('📝 Adicionando colunas à tabela pdfs...');
    
    // Adicionar coluna questions_answers se não existir
    try {
      await client.query(`
        ALTER TABLE pdfs 
        ADD COLUMN IF NOT EXISTS questions_answers TEXT;
      `);
      console.log('✅ Coluna "questions_answers" adicionada (ou já existia)');
    } catch (error) {
      console.warn('⚠️  Aviso ao adicionar coluna questions_answers:', error.message);
    }
    
    // Adicionar coluna ely_metadata se não existir
    try {
      await client.query(`
        ALTER TABLE pdfs 
        ADD COLUMN IF NOT EXISTS ely_metadata TEXT;
      `);
      console.log('✅ Coluna "ely_metadata" adicionada (ou já existia)');
    } catch (error) {
      console.warn('⚠️  Aviso ao adicionar coluna ely_metadata:', error.message);
    }
    
    // Verificar o estado final das colunas
    const columnsCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'pdfs'
      AND column_name IN ('questions_answers', 'ely_metadata')
      ORDER BY column_name;
    `);
    
    console.log('\n📊 Colunas na tabela pdfs:');
    columnsCheck.rows.forEach(row => {
      console.log(`   - ${row.column_name} (${row.data_type})`);
    });
    
    console.log('\n✅ Migração concluída com sucesso!');
    
  } catch (error) {
    console.error('❌ Erro ao executar migração:', error.message);
    console.error('   Detalhes:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.end();
    }
  }
}

migratePdfColumns();
