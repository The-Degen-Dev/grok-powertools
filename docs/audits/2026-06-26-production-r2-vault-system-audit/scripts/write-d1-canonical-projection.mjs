#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const auditRoot = path.resolve(scriptsDir, '..');
const repoRoot = path.resolve(auditRoot, '../../..');
const cloudRoot = path.join(repoRoot, 'cloud');
const manifestPath = path.join(auditRoot, 'manifest.json');
const privateDir = path.join(auditRoot, 'private');
const writeSqlDir = path.join(privateDir, 'd1-canonical-projection-write-sql');
const batchDir = path.join(writeSqlDir, 'batches');
const PRIVATE_DIR_SEGMENT = `${path.sep}private${path.sep}`;

const D1_DATABASE = 'grok-powertools-db';
const D1_DATABASE_ID = 'ad89e4bb-0b68-4c72-93d9-b90e6eb45aa6';
const SNAPSHOT_ID = 'snapshot_4100f2c3c2d3837a';
const SCHEMA_ID = 'd1-canonical-projection/v1';
const SOURCE_SNAPSHOT = {
  bucket: 'grok-gallery-001',
  objectKey:
    'grok-powertools/v1/users/_system/canonical-snapshots/r2-vault-canonical-snapshot-v1/2026-06-29T004723Z-4100f2c3c2d3837a212125c39b6d926cefa31c7453af4a5df9d1d49d6b4f2ef1.json',
  payloadSha256: '21c49f43c6692eff5b31ea0cb9ebaa882840e19895bf90c3cd35ada0e75e9fb6',
  stableContentHash: '4100f2c3c2d3837a212125c39b6d926cefa31c7453af4a5df9d1d49d6b4f2ef1',
  sourceBaselineCommit: 'edaaf8134bb545969d6e8036952695a3d8102ca7'
};

const MAX_SQL_STATEMENT_BYTES = 90_000;
const MAX_SQL_FILE_BYTES = 3_000_000;
const MAX_INLINE_IDENTITY_VALUE_BYTES = 50_000;
const MAX_INLINE_JSON_VALUE_BYTES = 50_000;

const tableInputs = [
  {
    table: 'canonical_asset_projection',
    relPath: 'private/d1-canonical-projection-assets.jsonl',
    expectedRowsKey: 'assetRows'
  },
  {
    table: 'canonical_storage_object_projection',
    relPath: 'private/d1-canonical-projection-storage-objects.jsonl',
    expectedRowsKey: 'storageRows'
  },
  {
    table: 'canonical_prompt_ref_projection',
    relPath: 'private/d1-canonical-projection-prompt-refs.jsonl',
    expectedRowsKey: 'promptRows'
  },
  {
    table: 'canonical_gap_projection',
    relPath: 'private/d1-canonical-projection-gaps.jsonl',
    expectedRowsKey: 'gapRows'
  },
  {
    table: 'canonical_asset_lookup',
    relPath: 'private/d1-canonical-projection-lookups.jsonl',
    expectedRowsKey: 'lookupRows'
  }
];

const snapshotInput = {
  table: 'canonical_snapshot_index',
  relPath: 'private/d1-canonical-projection-snapshot-index.json',
  expectedRowsKey: 'snapshotRows'
};

function nowIso() {
  return new Date().toISOString();
}

function auditPath(...parts) {
  const resolved = path.resolve(auditRoot, ...parts);
  if (resolved !== auditRoot && !resolved.startsWith(`${auditRoot}${path.sep}`)) {
    throw new Error(`Refusing to access outside audit root: ${resolved}`);
  }
  return resolved;
}

function isPrivateAuditPath(filePath) {
  return path.resolve(filePath).includes(PRIVATE_DIR_SEGMENT);
}

