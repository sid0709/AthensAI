#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['.'];
const ignored = new Set([
  'scripts/verify-firestore-only.mjs',
]);
const extensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.yml', '.yaml', '.sh']);
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.wxt']);
const forbidden = [
  ['database client import', /(?:from\s+|import\(|require\()\s*['"]mongo(?:db)?['"]/i],
  ['database client dependency', /["']mongo(?:db)?["']\s*:/i],
  ['database connection URL', /mongo(?:db)?(?:\+srv)?:\/\//i],
  ['database client API', /\bMongoClient\b|\bGridFSBucket\b/],
  ['database server binary', /\bmongod\b/i],
  ['legacy database environment', /\bMONGO_(?:URL|DB|HOST|PORT|CLOUD_URL|LOCAL_URL|SOURCE_URL|SOURCE_DB)\b|\bEMBEDDED_MONGO\b/],
  ['selectable database backend', /\bDATABASE_BACKEND\b/],
];

async function filesUnder(relative) {
  const absolute = path.join(root, relative);
  const info = await stat(absolute);
  if (info.isFile()) return [relative];
  const entries = await readdir(absolute, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : filesUnder(child);
    return extensions.has(path.extname(entry.name)) || entry.name === 'Dockerfile' ? [child] : [];
  }));
  return nested.flat();
}

const files = (await Promise.all(targets.map(filesUnder))).flat().filter((file) => !ignored.has(file));
const failures = [];
for (const file of files) {
  const content = await readFile(path.join(root, file), 'utf8');
  for (const [label, pattern] of forbidden) {
    const match = content.match(pattern);
    if (match) failures.push(`${file}: ${label} (${match[0]})`);
  }
}

if (failures.length) {
  console.error('Firestore-only architecture check failed:\n' + failures.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}
console.log(`Firestore-only architecture check passed (${files.length} files).`);
