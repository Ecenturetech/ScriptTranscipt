import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CATALOG_PATH = path.join(
  __dirname,
  "product_catalog_Relação de Produtos de Crop Protection COMPLETO – Brasil.csv"
);

function stripDiacritics(value = "") {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function escapeRegex(value = "") {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCatalogLine(line = "") {
  const columns = line.split(";");
  if (columns.length < 2) return null;

  const productName = columns[0]?.trim();
  const cultureField = columns[1]?.trim();

  if (!productName || !cultureField) return null;
  if (
    productName.toLowerCase().includes("nome produto") ||
    cultureField.toLowerCase().includes("culturas registradas")
  ) {
    return null;
  }

  const commonName = cultureField.split("(")[0].trim();
  if (!commonName) return null;

  return { productName, commonName };
}

function buildCultureProductMap(catalogPath = DEFAULT_CATALOG_PATH) {
  const fileContent = fs.readFileSync(catalogPath, "utf-8");
  const lines = fileContent.split(/\r?\n/).filter(Boolean);

  const cultureMap = new Map();

  for (const line of lines) {
    const parsed = parseCatalogLine(line);
    if (!parsed) continue;

    const { productName, commonName } = parsed;
    const key = stripDiacritics(commonName).toLowerCase();

    const current = cultureMap.get(key) || {
      displayName: commonName,
      products: new Set(),
    };

    current.products.add(productName);
    cultureMap.set(key, current);
  }

  return cultureMap;
}

function enrichTextWithProducts(text = "", cultureMap = new Map()) {
  if (!text || !cultureMap.size) return text;

  const normalizedText = stripDiacritics(text).toLowerCase();
  const replacements = [];
  const occupiedRanges = [];

  const entries = Array.from(cultureMap.entries()).sort(
    (a, b) => b[0].length - a[0].length
  );

  for (const [key, { products }] of entries) {
    const pattern = new RegExp(
      `(?<![\\p{L}])${escapeRegex(key)}(?![\\p{L}])`,
      "gu"
    );

    let match;
    while ((match = pattern.exec(normalizedText)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      if (occupiedRanges.some(([s, e]) => start < e && end > s)) continue;

      const lookAhead = text.slice(end).trimStart();
      if (lookAhead.startsWith("(")) continue;

      const originalSlice = text.slice(start, end);
      const productList = Array.from(products).join(", ");

      replacements.push({
        start,
        end,
        replacement: `${originalSlice} (${productList})`,
      });
      occupiedRanges.push([start, end]);
    }
  }

  replacements.sort((a, b) => b.start - a.start);

  let enriched = text;
  for (const { start, end, replacement } of replacements) {
    enriched = enriched.slice(0, start) + replacement + enriched.slice(end);
  }

  return enriched;
}

function enrichTranscriptFromCatalog(text = "", catalogPath = DEFAULT_CATALOG_PATH) {
  try {
    const cultureMap = buildCultureProductMap(catalogPath);
    return enrichTextWithProducts(text, cultureMap);
  } catch (error) {
    console.error("Erro ao enriquecer transcrição com catálogo:", error);
    return text;
  }
}

export {
  buildCultureProductMap,
  enrichTextWithProducts,
  enrichTranscriptFromCatalog,
  stripDiacritics,
};