function hashString(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

async function fileSha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

async function readJson(relPath) {
  return JSON.parse(await fs.readFile(auditPath(relPath), 'utf8'));
}

async function readJsonl(relPath) {
  const text = await fs.readFile(auditPath(relPath), 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${relPath}:${index + 1}: ${error.message}`);
      }
    });
}

async function writeJson(relPath, value) {
  const filePath = auditPath(relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  if (!isPrivateAuditPath(filePath)) await recordEvidence(filePath);
}

async function writeText(relPath, value) {
  const filePath = auditPath(relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value);
  if (!isPrivateAuditPath(filePath)) await recordEvidence(filePath);
}

async function readManifest() {
  return JSON.parse(await fs.readFile(manifestPath, 'utf8'));
}

async function writeManifest(manifest) {
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function updateManifest(mutator) {
  const manifest = await readManifest();
  await mutator(manifest);
  await writeManifest(manifest);
}

async function recordEvidence(filePath) {
  const resolved = path.resolve(filePath);
  if (isPrivateAuditPath(resolved)) return;
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isFile()) return;
  const rel = path.relative(auditRoot, resolved);
  await updateManifest((manifest) => {
    const current = Array.isArray(manifest.evidenceIndex) ? manifest.evidenceIndex : [];
    manifest.evidenceIndex = [
      ...current.filter((entry) => entry.path !== rel),
      {
        path: rel,
        bytes: stat.size,
        updatedAt: nowIso()
      }
    ].sort((left, right) => left.path.localeCompare(right.path));
  });
}

function assertApprovedForExecution() {
  if (process.env.AUDIT_D1_PROJECTION_WRITE_APPROVED !== '1') {
    throw new Error('Refusing D1 writes without AUDIT_D1_PROJECTION_WRITE_APPROVED=1');
  }
}

function isPrepareOnly() {
  return process.argv.includes('--prepare-only');
}

function q(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  return `"${identifier}"`;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NULL';
    return String(value);
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function valuesTuple(row, columns) {
  return `(${columns.map((column) => sqlLiteral(row[column])).join(', ')})`;
}

function insertStatement(table, columns, tuples) {
  return `INSERT INTO ${q(table)} (${columns.map(q).join(', ')}) VALUES\n${tuples.join(',\n')};\n`;
}

function ifNotExistsSql(statement) {
  return statement
    .replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/^CREATE INDEX\s+/i, 'CREATE INDEX IF NOT EXISTS ');
}

function rowsToInsertStatements({ table, columns, rows }) {
  const statements = [];
  let tuples = [];
  let currentBytes = byteLength(`INSERT INTO ${q(table)} (${columns.map(q).join(', ')}) VALUES\n;\n`);
  for (const row of rows) {
    const tuple = valuesTuple(row, columns);
    const tupleBytes = byteLength(tuple) + (tuples.length ? 2 : 0);
    if (tuples.length && currentBytes + tupleBytes > MAX_SQL_STATEMENT_BYTES) {
      statements.push(insertStatement(table, columns, tuples));
      tuples = [];
      currentBytes = byteLength(`INSERT INTO ${q(table)} (${columns.map(q).join(', ')}) VALUES\n;\n`);
    }
    if (byteLength(insertStatement(table, columns, [tuple])) > MAX_SQL_STATEMENT_BYTES) {
      throw new Error(`${table} row exceeds ${MAX_SQL_STATEMENT_BYTES} byte SQL statement limit`);
    }
    tuples.push(tuple);
    currentBytes += tupleBytes;
  }
  if (tuples.length) statements.push(insertStatement(table, columns, tuples));
  return statements;
}

function adaptRowsForD1Sql(table, rows) {
  const adaptations = [];
  const adaptedRows = rows.map((row) => {
    const copy = { ...row };
    if (
      table === 'canonical_asset_projection' &&
      typeof copy.identity_value === 'string' &&
      byteLength(copy.identity_value) > MAX_INLINE_IDENTITY_VALUE_BYTES
    ) {
      adaptations.push({
        table,
        canonicalAssetId: copy.canonical_asset_id,
        identityType: copy.identity_type,
        identityValueHash: copy.identity_value_hash,
        originalByteLength: byteLength(copy.identity_value),
        d1Value: null,
        reason:
          'composite identity_value exceeds D1 raw SQL statement limits; identity hash and individual lookup rows preserve query identity'
      });
      copy.identity_value = null;
    }
    if (
      table === 'canonical_asset_lookup' &&
      typeof copy.lookup_value === 'string' &&
      copy.lookup_type === 'identity' &&
      byteLength(copy.lookup_value) > MAX_INLINE_IDENTITY_VALUE_BYTES
    ) {
      adaptations.push({
        table,
        canonicalAssetId: copy.canonical_asset_id,
        lookupType: copy.lookup_type,
        lookupHash: copy.lookup_hash,
        originalByteLength: byteLength(copy.lookup_value),
        d1Value: null,
        reason:
          'composite identity lookup_value exceeds D1 raw SQL statement limits; lookup hash and individual grok_post_id lookup rows preserve query identity'
      });
      copy.lookup_value = null;
    }
    if (
      table === 'canonical_storage_object_projection' &&
      typeof copy.prompt_ref_ids_json === 'string' &&
      byteLength(copy.prompt_ref_ids_json) > MAX_INLINE_JSON_VALUE_BYTES
    ) {
      let promptRefCount = null;
      try {
        const parsed = JSON.parse(copy.prompt_ref_ids_json);
        promptRefCount = Array.isArray(parsed) ? parsed.length : null;
      } catch {
        promptRefCount = null;
      }
      adaptations.push({
        table,
        canonicalAssetId: copy.canonical_asset_id,
        storageObjectId: copy.storage_object_id,
        objectKeyHash: copy.object_key_hash,
        field: 'prompt_ref_ids_json',
        promptRefCount,
        originalByteLength: byteLength(copy.prompt_ref_ids_json),
        reason:
          'oversized prompt ref list exceeds D1 raw SQL statement limits; canonical_asset_lookup prompt_ref_id rows preserve query links'
      });
      copy.prompt_ref_ids_json = JSON.stringify({
        omittedForD1SqlLimit: true,
        promptRefCount,
        lookupTable: 'canonical_asset_lookup',
        lookupType: 'prompt_ref_id'
      });
    }
    return copy;
  });
  return { rows: adaptedRows, adaptations };
}

async function writeStatementFiles(prefix, statements) {
  const files = [];
  let current = [];
  let currentBytes = 0;
  let fileIndex = 1;
  async function flush() {
    if (!current.length) return;
    const relPath = path.join('private', 'd1-canonical-projection-write-sql', 'batches', `${String(fileIndex).padStart(4, '0')}-${prefix}.sql`);
    const fullPath = auditPath(relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, current.join('\n'));
    const stat = await fs.stat(fullPath);
    files.push({
      relPath,
      bytes: stat.size,
      sha256: await fileSha256(fullPath),
      statementCount: current.length
    });
    fileIndex += 1;
    current = [];
    currentBytes = 0;
  }

  for (const statement of statements) {
    const statementBytes = byteLength(statement);
    if (current.length && currentBytes + statementBytes > MAX_SQL_FILE_BYTES) await flush();
    current.push(statement);
    currentBytes += statementBytes;
  }
  await flush();
  return files;
}

function extractRows(parsed) {
  if (Array.isArray(parsed)) return parsed.flatMap((entry) => extractRows(entry));
  if (Array.isArray(parsed?.results)) return parsed.results;
  if (Array.isArray(parsed?.result?.results)) return parsed.result.results;
  if (Array.isArray(parsed?.result?.[0]?.results)) return parsed.result[0].results;
  if (Array.isArray(parsed?.result)) return parsed.result.flatMap((entry) => entry.results || []);
  return [];
}

function flattenResults(parsed) {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed.flatMap((entry) => flattenResults(entry));
  if (Array.isArray(parsed.result)) return parsed.result.flatMap((entry) => flattenResults(entry));
  if (parsed.result && !Array.isArray(parsed.result)) return flattenResults(parsed.result);
  return [parsed];
}

function sumMeta(parsed, field) {
  return flattenResults(parsed).reduce((sum, entry) => sum + Number(entry?.meta?.[field] || 0), 0);
}

function anyMeta(parsed, field) {
  return flattenResults(parsed).some((entry) => Boolean(entry?.meta?.[field]));
}

async function d1Execute({ name, command, fileRelPath }) {
  const args = [
    'exec',
    'node@24',
    '--',
    'npx',
    '--yes',
    'wrangler@latest',
    'd1',
    'execute',
    D1_DATABASE,
    '--remote',
    '--json',
    '--yes'
  ];
  if (command) args.push('--command', command);
  if (fileRelPath) args.push('--file', auditPath(fileRelPath));
  const startedAt = nowIso();
  let stdout = '';
  let stderr = '';
  try {
    const result = await execFileAsync('mise', args, {
      cwd: cloudRoot,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:${process.env.PATH || ''}`,
        npm_config_cache: process.env.npm_config_cache || '/tmp/codex-wrangler-npx-cache'
      },
      maxBuffer: 100 * 1024 * 1024
    });
    stdout = result.stdout || '';
    stderr = result.stderr || '';
  } catch (error) {
    stdout = error.stdout || '';
    stderr = error.stderr || '';
    const failedLog = {
      name,
      startedAt,
      finishedAt: nowIso(),
      ok: false,
      commandShape: command ? command.replace(/\s+/g, ' ').slice(0, 240) : null,
      fileRelPath: fileRelPath || null,
      stdoutBytes: Buffer.byteLength(stdout),
      stdoutSha256: stdout ? hashString(stdout) : null,
      stderrBytes: Buffer.byteLength(stderr),
      stderrSha256: stderr ? hashString(stderr) : null,
      error: error.message
    };
    await writeJson(path.join('private', 'd1-canonical-projection-write-execution-failure.json'), failedLog);
    throw new Error(`D1 ${name} failed; private failure log written`);
  }

  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    parseError = error;
  }
  const finishedAt = nowIso();
  if (parseError) {
    if (fileRelPath) {
      return {
        name,
        startedAt,
        finishedAt,
        ok: true,
        fileRelPath,
        commandShape: null,
        outputMode: 'wrangler_file_non_json_success',
        stdoutBytes: Buffer.byteLength(stdout),
        stdoutSha256: stdout ? hashString(stdout) : null,
        stderrBytes: Buffer.byteLength(stderr),
        stderrSha256: stderr ? hashString(stderr) : null,
        parsedRowCount: null,
        rowsWritten: null,
        rowsRead: null,
        changedDb: true,
        parsed: null
      };
    }
    await writeJson(path.join('private', 'd1-canonical-projection-write-execution-parse-failure.json'), {
      name,
      startedAt,
      finishedAt,
      ok: false,
      fileRelPath: fileRelPath || null,
      commandShape: command ? command.replace(/\s+/g, ' ').slice(0, 240) : null,
      stdoutBytes: Buffer.byteLength(stdout),
      stdoutSha256: stdout ? hashString(stdout) : null,
      stderrBytes: Buffer.byteLength(stderr),
      stderrSha256: stderr ? hashString(stderr) : null,
      parseError: parseError.message
    });
    throw new Error(`D1 ${name} returned non-JSON output; private parse failure log written`);
  }

  return {
    name,
    startedAt,
    finishedAt,
    ok: true,
    fileRelPath: fileRelPath || null,
    commandShape: command ? command.replace(/\s+/g, ' ').slice(0, 240) : null,
    stdoutBytes: Buffer.byteLength(stdout),
    stdoutSha256: stdout ? hashString(stdout) : null,
    stderrBytes: Buffer.byteLength(stderr),
    stderrSha256: stderr ? hashString(stderr) : null,
    parsedRowCount: extractRows(parsed).length,
    rowsWritten: parsed ? sumMeta(parsed, 'rows_written') : null,
    rowsRead: parsed ? sumMeta(parsed, 'rows_read') : null,
    changedDb: parsed ? anyMeta(parsed, 'changed_db') : null,
    parsed
  };
}

