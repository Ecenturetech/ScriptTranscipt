import pkg from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const { Client } = pkg;

// Carregar .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env');

// Tentar carregar .env
const result = dotenv.config({ path: envPath });
if (result.error) {
  console.warn('⚠️  Aviso: Não foi possível carregar .env:', result.error.message);
  console.warn('   Tentando carregar do diretório atual...');
  dotenv.config(); // Tentar carregar do diretório atual
}

// Garantir que as variáveis sejam strings (não undefined ou null)
const DB_HOST = String(process.env.DB_HOST || 'localhost');
const DB_PORT = parseInt(process.env.DB_PORT || '5432');
const DB_USER = String(process.env.DB_USER || 'root');
const DB_PASSWORD = process.env.DB_PASSWORD ? String(process.env.DB_PASSWORD) : '';
const DB_NAME = String(process.env.DB_NAME || 'video_db');

async function initDatabase() {
  let client;
  
  try {
    console.log('🔌 Tentando conectar ao PostgreSQL...');
    console.log(`   Host: ${DB_HOST}`);
    console.log(`   Port: ${DB_PORT}`);
    console.log(`   User: ${DB_USER}`);
    console.log(`   Database: postgres`);
    
    // Primeiro, conectar ao banco postgres para criar o banco se não existir
    const adminClient = new Client({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: 'postgres' // Conectar ao banco padrão
    });
    
    await adminClient.connect();
    console.log('✅ Conectado ao PostgreSQL');
    
    // Criar banco de dados se não existir
    try {
      await adminClient.query(`CREATE DATABASE ${DB_NAME}`);
      console.log(`✅ Banco de dados '${DB_NAME}' criado`);
    } catch (error) {
      if (error.code === '42P04') { // database already exists
        console.log(`ℹ️  Banco de dados '${DB_NAME}' já existe`);
      } else {
        throw error;
      }
    }
    
    await adminClient.end();
    
    // Agora conectar ao banco específico
    console.log(`🔌 Conectando ao banco '${DB_NAME}'...`);
    client = new Client({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME
    });
    
    await client.connect();
    console.log(`✅ Conectado ao banco '${DB_NAME}'`);
    
    // Ler e executar o schema
    const schemaPath = join(__dirname, '../database/schema.sql');
    let schema = readFileSync(schemaPath, 'utf-8');
    
    // Remover comentários de linha (-- comentário)
    schema = schema.replace(/--.*$/gm, '');
    
    // Função para dividir SQL respeitando dollar quoting ($$...$$)
    function splitSQL(sql) {
      const commands = [];
      let currentCommand = '';
      let inDollarQuote = false;
      let dollarTag = '';
      let i = 0;
      
      while (i < sql.length) {
        const char = sql[i];
        
        // Detectar início de dollar quote ($$ ou $tag$)
        if (char === '$' && !inDollarQuote) {
          let tag = '$';
          let j = i + 1;
          
          // Verificar se é um tag nomeado ($tag$)
          while (j < sql.length && sql[j] !== '$') {
            tag += sql[j];
            j++;
          }
          
          if (j < sql.length) {
            tag += '$';
            dollarTag = tag;
            inDollarQuote = true;
            currentCommand += tag;
            i = j + 1;
            continue;
          }
        }
        
        // Detectar fim de dollar quote
        if (inDollarQuote && char === '$') {
          let potentialTag = '$';
          let j = i + 1;
          
          while (j < sql.length && sql[j] !== '$') {
            potentialTag += sql[j];
            j++;
          }
          
          if (j < sql.length) {
            potentialTag += '$';
            if (potentialTag === dollarTag) {
              currentCommand += potentialTag;
              inDollarQuote = false;
              dollarTag = '';
              i = j + 1;
              continue;
            }
          }
        }
        
        currentCommand += char;
        
        // Se não estamos em dollar quote, verificar se é fim de comando
        if (!inDollarQuote && char === ';') {
          const trimmed = currentCommand.trim();
          if (trimmed.length > 0 && 
              !trimmed.startsWith('CREATE DATABASE') && 
              !trimmed.startsWith('\\c')) {
            commands.push(trimmed);
          }
          currentCommand = '';
        }
        
        i++;
      }
      
      // Adicionar último comando se houver
      const trimmed = currentCommand.trim();
      if (trimmed.length > 0 && 
          !trimmed.startsWith('CREATE DATABASE') && 
          !trimmed.startsWith('\\c')) {
        commands.push(trimmed);
      }
      
      return commands;
    }
    
    const commands = splitSQL(schema);
    
    console.log('📝 Executando schema do banco de dados...');
    
    for (const command of commands) {
      if (command) {
        try {
          await client.query(command);
        } catch (error) {
          // Ignorar erros de "já existe"
          const ignorableErrors = [
            '42P07', // relation already exists
            '42710', // duplicate object
            '42P16', // type already exists
            'already exists',
            'duplicate'
          ];
          
          const shouldIgnore = ignorableErrors.some(code => 
            error.code === code || error.message.toLowerCase().includes(code.toLowerCase())
          );
          
          if (!shouldIgnore) {
            console.warn('⚠️  Aviso ao executar comando:', error.message);
            console.warn('   Comando:', command.substring(0, 100) + '...');
          }
        }
      }
    }
    
    console.log('✅ Banco de dados inicializado com sucesso!');
    console.log(`📊 Banco: ${DB_NAME}`);
    console.log('📋 Tabelas criadas: videos, dictionary_terms, settings');
    
  } catch (error) {
    console.error('❌ Erro ao inicializar banco de dados:', error.message);
    process.exit(1);
  } finally {
    if (client) {
      await client.end();
    }
  }
}

initDatabase();

