import fs from 'fs/promises';
import path from 'path';

const ensureFile = async (filePath, defaultValue) => {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8');
  }
};

export const readJson = async (filePath, defaultValue) => {
  await ensureFile(filePath, defaultValue);
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
};

export const writeJson = async (filePath, data) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
};