async function currentProjectionTableState(tableNames) {
  const quotedNames = tableNames.map((name) => sqlLiteral(name)).join(', ');
  const result = await d1Execute({
    name: 'projection-table-preflight',
    command: `SELECT name, type FROM sqlite_master WHERE type='table' AND name IN (${quotedNames}) ORDER BY name`
  });
  const existing = extractRows(result.parsed).map((row) => row.name);
  const tableCounts = {};
  for (const tableName of existing) {
    const countResult = await d1Execute({
      name: `projection-count-${tableName}`,
      command: `SELECT COUNT(*) AS count FROM ${q(tableName)} WHERE snapshot_id = ${sqlLiteral(SNAPSHOT_ID)}`
    });
    tableCounts[tableName] = Number(extractRows(countResult.parsed)[0]?.count || 0);
  }
  return { existing, tableCounts, preflightLog: result };
}

async function prepareSqlFiles({ schema, summary }) {
  await fs.rm(writeSqlDir, { recursive: true, force: true });
  await fs.mkdir(batchDir, { recursive: true });

  const tableByName = new Map(schema.tables.map((table) => [table.name, table]));
  const createTableSql = schema.sql.map(ifNotExistsSql).join('\n\n');
  const schemaRelPath = path.join('private', 'd1-canonical-projection-write-sql', 'schema.sql');
  await fs.writeFile(auditPath(schemaRelPath), `${createTableSql}\n`);
  const schemaStat = await fs.stat(auditPath(schemaRelPath));
  const schemaFile = {
    relPath: schemaRelPath,
    bytes: schemaStat.size,
    sha256: await fileSha256(auditPath(schemaRelPath)),
    statementCount: schema.sql.length
  };

  const rowFiles = [];
  const writeAdaptations = [];
  for (const input of tableInputs) {
    const rows = await readJsonl(input.relPath);
    const expectedRows = summary.rowCounts[input.expectedRowsKey];
    if (rows.length !== expectedRows) {
      throw new Error(`${input.relPath} row count ${rows.length} does not match expected ${expectedRows}`);
    }
    const columns = tableByName.get(input.table)?.columns.map((column) => column[0]);
    if (!columns?.length) throw new Error(`No schema columns for ${input.table}`);
    const adapted = adaptRowsForD1Sql(input.table, rows);
    writeAdaptations.push(...adapted.adaptations);
    const statements = rowsToInsertStatements({ table: input.table, columns, rows: adapted.rows });
    rowFiles.push({
      table: input.table,
      expectedRows,
      sourceRelPath: input.relPath,
      files: await writeStatementFiles(input.table, statements),
      statementCount: statements.length
    });
  }

  const indexSql = schema.indexes.map(ifNotExistsSql).join('\n');
  const indexRelPath = path.join('private', 'd1-canonical-projection-write-sql', 'indexes.sql');
  await fs.writeFile(auditPath(indexRelPath), `${indexSql}\n`);
  const indexStat = await fs.stat(auditPath(indexRelPath));
  const indexFile = {
    relPath: indexRelPath,
    bytes: indexStat.size,
    sha256: await fileSha256(auditPath(indexRelPath)),
    statementCount: schema.indexes.length
  };

  const snapshotRow = await readJson(snapshotInput.relPath);
  const snapshotColumns = tableByName.get(snapshotInput.table)?.columns.map((column) => column[0]);
  if (!snapshotColumns?.length) throw new Error('No schema columns for canonical_snapshot_index');
  const snapshotStatements = rowsToInsertStatements({ table: snapshotInput.table, columns: snapshotColumns, rows: [snapshotRow] });
  const snapshotFiles = await writeStatementFiles(snapshotInput.table, snapshotStatements);

  return {
    generatedAt: nowIso(),
    sqlStatementByteLimit: MAX_SQL_STATEMENT_BYTES,
    sqlFileByteLimit: MAX_SQL_FILE_BYTES,
    maxInlineIdentityValueBytes: MAX_INLINE_IDENTITY_VALUE_BYTES,
    schemaFile,
    rowFiles,
    indexFile,
    snapshotFiles,
    writeAdaptations,
    expectedRows: summary.rowCounts
  };
}

