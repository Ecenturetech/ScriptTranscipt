import pool from './db/connection.js';

function stripDiacritics(value = '') {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function escapeRegex(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCommonName(field = '') {
  const s = String(field).trim();
  const idx = s.indexOf('(');
  if (idx > 0) return s.slice(0, idx).trim();
  return s;
}

async function loadCatalogTerms() {
  const { rows } = await pool.query(`
    SELECT nome_produto, culturas_registradas, doencas_pragas_plantas_daninhas_controladas, dose_recomendada, volume_calda, classe, empresa, pais
    FROM catalogo_produto
    WHERE (nome_produto IS NOT NULL AND nome_produto != '')
      AND (dose_recomendada IS NOT NULL OR volume_calda IS NOT NULL)
  `);

  const seen = new Set();
  const terms = [];

  for (const row of rows) {
    const dose = (row.dose_recomendada || '').trim();
    const volumeCalda = (row.volume_calda || '').trim();
    const classe = (row.classe || '').trim();
    const empresa = (row.empresa || '').trim();
    const pais = (row.pais || '').trim();
    if (!dose && !volumeCalda && !classe && !empresa && !pais) continue;

    const info = { dose, volumeCalda, classe, empresa, pais };

    const product = (row.nome_produto || '').trim();
    if (product) {
      const key = stripDiacritics(product).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        terms.push({ term: product, termNormalized: key, ...info });
      }
    }

    const cultureRaw = (row.culturas_registradas || '').trim();
    const culture = extractCommonName(cultureRaw);
    if (culture && culture.length >= 2) {
      const key = stripDiacritics(culture).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        terms.push({ term: culture, termNormalized: key, ...info });
      }
    }

    const diseaseRaw = (row.doencas_pragas_plantas_daninhas_controladas || '').trim();
    const disease = extractCommonName(diseaseRaw);
    if (disease && disease.length >= 2) {
      const key = stripDiacritics(disease).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        terms.push({ term: disease, termNormalized: key, ...info });
      }
      if (key.startsWith('acaro')) {
        const rest = disease.slice(disease.toLowerCase().indexOf('ácaro') + 5);
        const variantHyphen = 'cáscaro' + rest;
        const keyVariantHyphen = 'cascaro' + key.slice(5);
        if (!seen.has(keyVariantHyphen)) {
          seen.add(keyVariantHyphen);
          terms.push({ term: variantHyphen, termNormalized: keyVariantHyphen, replaceWith: disease, ...info });
        }
        const restSpace = rest.replace(/^-/, ' ');
        const variantSpace = 'cáscaro' + restSpace;
        const keyVariantSpace = 'cascaro' + key.slice(5).replace(/^-/, ' ');
        if (keyVariantSpace !== keyVariantHyphen && !seen.has(keyVariantSpace)) {
          seen.add(keyVariantSpace);
          terms.push({ term: variantSpace, termNormalized: keyVariantSpace, replaceWith: disease, ...info });
        }
      }
    }
  }

  terms.sort((a, b) => b.term.length - a.term.length);
  return terms;
}

function buildNormalizedMapping(text) {
  let normalized = '';
  const normToOrig = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = stripDiacritics(c);
    for (let j = 0; j < n.length; j++) {
      normalized += n[j];
      normToOrig.push(i);
    }
  }
  return { normalized: normalized.toLowerCase(), normToOrig };
}

function getActiveCatalogData(text, terms) {
  const { normalized } = buildNormalizedMapping(text);
  for (const { termNormalized, dose, volumeCalda, classe, empresa, pais } of terms) {
    const pattern = new RegExp(`(?<![\\p{L}])${escapeRegex(termNormalized)}(?![\\p{L}])`, 'gu');
    if (pattern.test(normalized)) {
      return { dose, volumeCalda, classe, empresa, pais };
    }
  }
  return null;
}

