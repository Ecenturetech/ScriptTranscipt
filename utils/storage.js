import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Retorna o caminho da pasta de armazenamento baseado na data atual
 * Cria a pasta se não existir
 * @returns {string} Caminho da pasta de armazenamento
 */
export function getStoragePath() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateFolder = `${year}-${month}-${day}`;
  
  const storagePath = path.join(__dirname, '..', 'storage', dateFolder);
  
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
  }
  
  return storagePath;
}

