-- Criação do banco de dados (execute como superusuário)
-- CREATE DATABASE video_db;

-- Conectar ao banco video_db antes de executar o restante
-- \c video_db;

-- Criar tipos ENUM
CREATE TYPE source_type_enum AS ENUM ('upload', 'vimeo', 'url');
CREATE TYPE status_enum AS ENUM ('processing', 'completed', 'error');

-- Tabela de vídeos
CREATE TABLE IF NOT EXISTS videos (
  id VARCHAR(36) PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  source_type source_type_enum NOT NULL,
  source_url VARCHAR(500),
  status status_enum NOT NULL DEFAULT 'processing',
  transcript TEXT,
  structured_transcript TEXT,
  questions_answers TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Criar índices
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at);
CREATE INDEX IF NOT EXISTS idx_videos_source_type ON videos(source_type);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_videos_updated_at BEFORE UPDATE ON videos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Tabela de termos do dicionário
CREATE TABLE IF NOT EXISTS dictionary_terms (
  id VARCHAR(36) PRIMARY KEY,
  term VARCHAR(255) NOT NULL UNIQUE,
  replacement VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_dictionary_terms_updated_at BEFORE UPDATE ON dictionary_terms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Tabela de configurações
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  transcript_prompt TEXT NOT NULL DEFAULT 'Melhore este transcript corrigindo erros de transcrição, pontuação e formatação. Mantenha o conteúdo original.',
  qa_prompt TEXT NOT NULL DEFAULT 'Com base no transcript fornecido, crie perguntas e respostas relevantes que cubram os principais pontos discutidos.',
  additional_prompt TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Inserir configuração padrão
INSERT INTO settings (id, transcript_prompt, qa_prompt, additional_prompt) 
VALUES (1, 
  'Melhore este transcript corrigindo erros de transcrição, pontuação e formatação. Mantenha o conteúdo original.',
  'Com base no transcript fornecido, crie perguntas e respostas relevantes que cubram os principais pontos discutidos.',
  ''
) ON CONFLICT (id) DO UPDATE SET id = settings.id;