function correctTextWithCatalog(text = '', terms = []) {
  if (!text || terms.length === 0) return text;

  const { normalized: normalizedText, normToOrig } = buildNormalizedMapping(text);
  let result = text;

  const spellingReplacements = [];
  for (const { term, termNormalized, replaceWith } of terms) {
    if (!replaceWith) continue;
    const pattern = new RegExp(`(?<![\\p{L}])${escapeRegex(termNormalized)}(?![\\p{L}])`, 'gu');
    let match;
    while ((match = pattern.exec(normalizedText)) !== null) {
      const nStart = match.index;
      const nEnd = nStart + match[0].length;
      const origStart = normToOrig[nStart];
      const origEnd = nEnd > 0 ? normToOrig[nEnd - 1] + 1 : normToOrig[0];
      spellingReplacements.push({ start: origStart, end: origEnd, replacement: replaceWith });
    }
  }
  spellingReplacements.sort((a, b) => b.start - a.start);
  const used = [];
  for (const { start, end, replacement } of spellingReplacements) {
    if (used.some(([s, e]) => start < e && end > s)) continue;
    used.push([start, end]);
    result = result.slice(0, start) + replacement + result.slice(end);
  }

  const active = getActiveCatalogData(text, terms);
  if (!active) return result;

  const { dose, volumeCalda, classe, empresa, pais } = active;

  if (dose) {
    result = result
      .replace(/\b0,7\s*a\s*0,9\s*L\/ha\b/gi, dose)
      .replace(/\b0,7\s*-\s*0,9\s*L\/ha\b/gi, dose)
      .replace(/\b0,7\s*a\s*0,9\b/gi, dose)
      .replace(/\b0,7\s*-\s*0,9\b/gi, dose)
      .replace(/\b0,7\s*à\s*0,9\b/gi, dose);
  }

  if (volumeCalda) {
    result = result
      .replace(/\b1\.?000\s*a\s*1\.?200\b/g, volumeCalda)
      .replace(/\b1000\s*a\s*1200\b/gi, volumeCalda)
      .replace(/\b1\.000\s*a\s*1\.200\b/g, volumeCalda);
  }

  if (classe) {
    result = result
      .replace(/\bclasse\s+é\s+do\s+limão\b/gi, `classe é ${classe}`)
      .replace(/\bclasse\s+do\s+limão\b/gi, `classe é ${classe}`);
  }

  if (empresa) {
    result = result
      .replace(/\bempresa\s+é\s+a\s+THC\b/gi, `empresa é a ${empresa}`)
      .replace(/\bempresa\s+é\s+a\s+thc\b/g, `empresa é a ${empresa}`)
      .replace(/\ba\s+THC\b/g, `a ${empresa}`)
      .replace(/\ba\s+thc\b/g, `a ${empresa}`);
  }

  if (pais) {
    const paisDisplay = pais.toLowerCase().includes('brazil') || pais.toLowerCase().includes('brasil') ? 'o Brasil' : pais;
    result = result
      .replace(/\bpaís\s+é\s+a\s+Argentina\b/gi, `país é ${paisDisplay}`)
      .replace(/\bpaís\s+é\s+a\s+argentina\b/g, `país é ${paisDisplay}`)
      .replace(/\bpaís\s+de\s+origem\s+é\s+a\s+Argentina\b/gi, `país de origem é ${paisDisplay}`)
      .replace(/\ba\s+Argentina\b/g, paisDisplay)
      .replace(/\ba\s+argentina\b/g, paisDisplay);
  }

  return result;
}

/**
 * Carrega o catálogo e corrige a transcrição: grafia (cáscaro → Ácaro) e
 * substitui dose, volume, classe, empresa e país incorretos pelos valores corretos.
 */
export async function correctTranscriptFromCatalog(text = '') {
  if (!text || typeof text !== 'string') return text;

  try {
    const terms = await loadCatalogTerms();
    if (terms.length === 0) return text;
    return correctTextWithCatalog(text, terms);
  } catch (error) {
    console.error('Erro ao corrigir transcrição com catálogo:', error.message);
    return text;
  }
}

export { loadCatalogTerms, correctTextWithCatalog, stripDiacritics, extractCommonName };
