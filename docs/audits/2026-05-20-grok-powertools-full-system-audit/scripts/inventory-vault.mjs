import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

const vaultPath = '/Users/philipbankier/Content/Grok IMagine/greymaker/GrokVault';
const promptRoot = '/Users/philipbankier/Content/Grok IMagine/greymaker';
const outputRoot = 'docs/audits/2026-05-20-grok-powertools-full-system-audit/inventory';

function walk(dir) {
  const entries = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...walk(fullPath));
    } else if (entry.isFile()) {
      entries.push(fullPath);
    }
  }
  return entries;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function summarizeJson(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      path: filePath,
      fileName: basename(filePath),
      bytes: Buffer.byteLength(raw),
      parseable: false,
      error: error.message
    };
  }

  const type = Array.isArray(parsed) ? 'array' : typeof parsed;
  const count = Array.isArray(parsed)
    ? parsed.length
    : parsed && typeof parsed === 'object'
      ? Object.keys(parsed).length
      : 0;
  const firstKeys = Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object'
    ? Object.keys(parsed[0])
    : parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.keys(parsed).slice(0, 20)
      : [];

  return {
    path: filePath,
    fileName: basename(filePath),
    bytes: Buffer.byteLength(raw),
    parseable: true,
    type,
    count,
    firstKeys
  };
}

const files = walk(vaultPath);
const mediaRows = [];
const byExtension = {};
const byDateFolder = {};
const zeroByteFiles = [];
const basenameGroups = new Map();
const hashGroups = new Map();

for (const filePath of files) {
  const st = statSync(filePath);
  const rel = relative(vaultPath, filePath);
  const parts = rel.split('/');
  const dateFolder = parts.length > 1 ? parts[0] : '[root]';
  const extension = extname(filePath).replace(/^\./, '').toLowerCase() || '[noext]';
  const hash = await sha256File(filePath);
  const row = {
    path: filePath,
    relativePath: rel,
    fileName: basename(filePath),
    dateFolder,
    extension,
    bytes: st.size,
    mtime: new Date(st.mtimeMs).toISOString(),
    sha256: hash
  };
  mediaRows.push(row);
  byExtension[extension] = (byExtension[extension] || 0) + 1;
  byDateFolder[dateFolder] = byDateFolder[dateFolder] || { count: 0, bytes: 0, byExtension: {} };
  byDateFolder[dateFolder].count += 1;
  byDateFolder[dateFolder].bytes += st.size;
  byDateFolder[dateFolder].byExtension[extension] = (byDateFolder[dateFolder].byExtension[extension] || 0) + 1;
  if (st.size === 0) zeroByteFiles.push(row);
  basenameGroups.set(row.fileName, [...(basenameGroups.get(row.fileName) || []), row.relativePath]);
  hashGroups.set(hash, [...(hashGroups.get(hash) || []), row.relativePath]);
}

const duplicateFileNames = [...basenameGroups.entries()]
  .filter(([, values]) => values.length > 1)
  .map(([fileName, paths]) => ({ fileName, paths }));
const duplicateHashes = [...hashGroups.entries()]
  .filter(([, values]) => values.length > 1)
  .map(([sha256, paths]) => ({ sha256, paths }));

const promptJsonFiles = walk(promptRoot)
  .filter((filePath) => extname(filePath).toLowerCase() === '.json')
  .filter((filePath) => !filePath.includes('/node_modules/'))
  .map(summarizeJson);

const summary = {
  vaultPath,
  generatedAt: new Date().toISOString(),
  totalFiles: mediaRows.length,
  totalBytes: mediaRows.reduce((sum, row) => sum + row.bytes, 0),
  byExtension,
  byDateFolder,
  zeroByteFiles: zeroByteFiles.map((row) => row.relativePath),
  duplicateFileNameCount: duplicateFileNames.length,
  duplicateHashCount: duplicateHashes.length
};

writeFileSync(join(outputRoot, 'local-vault-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(
  join(outputRoot, 'local-vault-files.csv'),
  [
    ['relativePath', 'fileName', 'dateFolder', 'extension', 'bytes', 'mtime', 'sha256'].join(','),
    ...mediaRows.map((row) => [
      row.relativePath,
      row.fileName,
      row.dateFolder,
      row.extension,
      row.bytes,
      row.mtime,
      row.sha256
    ].map(csvEscape).join(','))
  ].join('\n') + '\n'
);
writeFileSync(join(outputRoot, 'local-vault-duplicates.json'), `${JSON.stringify({ duplicateFileNames, duplicateHashes }, null, 2)}\n`);
writeFileSync(join(outputRoot, 'prompt-json-summary.json'), `${JSON.stringify(promptJsonFiles, null, 2)}\n`);

console.log(JSON.stringify(summary, null, 2));
