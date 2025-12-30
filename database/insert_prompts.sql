-- Script para inserir/atualizar os prompts atuais que estão sendo usados no código
-- Execute este script para atualizar os prompts no banco de dados com os prompts atuais do código

-- Prompt para Transcrição Melhorada (baseado no código atual)
UPDATE settings 
SET 
  transcript_prompt = 'Você é um especialista em transcrições e formatação de conteúdo.

Sua tarefa é transformar a transcrição bruta abaixo em uma versão aprimorada e bem formatada, seguindo EXATAMENTE o formato e estilo do exemplo fornecido.

Instruções:
1. Comece com "[Transcrição melhorada do material]" na primeira linha
2. Identifique e mantenha os falantes (identifique por contexto como "Agrônomo:", "Apresentador:", "Falante 1:", etc.)
3. Use o formato: [Nome do Falante]: [Texto formatado e aprimorado]
4. Organize o texto em parágrafos coerentes e bem estruturados
5. Corrija erros de transcrição óbvios, mas mantenha a fidelidade ao conteúdo original
6. Melhore a pontuação e a estrutura das frases para melhor legibilidade
7. Mantenha o tom e o estilo original
8. Não invente informações que não estão no texto original
9. Cada fala do mesmo falante deve estar em uma linha separada com o formato: [Nome do Falante]: [Texto]

Agora transforme a transcrição original abaixo seguindo o mesmo formato e estilo do exemplo:

Transcrição original:
"{text}"

Gere agora a transcrição aprimorada no mesmo formato do exemplo:',
  
  qa_prompt = 'Você é um assistente educacional especialista.
Sua tarefa é ler o texto abaixo e gerar um conjunto de Perguntas e Respostas (Q&A) detalhadas baseadas APENAS nesse texto.

Formato desejado:
P: [Pergunta]
R: [Resposta]
---

Texto base:
"{text}"

Gere o Q&A agora e utilize a língua do texto original:',
  
  additional_prompt = '',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

-- Se não existir registro, criar um novo
INSERT INTO settings (id, transcript_prompt, qa_prompt, additional_prompt) 
SELECT 1,
  'Você é um especialista em transcrições e formatação de conteúdo.

Sua tarefa é transformar a transcrição bruta abaixo em uma versão aprimorada e bem formatada, seguindo EXATAMENTE o formato e estilo do exemplo fornecido.

Instruções:
1. Comece com "[Transcrição melhorada do material]" na primeira linha
2. Identifique e mantenha os falantes (identifique por contexto como "Agrônomo:", "Apresentador:", "Falante 1:", etc.)
3. Use o formato: [Nome do Falante]: [Texto formatado e aprimorado]
4. Organize o texto em parágrafos coerentes e bem estruturados
5. Corrija erros de transcrição óbvios, mas mantenha a fidelidade ao conteúdo original
6. Melhore a pontuação e a estrutura das frases para melhor legibilidade
7. Mantenha o tom e o estilo original
8. Não invente informações que não estão no texto original
9. Cada fala do mesmo falante deve estar em uma linha separada com o formato: [Nome do Falante]: [Texto]

Agora transforme a transcrição original abaixo seguindo o mesmo formato e estilo do exemplo:

Transcrição original:
"{text}"

Gere agora a transcrição aprimorada no mesmo formato do exemplo:',
  'Você é um assistente educacional especialista.
Sua tarefa é ler o texto abaixo e gerar um conjunto de Perguntas e Respostas (Q&A) detalhadas baseadas APENAS nesse texto.

Formato desejado:
P: [Pergunta]
R: [Resposta]
---

Texto base:
"{text}"

Gere o Q&A agora e utilize a língua do texto original:',
  ''
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE id = 1);

