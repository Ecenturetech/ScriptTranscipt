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

export async function generateElyMetadata(text, fileName, documentCreatedAt = null) {
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
    const dataCriacaoDoc = documentCreatedAt || validFrom;
    
    const metadataPrompt = `Você é um especialista em extração de metadados de documentos agronômicos. Extraia os metadados do documento seguindo EXATAMENTE o formato ELY Document especificado abaixo.

Classificação doc_type (escolha UM valor da lista abaixo que melhor descreve o documento):
- product_label: Defines the approved and legally valid use conditions for a given product in a specific country. Includes dosage ranges, application methods, crops, and safety instructions as determined by the regulatory authority. This document acts as the regulatory boundary for all agronomic recommendations, ensuring that any advice or dosage mentioned elsewhere remains compliant with the country’s legal approvals.
- portfolio_catalog: Provides a complete listing of all products commercialized in a given market or region, including hybrids, traits, chemistries, and technologies. Enables cross‑referencing between product availability, registration status, and portfolio structure. Serves as the foundation to ensure that ELY only recommends or references products that are commercially available and approved in that market.
- product_positioning: Presents a comprehensive and official overview of a specific product, detailing its agronomic and technical characteristics, key attributes, competitive advantages, and positioning statements. Includes comparative ratings, trait information, and performance summaries validated by data or official evaluations. This document defines how the product is positioned in the market, ensuring consistency across technical, commercial, and marketing communications.
- product_guidance: Outlines the core agronomic rationale and technical guidance for a product or technology across different environments. Summarizes performance insights, benefits, vulnerabilities, and management recommendations. Provides a consistent technical narrative to support agronomists, sales teams, and partners in product training and agronomic reasoning.
- localized_guidance: Delivers regionally adapted recommendations for specific geographies or production systems, using local trial data, environmental adaptation, and regulatory nuances. Refines the general guidance into precise, localized agronomic strategies, ensuring that ELY provides recommendations aligned with local reality and validated by field evidence.
- demand_generation_guide: Establishes the operational and technical framework for planning and executing demand generation field activities. Includes decision trees, plot setup instructions, and performance evaluation methods. Ensures demonstration trials are executed consistently, following agronomic standards for credible and comparable results.
- product_performance_results: Presents the performance outcomes of agricultural products—such as seeds, crop protection solutions, or digital tools—based on field trials, demo plots, or commercial‑scale evaluations. These documents provide data‑driven insights into product efficacy, yield potential, agronomic traits, and environmental adaptability under real‑world conditions.
- demand_generation_results: Presents aggregated field performance evidence from demand generation or on‑farm trials, including quantitative results (e.g., yield, win rate) and qualitative observations (e.g., farmer feedback). Reinforces product credibility and supports agronomic and commercial discussions based on real‑world performance.
- agronomy_best_practices: Compiles general agronomic knowledge and management recommendations applicable across crops, regions, or production systems. Covers areas such as planting, soil fertility, pest and disease management, and environmental stewardship. Provides the knowledge foundation for ELY’s reasoning, supporting model context and logical inference.
- marketing_material: Focuses on communication and positioning, summarizing key value propositions, claims, and visuals used in campaigns, brochures, or social media. Supports awareness and demand generation but should not be used as a technical or regulatory reference for field‑level recommendations.
- external_material: Refers to third‑party content, such as reports, publications, or technical documents not produced internally, as well as market data and trials with public results. These materials may offer complementary perspectives, data, or insights relevant to agronomic decision‑making or strategic positioning. While useful for context and reference, they should be critically evaluated before being used to support field recommendations or internal reasoning.
- scientific_article: Represents peer‑reviewed academic publications that present original research, methodologies, and validated results. These articles serve as a robust source of technical evidence, supporting agronomic reasoning, innovation, and the development of best practices. Ideal for deepening understanding and supporting recommendations with scientific rigor.
- technical_guidance: Technical material developed by the Bayer team, with detailed guidelines for the safe and effective application of products, integrated pest management, and specific agronomic practices. Serves as a reliable reference for field recommendations, ensuring compliance with internal standards and supporting agronomic and commercial decisions.
- technical_commercial_argumentary: Structured material for technical‑commercial support, integrating validated technical information with positioning arguments and field recommendations. Brings together, in a practical and decision‑oriented way, the key elements needed to support agronomic and commercial discussions with customers and partners.
- frequent_asked_questions: Compiles a comprehensive selection of questions and answers on the various topics covered in Bayer’s portfolio, including agronomic subjects. This resource is designed to clarify common doubts and provide relevant information, facilitating the understanding of products and practices. While it is a useful tool for guidance and clarification, it should not be considered a substitute for technical consultations or specific field recommendations.
- commercial_policy: Establishes the commercial guidelines and rules applicable to negotiation, pricing, discounts, payment terms, and credit policies. Defines the parameters that guide commercial transactions, ensuring alignment with strategic objectives, compliance, and ethical practices.
- corporate_policy: Defines the principles, norms, and guidelines that govern corporate conduct, including ethics, compliance, sustainability, safety, and governance. Establishes the basis for all internal decisions and practices, ensuring alignment with institutional values and legal requirements.
- professional_demand_generation: Establishes the operational and technical framework for planning and executing professional demand generation trials with agro‑specialists. Includes detailed protocols for defining objectives, selecting areas, setting up demonstration plots, and applying technologies according to agronomic standards. Covers decision flows, installation and management instructions, and methods for performance evaluation and data collection, ensuring consistent, credible, and comparable demonstrations among industry professionals.
- operational_guidance: Provides clear, step‑by‑step operational instructions that enable users to correctly execute processes, workflows, or system activities within a defined program or platform. Outlines procedures, required actions, navigation paths, and practical guidance to ensure consistent, compliant, and efficient execution of tasks. Supports users by standardizing operations, clarifying responsibilities, and offering troubleshooting and contextual explanations when needed.
- geo_location_reference: Presents a detailed description of regions and their respective geographic coordinates, including spatial boundaries and centroid. The objective is to provide a georeferenced basis for localized agronomic analyses, strategic planning, and correlation with technical recommendations, ensuring spatial accuracy in management strategies.
- trial_protocol_reference: Standardizes the methodological structure of the organization’s official tests, detailing the testing basis, protocols used, technical criteria, experimental objectives, and operational requirements that ensure consistency, traceability, and comparability of data. Also includes the characterization of regions and locations where tests are conducted, as well as a description of the network of suppliers, collaborators, and partners involved in the execution of the studies, guaranteeing transparency and uniformity in conduct standards.

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
• purpose: [Identify the chosen 'doc_type'. Copy the 'Expanded Purpose' description of that 'doc_type' and use it as a template. Substitute the generic terms with the specific content of this document (e.g., replace "a product" with the actual product name, "region" with the region name, etc.). Keep the original sentence structure and ALWAYS write in ENGLISH.]
• language: [código ISO do idioma do documento: pt, es, en.]
• crop: [apresente a cultura, em inglês e o nome científico entre parênteses. Ex: "acerola (Malpighia emarginata)"]
• valid_from: [Procure no documento por uma data de referência (ex: "Novembro/2025", "Safra 2024/25"). Se encontrar, use o primeiro dia do mês/ano correspondente no formato YYYY-MM-DD. Se não encontrar, use a data atual: ${validFrom}]
• valid_to: [Se 'valid_from' foi extraído do documento, calcule 1 ano após essa data (ex: 2025-11-01 -> 2026-11-01). Se o documento tiver uma validade específica, use-a. Se usou a data atual em valid_from, use: ${validTo}]
• date_document: ${dataCriacaoDoc}

Abstract
[apresente um resumo do documento NO MESMO IDIOMA em que o documento está escrito. O resumo deve focar no CONTEÚDO específico (quais produtos, pragas, resultados, recomendações) e NÃO apenas descrever o tipo de documento (evite iniciar com "Este documento é um manual..."). Seja direto e informativo sobre as informações técnicas.]

IMPORTANTE:
- O idioma de título, autores, purpose e abstract é o idioma que você DETECTAR no bloco "Texto do documento" abaixo. Ignore o fato de este prompt estar em português; a saída deve seguir apenas o idioma do conteúdo do documento.
- doc_type: um único valor da lista fornecida.
- purpose: Deve ser idêntico à descrição do doc_type escolhido.
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
• date_document: 
`;
  }
}
