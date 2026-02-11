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

Classificação doc_type (escolha UM valor da lista abaixo que melhor descreve o documento):
- product_label: Define as condições de uso aprovadas e legalmente válidas para um produto em um país específico, incluindo doses, métodos de aplicação, culturas e segurança. Atua como limite regulatório para recomendações agronômicas.
- portfolio_catalog: Lista completa de produtos comercializados em uma região, com híbridos, características e tecnologias. Permite cruzar disponibilidade, status regulatório e estrutura do portfólio.
- product_positioning: Visão oficial e detalhada de um produto específico, com características técnicas, atributos, vantagens competitivas e posicionamento de mercado.
- product_guidance: Racional agronômico e orientação técnica principal de um produto/tecnologia em diferentes ambientes, incluindo benefícios, vulnerabilidades e recomendações de manejo.
- localized_guidance: Recomendações adaptadas regionalmente com base em dados locais, ambiente e requisitos regulatórios.
- demand_generation_guide: Estrutura operacional e técnica para planejamento e execução de atividades de geração de demanda em campo, incluindo árvores de decisão e padrões agronômicos.
- product_performance_results: Resultados de desempenho de produtos agrícolas baseados em ensaios de campo, demos ou avaliações comerciais, com dados de eficácia, produtividade e adaptação ambiental.
- demand_generation_results: Evidências agregadas de desempenho em campo (ex.: produtividade, feedback de agricultores), apoiando discussões técnicas e comerciais.
- agronomy_best_practices: Conhecimento agronômico geral e práticas de manejo aplicáveis a diferentes culturas, regiões e sistemas produtivos.
- marketing_material: Materiais focados em comunicação e posicionamento, com propostas de valor e visuais de campanha. Não devem ser usados como referência técnica/regulatória.
- external_material: Conteúdos de terceiros (relatórios, publicações, estudos públicos) que oferecem contexto complementar e precisam de validação antes de uso em recomendações.
- scientific_article: Publicações científicas revisadas por pares com evidências empíricas e metodologias validadas para suporte técnico e científico.
- technical_guidance: Materiais técnicos detalhados com diretrizes seguras de aplicação, manejo integrado e práticas agronômicas específicas, alinhadas a padrões internos.
- technical_commercial_argumentary: Conteúdo estruturado para suporte técnico-comercial, combinando informações técnicas validadas com argumentos de posicionamento e recomendações de campo.
- frequent_asked_questions: Compilação de perguntas e respostas sobre temas do portfólio, útil para esclarecimento geral, mas não substitui recomendações técnicas específicas.
- commercial_policy: Diretrizes comerciais sobre negociação, descontos, pagamentos e políticas de crédito, garantindo alinhamento estratégico e compliance.
- corporate_policy: Princípios e normas corporativas sobre ética, governança, segurança e sustentabilidade.
- professional_demand_generation: Estrutura operacional e técnica para execução de ensaios profissionais de geração de demanda com especialistas, incluindo protocolos e avaliação de desempenho.
- operational_guidance: Instruções operacionais passo a passo para execução de processos, fluxos e atividades em sistemas ou programas.
- geo_location_reference: Descrição detalhada de regiões e coordenadas geográficas para análises agronômicas localizadas e planejamento estratégico.
- trial_protocol_reference: Estrutura metodológica padronizada para testes oficiais, incluindo protocolos, critérios técnicos e requisitos operacionais para garantir consistência e comparabilidade de dados.

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
• doc_type: [Um único valor da lista acima.]
• purpose: [Gere uma descrição baseada no "Expanded Purpose" do tipo de documento identificado, mas adaptada ao conteúdo específico deste documento (produto, cultura, região). Comece com verbo (Define, Lista, Apresenta). 1-2 frases.]
• language: [código ISO do idioma do documento: pt, es, en.]
• crop: [apresente a cultura, em inglês e o nome científico entre parênteses. Ex: "acerola (Malpighia emarginata)"]
• valid_from: ${validFrom}
• valid_to: ${validTo}

Abstract
[apresente um resumo do documento NO MESMO IDIOMA em que o documento está escrito. O resumo deve focar no CONTEÚDO específico (quais produtos, pragas, resultados, recomendações) e NÃO apenas descrever o tipo de documento (evite iniciar com "Este documento é um manual..."). Seja direto e informativo sobre as informações técnicas.]

IMPORTANTE:
- Título, autores, purpose e abstract: NO MESMO IDIOMA do documento.
- doc_type: um único valor da lista fornecida.
- purpose: Use as definições "Expanded Purpose" listadas acima como guia para gerar o texto, mas adapte para o contexto específico do documento.
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
