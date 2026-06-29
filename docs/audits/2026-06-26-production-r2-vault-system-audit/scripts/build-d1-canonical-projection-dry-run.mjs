#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const auditRoot = path.resolve(scriptsDir, '..');
const privateDir = path.join(auditRoot, 'private');
const manifestPath = path.join(auditRoot, 'manifest.json');
const PRIVATE_DIR_SEGMENT = `${path.sep}private${path.sep}`;

const APPROVED = {
  bucket: 'grok-gallery-001',
  objectKey:
    'grok-powertools/v1/users/_system/canonical-snapshots/r2-vault-canonical-snapshot-v1/2026-06-29T004723Z-4100f2c3c2d3837a212125c39b6d926cefa31c7453af4a5df9d1d49d6b4f2ef1.json',
  payloadSha256: '21c49f43c6692eff5b31ea0cb9ebaa882840e19895bf90c3cd35ada0e75e9fb6',
  stableContentHash: '4100f2c3c2d3837a212125c39b6d926cefa31c7453af4a5df9d1d49d6b4f2ef1',
  sourceBaselineCommit: 'edaaf8134bb545969d6e8036952695a3d8102ca7',
  schemaVersion: 'r2-vault-canonical-snapshot/v1',
  snapshotKind: 'local_dry_run'
};

const PROJECTION_SCHEMA_ID = 'd1-canonical-projection/v1';
const SNAPSHOT_ID = `snapshot_${APPROVED.stableContentHash.slice(0, 16)}`;
const PRIVATE_SNAPSHOT_REL = 'private/canonical-snapshot-dry-run.json';

const outputRels = {
  snapshotIndex: 'private/d1-canonical-projection-snapshot-index.json',
  assets: 'private/d1-canonical-projection-assets.jsonl',
  storageObjects: 'private/d1-canonical-projection-storage-objects.jsonl',
  promptRefs: 'private/d1-canonical-projection-prompt-refs.jsonl',
  gaps: 'private/d1-canonical-projection-gaps.jsonl',
  lookups: 'private/d1-canonical-projection-lookups.jsonl',
  schema: 'reconciliations/d1-canonical-projection-schema.json',
  summary: 'reconciliations/d1-canonical-projection-dry-run-summary.json',
  validation: 'logs/d1-canonical-projection-dry-run-validation.json',
  report: 'report-d1-canonical-projection-dry-run.md'
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

function stableSortObject(value) {
  if (Array.isArray(value)) return value.map(stableSortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableSortObject(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableSortObject(value));
}

function stableHash(value) {
  return hashString(stableStringify(value));
}

function normalizeForStableHash(snapshot) {
  return {
    ...snapshot,
    generatedAt: '<generatedAt>',
    sourceArtifacts: snapshot.sourceArtifacts.map((artifact) => ({
      ...artifact,
      bytes: artifact.bytes,
      sha256: artifact.sha256
    }))
  };
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function sumObjectValues(value) {
  return Object.values(value || {}).reduce((sum, item) => sum + Number(item || 0), 0);
}

function countsEqual(left, right) {
  const leftEntries = Object.entries(left || {}).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const rightEntries = Object.entries(right || {}).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== '').map(String))].sort();
}

function jsonText(value) {
  return JSON.stringify(value ?? null);
}

function boolInt(value) {
  return value ? 1 : 0;
}

function firstString(values) {
  return uniqueSorted(values)[0] || null;
}