async function readback() {
  const countQueries = [
    ['snapshotRows', 'canonical_snapshot_index'],
    ['assetRows', 'canonical_asset_projection'],
    ['storageRows', 'canonical_storage_object_projection'],
    ['promptRows', 'canonical_prompt_ref_projection'],
    ['gapRows', 'canonical_gap_projection'],
    ['lookupRows', 'canonical_asset_lookup']
  ];
  const counts = {};
  for (const [key, table] of countQueries) {
    const result = await d1Execute({
      name: `readback-${table}-count`,
      command: `SELECT COUNT(*) AS count FROM ${q(table)} WHERE snapshot_id = ${sqlLiteral(SNAPSHOT_ID)}`
    });
    counts[key] = Number(extractRows(result.parsed)[0]?.count || 0);
  }

  const snapshotResult = await d1Execute({
    name: 'readback-snapshot-index',
    command: `SELECT snapshot_id, schema_version, r2_bucket, r2_object_key, payload_sha256, stable_content_hash, source_baseline_commit, logical_asset_count, storage_object_count, prompt_ref_count, gap_record_count FROM canonical_snapshot_index WHERE snapshot_id = ${sqlLiteral(SNAPSHOT_ID)}`
  });
  const statusResult = await d1Execute({
    name: 'readback-storage-status',
    command: `SELECT status, COUNT(*) AS count FROM canonical_storage_object_projection WHERE snapshot_id = ${sqlLiteral(SNAPSHOT_ID)} GROUP BY status ORDER BY status`
  });
  const gapTypeResult = await d1Execute({
    name: 'readback-gap-types',
    command: `SELECT type, COUNT(*) AS count FROM canonical_gap_projection WHERE snapshot_id = ${sqlLiteral(SNAPSHOT_ID)} GROUP BY type ORDER BY type`
  });
  const reviewResult = await d1Execute({
    name: 'readback-review-counts',
    command: `SELECT SUM(review_required) AS reviewRequiredAssets FROM canonical_asset_projection WHERE snapshot_id = ${sqlLiteral(SNAPSHOT_ID)}`
  });

  return {
    counts,
    snapshotRows: extractRows(snapshotResult.parsed),
    storageStatusCounts: Object.fromEntries(extractRows(statusResult.parsed).map((row) => [row.status, Number(row.count || 0)])),
    gapTypeCounts: Object.fromEntries(extractRows(gapTypeResult.parsed).map((row) => [row.type, Number(row.count || 0)])),
    reviewRequiredAssets: Number(extractRows(reviewResult.parsed)[0]?.reviewRequiredAssets || 0)
  };
}

