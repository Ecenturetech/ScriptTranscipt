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
- product_label: Define as condições de uso aprovadas e legalmente válidas de um determinado produto em um país específico. Inclui faixas de dosagem, métodos de aplicação, culturas e instruções de segurança conforme determinado pela autoridade regulatória. Este documento atua como limite regulatório para todas as recomendações agronômicas, garantindo que qualquer orientação ou dosagem mencionada em outros contextos permaneça em conformidade com as aprovações legais do país.
- portfolio_catalog: Oferece uma listagem completa de todos os produtos comercializados em um determinado mercado ou região, incluindo híbridos, características, químicos e tecnologias. Permite cruzamento entre disponibilidade de produtos, status de registro e estrutura do portfólio. Serve como base para garantir que a ELY recomende ou referencie apenas produtos comercialmente disponíveis e aprovados naquele mercado.
- product_positioning: Apresenta uma visão abrangente e oficial de um produto específico, detalhando suas características agronômicas e técnicas, atributos-chave, vantagens competitivas e declarações de posicionamento. Inclui avaliações comparativas, informações de características e resumos de desempenho validados por dados ou avaliações oficiais. Este documento define como o produto é posicionado no mercado, garantindo consistência nas comunicações técnicas, comerciais e de marketing.
- product_guidance: Esboça a lógica agronômica central e a orientação técnica para um produto ou tecnologia em diferentes ambientes. Resume insights de desempenho, benefícios, vulnerabilidades e recomendações de manejo. Oferece uma narrativa técnica consistente para apoiar agrônomos, equipes de vendas e parceiros no treinamento de produtos e no raciocínio agronômico.
- localized_guidance: Oferece recomendações adaptadas regionalmente para geografias ou sistemas de produção específicos, utilizando dados de ensaios locais, adaptação ambiental e nuances regulatórias. Refina a orientação geral em estratégias agronômicas localizadas e precisas, garantindo que a ELY forneça recomendações alinhadas à realidade local e validadas por evidências de campo.
- demand_generation_guide: Estabelece o marco operacional e técnico para planejar e executar atividades de campo de geração de demanda. Inclui árvores de decisão, instruções de instalação de parcelas e métodos de avaliação de desempenho. Garante que os ensaios de demonstração sejam executados de forma consistente, seguindo padrões agronômicos para resultados credíveis e comparáveis.
- product_performance_results: Apresentar os resultados de desempenho de produtos agrícolas—como sementes, soluções de proteção de cultivos ou ferramentas digitais—com base em ensaios de campo, parcelas demonstrativas ou avaliações em escala comercial. Esses documentos fornecem insights baseados em dados sobre eficácia do produto, potencial de produtividade, características agronômicas e adaptabilidade ambiental em condições reais.
- demand_generation_results: Apresenta evidências agregadas de desempenho de campo de geração de demanda ou ensaios na fazenda, incluindo resultados quantitativos (ex.: produtividade, taxa de vitória) e observações qualitativas (ex.: feedback do produtor). Reforça a credibilidade do produto e apoia discussões agronômicas e comerciais com base no desempenho real.
- agronomy_best_practices: Compila conhecimento agronômico geral e recomendações de manejo aplicáveis a culturas, regiões ou sistemas de produção. Aborda áreas como plantio, fertilidade do solo, manejo de pragas e doenças e gestão ambiental. Fornece a base de conhecimento para o raciocínio da ELY, apoiando o contexto do modelo e a inferência lógica.
- marketing_material: Foca em comunicação e posicionamento, resumindo proposições de valor, claims e elementos visuais usados em campanhas, folhetos ou mídias sociais. Apoia conscientização e geração de demanda, mas não deve ser usado como referência técnica ou regulatória para recomendações em nível de campo.
- external_material: Refere-se a conteúdo de terceiros, como relatórios, publicações ou documentos técnicos não produzidos internamente, além de dados de mercado e ensaios com resultados públicos. Esses materiais podem oferecer perspectivas, dados ou insights complementares relevantes para decisões agronômicas ou posicionamento estratégico. Embora úteis para contexto e referência, devem ser avaliados criticamente antes de serem usados para apoiar recomendações de campo ou raciocínio interno.
- scientific_article: Representa publicações acadêmicas revisadas por pares que apresentam pesquisa original, metodologias e resultados validados. Esses artigos servem como fonte robusta de evidência técnica, apoiando o raciocínio agronômico, a inovação e o desenvolvimento de melhores práticas. Ideais para aprofundar o entendimento e apoiar recomendações com rigor científico.
- technical_guidance: Material técnico desenvolvido pela equipe Bayer, com diretrizes detalhadas para a aplicação segura e eficaz de produtos, manejo integrado de pragas e práticas agronômicas específicas. Serve como referência confiável para recomendações de campo, garantindo conformidade com padrões internos e apoiando decisões agronômicas e comerciais.
- technical_commercial_argumentary: Material estruturado de suporte técnico-comercial, integrando informação técnica validada com argumentos de posicionamento e recomendações de campo. Reúne, de forma prática e orientada à decisão, os elementos-chave necessários para apoiar discussões agronômicas e comerciais com clientes e parceiros.
- frequent_asked_questions: Compila uma seleção abrangente de perguntas e respostas sobre os diversos temas cobertos no portfólio da Bayer, incluindo assuntos agronômicos. Este recurso visa esclarecer dúvidas comuns e fornecer informações relevantes, facilitando o entendimento de produtos e práticas. Embora seja uma ferramenta útil para orientação e esclarecimento, não deve ser considerada substituta de consultas técnicas ou recomendações específicas de campo.
- commercial_policy: Estabelece as diretrizes e regras comerciais aplicáveis à negociação, precificação, descontos, condições de pagamento e políticas de crédito. Define os parâmetros que orientam as transações comerciais, garantindo alinhamento com objetivos estratégicos, compliance e práticas éticas.
- corporate_policy: Define os princípios, normas e diretrizes que regem a conduta corporativa, incluindo ética, compliance, sustentabilidade, segurança e governança. Estabelece a base para todas as decisões e práticas internas, garantindo alinhamento com valores institucionais e requisitos legais.
- professional_demand_generation: Estabelece o marco operacional e técnico para planejar e executar ensaios de geração de demanda profissional com agroespecialistas. Inclui protocolos detalhados para definição de objetivos, seleção de áreas, instalação de parcelas demonstrativas e aplicação de tecnologias conforme padrões agronômicos. Abrange fluxos de decisão, instruções de instalação e gestão dos ensaios, além de métodos de avaliação de desempenho e coleta de dados. Garante que as demonstrações sejam consistentes, credíveis e comparáveis, fortalecendo a geração de demanda entre profissionais do setor.
- operational_guidance: Fornece instruções operacionais claras e passo a passo que permitem aos usuários executar corretamente processos, fluxos de trabalho ou atividades de sistema dentro de um programa ou plataforma definidos. Este documento descreve procedimentos, ações necessárias, caminhos de navegação e orientação prática para garantir execução consistente, conforme e eficiente das tarefas. Apoia os usuários padronizando operações, esclarecendo responsabilidades e oferecendo solução de problemas e explicações contextuais quando necessário.
- geo_location_reference: Este documento apresenta uma descrição detalhada das regiões e suas respectivas coordenadas geográficas, incluindo limites espaciais e centróide. O objetivo é fornecer uma base georreferenciada para análises agronômicas localizadas, planejamento estratégico e correlação com recomendações técnicas, garantindo precisão espacial nas estratégias de manejo.
- trial_protocol_reference: Padroniza a estrutura metodológica dos testes oficiais da organização, detalhando a base de testes, os protocolos utilizados, critérios técnicos, objetivos experimentais e requisitos operacionais que garantem consistência, rastreabilidade e comparabilidade dos dados. Inclui também a caracterização das regiões e localidades onde os testes são realizados, além da descrição da rede de fornecedores, colaboradores e parceiros envolvidos na execução dos estudos, garantindo transparência e uniformidade nos padrões de conduta.

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
• purpose: [Identifique o 'doc_type' escolhido acima. Copie a descrição (Expanded Purpose) desse 'doc_type' e use-a como template. Substitua os termos genéricos pelo conteúdo específico deste documento (ex: substitua "um produto" pelo nome do produto real, "região" pelo nome da região, etc). Mantenha a estrutura da frase original.]
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
