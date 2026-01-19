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

-- Tabela de áudios
CREATE TABLE IF NOT EXISTS audios (
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

CREATE INDEX IF NOT EXISTS idx_audios_status ON audios(status);
CREATE INDEX IF NOT EXISTS idx_audios_created_at ON audios(created_at);
CREATE INDEX IF NOT EXISTS idx_audios_source_type ON audios(source_type);

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

CREATE TRIGGER update_audios_updated_at BEFORE UPDATE ON audios
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

-- Tabela de PDFs
CREATE TABLE IF NOT EXISTS pdfs (
  id VARCHAR(36) PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  status status_enum NOT NULL DEFAULT 'processing',
  extracted_text TEXT,
  structured_summary TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Criar índices para PDFs
CREATE INDEX IF NOT EXISTS idx_pdfs_status ON pdfs(status);
CREATE INDEX IF NOT EXISTS idx_pdfs_created_at ON pdfs(created_at);

-- Trigger para atualizar updated_at automaticamente em PDFs
CREATE TRIGGER update_pdfs_updated_at BEFORE UPDATE ON pdfs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Tabela de SCORMs
CREATE TABLE IF NOT EXISTS scorms (
  id VARCHAR(36) PRIMARY KEY,
  scorm_id VARCHAR(255) NOT NULL,
  scorm_name VARCHAR(500) NOT NULL,
  course_path VARCHAR(500) NOT NULL,
  status status_enum NOT NULL DEFAULT 'processing',
  extracted_text TEXT,
  structured_summary TEXT,
  questions_answers TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Criar índices para SCORMs
CREATE INDEX IF NOT EXISTS idx_scorms_status ON scorms(status);
CREATE INDEX IF NOT EXISTS idx_scorms_created_at ON scorms(created_at);
CREATE INDEX IF NOT EXISTS idx_scorms_scorm_id ON scorms(scorm_id);

-- Trigger para atualizar updated_at automaticamente em SCORMs
CREATE TRIGGER update_scorms_updated_at BEFORE UPDATE ON scorms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
