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

async function insertPrompts() {
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
    console.log(`✅ Conectado ao banco '${DB_NAME}'`);
    
    // Ler e executar o script SQL
    const sqlPath = join(__dirname, '../database/insert_prompts.sql');
    const sql = readFileSync(sqlPath, 'utf-8');
    
    // Remover comentários de linha (-- comentário)
    const cleanedSql = sql.replace(/--.*$/gm, '');
    
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
          if (trimmed.length > 0) {
            commands.push(trimmed);
          }
          currentCommand = '';
        }
        
        i++;
      }
      
      // Adicionar último comando se houver
      const trimmed = currentCommand.trim();
      if (trimmed.length > 0) {
        commands.push(trimmed);
      }
      
      return commands;
    }
    
    const commands = splitSQL(cleanedSql);
    
    console.log('📝 Executando script de inserção de prompts...');
    
    for (const command of commands) {
      if (command) {
        try {
          await client.query(command);
          console.log('✅ Comando executado com sucesso');
        } catch (error) {
          console.error('❌ Erro ao executar comando:', error.message);
          console.error('   Comando:', command.substring(0, 200) + '...');
          throw error;
        }
      }
    }
    
    // Verificar se os prompts foram inseridos
    const { rows } = await client.query('SELECT * FROM settings WHERE id = 1');
    if (rows.length > 0) {
      console.log('✅ Prompts inseridos/atualizados com sucesso!');
      console.log(`📋 Prompt de Transcrição: ${rows[0].transcript_prompt.substring(0, 50)}...`);
      console.log(`📋 Prompt de Q&A: ${rows[0].qa_prompt.substring(0, 50)}...`);
    } else {
      console.warn('⚠️  Nenhum registro encontrado na tabela settings');
    }
    
  } catch (error) {
    console.error('❌ Erro ao inserir prompts:', error.message);
    if (error.code === '42P01') {
      console.error('   A tabela "settings" não existe. Execute primeiro: npm run init-db');
    }
    process.exit(1);
  } finally {
    if (client) {
      await client.end();
    }
  }
}

insertPrompts();