function countsEqual(left, right) {
  const normalize = (value) => Object.entries(value || {}).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function validateReadback({ readbackResult, summary, validation }) {
  const errors = [];
  for (const [key, expected] of Object.entries(summary.rowCounts)) {
    if (['unlinkedStorageRows', 'promptRowsWithBodyFields', 'duplicateLookupKeys'].includes(key)) continue;
    if (readbackResult.counts[key] !== expected) {
      errors.push(`${key} readback ${readbackResult.counts[key]} does not match expected ${expected}`);
    }
  }
  const snapshot = readbackResult.snapshotRows[0];
  if (!snapshot) errors.push('missing canonical_snapshot_index row');
  if (snapshot?.schema_version !== SCHEMA_ID) errors.push('snapshot schema_version mismatch');
  if (snapshot?.r2_bucket !== SOURCE_SNAPSHOT.bucket) errors.push('snapshot r2_bucket mismatch');
  if (snapshot?.r2_object_key !== SOURCE_SNAPSHOT.objectKey) errors.push('snapshot r2_object_key mismatch');
  if (snapshot?.payload_sha256 !== SOURCE_SNAPSHOT.payloadSha256) errors.push('snapshot payload_sha256 mismatch');
  if (snapshot?.stable_content_hash !== SOURCE_SNAPSHOT.stableContentHash) errors.push('snapshot stable_content_hash mismatch');
  if (snapshot?.source_baseline_commit !== SOURCE_SNAPSHOT.sourceBaselineCommit) errors.push('snapshot source_baseline_commit mismatch');
  if (!countsEqual(readbackResult.storageStatusCounts, validation.storageStatusCounts)) {
    errors.push('storage status counts do not match dry-run validation');
  }
  if (!countsEqual(readbackResult.gapTypeCounts, validation.projectionGapTypeCounts)) {
    errors.push('gap type counts do not match dry-run validation');
  }
  if (readbackResult.reviewRequiredAssets !== summary.reviewQueue.reviewRequiredAssets) {
    errors.push('reviewRequiredAssets readback does not match dry-run summary');
  }
  return {
    ok: errors.length === 0,
    errors,
    checkedAt: nowIso()
  };
}

function safeExecutionSummary(execution) {
  return execution.map((entry) => ({
    name: entry.name,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    ok: entry.ok,
    fileRelPath: entry.fileRelPath,
    commandShape: entry.commandShape,
    stdoutBytes: entry.stdoutBytes,
    stdoutSha256: entry.stdoutSha256,
    stderrBytes: entry.stderrBytes,
    stderrSha256: entry.stderrSha256,
    parsedRowCount: entry.parsedRowCount,
    rowsWritten: entry.rowsWritten,
    rowsRead: entry.rowsRead,
    changedDb: entry.changedDb
  }));
}

function renderReport(log) {
  return `# D1 Canonical Projection Write

Generated: ${log.generatedAt}

This report is committed-safe. It records the approved production D1 projection write and readback verification without raw prompt bodies, cookies, bearer tokens, signed URLs, raw SQL values, or private row payloads.

## Status

- Result: ${log.status}
- D1 database: \`${log.target.database}\`
- D1 database id: \`${log.target.databaseId}\`
- Projection schema: \`${log.projection.schemaVersion}\`
- Source payload SHA-256: \`${log.sourceSnapshot.payloadSha256}\`
- Source stable content hash: \`${log.sourceSnapshot.stableContentHash}\`
- Readback valid: ${log.verification.ok ? 'yes' : 'no'}

## Writes

- D1 projection writes: ${log.productionWrites.d1ProjectionWrites}
- Worker state writes: ${log.productionWrites.workerStateWrites}
- Product route/read changes: ${log.productionWrites.productRouteOrReadChanges}
- Grok actions: ${log.productionWrites.grokActions}
- R2 writes: ${log.productionWrites.r2Writes}
- R2 object moves: ${log.productionWrites.r2ObjectMoves}
- R2 object deletes: ${log.productionWrites.r2ObjectDeletes}
- Repair route calls: ${log.productionWrites.repairRouteCalls}
- Sync route calls: ${log.productionWrites.syncRouteCalls}
- Physical cleanup actions: ${log.productionWrites.physicalCleanupActions}

## Readback Counts

- Snapshot rows: ${log.readback.counts.snapshotRows}
- Asset rows: ${log.readback.counts.assetRows}
- Storage rows: ${log.readback.counts.storageRows}
- Prompt rows: ${log.readback.counts.promptRows}
- Gap rows: ${log.readback.counts.gapRows}
- Lookup rows: ${log.readback.counts.lookupRows}

## Review Queue

- Review-required assets: ${log.readback.reviewRequiredAssets}
- Needs-human-review storage rows: ${log.readback.storageStatusCounts.needs_human_review}
- Orphan-candidate storage rows: ${log.readback.storageStatusCounts.orphan_candidate}
- Grok conversation response gaps: ${log.readback.gapTypeCounts.grok_conversation_response_gap}
- Grok media-post response gaps: ${log.readback.gapTypeCounts.grok_media_post_response_gap}

## Rollback And Recovery

The approved R2 canonical snapshot remains the recovery source. No product route or Worker read path has been switched to this projection in this phase.

## D1 Write Adaptations

${log.sqlPlan.writeAdaptations.length ? log.sqlPlan.writeAdaptations.map((adaptation) => `- ${adaptation.table}: ${adaptation.reason}`).join('\n') : '- None.'}

## Next Phase

The next phase is product/Worker read-path design and validation against this D1 projection, after separate approval. R2 moves/deletes, repair/sync routes, Grok actions, and physical cleanup remain outside this phase.

## Validation

${log.verification.errors.length ? log.verification.errors.map((error) => `- ERROR: ${error}`).join('\n') : '- No validation errors.'}
`;
}

async function main() {
  const prepareOnly = isPrepareOnly();
  if (!prepareOnly) assertApprovedForExecution();
  const generatedAt = nowIso();
  const schema = await readJson('reconciliations/d1-canonical-projection-schema.json');
  const summary = await readJson('reconciliations/d1-canonical-projection-dry-run-summary.json');
  const dryRunValidation = await readJson('logs/d1-canonical-projection-dry-run-validation.json');
  if (schema.schemaId !== SCHEMA_ID) throw new Error(`Unexpected projection schema id: ${schema.schemaId}`);
  if (summary.validation?.ok !== true || dryRunValidation.ok !== true) throw new Error('Dry-run validation is not ok');
  if (summary.sourceSnapshot?.payloadSha256 !== SOURCE_SNAPSHOT.payloadSha256) throw new Error('Source payload SHA mismatch');
  if (summary.sourceSnapshot?.stableContentHash !== SOURCE_SNAPSHOT.stableContentHash) {
    throw new Error('Source stable content hash mismatch');
  }

  const sqlPlan = await prepareSqlFiles({ schema, summary });
  await writeJson('logs/d1-canonical-projection-write-plan.json', {
    generatedAt,
    status: prepareOnly ? 'local_prepare_only' : 'planned_for_approved_execution',
    target: { database: D1_DATABASE, databaseId: D1_DATABASE_ID },
    sourceSnapshot: SOURCE_SNAPSHOT,
    projection: { schemaVersion: SCHEMA_ID, snapshotId: SNAPSHOT_ID },
    sqlPlan: {
      statementByteLimit: sqlPlan.sqlStatementByteLimit,
      fileByteLimit: sqlPlan.sqlFileByteLimit,
      maxInlineIdentityValueBytes: sqlPlan.maxInlineIdentityValueBytes,
      maxInlineJsonValueBytes: MAX_INLINE_JSON_VALUE_BYTES,
      writeAdaptations: sqlPlan.writeAdaptations,
      schemaFile: sqlPlan.schemaFile,
      rowFileGroups: sqlPlan.rowFiles.map((group) => ({
        table: group.table,
        expectedRows: group.expectedRows,
        sourceRelPath: group.sourceRelPath,
        fileCount: group.files.length,
        statementCount: group.statementCount,
        bytes: group.files.reduce((sum, file) => sum + file.bytes, 0)
      })),
      indexFile: sqlPlan.indexFile,
      snapshotFiles: sqlPlan.snapshotFiles
    },
    productionWritesApproved: true,
    note: 'Exact SQL files are ignored under private/. Snapshot commit row is inserted last.'
  });

  if (prepareOnly) {
    console.log('d1 canonical projection write plan prepared locally');
    console.log(`sql batches: ${sqlPlan.rowFiles.reduce((sum, group) => sum + group.files.length, 0)} row files`);
    return;
  }

  const tableNames = [snapshotInput.table, ...tableInputs.map((input) => input.table)];
  const preflight = await currentProjectionTableState(tableNames);
  const occupiedTables = Object.entries(preflight.tableCounts).filter(([, count]) => Number(count) > 0);
  if (occupiedTables.length) {
    throw new Error(`Refusing to write over existing ${SNAPSHOT_ID} rows: ${JSON.stringify(occupiedTables)}`);
  }

  const execution = [];
  execution.push(await d1Execute({ name: 'write-schema', fileRelPath: sqlPlan.schemaFile.relPath }));
  for (const group of sqlPlan.rowFiles) {
    for (const file of group.files) {
      execution.push(await d1Execute({ name: `write-${group.table}`, fileRelPath: file.relPath }));
    }
  }
  execution.push(await d1Execute({ name: 'write-indexes', fileRelPath: sqlPlan.indexFile.relPath }));
  for (const file of sqlPlan.snapshotFiles) {
    execution.push(await d1Execute({ name: 'write-snapshot-index', fileRelPath: file.relPath }));
  }

  const readbackResult = await readback();
  const verification = validateReadback({ readbackResult, summary, validation: dryRunValidation });
  const log = {
    generatedAt,
    status: verification.ok ? 'write_readback_verified' : 'write_readback_failed',
    target: {
      database: D1_DATABASE,
      databaseId: D1_DATABASE_ID
    },
    sourceSnapshot: SOURCE_SNAPSHOT,
    projection: {
      schemaVersion: SCHEMA_ID,
      snapshotId: SNAPSHOT_ID,
      commitRowInsertedLast: true
    },
    approval: {
      approvedInChat: true,
      approvedScope:
        'write validated D1 canonical projection rows only; stop before Worker writes, product route/read changes, Grok actions, R2 moves/deletes, repair/sync routes, and physical cleanup'
    },
    sqlPlan: {
      schemaFile: sqlPlan.schemaFile,
      writeAdaptations: sqlPlan.writeAdaptations,
      rowFileGroups: sqlPlan.rowFiles.map((group) => ({
        table: group.table,
        expectedRows: group.expectedRows,
        fileCount: group.files.length,
        statementCount: group.statementCount,
        bytes: group.files.reduce((sum, file) => sum + file.bytes, 0)
      })),
      indexFile: sqlPlan.indexFile,
      snapshotFiles: sqlPlan.snapshotFiles
    },
    preflight: {
      existingProjectionTables: preflight.existing,
      existingSnapshotRowsBeforeWrite: preflight.tableCounts
    },
    execution: safeExecutionSummary(execution),
    readback: readbackResult,
    verification,
    productionWrites: {
      d1ProjectionWrites: Object.values(readbackResult.counts).reduce((sum, count) => sum + Number(count || 0), 0),
      workerStateWrites: 0,
      productRouteOrReadChanges: 0,
      grokActions: 0,
      r2Writes: 0,
      r2ObjectMoves: 0,
      r2ObjectDeletes: 0,
      repairRouteCalls: 0,
      syncRouteCalls: 0,
      physicalCleanupActions: 0
    },
    rollback: {
      sourceOfRecovery: 'approved R2 canonical snapshot',
      r2SnapshotObjectKey: SOURCE_SNAPSHOT.objectKey,
      note: 'No product read path has been switched, so rollback for user-facing behavior is to keep product reads on the existing path.'
    },
    nextAllowedPhase: 'product_read_path_design_after_separate_approval'
  };

  await writeJson('logs/d1-canonical-projection-write-readback.json', log);
  await writeText('report-d1-canonical-projection-write.md', renderReport(log));
  await updateManifest((manifest) => {
    manifest.subsystems ||= {};
    manifest.subsystems.d1CanonicalProjectionWrite = verification.ok ? 'verified' : 'failed';
    manifest.currentD1CanonicalProjectionWrite = {
      generatedAt,
      status: log.status,
      target: log.target,
      sourceSnapshot: log.sourceSnapshot,
      projection: log.projection,
      rowCounts: log.readback.counts,
      reviewQueue: {
        reviewRequiredAssets: log.readback.reviewRequiredAssets,
        needsHumanReviewStorageRows: log.readback.storageStatusCounts.needs_human_review,
        orphanCandidateStorageRows: log.readback.storageStatusCounts.orphan_candidate
      },
      verification,
      productionWrites: log.productionWrites,
      committedEvidence: {
        plan: 'logs/d1-canonical-projection-write-plan.json',
        readback: 'logs/d1-canonical-projection-write-readback.json',
        report: 'report-d1-canonical-projection-write.md'
      },
      nextAllowedPhase: log.nextAllowedPhase,
      requiresExplicitUserApproval: true
    };
    manifest.nextRecommendedPhase = {
      name: 'product_read_path_design',
      scope: [
        'design Worker/product reads against the verified D1 projection',
        'keep the existing product read path active until a separate approved switch',
        'validate read counts, filtering, and review visibility against D1 before user-facing changes'
      ],
      stopBefore: [
        'Grok actions',
        'R2 object moves',
        'R2 object deletes',
        'repair or sync routes',
        'physical duplicate cleanup'
      ],
      pauseForUser: [
        'product read behavior would hide review/orphan/gap rows',
        'D1 readback no longer matches the write report',
        'Worker route changes require a deploy',
        'any cleanup, repair, move, delete, or Grok action is proposed'
      ]
    };
  });

  if (!verification.ok) {
    process.exitCode = 1;
    console.error('d1 canonical projection write readback failed');
    return;
  }
  console.log('d1 canonical projection write/readback verified');
  console.log(`readback log: ${path.relative(process.cwd(), auditPath('logs/d1-canonical-projection-write-readback.json'))}`);
}

main().catch(async (error) => {
  await writeJson(path.join('private', 'd1-canonical-projection-write-error.json'), {
    generatedAt: nowIso(),
    error: error.stack || error.message
  }).catch(() => undefined);
  console.error(error.message);
  process.exitCode = 1;
});
