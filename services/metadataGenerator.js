import OpenAI from 'openai';
import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../../.env');

dotenv.config({ path: envPath });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

if (!process.env.OPENAI_API_KEY) {
  console.error('[ELY] ERRO CRÍTICO: OPENAI_API_KEY não encontrada no arquivo .env ou variáveis de ambiente!');
}

const METADATA_TEXT_MAX_LENGTH = 10000;
const METADATA_TIMEOUT = 60000;

export async function generateElyMetadata(text, fileName) {
  try {
    const textoLimitado = text.substring(0, METADATA_TEXT_MAX_LENGTH);
    if (text.length > METADATA_TEXT_MAX_LENGTH) {
      console.log(`[ELY] Gerando metadados a partir de amostra de ${METADATA_TEXT_MAX_LENGTH} caracteres (documento tem ${text.length})...`);
    }
    
    const hoje = new Date();
    const validFrom = hoje.toISOString().split('T')[0];
    const proximoAno = new Date(hoje);
    proximoAno.setFullYear(proximoAno.getFullYear() + 1);
    const validTo = proximoAno.toISOString().split('T')[0];
    
    const metadataPrompt = `Você é um especialista em extração de metadados de documentos agronômicos. Extraia os metadados do documento seguindo EXATAMENTE o formato ELY Document especificado abaixo.

Siga estas regras de lógica de organização para classificar o documento:
1. Identificação de Origem:
   - 'country': Deve ser o Nome do País em Inglês seguido do código ISO entre parênteses. Exemplo: "Brazil (BR)", "United States (US)".
2. Hierarquia de Autoridade (doc_type):
   - 'product_label': Prioridade máxima. Documentos legais, bulas.
   - 'localized_guidance': Recomendações técnicas muito específicas para uma micro-região.
   - 'product_performance_results': Resultados de ensaios/testes.
   - 'agronomy_best_practices': Guias gerais, manuais de cultivo, "Coleção Plantar", livros técnicos e recomendações de manejo completas.
   - 'marketing_material': Materiais de venda/divulgação.
3. Nível de Detalhe (specificity):
   - 'subnational_specific': Focado em regiões específicas (estados, zonas).
   - 'country_specific': Aplicável a todo o país.
   - 'global': Sem restrição geográfica específica.

📄 ELY Document

Document Title: [apresente o título do material, na mesma língua do arquivo]

Version: v1.0

Date: [apresente a data de criação do arquivo, no formato YYYY-MM-DD. Se não encontrar, use a data atual: ${validFrom}]

Author: [apresente TODOS os autores encontrados, separados por vírgula. Procure com atenção por listas de nomes na capa, contracapa ou créditos. Não omita nomes.]

________________________________________

🔗 ELY Metadata Reference (ISO-compliant / Schema key format)

• country: [Nome do País em Inglês (Código ISO). Ex: "Brazil (BR)"]
• subnational_codes: [Se specificity for 'subnational_specific', liste os códigos ISO das regiões (ex: BR-PR). Se for 'country_specific', REPLIQUE o código ISO do país (ex: "BR"). NÃO DEIXE VAZIO se for específico de um país.]
• specificity: [Use 'subnational_specific' se focar em regiões específicas. Use 'country_specific' se for nacional. Use 'global' se não houver restrição.]
• doc_type: [Classifique conforme a hierarquia. Manuais de cultura completos são 'agronomy_best_practices'.]
• purpose: [descreva o propósito técnico do documento NO MESMO IDIOMA do documento. Ex: "Compila conhecimento agronômico geral e recomendações de manejo..."]
• language: [código ISO do idioma do documento: pt, es, en.]
• crop: [apresente a cultura, em inglês e o nome científico entre parênteses. Ex: "acerola (Malpighia emarginata)"]
• valid_from: ${validFrom}
• valid_to: ${validTo}

Abstract
[apresente um resumo do documento NO MESMO IDIOMA em que o documento está escrito. Descreva o conteúdo principal, objetivos e recomendações.]

IMPORTANTE:
- Título, autores, purpose e abstract devem estar NO MESMO IDIOMA do documento.
- O campo country deve seguir o formato "Country (ISO)".
- O campo doc_type para manuais de cultivo deve ser 'agronomy_best_practices'.
- Se authors for uma lista longa, inclua TODOS.
- Siga EXATAMENTE o formato visual acima.

Texto do documento:
"""
${textoLimitado}
"""

Nome do arquivo original: ${fileName}

Gere agora os metadados no formato especificado:`;

    console.log(`[ELY] Enviando requisição para OpenAI (modelo: gpt-4o-mini, timeout: ${METADATA_TIMEOUT}ms)...`);

    const apiCall = openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Você é um especialista em extração de metadados de documentos agronômicos. Você deve seguir estritamente o formato especificado e extrair informações precisas do documento.',
        },
        {
          role: 'user',
          content: metadataPrompt,
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout ao gerar metadados ELY')), METADATA_TIMEOUT)
    );

    const response = await Promise.race([apiCall, timeoutPromise]);
    
    console.log('[ELY] Resposta da OpenAI recebida com sucesso.');

    const metadata = response.choices[0].message.content.trim();
    
    if (!metadata || metadata.length === 0) {
      throw new Error('Nenhum metadado foi retornado pela OpenAI');
    }
    
    return metadata;
  } catch (error) {
    console.error('Erro ao gerar metadados ELY:', error.message);
    return `
📄 ELY Document
Document Title: ${fileName} (Erro na geração automática)
Version: v1.0
Date: ${new Date().toISOString().split('T')[0]}
Author: 

________________________________________

🔗 ELY Metadata Reference
• country: 
• subnational_codes: 
• specificity: global
• doc_type: 
• purpose: Erro na geração automática: ${error.message}
• language: 
• crop: 
• valid_from: ${new Date().toISOString().split('T')[0]}
• valid_to: 
`;
  }
}
