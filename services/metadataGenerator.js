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

export async function generateElyMetadata(text, fileName) {
  try {
    const textoLimitado = text.substring(0, 50000);
    
    // Calcula valid_from e valid_to (1 ano a partir de hoje)
    const hoje = new Date();
    const validFrom = hoje.toISOString().split('T')[0];
    const proximoAno = new Date(hoje);
    proximoAno.setFullYear(proximoAno.getFullYear() + 1);
    const validTo = proximoAno.toISOString().split('T')[0];
    
    const metadataPrompt = `Você é um especialista em extração de metadados de documentos agronômicos. Extraia os metadados do documento seguindo EXATAMENTE o formato ELY Document especificado abaixo.

Siga estas regras de lógica de organização para classificar o documento:
1. Identificação de Origem: O 'country' deve ser sempre o código ISO do país (ex: BR).
2. Hierarquia de Autoridade (doc_type):
   - 'product_label': Prioridade máxima. Documentos legais, bulas.
   - 'localized_guidance': Recomendações técnicas regionais/locais.
   - 'product_performance_results': Resultados de ensaios/testes.
   - 'marketing_material': Materiais de venda/divulgação.
   - 'agronomy_best_practices': Guias gerais de melhores práticas.
3. Nível de Detalhe (specificity):
   - 'subnational_specific': Focado em regiões específicas (estados, zonas).
   - 'country_specific': Aplicável a todo o país.
   - 'global': Sem restrição geográfica específica.

📄 ELY Document – Brazil

Document Title: [apresente o título do material, na mesma língua do arquivo]

Version: v1.0

Date: [apresente a data de criação do arquivo, no formato YYYY-MM-DD. Se não encontrar, use a data atual: ${validFrom}]

Author: [apresente o nome do autor ou autores do arquivo. Se não encontrar, deixe vazio]

________________________________________

🔗 ELY Metadata Reference (ISO-compliant / Schema key format)

• country: Brazil (BR)
• subnational_codes: [Se specificity for 'subnational_specific', liste os códigos ISO das regiões (ex: BR-PR, BR-RS). Se for nacional ('country_specific'), use "BR".]
• specificity: [Use 'subnational_specific' se focar em regiões específicas. Use 'country_specific' se for nacional. Use 'global' se não houver restrição.]
• doc_type: [Classifique conforme a hierarquia: 'product_label', 'localized_guidance', 'product_performance_results', 'marketing_material', 'agronomy_best_practices', 'product_catalog', 'research_paper'.]
• purpose: [apresente em português. Descreva o propósito técnico do documento, traduzindo na íntegra se necessário. Exemplo: "Apresenta recomendações regionais adaptadas a contextos geográficos..."]
• language: pt
• crop: [apresente a cultura, em inglês e o nome científico da cultura entre parênteses. Exemplo: "acerola (Malpighia emarginata)". Se não houver cultura específica, deixe vazio]
• valid_from: ${validFrom}
• valid_to: ${validTo}

Abstract
[apresente um resumo do documento em português, descrevendo o conteúdo principal, objetivos, público-alvo e principais recomendações técnicas/práticas mencionadas]

IMPORTANTE:
- Título, autores, purpose e abstract devem estar em PORTUGUÊS
- Os demais campos devem estar em INGLÊS (incluindo doc_type, crop, specificity)
- Siga EXATAMENTE o formato acima, incluindo os separadores e formatação
- Se algum campo não puder ser determinado, deixe vazio mas mantenha o formato
- Se o documento for uma bula ou documento legal, doc_type DEVE ser 'product_label'

Texto do documento:
"""
${textoLimitado}
"""

Nome do arquivo original: ${fileName}

Gere agora os metadados no formato especificado:`;

    const response = await openai.chat.completions.create({
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
    });
    
    const metadata = response.choices[0].message.content.trim();
    
    if (!metadata || metadata.length === 0) {
      throw new Error('Nenhum metadado foi retornado pela OpenAI');
    }
    
    return metadata;
  } catch (error) {
    console.error('Erro ao gerar metadados ELY:', error);
    throw new Error(`Erro ao gerar metadados ELY: ${error.message}`);
  }
}