function inferMediaTypeFromKey(objectKey) {
  const lower = String(objectKey || '').toLowerCase().split(/[?#]/)[0];
  if (/\.(avif|gif|heic|jpeg|jpg|png|webp)$/.test(lower)) return 'image';
  if (/\.(m4v|mov|mp4|webm)$/.test(lower)) return 'video';
  return 'unknown';
}

function inferPrimaryStatus(asset) {
  const counts = asset.statusCounts || {};
  if (asset.reviewRequired) {
    if (counts.orphan_candidate) return 'orphan_candidate';
    if (counts.needs_human_review) return 'needs_human_review';
  }
  if (counts.canonical) return 'canonical';
  if (counts.date_folder_mapped) return 'date_folder_mapped';
  if (counts.alternate_duplicate) return 'alternate_duplicate';
  if (counts.needs_human_review) return 'needs_human_review';
  if (counts.orphan_candidate) return 'orphan_candidate';
  return 'unknown';
}

function verificationStatusForPrimaryStatus(primaryStatus) {
  if (primaryStatus === 'canonical' || primaryStatus === 'date_folder_mapped') return 'verified';
  if (primaryStatus === 'needs_human_review' || primaryStatus === 'orphan_candidate') return 'blocked';
  return 'unproven';
}

function severityForGap(gap) {
  if (gap.type === 'needs_human_review' || gap.type === 'orphan_candidate') return 'blocking';
  if (gap.type === 'grok_conversation_response_gap' || gap.type === 'grok_media_post_response_gap') return 'warning';
  return 'info';
}

async function readJson(relPath) {
  return JSON.parse(await fs.readFile(auditPath(relPath), 'utf8'));
}

async function readOptionalJson(relPath) {
  try {
    return await readJson(relPath);
  } catch {
    return null;
  }
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

async function fileSha256(relPath) {
  const buffer = await fs.readFile(auditPath(relPath));
  return createHash('sha256').update(buffer).digest('hex');
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

async function writeJsonl(relPath, rows) {
  const filePath = auditPath(relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const stream = createWriteStream(filePath, { encoding: 'utf8' });
  for (const row of rows) stream.write(`${JSON.stringify(row)}\n`);
  await new Promise((resolve, reject) => {
    stream.end(resolve);
    stream.on('error', reject);
  });
  if (!isPrivateAuditPath(filePath)) await recordEvidence(filePath);
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

async function artifactDescriptor(relPath, rowCount = null) {
  const filePath = auditPath(relPath);
  const stat = await fs.stat(filePath);
  return {
    path: relPath,
    private: isPrivateAuditPath(filePath),
    bytes: stat.size,
    sha256: await fileSha256(relPath),
    ...(rowCount === null ? {} : { rowCount })
  };
}

function projectionSchema() {
  return {
    schemaId: PROJECTION_SCHEMA_ID,
    schemaKind: 'local_only_d1_query_projection_contract',
    sourceSnapshot: {
      bucket: APPROVED.bucket,
      objectKey: APPROVED.objectKey,
      payloadSha256: APPROVED.payloadSha256,
      stableContentHash: APPROVED.stableContentHash,
      schemaVersion: APPROVED.schemaVersion
    },
    productionWritePolicy: 'dry_run_only_until_explicit_d1_write_approval',
    rawDataPolicy: {
      durableRawPlane: 'approved append-only R2 canonical snapshot',
      d1Role: 'query projection for product reads and review queues',
      promptBodies: 'not stored in D1 projection rows; use prompt hashes and R2 snapshot pointers',
      privateIdentifiers: 'allowed in ignored private dry-run rows and future private D1, not in committed summaries'
    },
    tables: [
      {
        name: 'canonical_snapshot_index',
        purpose: 'Registers the approved R2 snapshot that projection rows were derived from.',
        primaryKey: ['snapshot_id'],
        columns: [
          ['snapshot_id', 'TEXT', 'public stable id derived from stable content hash'],
          ['schema_version', 'TEXT', 'projection schema id'],
          ['r2_bucket', 'TEXT', 'approved source bucket'],
          ['r2_object_key', 'TEXT', 'approved source object key'],
          ['payload_sha256', 'TEXT', 'approved payload byte hash'],
          ['stable_content_hash', 'TEXT', 'approved stable content hash'],
          ['source_baseline_commit', 'TEXT', 'source baseline evidence commit'],
          ['generated_at', 'TEXT', 'snapshot generated timestamp'],
          ['projected_at', 'TEXT', 'local projection generated timestamp'],
          ['logical_asset_count', 'INTEGER', 'source logical asset count'],
          ['storage_object_count', 'INTEGER', 'source storage object count'],
          ['prompt_ref_count', 'INTEGER', 'source prompt record count'],
          ['gap_record_count', 'INTEGER', 'source gap record count'],
          ['classification_counts_json', 'TEXT', 'JSON status counts'],
          ['gap_counts_json', 'TEXT', 'JSON gap counts']
        ]
      },
      {
        name: 'canonical_asset_projection',
        purpose: 'One row per logical canonical asset for product inventory and review filtering.',
        primaryKey: ['snapshot_id', 'canonical_asset_id'],
        indexes: [
          ['snapshot_id', 'primary_status'],
          ['snapshot_id', 'review_required'],
          ['snapshot_id', 'identity_type', 'identity_value_hash'],
          ['snapshot_id', 'canonical_object_key_hash']
        ],
        columns: [
          ['snapshot_id', 'TEXT', 'source projection snapshot id'],
          ['canonical_asset_id', 'TEXT', 'stable logical asset id'],
          ['identity_type', 'TEXT', 'grokPostId, grokPostSet, retainedStorageObjectKey, or storageObjectKey'],
          ['identity_value', 'TEXT', 'private exact identity value for future D1 only'],
          ['identity_value_hash', 'TEXT', 'committed-safe identity hash'],
          ['canonical_object_key', 'TEXT', 'private exact R2 object key for serving media'],
          ['canonical_object_key_hash', 'TEXT', 'committed-safe object key hash'],
          ['media_type', 'TEXT', 'image, video, or unknown'],
          ['content_sha256', 'TEXT', 'canonical media content hash when known'],
          ['size_bytes', 'INTEGER', 'canonical media size when known'],
          ['primary_status', 'TEXT', 'query status derived without hiding review rows'],
          ['verification_status', 'TEXT', 'verified, blocked, failed, or unproven'],
          ['review_required', 'INTEGER', '1 when human review is required'],
          ['gap_flags_json', 'TEXT', 'JSON gap flags'],
          ['status_counts_json', 'TEXT', 'JSON status counts'],
          ['reason_counts_json', 'TEXT', 'JSON reason counts'],
          ['storage_object_count', 'INTEGER', 'linked storage row count'],
          ['duplicate_group_count', 'INTEGER', 'linked duplicate group count'],
          ['prompt_ref_count', 'INTEGER', 'linked prompt ref count'],
          ['grok_post_id_count', 'INTEGER', 'linked Grok post id count'],
          ['media_uuid_count', 'INTEGER', 'linked media UUID count'],
          ['model_names_json', 'TEXT', 'selected display metadata from prompt/media-post evidence'],
          ['resolution_names_json', 'TEXT', 'selected display metadata from prompt/media-post evidence'],
          ['created_at', 'TEXT', 'source first-seen approximation'],
          ['updated_at', 'TEXT', 'projection timestamp']
        ]
      },
      {
        name: 'canonical_storage_object_projection',
        purpose: 'One row per R2 media object preserving duplicate, review, and object evidence.',
        primaryKey: ['snapshot_id', 'storage_object_id'],
        indexes: [
          ['snapshot_id', 'canonical_asset_id'],
          ['snapshot_id', 'status'],
          ['snapshot_id', 'object_key_hash'],
          ['snapshot_id', 'content_sha256']
        ],
        columns: [
          ['snapshot_id', 'TEXT', 'source projection snapshot id'],
          ['storage_object_id', 'TEXT', 'stable storage row id'],
          ['canonical_asset_id', 'TEXT', 'linked logical asset id when known'],
          ['object_key', 'TEXT', 'private exact R2 object key'],
          ['object_key_hash', 'TEXT', 'committed-safe R2 object key hash'],
          ['user_id_hash', 'TEXT', 'hashed user id segment'],
          ['status', 'TEXT', 'canonical, date_folder_mapped, alternate_duplicate, needs_human_review, or orphan_candidate'],
          ['reason', 'TEXT', 'classification reason'],
          ['retained_canonical_key', 'TEXT', 'private exact retained key when applicable'],
          ['retained_canonical_key_hash', 'TEXT', 'retained key hash'],
          ['duplicate_group_id', 'TEXT', 'duplicate group id when applicable'],
          ['media_type', 'TEXT', 'image, video, or unknown'],
          ['size_bytes', 'INTEGER', 'R2 object size'],
          ['content_sha256', 'TEXT', 'media byte hash'],
          ['path_class', 'TEXT', 'R2 path class'],
          ['d1_covered', 'INTEGER', 'current D1 evidence coverage'],
          ['worker_covered', 'INTEGER', 'current Worker evidence coverage'],
          ['grok_api_covered', 'INTEGER', 'current Grok API evidence coverage'],
          ['verification_status', 'TEXT', 'current evidence status if known'],
          ['upload_status', 'TEXT', 'current upload status if known'],
          ['identity_links_json', 'TEXT', 'JSON identity links to retained candidate'],
          ['prompt_ref_ids_json', 'TEXT', 'JSON linked prompt refs'],
          ['source_url_hashes_json', 'TEXT', 'JSON source URL hashes'],
          ['created_at', 'TEXT', 'source first-seen approximation'],
          ['updated_at', 'TEXT', 'projection timestamp']
        ]
      },
      {
        name: 'canonical_prompt_ref_projection',
        purpose: 'Prompt lookup metadata without prompt bodies.',
        primaryKey: ['snapshot_id', 'prompt_ref_id'],
        indexes: [
          ['snapshot_id', 'source'],
          ['snapshot_id', 'prompt_sha256'],
          ['snapshot_id', 'source_conversation_id_hash'],
          ['snapshot_id', 'grok_post_id_hash']
        ],
        columns: [
          ['snapshot_id', 'TEXT', 'source projection snapshot id'],
          ['prompt_ref_id', 'TEXT', 'stable prompt reference id'],
          ['source', 'TEXT', 'grok_conversation_response or grok_media_post'],
          ['captured_at', 'TEXT', 'capture timestamp'],
          ['prompt_sha256', 'TEXT', 'prompt body hash'],
          ['original_prompt_sha256', 'TEXT', 'original prompt body hash'],
          ['source_conversation_id', 'TEXT', 'private exact conversation id when applicable'],
          ['source_conversation_id_hash', 'TEXT', 'committed-safe conversation hash'],
          ['response_id', 'TEXT', 'private exact response id when applicable'],
          ['response_id_hash', 'TEXT', 'committed-safe response hash'],
          ['grok_post_id', 'TEXT', 'private exact post id when applicable'],
          ['grok_post_id_hash', 'TEXT', 'committed-safe post id hash'],
          ['linked_asset_count', 'INTEGER', 'logical assets linked to this prompt ref'],
          ['metadata_summary_json', 'TEXT', 'selected stable metadata only'],
          ['media_evidence_counts_json', 'TEXT', 'counts of media evidence arrays'],
          ['created_at', 'TEXT', 'capture timestamp or projection timestamp'],
          ['updated_at', 'TEXT', 'projection timestamp']
        ]
      },
      {
        name: 'canonical_gap_projection',
        purpose: 'Review and response-gap queue rows that must remain visible.',
        primaryKey: ['snapshot_id', 'gap_id'],
        indexes: [
          ['snapshot_id', 'type'],
          ['snapshot_id', 'severity'],
          ['snapshot_id', 'canonical_asset_id'],
          ['snapshot_id', 'requires_human_review']
        ],
        columns: [
          ['snapshot_id', 'TEXT', 'source projection snapshot id'],
          ['gap_id', 'TEXT', 'stable gap id derived from the gap record'],
          ['type', 'TEXT', 'gap type'],
          ['severity', 'TEXT', 'info, warning, or blocking'],
          ['status', 'TEXT', 'HTTP status or review status'],
          ['canonical_asset_id', 'TEXT', 'linked logical asset id when known'],
          ['storage_object_id', 'TEXT', 'linked storage object id when known'],
          ['object_key_hash', 'TEXT', 'object hash when present'],
          ['source_conversation_id_hash', 'TEXT', 'conversation hash when present'],
          ['asset_id_hash', 'TEXT', 'Grok asset hash when present'],
          ['reason', 'TEXT', 'classification or response reason'],
          ['requires_human_review', 'INTEGER', '1 for review/orphan rows'],
          ['requires_live_grok', 'INTEGER', '1 for unresolved Grok response gaps'],
          ['requires_cloud_write', 'INTEGER', '1 if later cloud write is needed to resolve'],
          ['evidence_json', 'TEXT', 'committed-safe evidence hashes and counts'],
          ['created_at', 'TEXT', 'capture timestamp or projection timestamp'],
          ['updated_at', 'TEXT', 'projection timestamp']
        ]
      },
      {
        name: 'canonical_asset_lookup',
        purpose: 'Lookup table for exact private identity values and committed-safe hashes.',
        primaryKey: ['snapshot_id', 'lookup_type', 'lookup_hash', 'canonical_asset_id'],
        indexes: [
          ['snapshot_id', 'lookup_type', 'lookup_hash'],
          ['snapshot_id', 'canonical_asset_id']
        ],
        columns: [
          ['snapshot_id', 'TEXT', 'source projection snapshot id'],
          ['canonical_asset_id', 'TEXT', 'stable logical asset id'],
          ['lookup_type', 'TEXT', 'identity, grok_post_id, media_uuid, object_key, object_key_hash, prompt_ref_id, duplicate_group_id'],
          ['lookup_value', 'TEXT', 'private exact value where needed'],
          ['lookup_hash', 'TEXT', 'committed-safe hash or source-provided hash'],
          ['created_at', 'TEXT', 'projection timestamp']
        ]
      }
    ],
    sql: [
      `CREATE TABLE canonical_snapshot_index (
  snapshot_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  r2_bucket TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  stable_content_hash TEXT NOT NULL,
  source_baseline_commit TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  projected_at TEXT NOT NULL,
  logical_asset_count INTEGER NOT NULL,
  storage_object_count INTEGER NOT NULL,
  prompt_ref_count INTEGER NOT NULL,
  gap_record_count INTEGER NOT NULL,
  classification_counts_json TEXT NOT NULL,
  gap_counts_json TEXT NOT NULL
);`,
      `CREATE TABLE canonical_asset_projection (
  snapshot_id TEXT NOT NULL,
  canonical_asset_id TEXT NOT NULL,
  identity_type TEXT NOT NULL,
  identity_value TEXT,
  identity_value_hash TEXT,
  canonical_object_key TEXT,
  canonical_object_key_hash TEXT,
  media_type TEXT NOT NULL,
  content_sha256 TEXT,
  size_bytes INTEGER,
  primary_status TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  review_required INTEGER NOT NULL,
  gap_flags_json TEXT NOT NULL,
  status_counts_json TEXT NOT NULL,
  reason_counts_json TEXT NOT NULL,
  storage_object_count INTEGER NOT NULL,
  duplicate_group_count INTEGER NOT NULL,
  prompt_ref_count INTEGER NOT NULL,
  grok_post_id_count INTEGER NOT NULL,
  media_uuid_count INTEGER NOT NULL,
  model_names_json TEXT NOT NULL,
  resolution_names_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, canonical_asset_id)
);`,
      `CREATE TABLE canonical_storage_object_projection (
  snapshot_id TEXT NOT NULL,
  storage_object_id TEXT NOT NULL,
  canonical_asset_id TEXT,
  object_key TEXT NOT NULL,
  object_key_hash TEXT NOT NULL,
  user_id_hash TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  retained_canonical_key TEXT,
  retained_canonical_key_hash TEXT,
  duplicate_group_id TEXT,
  media_type TEXT NOT NULL,
  size_bytes INTEGER,
  content_sha256 TEXT,
  path_class TEXT,
  d1_covered INTEGER NOT NULL,
  worker_covered INTEGER NOT NULL,
  grok_api_covered INTEGER NOT NULL,
  verification_status TEXT,
  upload_status TEXT,
  identity_links_json TEXT NOT NULL,
  prompt_ref_ids_json TEXT NOT NULL,
  source_url_hashes_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, storage_object_id)
);`,
      `CREATE TABLE canonical_prompt_ref_projection (
  snapshot_id TEXT NOT NULL,
  prompt_ref_id TEXT NOT NULL,
  source TEXT NOT NULL,
  captured_at TEXT,
  prompt_sha256 TEXT,
  original_prompt_sha256 TEXT,
  source_conversation_id TEXT,
  source_conversation_id_hash TEXT,
  response_id TEXT,
  response_id_hash TEXT,
  grok_post_id TEXT,
  grok_post_id_hash TEXT,
  linked_asset_count INTEGER NOT NULL,
  metadata_summary_json TEXT NOT NULL,
  media_evidence_counts_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, prompt_ref_id)
);`,
      `CREATE TABLE canonical_gap_projection (
  snapshot_id TEXT NOT NULL,
  gap_id TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT,
  canonical_asset_id TEXT,
  storage_object_id TEXT,
  object_key_hash TEXT,
  source_conversation_id_hash TEXT,
  asset_id_hash TEXT,
  reason TEXT,
  requires_human_review INTEGER NOT NULL,
  requires_live_grok INTEGER NOT NULL,
  requires_cloud_write INTEGER NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, gap_id)
);`,
      `CREATE TABLE canonical_asset_lookup (
  snapshot_id TEXT NOT NULL,
  canonical_asset_id TEXT NOT NULL,
  lookup_type TEXT NOT NULL,
  lookup_value TEXT,
  lookup_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, lookup_type, lookup_hash, canonical_asset_id)
);`
    ],
    indexes: [
      'CREATE INDEX idx_cap_status ON canonical_asset_projection (snapshot_id, primary_status);',
      'CREATE INDEX idx_cap_review ON canonical_asset_projection (snapshot_id, review_required);',
      'CREATE INDEX idx_cap_identity ON canonical_asset_projection (snapshot_id, identity_type, identity_value_hash);',
      'CREATE INDEX idx_cap_object_hash ON canonical_asset_projection (snapshot_id, canonical_object_key_hash);',
      'CREATE INDEX idx_csop_asset ON canonical_storage_object_projection (snapshot_id, canonical_asset_id);',
      'CREATE INDEX idx_csop_status ON canonical_storage_object_projection (snapshot_id, status);',
      'CREATE INDEX idx_csop_object_hash ON canonical_storage_object_projection (snapshot_id, object_key_hash);',
      'CREATE INDEX idx_csop_sha ON canonical_storage_object_projection (snapshot_id, content_sha256);',
      'CREATE INDEX idx_cprp_source ON canonical_prompt_ref_projection (snapshot_id, source);',
      'CREATE INDEX idx_cprp_prompt_hash ON canonical_prompt_ref_projection (snapshot_id, prompt_sha256);',
      'CREATE INDEX idx_cprp_conversation_hash ON canonical_prompt_ref_projection (snapshot_id, source_conversation_id_hash);',
      'CREATE INDEX idx_cprp_post_hash ON canonical_prompt_ref_projection (snapshot_id, grok_post_id_hash);',
      'CREATE INDEX idx_cgp_type ON canonical_gap_projection (snapshot_id, type);',
      'CREATE INDEX idx_cgp_severity ON canonical_gap_projection (snapshot_id, severity);',
      'CREATE INDEX idx_cgp_asset ON canonical_gap_projection (snapshot_id, canonical_asset_id);',
      'CREATE INDEX idx_cgp_human_review ON canonical_gap_projection (snapshot_id, requires_human_review);',
      'CREATE INDEX idx_cal_lookup ON canonical_asset_lookup (snapshot_id, lookup_type, lookup_hash);',
      'CREATE INDEX idx_cal_asset ON canonical_asset_lookup (snapshot_id, canonical_asset_id);'
    ],
    validationRules: [
      'approved R2 payload byte SHA-256 must match the approved value',
      'approved R2 stable content hash must match the approved value',
      'projection row counts must match source snapshot counts',
      'storage status counts must match source classification counts',
      'gap projection type counts must match source gap record type counts',
      'all storage projection rows should link to a logical asset',
      'prompt projection rows must not include raw prompt or originalPrompt bodies',
      'committed outputs must contain only schema, counts, hashes, validation status, and approval gates',
      'productionWrites must remain false and D1 writes must remain zero'
    ]
  };
}

function buildStorageIndexes(snapshot) {
  const storageByObjectKey = new Map();
  const storageByObjectHash = new Map();
  for (const row of snapshot.storageObjects) {
    storageByObjectKey.set(row.objectKey, row);
    storageByObjectHash.set(row.objectKeyHash, row);
  }

  const assetByObjectKey = new Map();
  const assetByObjectHash = new Map();
  const assetByPromptRef = new Map();
  for (const asset of snapshot.logicalAssets) {
    for (const objectKey of asset.storageObjectKeys || []) assetByObjectKey.set(objectKey, asset);
    for (const objectHash of asset.storageObjectKeyHashes || []) assetByObjectHash.set(objectHash, asset);
    for (const promptRefId of asset.promptRefIds || []) {
      if (!assetByPromptRef.has(promptRefId)) assetByPromptRef.set(promptRefId, new Set());
      assetByPromptRef.get(promptRefId).add(asset.canonicalAssetId);
    }
  }

  return { storageByObjectKey, storageByObjectHash, assetByObjectKey, assetByObjectHash, assetByPromptRef };
}

function selectedPromptMetadata(promptRecords) {
  const modelNames = [];
  const resolutionNames = [];
  const mediaTypes = [];
  for (const record of promptRecords) {
    const metadata = record.metadata || {};
    if (metadata.modelName) modelNames.push(metadata.modelName);
    if (metadata.model) modelNames.push(metadata.model);
    if (metadata.resolutionName) resolutionNames.push(metadata.resolutionName);
    if (metadata.resolution) resolutionNames.push(metadata.resolution);
    if (metadata.mediaType) mediaTypes.push(metadata.mediaType);
    if (Array.isArray(metadata.mediaTypes)) mediaTypes.push(...metadata.mediaTypes);
  }
  return {
    modelNames: uniqueSorted(modelNames),
    resolutionNames: uniqueSorted(resolutionNames),
    mediaTypes: uniqueSorted(mediaTypes)
  };
}

function buildRows(snapshot, projectedAt) {
  const indexes = buildStorageIndexes(snapshot);
  const promptById = new Map(snapshot.promptArchive.map((record) => [record.promptRefId, record]));
  const assetRows = [];
  const storageRows = [];
  const promptRows = [];
  const gapRows = [];
  const lookupRows = [];

  const snapshotRow = {
    snapshot_id: SNAPSHOT_ID,
    schema_version: PROJECTION_SCHEMA_ID,
    r2_bucket: APPROVED.bucket,
    r2_object_key: APPROVED.objectKey,
    payload_sha256: APPROVED.payloadSha256,
    stable_content_hash: APPROVED.stableContentHash,
    source_baseline_commit: APPROVED.sourceBaselineCommit,
    generated_at: snapshot.generatedAt,
    projected_at: projectedAt,
    logical_asset_count: snapshot.logicalAssets.length,
    storage_object_count: snapshot.storageObjects.length,
    prompt_ref_count: snapshot.promptArchive.length,
    gap_record_count: snapshot.gapRecords.length,
    classification_counts_json: jsonText(snapshot.classificationCounts),
    gap_counts_json: jsonText(snapshot.gapCounts)
  };

  for (const asset of snapshot.logicalAssets) {
    const canonicalStorage = indexes.storageByObjectKey.get(asset.canonicalStorageObjectKey);
    const linkedStorage = (asset.storageObjectKeys || [])
      .map((objectKey) => indexes.storageByObjectKey.get(objectKey))
      .filter(Boolean);
    const linkedPrompts = (asset.promptRefIds || [])
      .map((promptRefId) => promptById.get(promptRefId))
      .filter(Boolean);
    const metadata = selectedPromptMetadata(linkedPrompts);
    const primaryStatus = inferPrimaryStatus(asset);
    const mediaType = canonicalStorage?.evidence?.mediaType || inferMediaTypeFromKey(asset.canonicalStorageObjectKey);

    assetRows.push({
      snapshot_id: SNAPSHOT_ID,
      canonical_asset_id: asset.canonicalAssetId,
      identity_type: asset.identity?.type || 'unknown',
      identity_value: asset.identity?.value || null,
      identity_value_hash: asset.identity?.valueHash || (asset.identity?.value ? hashString(asset.identity.value).slice(0, 16) : null),
      canonical_object_key: asset.canonicalStorageObjectKey || null,
      canonical_object_key_hash: asset.canonicalStorageObjectKeyHash || null,
      media_type: mediaType,
      content_sha256: canonicalStorage?.evidence?.sha256 || firstString(linkedStorage.map((row) => row.evidence?.sha256)),
      size_bytes: canonicalStorage?.evidence?.size ?? null,
      primary_status: primaryStatus,
      verification_status: verificationStatusForPrimaryStatus(primaryStatus),
      review_required: boolInt(asset.reviewRequired),
      gap_flags_json: jsonText(asset.gapFlags || []),
      status_counts_json: jsonText(asset.statusCounts || {}),
      reason_counts_json: jsonText(asset.reasons || {}),
      storage_object_count: (asset.storageObjectKeys || []).length,
      duplicate_group_count: (asset.duplicateGroupIds || []).length,
      prompt_ref_count: (asset.promptRefIds || []).length,
      grok_post_id_count: (asset.grokPostIds || []).length,
      media_uuid_count: (asset.mediaUuids || []).length,
      model_names_json: jsonText(metadata.modelNames),
      resolution_names_json: jsonText(metadata.resolutionNames),
      created_at: firstString(linkedPrompts.map((record) => record.capturedAt)),
      updated_at: projectedAt
    });

    addLookup(lookupRows, asset.canonicalAssetId, 'identity', asset.identity?.value, asset.identity?.valueHash, projectedAt);
    for (const grokPostId of asset.grokPostIds || []) addLookup(lookupRows, asset.canonicalAssetId, 'grok_post_id', grokPostId, null, projectedAt);
    for (const mediaUuid of asset.mediaUuids || []) addLookup(lookupRows, asset.canonicalAssetId, 'media_uuid', mediaUuid, null, projectedAt);
    for (const objectKey of asset.storageObjectKeys || []) {
      const storage = indexes.storageByObjectKey.get(objectKey);
      addLookup(lookupRows, asset.canonicalAssetId, 'object_key', objectKey, storage?.objectKeyHash, projectedAt);
      if (storage?.objectKeyHash) addLookup(lookupRows, asset.canonicalAssetId, 'object_key_hash', storage.objectKeyHash, storage.objectKeyHash, projectedAt);
    }
    for (const promptRefId of asset.promptRefIds || []) addLookup(lookupRows, asset.canonicalAssetId, 'prompt_ref_id', promptRefId, null, projectedAt);
    for (const duplicateGroupId of asset.duplicateGroupIds || []) addLookup(lookupRows, asset.canonicalAssetId, 'duplicate_group_id', duplicateGroupId, duplicateGroupId, projectedAt);
  }

  for (const storage of snapshot.storageObjects) {
    const asset = indexes.assetByObjectKey.get(storage.objectKey) || indexes.assetByObjectHash.get(storage.objectKeyHash);
    const evidence = storage.evidence || {};
    storageRows.push({
      snapshot_id: SNAPSHOT_ID,
      storage_object_id: storage.storageObjectId,
      canonical_asset_id: asset?.canonicalAssetId || null,
      object_key: storage.objectKey,
      object_key_hash: storage.objectKeyHash,
      user_id_hash: storage.userIdHash || null,
      status: storage.status,
      reason: storage.reason || null,
      retained_canonical_key: storage.retainedCanonicalKey || null,
      retained_canonical_key_hash: storage.retainedCanonicalKeyHash || null,
      duplicate_group_id: storage.duplicateGroupId || null,
      media_type: evidence.mediaType || inferMediaTypeFromKey(storage.objectKey),
      size_bytes: evidence.size ?? null,
      content_sha256: evidence.sha256 || null,
      path_class: evidence.pathClass || null,
      d1_covered: boolInt(evidence.d1Covered),
      worker_covered: boolInt(evidence.workerCovered),
      grok_api_covered: boolInt(evidence.grokApiCovered),
      verification_status: evidence.verificationStatus || null,
      upload_status: evidence.uploadStatus || null,
      identity_links_json: jsonText(storage.identityLinksToRetained || []),
      prompt_ref_ids_json: jsonText(storage.promptRefIds || []),
      source_url_hashes_json: jsonText(evidence.sourceUrlHashes || []),
      created_at: null,
      updated_at: projectedAt
    });
  }

  for (const prompt of snapshot.promptArchive) {
    const linkedAssetIds = [...(indexes.assetByPromptRef.get(prompt.promptRefId) || new Set())].sort();
    const mediaEvidence = prompt.mediaEvidence || {};
    const mediaEvidenceCounts = Object.fromEntries(
      Object.entries(mediaEvidence).map(([key, value]) => [key, Array.isArray(value) ? value.length : value ? 1 : 0])
    );
    const metadata = prompt.metadata || {};
    promptRows.push({
      snapshot_id: SNAPSHOT_ID,
      prompt_ref_id: prompt.promptRefId,
      source: prompt.source,
      captured_at: prompt.capturedAt || null,
      prompt_sha256: prompt.promptSha256 || null,
      original_prompt_sha256: prompt.originalPromptSha256 || null,
      source_conversation_id: prompt.sourceConversationId || null,
      source_conversation_id_hash: prompt.sourceConversationId ? hashString(prompt.sourceConversationId).slice(0, 16) : null,
      response_id: prompt.responseId || null,
      response_id_hash: prompt.responseId ? hashString(prompt.responseId).slice(0, 16) : null,
      grok_post_id: prompt.grokPostId || null,
      grok_post_id_hash: prompt.grokPostId ? hashString(prompt.grokPostId).slice(0, 16) : null,
      linked_asset_count: linkedAssetIds.length,
      metadata_summary_json: jsonText({
        createTime: metadata.createTime || null,
        model: metadata.model || metadata.modelName || null,
        mediaType: metadata.mediaType || null,
        mediaTypes: Array.isArray(metadata.mediaTypes) ? metadata.mediaTypes : [],
        mode: metadata.mode || null,
        queryType: metadata.queryType || null,
        resolution: metadata.resolution || null,
        resolutionName: metadata.resolutionName || null,
        videoDuration: metadata.videoDuration || null,
        shared: metadata.shared ?? null,
        manual: metadata.manual ?? null,
        partial: metadata.partial ?? null
      }),
      media_evidence_counts_json: jsonText(mediaEvidenceCounts),
      created_at: prompt.capturedAt || projectedAt,
      updated_at: projectedAt
    });
  }

  for (const [index, gap] of snapshot.gapRecords.entries()) {
    const storage = gap.objectKeyHash ? indexes.storageByObjectHash.get(gap.objectKeyHash) : null;
    const asset = storage
      ? indexes.assetByObjectKey.get(storage.objectKey) || indexes.assetByObjectHash.get(storage.objectKeyHash)
      : null;
    const gapId = `gap_${stableHash({ index, gap }).slice(0, 24)}`;
    const requiresHumanReview = gap.type === 'needs_human_review' || gap.type === 'orphan_candidate';
    const requiresLiveGrok = gap.type === 'grok_conversation_response_gap' || gap.type === 'grok_media_post_response_gap';
    gapRows.push({
      snapshot_id: SNAPSHOT_ID,
      gap_id: gapId,
      type: gap.type,
      severity: severityForGap(gap),
      status: gap.status === undefined ? (requiresHumanReview ? 'review_required' : null) : String(gap.status),
      canonical_asset_id: asset?.canonicalAssetId || null,
      storage_object_id: storage?.storageObjectId || null,
      object_key_hash: gap.objectKeyHash || null,
      source_conversation_id_hash: gap.sourceConversationId ? hashString(gap.sourceConversationId).slice(0, 16) : null,
      asset_id_hash: gap.assetId ? hashString(gap.assetId).slice(0, 16) : null,
      reason: gap.reason || gap.parseError || null,
      requires_human_review: boolInt(requiresHumanReview),
      requires_live_grok: boolInt(requiresLiveGrok),
      requires_cloud_write: 0,
      evidence_json: jsonText({
        pathClass: gap.pathClass || null,
        retainedCanonicalKeyHash: gap.retainedCanonicalKeyHash || null,
        duplicateGroupId: gap.duplicateGroupId || null,
        sha256: gap.sha256 || null,
        hasObjectKey: Boolean(gap.objectKey),
        hasSourceConversationId: Boolean(gap.sourceConversationId),
        hasAssetId: Boolean(gap.assetId)
      }),
      created_at: gap.capturedAt || projectedAt,
      updated_at: projectedAt
    });
  }

  return { snapshotRow, assetRows, storageRows, promptRows, gapRows, lookupRows };
}

function addLookup(rows, canonicalAssetId, lookupType, lookupValue, lookupHash, projectedAt) {
  if (!lookupValue && !lookupHash) return;
  const exactValue = lookupValue ? String(lookupValue) : null;
  rows.push({
    snapshot_id: SNAPSHOT_ID,
    canonical_asset_id: canonicalAssetId,
    lookup_type: lookupType,
    lookup_value: exactValue,
    lookup_hash: lookupHash || hashString(exactValue).slice(0, 16),
    created_at: projectedAt
  });
}

function validateProjection({ snapshot, payloadDescriptor, stableContentHash, rows }) {
  const errors = [];
  const warnings = [];
  const storageStatusCounts = countBy(rows.storageRows, (row) => row.status);
  const sourceGapTypeCounts = countBy(snapshot.gapRecords, (row) => row.type);
  const projectionGapTypeCounts = countBy(rows.gapRows, (row) => row.type);
  const primaryStatusCounts = countBy(rows.assetRows, (row) => row.primary_status);
  const verificationStatusCounts = countBy(rows.assetRows, (row) => row.verification_status);
  const unlinkedStorageRows = rows.storageRows.filter((row) => !row.canonical_asset_id).length;
  const promptRowsWithBodyFields = rows.promptRows.filter((row) => Object.hasOwn(row, 'prompt') || Object.hasOwn(row, 'originalPrompt')).length;
  const duplicateLookupKeys = rows.lookupRows.length - new Set(rows.lookupRows.map((row) => [row.snapshot_id, row.lookup_type, row.lookup_hash, row.canonical_asset_id].join('|'))).size;

  if (payloadDescriptor.sha256 !== APPROVED.payloadSha256) errors.push('approved payload SHA-256 mismatch');
  if (stableContentHash !== APPROVED.stableContentHash) errors.push('approved stable content hash mismatch');
  if (snapshot.schemaVersion !== APPROVED.schemaVersion) errors.push('source snapshot schemaVersion mismatch');
  if (snapshot.snapshotKind !== APPROVED.snapshotKind) errors.push('source snapshot kind mismatch');
  if (snapshot.productionWrites !== false) errors.push('source snapshot productionWrites must be false');
  if (snapshot.sourceBaseline?.evidenceBaselineCommit !== APPROVED.sourceBaselineCommit) {
    errors.push('source baseline commit mismatch');
  }
  if (rows.assetRows.length !== snapshot.logicalAssets.length) errors.push('asset projection row count mismatch');
  if (rows.storageRows.length !== snapshot.storageObjects.length) errors.push('storage projection row count mismatch');
  if (rows.promptRows.length !== snapshot.promptArchive.length) errors.push('prompt projection row count mismatch');
  if (rows.gapRows.length !== snapshot.gapRecords.length) errors.push('gap projection row count mismatch');
  if (!countsEqual(storageStatusCounts, snapshot.classificationCounts)) {
    errors.push('storage status counts do not match source classificationCounts');
  }
  if (!countsEqual(projectionGapTypeCounts, sourceGapTypeCounts)) {
    errors.push('projected gap type counts do not match source gap record type counts');
  }
  if (unlinkedStorageRows > 0) errors.push(`${unlinkedStorageRows} storage projection rows do not link to a logical asset`);
  if (promptRowsWithBodyFields > 0) errors.push(`${promptRowsWithBodyFields} prompt projection rows include raw prompt body fields`);
  if (duplicateLookupKeys > 0) errors.push(`${duplicateLookupKeys} lookup projection rows violate the proposed primary key`);
  if (sumObjectValues(storageStatusCounts) !== rows.storageRows.length) errors.push('storage status counts do not sum to storage row count');
  if (sumObjectValues(primaryStatusCounts) !== rows.assetRows.length) errors.push('primary status counts do not sum to asset row count');
  if (!rows.snapshotRow.r2_object_key) errors.push('snapshot index row must include approved R2 object key');
  if (rows.assetRows.some((row) => row.review_required && row.primary_status === 'canonical')) {
    warnings.push('some review-required assets have canonical primary status');
  }

  return {
    generatedAt: nowIso(),
    ok: errors.length === 0,
    errors,
    warnings,
    productionWrites: {
      d1Writes: 0,
      workerStateWrites: 0,
      grokActions: 0,
      r2Writes: 0,
      objectMoves: 0,
      objectDeletes: 0,
      repairRouteCalls: 0,
      syncRouteCalls: 0,
      physicalCleanupActions: 0
    },
    counts: {
      snapshotRows: 1,
      assetRows: rows.assetRows.length,
      storageRows: rows.storageRows.length,
      promptRows: rows.promptRows.length,
      gapRows: rows.gapRows.length,
      lookupRows: rows.lookupRows.length,
      unlinkedStorageRows,
      promptRowsWithBodyFields,
      duplicateLookupKeys
    },
    sourceCounts: {
      logicalAssets: snapshot.logicalAssets.length,
      storageObjects: snapshot.storageObjects.length,
      promptArchive: snapshot.promptArchive.length,
      gapRecords: snapshot.gapRecords.length
    },
    classificationCounts: snapshot.classificationCounts,
    storageStatusCounts,
    sourceGapTypeCounts,
    projectionGapTypeCounts,
    primaryStatusCounts,
    verificationStatusCounts,
    snapshotIdentityTypeCounts: countBy(snapshot.logicalAssets, (row) => row.identity?.type),
    promptSourceCounts: countBy(snapshot.promptArchive, (row) => row.source),
    gapSeverityCounts: countBy(rows.gapRows, (row) => row.severity),
    sourceSnapshot: {
      payloadSha256: payloadDescriptor.sha256,
      stableContentHash,
      schemaVersion: snapshot.schemaVersion,
      snapshotKind: snapshot.snapshotKind,
      sourceBaselineCommit: snapshot.sourceBaseline?.evidenceBaselineCommit
    }
  };
}

function buildCurrentD1Comparison(d1Schema) {
  const schemaRows = Array.isArray(d1Schema?.rows) ? d1Schema.rows : [];
  const tableNames = schemaRows.filter((row) => row.type === 'table').map((row) => row.name).sort();
  const indexNames = schemaRows.filter((row) => row.type === 'index').map((row) => row.name).sort();
  const proposedTables = [
    'canonical_snapshot_index',
    'canonical_asset_projection',
    'canonical_storage_object_projection',
    'canonical_prompt_ref_projection',
    'canonical_gap_projection',
    'canonical_asset_lookup'
  ];
  return {
    schemaArtifact: 'inventory/d1-schema.json',
    generatedAt: d1Schema?.generatedAt || null,
    database: d1Schema?.database || 'grok-powertools-db',
    databaseId: d1Schema?.databaseId || 'ad89e4bb-0b68-4c72-93d9-b90e6eb45aa6',
    tableCount: tableNames.length,
    indexCount: indexNames.length,
    currentTables: tableNames,
    requiredCurrentTablesPresent: {
      r2_dedupe_index: tableNames.includes('r2_dedupe_index'),
      metadata_snapshot_index: tableNames.includes('metadata_snapshot_index'),
      vault_overlays: tableNames.includes('vault_overlays')
    },
    proposedProjectionTablesAlreadyPresent: proposedTables.filter((name) => tableNames.includes(name)),
    interpretation:
      'current production D1 is upload/object-key centered; this dry run adds a separate logical canonical projection contract and does not mutate D1'
  };
}

function buildSummary({ generatedAt, snapshot, rows, validation, privateArtifacts, currentD1Comparison }) {
  return {
    generatedAt,
    schemaVersion: PROJECTION_SCHEMA_ID,
    mode: 'd1_canonical_projection_local_dry_run',
    sourceSnapshot: {
      bucket: APPROVED.bucket,
      objectKey: APPROVED.objectKey,
      payloadSha256: APPROVED.payloadSha256,
      stableContentHash: APPROVED.stableContentHash,
      schemaVersion: APPROVED.schemaVersion,
      snapshotKind: APPROVED.snapshotKind,
      sourceBaselineCommit: APPROVED.sourceBaselineCommit
    },
    productionWrites: validation.productionWrites,
    privateArtifacts,
    currentD1Comparison,
    rowCounts: validation.counts,
    sourceCounts: validation.sourceCounts,
    classificationCounts: snapshot.classificationCounts,
    storageStatusCounts: validation.storageStatusCounts,
    primaryStatusCounts: validation.primaryStatusCounts,
    verificationStatusCounts: validation.verificationStatusCounts,
    gapCounts: snapshot.gapCounts,
    gapTypeCounts: validation.projectionGapTypeCounts,
    gapSeverityCounts: validation.gapSeverityCounts,
    promptSourceCounts: validation.promptSourceCounts,
    identityTypeCounts: validation.snapshotIdentityTypeCounts,
    reviewQueue: {
      reviewRequiredAssets: rows.assetRows.filter((row) => row.review_required).length,
      blockingGapRows: rows.gapRows.filter((row) => row.severity === 'blocking').length,
      warningGapRows: rows.gapRows.filter((row) => row.severity === 'warning').length,
      orphanCandidateStorageRows: rows.storageRows.filter((row) => row.status === 'orphan_candidate').length,
      needsHumanReviewStorageRows: rows.storageRows.filter((row) => row.status === 'needs_human_review').length
    },
    validation: {
      ok: validation.ok,
      errorCount: validation.errors.length,
      warningCount: validation.warnings.length
    },
    designDecisions: [
      'R2 canonical snapshot remains the durable source of truth for raw prompts and bulky metadata.',
      'D1 projection rows store query fields, lookup keys, hashes, counts, status, and selected display metadata only.',
      'Private exact object keys and private exact Grok IDs are present only in ignored local dry-run rows for this phase.',
      'Prompt projection rows store prompt hashes and metadata summaries, not prompt or originalPrompt bodies.',
      'Review and orphan rows remain first-class projection rows and are not hidden or merged.'
    ],
    approvalGate: {
      nextAllowedPhase: 'd1_canonical_projection_write_after_separate_approval',
      requiresExplicitUserApproval: true,
      approvalMustName: [
        'target D1 database and database id',
        'source R2 snapshot bucket and object key',
        'source payload SHA-256',
        'source stable content hash',
        'projection schema id',
        'expected D1 table names and row counts',
        'rollback plan that leaves R2 snapshot as recovery source'
      ],
      stillForbiddenWithoutSeparateApproval: [
        'Worker state writes',
        'product route or read-path changes',
        'Grok actions',
        'R2 object moves',
        'R2 object deletes',
        'repair route calls',
        'sync route calls',
        'physical duplicate cleanup'
      ],
      dryRunValid: validation.ok
    }
  };
}

function renderReport(summary, validation) {
  const validationLines = [
    ...(validation.errors.length ? validation.errors.map((error) => `- ERROR: ${error}`) : ['- No validation errors.']),
    ...validation.warnings.map((warning) => `- WARNING: ${warning}`)
  ].join('\n');

  return `# D1 Canonical Projection Dry Run

Generated: ${summary.generatedAt}

This report is committed-safe. It records the local-only D1 projection dry run derived from the approved R2 canonical snapshot. Exact projection rows are ignored under \`private/\`.

## Status

- Projection schema: \`${summary.schemaVersion}\`
- Source payload SHA-256: \`${summary.sourceSnapshot.payloadSha256}\`
- Source stable content hash: \`${summary.sourceSnapshot.stableContentHash}\`
- Dry-run valid: ${summary.validation.ok ? 'yes' : 'no'}
- D1 writes: ${summary.productionWrites.d1Writes}
- Worker state writes: ${summary.productionWrites.workerStateWrites}
- Grok actions: ${summary.productionWrites.grokActions}
- R2 writes: ${summary.productionWrites.r2Writes}
- Object moves: ${summary.productionWrites.objectMoves}
- Object deletes: ${summary.productionWrites.objectDeletes}
- Physical cleanup actions: ${summary.productionWrites.physicalCleanupActions}

## Row Counts

- Snapshot rows: ${summary.rowCounts.snapshotRows}
- Asset rows: ${summary.rowCounts.assetRows}
- Storage rows: ${summary.rowCounts.storageRows}
- Prompt rows: ${summary.rowCounts.promptRows}
- Gap rows: ${summary.rowCounts.gapRows}
- Lookup rows: ${summary.rowCounts.lookupRows}

## Current D1 Comparison

- Database: \`${summary.currentD1Comparison.database}\`
- Database id: \`${summary.currentD1Comparison.databaseId}\`
- Schema artifact: \`${summary.currentD1Comparison.schemaArtifact}\`
- Current tables: ${summary.currentD1Comparison.tableCount}
- Current indexes: ${summary.currentD1Comparison.indexCount}
- Existing projection tables present: ${summary.currentD1Comparison.proposedProjectionTablesAlreadyPresent.length ? summary.currentD1Comparison.proposedProjectionTablesAlreadyPresent.join(', ') : 'none'}
- Interpretation: ${summary.currentD1Comparison.interpretation}

## Review Queue

- Review-required assets: ${summary.reviewQueue.reviewRequiredAssets}
- Blocking gap rows: ${summary.reviewQueue.blockingGapRows}
- Warning gap rows: ${summary.reviewQueue.warningGapRows}
- Needs-human-review storage rows: ${summary.reviewQueue.needsHumanReviewStorageRows}
- Orphan-candidate storage rows: ${summary.reviewQueue.orphanCandidateStorageRows}

## Storage Status Counts

${Object.entries(summary.storageStatusCounts).map(([status, count]) => `- ${status}: ${count}`).join('\n')}

## Gap Type Counts

${Object.entries(summary.gapTypeCounts).map(([type, count]) => `- ${type}: ${count}`).join('\n')}

## Prompt Policy

Prompt bodies remain in the approved R2 snapshot data plane. The D1 projection dry-run stores prompt reference IDs, prompt hashes, selected metadata summaries, and media evidence counts, not raw prompt or originalPrompt text.

## Approval Gate

The next phase is \`${summary.approvalGate.nextAllowedPhase}\`. It requires explicit approval naming the target D1 database, source R2 snapshot, payload SHA-256, stable content hash, projection schema id, expected row counts, and rollback plan. Product read changes, Worker writes, Grok actions, R2 moves/deletes, repair/sync routes, and physical duplicate cleanup remain outside this dry run.

## Validation

${validationLines}
`;
}

async function buildDryRun() {
  await fs.mkdir(privateDir, { recursive: true });
  const generatedAt = nowIso();
  const manifest = await readManifest();
  const snapshot = await readJson(PRIVATE_SNAPSHOT_REL);
  const d1Schema = await readOptionalJson('inventory/d1-schema.json');
  const currentD1Comparison = buildCurrentD1Comparison(d1Schema);
  const payloadDescriptor = await artifactDescriptor(PRIVATE_SNAPSHOT_REL);
  const stableContentHash = stableHash(normalizeForStableHash(snapshot));
  const rows = buildRows(snapshot, generatedAt);
  const validation = validateProjection({ snapshot, payloadDescriptor, stableContentHash, rows });
  if (manifest.currentCanonicalSnapshotR2Write?.verification?.ok !== true) {
    validation.warnings.push('manifest did not report a verified currentCanonicalSnapshotR2Write at script start');
  }
  if (currentD1Comparison.proposedProjectionTablesAlreadyPresent.length > 0) {
    validation.warnings.push('one or more proposed D1 projection tables already exist in current D1 schema');
  }
  const schema = projectionSchema();

  await writeJson(outputRels.snapshotIndex, rows.snapshotRow);
  await writeJsonl(outputRels.assets, rows.assetRows);
  await writeJsonl(outputRels.storageObjects, rows.storageRows);
  await writeJsonl(outputRels.promptRefs, rows.promptRows);
  await writeJsonl(outputRels.gaps, rows.gapRows);
  await writeJsonl(outputRels.lookups, rows.lookupRows);

  const privateArtifacts = {
    snapshotIndex: await artifactDescriptor(outputRels.snapshotIndex, 1),
    assets: await artifactDescriptor(outputRels.assets, rows.assetRows.length),
    storageObjects: await artifactDescriptor(outputRels.storageObjects, rows.storageRows.length),
    promptRefs: await artifactDescriptor(outputRels.promptRefs, rows.promptRows.length),
    gaps: await artifactDescriptor(outputRels.gaps, rows.gapRows.length),
    lookups: await artifactDescriptor(outputRels.lookups, rows.lookupRows.length),
    gitIgnored: true,
    containsPrivateObjectKeys: true,
    containsPrivateGrokIds: true,
    containsRawPromptBodies: false
  };
  const summary = buildSummary({ generatedAt, snapshot, rows, validation, privateArtifacts, currentD1Comparison });

  await writeJson(outputRels.schema, schema);
  await writeJson(outputRels.summary, summary);
  await writeJson(outputRels.validation, validation);
  await writeText(outputRels.report, renderReport(summary, validation));

  await updateManifest((current) => {
    current.subsystems ||= {};
    current.subsystems.d1CanonicalProjectionDryRun = validation.ok ? 'validated' : 'failed';
    current.currentD1CanonicalProjectionDryRun = {
      generatedAt: summary.generatedAt,
      schemaVersion: summary.schemaVersion,
      sourceSnapshot: summary.sourceSnapshot,
      privateArtifacts: {
        snapshotIndex: outputRels.snapshotIndex,
        assets: outputRels.assets,
        storageObjects: outputRels.storageObjects,
        promptRefs: outputRels.promptRefs,
        gaps: outputRels.gaps,
        lookups: outputRels.lookups
      },
      committedArtifacts: {
        schema: outputRels.schema,
        summary: outputRels.summary,
        validation: outputRels.validation,
        report: outputRels.report
      },
      rowCounts: summary.rowCounts,
      reviewQueue: summary.reviewQueue,
      validation: summary.validation,
      productionWrites: summary.productionWrites,
      nextAllowedPhase: summary.approvalGate.nextAllowedPhase,
      requiresExplicitUserApproval: true
    };
    current.nextRecommendedPhase = {
      name: 'd1_canonical_projection_write',
      scope: [
        'write the validated projection rows to D1 only after separate explicit approval',
        'keep the approved R2 snapshot as the rollback and recovery source',
        'read back D1 row counts and status counts before any product route change',
        'switch Worker/product reads only in a later separately approved phase'
      ],
      stopBefore: [
        'product route or read-path changes',
        'Grok actions',
        'R2 object moves',
        'R2 object deletes',
        'repair or sync routes',
        'physical duplicate cleanup'
      ],
      pauseForUser: [
        'D1 target database identity is uncertain',
        'row counts do not match the dry-run summary',
        'D1 schema migration would require changing product reads in the same phase',
        'rollback plan cannot preserve the approved R2 snapshot as recovery source'
      ]
    };
  });

  if (!validation.ok) process.exitCode = 1;
  console.log(`d1 canonical projection summary: ${path.relative(process.cwd(), auditPath(outputRels.summary))}`);
  console.log(`d1 canonical projection validation: ${validation.ok ? 'ok' : 'failed'}`);
}

await buildDryRun();
