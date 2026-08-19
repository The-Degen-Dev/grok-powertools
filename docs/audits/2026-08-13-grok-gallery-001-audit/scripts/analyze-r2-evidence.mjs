#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const sourceAuditRoot = path.resolve(path.dirname(scriptPath), '..');
const auditRoot = process.env.AUDIT_OUTPUT_ROOT
  ? path.resolve(process.cwd(), process.env.AUDIT_OUTPUT_ROOT)
  : sourceAuditRoot;
const repoRoot = path.resolve(sourceAuditRoot, '../../..');
const bucket = process.env.AUDIT_R2_BUCKET || 'grok-gallery-001';
const productionPrefix = process.env.AUDIT_R2_PREFIX || 'grok-powertools/v1';
const concurrency = Math.max(1, Number(process.env.AUDIT_METADATA_CONCURRENCY || 16));
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizePrompt(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function assertAuditPath(filePath) {
  const resolved = path.resolve(filePath);
  if (resolved !== auditRoot && !resolved.startsWith(`${auditRoot}${path.sep}`)) {
    throw new Error(`Refusing to write outside audit root: ${resolved}`);
  }
  return resolved;
}

async function readJsonl(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function writeJson(filePath, value) {
  const resolved = assertAuditPath(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonl(filePath, rows) {
  const resolved = assertAuditPath(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return results;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sum(rows, valueFn) {
  return rows.reduce((total, row) => total + Number(valueFn(row) || 0), 0);
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function objectRef(key) {
  return key ? `sha256:${sha256(key).slice(0, 20)}` : null;
}

function loadS3() {
  const require = createRequire(path.join(repoRoot, 'cloud', 'package.json'));
  return require('@aws-sdk/client-s3');
}

function s3ClientConfig() {
  const missing = ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
    .filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required read-only R2 variables: ${missing.join(', ')}`);
  return {
    region: 'auto',
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  };
}

async function bodyToBuffer(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function metadataKindFromKey(key) {
  const file = key.split('/').at(-1) || '';
  if (file.startsWith('saved-prompts.')) return 'savedPrompts';
  if (file.startsWith('prompt-history.')) return 'promptHistory';
  if (file.startsWith('processed-ids.')) return 'processedIds';
  if (file.startsWith('backfill-manifest.')) return 'backfillManifest';
  return 'unknown';
}

function collectTopLevelFieldCoverage(data) {
  const rows = Array.isArray(data) ? data : [];
  const fields = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    for (const key of Object.keys(row)) fields.set(key, (fields.get(key) || 0) + 1);
  }
  return Object.fromEntries([...fields.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function collectPrivateStringEvidence(value, kind) {
  const promptHashes = new Set();
  const originalPromptHashes = new Set();
  const identityFields = new Map();
  let promptValues = 0;
  let nonEmptyPromptValues = 0;
  function visit(node) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      const normalizedKey = key.toLowerCase().replace(/[-_\s]/g, '');
      if (typeof child === 'string') {
        const isPromptText = normalizedKey === 'prompt' ||
          normalizedKey === 'prompttext' ||
          normalizedKey === 'originalprompt' ||
          (normalizedKey === 'text' && (kind === 'promptHistory' || kind === 'savedPrompts'));
        if (isPromptText) {
          promptValues += 1;
          const normalized = normalizePrompt(child);
          if (normalized) {
            nonEmptyPromptValues += 1;
            const hash = sha256(normalized);
            promptHashes.add(hash);
            if (normalizedKey === 'originalprompt') originalPromptHashes.add(hash);
          }
        }
        if (/(asset|post|conversation|response|source).*id|^id$/.test(normalizedKey)) {
          identityFields.set(key, (identityFields.get(key) || 0) + 1);
        }
      }
      visit(child);
    }
  }
  visit(value);
  return {
    promptValues,
    nonEmptyPromptValues,
    distinctPromptHashes: promptHashes.size,
    distinctOriginalPromptHashes: originalPromptHashes.size,
    identityFieldCounts: Object.fromEntries([...identityFields.entries()].sort(([a], [b]) => a.localeCompare(b)))
  };
}

function deriveLogicalId(object) {
  const metadataId = object.customMetadata?.['asset-id'];
  if (metadataId) return String(metadataId).toLowerCase();
  if (object.assetId) return String(object.assetId).toLowerCase();
  const matches = String(object.key || '').match(UUID_RE) || [];
  return matches.at(-1)?.toLowerCase() || null;
}

function classifyExactDuplicate(items) {
  const classes = new Set(items.map((item) => item.pathClass));
  const logicalIds = new Set(items.map(deriveLogicalId).filter(Boolean));
  if (classes.has('conflict-media')) return 'conflict_evidence_preserve';
  if (classes.has('canonical-media') && classes.has('legacy-date-media')) return 'legacy_canonical_alias';
  if (classes.size === 1 && classes.has('legacy-date-media')) return 'legacy_repeated_bytes';
  if (classes.size === 1 && classes.has('canonical-media')) {
    return logicalIds.size <= 1 ? 'canonical_duplicate_key' : 'canonical_same_bytes_distinct_ids';
  }
  return 'mixed_exact_duplicate';
}

function mediaFieldCoverage(media, field) {
  return media.filter((object) => {
    if (field === 'content-type') return Boolean(object.contentType);
    if (field === 'size') return Number(object.size) > 0;
    return Boolean(object.customMetadata?.[field]);
  }).length;
}

async function main() {
  const objects = await readJsonl(path.join(auditRoot, 'inventory', 'r2-objects.jsonl'));
  const hashRows = await readJsonl(path.join(auditRoot, 'inventory', 'r2-media-hashes.jsonl'));
  const d1Rows = await readJsonl(path.join(auditRoot, 'inventory', 'd1-r2-dedupe-index.jsonl'));
  const d1MetadataRows = await readJsonl(path.join(auditRoot, 'inventory', 'd1-metadata-snapshot-index.jsonl'));
  const canonicalSnapshots = await readJsonl(path.join(auditRoot, 'inventory', 'd1-canonical-snapshot-index.jsonl'));
  const canonicalAssets = await readJsonl(path.join(auditRoot, 'inventory', 'd1-canonical-asset-projection.jsonl'));
  const canonicalStorage = await readJsonl(path.join(auditRoot, 'inventory', 'd1-canonical-storage-object-projection.jsonl'));
  const canonicalPrompts = await readJsonl(path.join(auditRoot, 'inventory', 'd1-canonical-prompt-ref-projection.jsonl'));
  const canonicalGaps = await readJsonl(path.join(auditRoot, 'inventory', 'd1-canonical-gap-projection.jsonl'));
  const hashByKey = new Map(hashRows.map((row) => [row.objectKey, row]));
  const d1ByKey = new Map(d1Rows.map((row) => [row.canonical_object_key, row]).filter(([key]) => key));
  const d1MetadataByKey = new Map(d1MetadataRows.map((row) => [row.object_key, row]).filter(([key]) => key));
  const objectsByKey = new Map(objects.map((object) => [object.key, object]));
  const media = objects.filter((object) => object.isMedia);
  const mediaByKey = new Map(media.map((object) => [object.key, object]));
  const metadataObjects = objects.filter((object) =>
    ['metadata', 'prompt-sidecar', 'asset-metadata-v2'].includes(object.pathClass));

  const { S3Client, GetObjectCommand } = loadS3();
  const client = new S3Client(s3ClientConfig());
  let completed = 0;
  const fetched = await mapLimit(metadataObjects, concurrency, async (object) => {
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.key }));
      const buffer = await bodyToBuffer(response.Body);
      const parsed = JSON.parse(buffer.toString('utf8'));
      completed += 1;
      if (completed % 250 === 0 || completed === metadataObjects.length) {
        console.log(`metadata evidence ${completed}/${metadataObjects.length}`);
      }
      return { object, parsed, bodySha256: sha256(buffer), bytesRead: buffer.length, status: 'ok' };
    } catch (error) {
      completed += 1;
      return { object, status: 'failed', error: error.message };
    }
  });

  const sidecars = [];
  const assetMetadataSidecars = [];
  const snapshots = [];
  for (const row of fetched) {
    if (row.object.pathClass === 'prompt-sidecar') {
      const parsed = row.parsed || {};
      const parentKey = row.object.key.replace(/\.prompt\.json$/i, '');
      const declaredMediaKey = typeof parsed.mediaKey === 'string' ? parsed.mediaKey : null;
      const targetKey = declaredMediaKey || parentKey;
      const target = mediaByKey.get(targetKey);
      const prompt = typeof parsed.prompt === 'string' ? parsed.prompt : '';
      const normalizedPrompt = normalizePrompt(prompt);
      const issues = [];
      if (row.status !== 'ok') issues.push('read_or_parse_failed');
      if (!normalizedPrompt) issues.push('prompt_missing_or_empty');
      if (!declaredMediaKey) issues.push('media_key_missing');
      if (declaredMediaKey && declaredMediaKey !== parentKey) issues.push('media_key_parent_mismatch');
      if (!target) issues.push('target_media_missing');
      if (!parsed.assetId) issues.push('asset_id_missing');
      if (!parsed.uploadedAt || Number.isNaN(Date.parse(parsed.uploadedAt))) issues.push('uploaded_at_missing_or_invalid');
      if (parsed.assetId && target?.customMetadata?.['asset-id'] && parsed.assetId !== target.customMetadata['asset-id']) {
        issues.push('asset_id_mismatch');
      }
      sidecars.push({
        objectKey: row.object.key,
        objectRef: objectRef(row.object.key),
        parentKey,
        targetKey,
        targetRef: objectRef(targetKey),
        targetExists: Boolean(target),
        promptPresent: Boolean(normalizedPrompt),
        promptLength: normalizedPrompt.length,
        promptSha256: normalizedPrompt ? sha256(normalizedPrompt) : null,
        rawPromptSha256: prompt ? sha256(prompt) : null,
        assetIdPresent: Boolean(parsed.assetId),
        uploadedAtPresent: Boolean(parsed.uploadedAt),
        fieldNames: Object.keys(parsed).sort(),
        issues,
        status: row.status
      });
      continue;
    }

    if (row.object.pathClass === 'asset-metadata-v2') {
      const parsed = row.parsed || {};
      const parentKey = row.object.key.replace(/\.metadata\.v2\.[0-9a-f]{24}\.json$/i, '');
      const targetKey = typeof parsed.mediaKey === 'string' ? parsed.mediaKey : parentKey;
      const target = mediaByKey.get(targetKey);
      const capture = parsed.capture && typeof parsed.capture === 'object' ? parsed.capture : {};
      const prompt = typeof capture.promptText === 'string' ? capture.promptText : '';
      const issues = [];
      if (row.status !== 'ok') issues.push('read_or_parse_failed');
      if (parsed.schemaVersion !== 2) issues.push('schema_version_invalid');
      if (!parsed.mediaKey) issues.push('media_key_missing');
      if (targetKey !== parentKey) issues.push('media_key_parent_mismatch');
      if (!target) issues.push('target_media_missing');
      if (!parsed.assetId) issues.push('asset_id_missing');
      if (capture.evidenceSource !== 'grok_conversation_response') issues.push('evidence_source_invalid');
      if (!capture.conversationId) issues.push('conversation_id_missing');
      if (!capture.assetMetadata || typeof capture.assetMetadata !== 'object') issues.push('asset_metadata_missing');
      if (!prompt.trim()) issues.push('prompt_missing_or_empty');
      assetMetadataSidecars.push({
        objectKey: row.object.key,
        objectRef: objectRef(row.object.key),
        parentKey,
        targetKey,
        targetRef: objectRef(targetKey),
        targetExists: Boolean(target),
        schemaVersion: parsed.schemaVersion ?? null,
        assetIdPresent: Boolean(parsed.assetId),
        conversationIdPresent: Boolean(capture.conversationId),
        evidenceSource: capture.evidenceSource || null,
        assetMetadataPresent: Boolean(capture.assetMetadata && typeof capture.assetMetadata === 'object'),
        promptPresent: Boolean(prompt.trim()),
        promptSha256: prompt.trim() ? sha256(prompt.trim()) : null,
        issues,
        status: row.status
      });
      continue;
    }

    const parsed = row.parsed || {};
    const data = parsed.data;
    const kind = metadataKindFromKey(row.object.key);
    const d1Metadata = d1MetadataByKey.get(row.object.key);
    snapshots.push({
      objectKey: row.object.key,
      objectRef: objectRef(row.object.key),
      kind,
      schemaVersion: parsed.schemaVersion ?? null,
      updatedAt: parsed.updatedAt ?? null,
      contentHashPresent: Boolean(parsed.contentHash),
      dataType: Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data,
      recordCount: Array.isArray(data) ? data.length : data && typeof data === 'object' ? Object.keys(data).length : 0,
      topLevelFieldCoverage: collectTopLevelFieldCoverage(data),
      privateStringEvidence: collectPrivateStringEvidence(data, kind),
      d1Indexed: Boolean(d1Metadata),
      d1ContentHashMatches: d1Metadata
        ? Boolean(parsed.contentHash) && parsed.contentHash === d1Metadata.content_hash
        : null,
      bodySha256: row.bodySha256,
      bytesRead: row.bytesRead || 0,
      status: row.status,
      error: row.error
    });
  }

  const sidecarByTarget = new Map(sidecars.filter((row) => row.targetKey).map((row) => [row.targetKey, row]));
  const assetMetadataByTarget = new Map();
  for (const row of assetMetadataSidecars) {
    const current = assetMetadataByTarget.get(row.targetKey) || [];
    current.push(row);
    assetMetadataByTarget.set(row.targetKey, current);
  }
  const latestCanonicalSnapshot = [...canonicalSnapshots]
    .sort((a, b) => String(a.generated_at || '').localeCompare(String(b.generated_at || '')))
    .at(-1) || null;
  const latestSnapshotId = latestCanonicalSnapshot?.snapshot_id || null;
  const currentCanonicalAssets = canonicalAssets.filter((row) => row.snapshot_id === latestSnapshotId);
  const currentCanonicalStorage = canonicalStorage.filter((row) => row.snapshot_id === latestSnapshotId);
  const currentCanonicalPrompts = canonicalPrompts.filter((row) => row.snapshot_id === latestSnapshotId);
  const currentCanonicalGaps = canonicalGaps.filter((row) => row.snapshot_id === latestSnapshotId);
  const canonicalStorageByKey = new Map(currentCanonicalStorage.map((row) => [row.object_key, row]).filter(([key]) => key));
  const canonicalPromptById = new Map(currentCanonicalPrompts.map((row) => [row.prompt_ref_id, row]));
  const promptComparisons = sidecars.map((sidecar) => {
    const storage = canonicalStorageByKey.get(sidecar.targetKey);
    const decodedPromptRefs = parseJson(storage?.prompt_ref_ids_json || '[]', []);
    const promptRefIds = Array.isArray(decodedPromptRefs) ? decodedPromptRefs : [];
    const promptRefsOmitted = !Array.isArray(decodedPromptRefs) && Boolean(decodedPromptRefs?.omittedForD1SqlLimit);
    const promptRefs = promptRefIds.map((id) => canonicalPromptById.get(id)).filter(Boolean);
    const expectedHashes = new Set(promptRefs.flatMap((row) => [row.prompt_sha256, row.original_prompt_sha256]).filter(Boolean));
    const matches = Boolean(sidecar.rawPromptSha256) && expectedHashes.has(sidecar.rawPromptSha256);
    return {
      targetKey: sidecar.targetKey,
      targetRef: sidecar.targetRef,
      projected: Boolean(storage),
      promptRefsOmitted,
      linkedPromptRefs: promptRefs.length,
      expectedPromptHashes: expectedHashes.size,
      sidecarPromptMatchesCanonicalEvidence: expectedHashes.size > 0 ? matches : null,
      sidecarPromptSha256: sidecar.rawPromptSha256
    };
  });
  const comparablePrompts = promptComparisons.filter((row) => row.expectedPromptHashes > 0);
  const mediaAudit = media.map((object) => {
    const actualHash = hashByKey.get(object.key);
    const storedSha = object.customMetadata?.sha256 || null;
    const storedMediaType = object.customMetadata?.['media-type'] || null;
    const sidecar = sidecarByTarget.get(object.key);
    const assetMetadata = assetMetadataByTarget.get(object.key) || [];
    const issues = [];
    if (!object.contentType) issues.push('content_type_missing');
    if (!(Number(object.size) > 0)) issues.push('size_missing_or_zero');
    if (!storedSha) issues.push('stored_sha256_missing');
    else if (actualHash?.sha256 && storedSha !== actualHash.sha256) issues.push('stored_sha256_mismatch');
    if (!object.customMetadata?.['asset-id']) issues.push('asset_id_missing');
    if (!object.customMetadata?.['source-url-hash']) issues.push('source_url_hash_missing');
    if (!storedMediaType) issues.push('stored_media_type_missing');
    else if (object.mediaType !== 'unknown-media' && storedMediaType !== object.mediaType) issues.push('stored_media_type_mismatch');
    if (!object.customMetadata?.['extension-version']) issues.push('extension_version_missing');
    if (!object.customMetadata?.['captured-at']) issues.push('captured_at_missing');
    if (!sidecar?.promptPresent) issues.push('prompt_sidecar_missing');
    if (!assetMetadata.some((row) => row.status === 'ok' && row.issues.length === 0)) {
      issues.push('asset_metadata_v2_missing_or_invalid');
    }
    const d1Row = d1ByKey.get(object.key);
    if (object.pathClass === 'canonical-media' && !d1Row) issues.push('d1_index_missing');
    if (d1Row?.content_sha256 && actualHash?.sha256 && d1Row.content_sha256 !== actualHash.sha256) {
      issues.push('d1_hash_mismatch');
    }
    return {
      objectKey: object.key,
      objectRef: objectRef(object.key),
      pathClass: object.pathClass,
      logicalId: deriveLogicalId(object),
      mediaType: object.mediaType,
      size: object.size,
      contentSha256: actualHash?.sha256 || null,
      promptSha256: sidecar?.promptSha256 || null,
      assetMetadataV2Count: assetMetadata.length,
      customMetadataFields: Object.keys(object.customMetadata || {}).sort(),
      issues
    };
  });

  const exactGroups = [...groupBy(mediaAudit, (row) => row.contentSha256).values()].filter((group) => group.length > 1);
  const exactDetails = exactGroups.map((items) => ({
    sha256: items[0].contentSha256,
    classification: classifyExactDuplicate(items.map((item) => mediaByKey.get(item.objectKey))),
    objectCount: items.length,
    excessCopies: items.length - 1,
    bytesPerObject: items[0].size,
    excessBytes: Number(items[0].size || 0) * (items.length - 1),
    sizeMismatch: new Set(items.map((item) => item.size)).size > 1,
    pathClasses: [...new Set(items.map((item) => item.pathClass))].sort(),
    logicalIds: [...new Set(items.map((item) => item.logicalId).filter(Boolean))].sort(),
    objectKeys: items.map((item) => item.objectKey).sort(),
    objectRefs: items.map((item) => item.objectRef).sort()
  }));

  const logicalGroups = [...groupBy(mediaAudit, (row) => row.logicalId).values()].filter((group) => group.length > 1);
  const logicalDetails = logicalGroups.map((items) => ({
    logicalId: items[0].logicalId,
    objectCount: items.length,
    distinctContentHashes: new Set(items.map((item) => item.contentSha256).filter(Boolean)).size,
    classification: new Set(items.map((item) => item.contentSha256).filter(Boolean)).size > 1
      ? 'logical_identity_multiple_payloads'
      : 'logical_identity_exact_aliases',
    pathClasses: [...new Set(items.map((item) => item.pathClass))].sort(),
    objectKeys: items.map((item) => item.objectKey).sort(),
    objectRefs: items.map((item) => item.objectRef).sort()
  }));

  const promptGroups = [...groupBy(mediaAudit, (row) => row.promptSha256).values()].filter((group) => group.length > 1);
  const promptVariantDetails = promptGroups.map((items) => ({
    promptSha256: items[0].promptSha256,
    mediaCount: items.length,
    distinctContentHashes: new Set(items.map((item) => item.contentSha256).filter(Boolean)).size,
    classification: new Set(items.map((item) => item.contentSha256).filter(Boolean)).size > 1
      ? 'prompt_reuse_or_generation_variants_not_duplicates'
      : 'same_prompt_same_bytes',
    objectKeys: items.map((item) => item.objectKey).sort(),
    objectRefs: items.map((item) => item.objectRef).sort()
  }));

  const snapshotSummary = snapshots.map(({ objectKey, ...row }) => row);
  const sidecarSummary = {
    generatedAt: new Date().toISOString(),
    total: sidecars.length,
    parseFailures: sidecars.filter((row) => row.status !== 'ok').length,
    fieldSets: countBy(sidecars, (row) => row.fieldNames.join(',')),
    withPrompt: sidecars.filter((row) => row.promptPresent).length,
    distinctNormalizedPrompts: new Set(sidecars.map((row) => row.promptSha256).filter(Boolean)).size,
    withDeclaredMediaKey: sidecars.filter((row) => !row.issues.includes('media_key_missing')).length,
    exactParentLinks: sidecars.filter((row) => !row.issues.includes('media_key_missing') && !row.issues.includes('media_key_parent_mismatch')).length,
    missingMediaTargets: sidecars.filter((row) => row.issues.includes('target_media_missing')).length,
    withAssetId: sidecars.filter((row) => row.assetIdPresent).length,
    withUploadedAt: sidecars.filter((row) => row.uploadedAtPresent).length,
    issueCounts: countBy(sidecars.flatMap((row) => row.issues.map((issue) => ({ issue }))), (row) => row.issue)
  };

  const assetMetadataSummary = {
    generatedAt: new Date().toISOString(),
    total: assetMetadataSidecars.length,
    parseFailures: assetMetadataSidecars.filter((row) => row.status !== 'ok').length,
    valid: assetMetadataSidecars.filter((row) => row.status === 'ok' && row.issues.length === 0).length,
    exactParentLinks: assetMetadataSidecars.filter((row) => row.targetKey === row.parentKey).length,
    missingMediaTargets: assetMetadataSidecars.filter((row) => !row.targetExists).length,
    withAuthoritativePrompt: assetMetadataSidecars.filter((row) => row.promptPresent).length,
    withConversationId: assetMetadataSidecars.filter((row) => row.conversationIdPresent).length,
    withRawAssetMetadata: assetMetadataSidecars.filter((row) => row.assetMetadataPresent).length,
    issueCounts: countBy(
      assetMetadataSidecars.flatMap((row) => row.issues.map((issue) => ({ issue }))),
      (row) => row.issue
    )
  };

  const contractFields = [
    'content-type',
    'size',
    'sha256',
    'asset-id',
    'source-url-hash',
    'media-type',
    'extension-version',
    'captured-at'
  ];
  const byPathClass = {};
  for (const [pathClass, rows] of groupBy(media, (object) => object.pathClass)) {
    byPathClass[pathClass] = {
      mediaObjects: rows.length,
      withPromptSidecar: rows.filter((row) => sidecarByTarget.get(row.key)?.promptPresent).length,
      withValidAssetMetadataV2: rows.filter((row) =>
        (assetMetadataByTarget.get(row.key) || []).some((sidecar) => sidecar.status === 'ok' && sidecar.issues.length === 0)
      ).length,
      fieldCoverage: Object.fromEntries(contractFields.map((field) => [field, mediaFieldCoverage(rows, field)]))
    };
  }

  const integritySummary = {
    generatedAt: new Date().toISOString(),
    mediaObjects: media.length,
    hashRows: hashRows.length,
    missingOrFailedHashRows: media.filter((object) => hashByKey.get(object.key)?.status !== 'ok').length,
    storedSha256Present: media.filter((object) => Boolean(object.customMetadata?.sha256)).length,
    storedSha256Mismatch: mediaAudit.filter((row) => row.issues.includes('stored_sha256_mismatch')).length,
    storedMediaTypeMismatch: mediaAudit.filter((row) => row.issues.includes('stored_media_type_mismatch')).length,
    d1Rows: d1Rows.length,
    d1RowsWithMissingR2Object: d1Rows.filter((row) => row.canonical_object_key && !objectsByKey.has(row.canonical_object_key)).length,
    d1RowsPointingToNonMediaObject: d1Rows.filter((row) => row.canonical_object_key && objectsByKey.has(row.canonical_object_key) && !mediaByKey.has(row.canonical_object_key)).length,
    d1HashMismatch: mediaAudit.filter((row) => row.issues.includes('d1_hash_mismatch')).length,
    canonicalMediaMissingD1Index: mediaAudit.filter((row) => row.issues.includes('d1_index_missing')).length,
    d1DuplicateContentHashGroups: [...groupBy(d1Rows, (row) => row.content_sha256).values()].filter((group) => group.length > 1).length,
    zeroByteMedia: media.filter((object) => !(Number(object.size) > 0)).length,
    headFailures: media.filter((object) => object.headStatus !== 'ok').length,
    issueCounts: countBy(mediaAudit.flatMap((row) => row.issues.map((issue) => ({ issue }))), (row) => row.issue),
    byPathClass
  };

  const duplicateSummary = {
    generatedAt: new Date().toISOString(),
    exactByteGroups: exactDetails.length,
    objectsInExactByteGroups: sum(exactDetails, (group) => group.objectCount),
    excessExactCopies: sum(exactDetails, (group) => group.excessCopies),
    excessExactBytes: sum(exactDetails, (group) => group.excessBytes),
    exactClassificationCounts: countBy(exactDetails, (group) => group.classification),
    exactClassificationBytes: Object.fromEntries(
      [...groupBy(exactDetails, (group) => group.classification)].map(([classification, groups]) => [
        classification,
        sum(groups, (group) => group.excessBytes)
      ])
    ),
    sizeMismatchGroups: exactDetails.filter((group) => group.sizeMismatch).length,
    logicalIdentityGroups: logicalDetails.length,
    logicalIdentityClassificationCounts: countBy(logicalDetails, (group) => group.classification),
    promptReuseGroups: promptVariantDetails.length,
    promptReuseClassificationCounts: countBy(promptVariantDetails, (group) => group.classification),
    deletionAuthorized: false
  };

  const projectedKeys = new Set(currentCanonicalStorage.map((row) => row.object_key).filter(Boolean));
  const canonicalIndexSummary = {
    generatedAt: new Date().toISOString(),
    snapshot: latestCanonicalSnapshot ? {
      snapshotId: latestCanonicalSnapshot.snapshot_id,
      generatedAt: latestCanonicalSnapshot.generated_at,
      projectedAt: latestCanonicalSnapshot.projected_at,
      schemaVersion: latestCanonicalSnapshot.schema_version,
      logicalAssetCount: latestCanonicalSnapshot.logical_asset_count,
      storageObjectCount: latestCanonicalSnapshot.storage_object_count,
      promptRefCount: latestCanonicalSnapshot.prompt_ref_count,
      gapRecordCount: latestCanonicalSnapshot.gap_record_count,
      classificationCounts: parseJson(latestCanonicalSnapshot.classification_counts_json || '{}', {}),
      gapCounts: parseJson(latestCanonicalSnapshot.gap_counts_json || '{}', {})
    } : null,
    projectionRows: {
      assets: currentCanonicalAssets.length,
      storageObjects: currentCanonicalStorage.length,
      promptRefs: currentCanonicalPrompts.length,
      gaps: currentCanonicalGaps.length
    },
    r2Coverage: {
      projectedStorageMissingFromCurrentR2: currentCanonicalStorage.filter((row) => row.object_key && !objectsByKey.has(row.object_key)).length,
      currentMediaNotInProjection: media.filter((object) => !projectedKeys.has(object.key)).length,
      currentMediaNotInProjectionByPathClass: countBy(media.filter((object) => !projectedKeys.has(object.key)), (object) => object.pathClass)
    },
    promptRefs: {
      bySource: countBy(currentCanonicalPrompts, (row) => row.source),
      withPromptHash: currentCanonicalPrompts.filter((row) => Boolean(row.prompt_sha256)).length,
      withOriginalPromptHash: currentCanonicalPrompts.filter((row) => Boolean(row.original_prompt_sha256)).length,
      linkedToAssets: currentCanonicalPrompts.filter((row) => Number(row.linked_asset_count) > 0).length
    },
    gaps: {
      byType: countBy(currentCanonicalGaps, (row) => row.type),
      byStatus: countBy(currentCanonicalGaps, (row) => row.status),
      bySeverity: countBy(currentCanonicalGaps, (row) => row.severity),
      requiringHumanReview: currentCanonicalGaps.filter((row) => Number(row.requires_human_review) === 1).length,
      requiringLiveGrok: currentCanonicalGaps.filter((row) => Number(row.requires_live_grok) === 1).length,
      requiringCloudWrite: currentCanonicalGaps.filter((row) => Number(row.requires_cloud_write) === 1).length
    }
  };

  const promptAccuracySummary = {
    sidecars: sidecars.length,
    sidecarsInCanonicalProjection: promptComparisons.filter((row) => row.projected).length,
    sidecarsWithCanonicalPromptEvidence: comparablePrompts.length,
    sidecarsMatchingCanonicalPromptEvidence: comparablePrompts.filter((row) => row.sidecarPromptMatchesCanonicalEvidence).length,
    sidecarsMismatchingCanonicalPromptEvidence: comparablePrompts.filter((row) => !row.sidecarPromptMatchesCanonicalEvidence).length,
    sidecarsWithoutCanonicalPromptEvidence: promptComparisons.filter((row) => row.expectedPromptHashes === 0).length,
    sidecarsWithPromptRefsOmittedByProjectionLimit: promptComparisons.filter((row) => row.promptRefsOmitted).length,
    comparisonMethod: 'SHA-256 of the exact stored sidecar prompt compared with prompt and original-prompt SHA-256 values linked by the canonical storage projection'
  };

  const metadataContractSummary = {
    generatedAt: new Date().toISOString(),
    bucket,
    productionPrefix,
    mediaObjects: media.length,
    promptSidecars: sidecarSummary,
    assetMetadataV2: assetMetadataSummary,
    promptAccuracyAgainstCanonicalEvidence: promptAccuracySummary,
    metadataSnapshots: {
      total: snapshots.length,
      parseFailures: snapshots.filter((row) => row.status !== 'ok').length,
      byKind: countBy(snapshots, (row) => row.kind),
      recordsByKind: Object.fromEntries(
        [...groupBy(snapshots, (row) => row.kind)].map(([kind, rows]) => [kind, sum(rows, (row) => row.recordCount)])
      ),
      snapshots: snapshotSummary
    },
    mediaFieldCoverage: integritySummary.byPathClass,
    requiredButNotPersistedPerMedia: [
      'original versus effective prompt distinction',
      'Grok post ID',
      'Grok conversation ID',
      'Grok response ID',
      'model and generation settings',
      'dimensions',
      'duration',
      'audio presence and codecs',
      'created and saved timestamps',
      'parent, reference, and variant relationships',
      'metadata schema version',
      'evidence source'
    ],
    rawPromptsWrittenToAuditArtifacts: false
  };

  const browserAuditSeed = {
    generatedAt: new Date().toISOString(),
    r2LogicalAssetIdHashes: [...new Set(mediaAudit.map((row) => row.logicalId).filter(Boolean).map((id) => sha256(id)))].sort(),
    r2CanonicalAssetIdHashes: [...new Set(mediaAudit
      .filter((row) => row.pathClass === 'canonical-media')
      .map((row) => row.logicalId)
      .filter(Boolean)
      .map((id) => sha256(id)))].sort(),
    sidecarPromptByAssetIdHash: mediaAudit
      .filter((row) => row.logicalId && sidecarByTarget.get(row.objectKey)?.rawPromptSha256)
      .map((row) => ({
        assetIdHash: sha256(row.logicalId),
        promptSha256: sidecarByTarget.get(row.objectKey).rawPromptSha256
      }))
  };

  await writeJson(path.join(auditRoot, 'inventory', 'prompt-sidecar-summary.json'), sidecarSummary);
  await writeJson(path.join(auditRoot, 'inventory', 'asset-metadata-v2-summary.json'), assetMetadataSummary);
  await writeJson(path.join(auditRoot, 'inventory', 'metadata-contract-summary.json'), metadataContractSummary);
  await writeJson(path.join(auditRoot, 'reconciliations', 'r2-integrity-summary.json'), integritySummary);
  await writeJson(path.join(auditRoot, 'reconciliations', 'duplicate-classification-summary.json'), duplicateSummary);
  await writeJson(path.join(auditRoot, 'reconciliations', 'canonical-index-summary.json'), canonicalIndexSummary);
  await writeJsonl(path.join(auditRoot, 'private', 'prompt-sidecar-audit.jsonl'), sidecars);
  await writeJsonl(path.join(auditRoot, 'private', 'asset-metadata-v2-audit.jsonl'), assetMetadataSidecars);
  await writeJsonl(path.join(auditRoot, 'private', 'media-contract-audit.jsonl'), mediaAudit);
  await writeJsonl(path.join(auditRoot, 'private', 'exact-duplicate-groups.jsonl'), exactDetails);
  await writeJsonl(path.join(auditRoot, 'private', 'logical-identity-groups.jsonl'), logicalDetails);
  await writeJsonl(path.join(auditRoot, 'private', 'prompt-variant-groups.jsonl'), promptVariantDetails);
  await writeJsonl(path.join(auditRoot, 'private', 'prompt-sidecar-canonical-comparison.jsonl'), promptComparisons);
  await writeJson(path.join(auditRoot, 'private', 'browser-audit-seed.json'), browserAuditSeed);
  console.log(`analysis complete: ${media.length} media, ${sidecars.length} prompt sidecars, ${assetMetadataSidecars.length} asset metadata sidecars, ${exactDetails.length} exact-byte groups`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
