import OpenAI from 'openai';
import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env');

dotenv.config({ path: envPath });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

if (!process.env.OPENAI_API_KEY) {
  console.error('[ELY] ERRO CRÍTICO: OPENAI_API_KEY não encontrada no arquivo .env ou variáveis de ambiente!');
}

const METADATA_TEXT_MAX_LENGTH = 60000;
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

Classificação doc_type (use apenas um valor; priorize pela ordem abaixo):
1. 'product_label': Documentos legais, bulas, rótulos, fichas de segurança/emergência.
2. 'localized_guidance': Guias de geração de demanda, orientações de posicionamento para equipe/comercial, boletins técnicos por região/safra, materiais que definem ações e prioridades para uma região ou safra específica. Ex.: "Guia de Geração de Demanda", materiais de suporte à venda por região.
3. 'product_performance_results': Resultados de ensaios, testes de campo, comparativos, relatórios de performance de produtos.
4. 'agronomy_best_practices': Propostas técnicas de valor (PTV), manuais de cultivo, guias agronômicos que compilam prioridades e práticas de manejo, recomendações técnicas detalhadas, "Coleção Plantar", livros técnicos. Ex.: "Proposta Técnica de Valor", documentos que compilam prioridades e recomendações de híbridos/culturas.
5. 'marketing_material': Folhetos promocionais, catálogos de produtos, apresentações comerciais (foco em venda, não em recomendações técnicas).

Specificity:
- 'subnational_specific': documento focado em região, estado, safra ou zona específica (ex.: Safrinha Subtropical, Norte PR).
- 'country_specific': aplicável a todo o país.
- 'global': sem restrição geográfica.

📄 ELY Document

Document Title: [apresente o título do material, na mesma língua do arquivo. Se usar o nome do arquivo, CORRIJA qualquer erro de encoding ou acentuação (ex: "RelatÃ³rio" -> "Relatório", "Producao" -> "Produção"). Remova a extensão do arquivo (.pdf, .docx).]

Version: v1.0

Date: [apresente a data de criação do arquivo, no formato YYYY-MM-DD. Se não encontrar, use a data atual: ${validFrom}]

Author: [apresente TODOS os autores encontrados, separados por vírgula. Procure com atenção por listas de nomes na capa, contracapa ou créditos. Não omita nomes.]

________________________________________

🔗 ELY Metadata Reference (ISO-compliant / Schema key format)

• country: [Nome do País em Inglês (Código ISO). Ex: "Brazil (BR)"]
• subnational_codes: [Se specificity for 'subnational_specific', liste os códigos ISO das regiões (ex: BR-PR). Se for 'country_specific', REPLIQUE o código ISO do país (ex: "BR"). NÃO DEIXE VAZIO se for específico de um país.]
• specificity: [Use 'subnational_specific', 'country_specific' ou 'global' conforme regras acima.]
• doc_type: [Um único valor conforme a hierarquia acima.]
• purpose: [Uma ou duas frases, NO MESMO IDIOMA do documento. Use verbo no início (Compila, Define, Apresenta, Descreve). Inclua: o que o documento faz + contexto (safra/região/cultura quando aplicável) + tema principal. Exemplos: "Compila prioridades e práticas agronômicas para a safra X, com recomendações de manejo e posicionamento de híbridos." / "Define ações de geração de demanda e orientações técnicas para implementação de híbridos na região Y." Seja objetivo; evite começar com "Este documento é..." ou "Este guia visa...".]
• language: [código ISO do idioma do documento: pt, es, en.]
• crop: [apresente a cultura, em inglês e o nome científico entre parênteses. Ex: "acerola (Malpighia emarginata)"]
• valid_from: ${validFrom}
• valid_to: ${validTo}

Abstract
[apresente um resumo do documento NO MESMO IDIOMA em que o documento está escrito. O resumo deve focar no CONTEÚDO específico (quais produtos, pragas, resultados, recomendações) e NÃO apenas descrever o tipo de documento (evite iniciar com "Este documento é um manual..."). Seja direto e informativo sobre as informações técnicas.]

IMPORTANTE:
- Título, autores, purpose e abstract: NO MESMO IDIOMA do documento.
- doc_type: um único valor; guias de geração de demanda = localized_guidance; PTV e compilações de prioridades agronômicas = agronomy_best_practices.
- purpose: frase objetiva começando por verbo (Compila, Define, Apresenta), com contexto (safra/região/cultura) e tema; evitar "Este guia visa..." ou "Este documento é...".
- country no formato "Country (ISO)".
- Corrija encoding no título se necessário; resumo com informações técnicas do texto; inclua TODOS os autores. Siga EXATAMENTE o formato visual acima.

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
