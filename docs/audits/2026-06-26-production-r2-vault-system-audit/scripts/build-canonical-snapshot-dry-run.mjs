#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const auditRoot = path.resolve(scriptsDir, '..');
const privateDir = path.join(auditRoot, 'private');
const manifestPath = path.join(auditRoot, 'manifest.json');

const SNAPSHOT_SCHEMA_VERSION = 'r2-vault-canonical-snapshot/v1';
const DRY_RUN_KIND = 'local_dry_run';
const PRIVATE_DIR_SEGMENT = `${path.sep}private${path.sep}`;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;

const sourceArtifactPaths = [
  'manifest.json',
  'reconciliations/local-canonical-index-summary.json',
  'reconciliations/canonical-gap-report.json',
  'inventory/grok-assets-current-summary.json',
  'logs/grok-assets-active-tab-capture.json',
  'private/local-canonical-index.jsonl',
  'private/grok-assets-current-inventory.jsonl',
  'private/grok-conversation-responses-current.jsonl',
  'private/grok-media-posts-current.jsonl',
  'inventory/r2-objects.jsonl',
  'inventory/r2-media-hashes.jsonl',
  'inventory/metadata-references.json',
  'inventory/local-media-summary.json',
  'inventory/d1-r2-dedupe-index.jsonl',
  'inventory/worker-vault-assets.jsonl'
];

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

function shortHash(value, length = 16) {
  return hashString(value).slice(0, length);
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

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== '').map(String))].sort();
}

function extractUuids(value) {
  return uniqueSorted([...String(value || '').matchAll(UUID_RE)].map((match) => match[0].toLowerCase()));
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

async function fileSha256(relPath) {
  const buffer = await fs.readFile(auditPath(relPath));
  return createHash('sha256').update(buffer).digest('hex');
}

async function artifactDescriptor(relPath) {
  const filePath = auditPath(relPath);
  const stat = await fs.stat(filePath);
  const descriptor = {
    path: relPath,
    private: isPrivateAuditPath(filePath),
    bytes: stat.size,
    sha256: await sourceArtifactSha256(relPath),
    hashScope: relPath === 'manifest.json' ? 'normalized_without_dry_run_bookkeeping' : 'file_bytes'
  };
  if (relPath.endsWith('.jsonl')) descriptor.rowCount = (await readJsonl(relPath)).length;
  return descriptor;
}

async function sourceArtifactSha256(relPath) {
  if (relPath !== 'manifest.json') return fileSha256(relPath);
  const manifest = await readJson(relPath);
  return hashString(stableStringify(normalizeManifestForSourceHash(manifest)));
}

function normalizeManifestForSourceHash(manifest) {
  const clone = JSON.parse(JSON.stringify(manifest));
  delete clone.currentCanonicalSnapshotDryRun;
  delete clone.evidenceIndex;
  if (clone.subsystems) delete clone.subsystems.canonicalSnapshotDryRun;
  return clone;
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

function promptRecordId(parts) {
  return `prompt_${shortHash(parts.join('|'), 24)}`;
}

function metadataFromPost(post) {
  return {
    createTime: post.createTime || null,
    mediaType: post.mediaType || null,
    mimeType: post.mimeType || null,
    mode: post.mode || null,
    modelName: post.modelName || null,
    resolution: post.resolution || null,
    resolutionName: post.resolutionName || null,
    videoDuration: post.videoDuration || null,
    isV2: Boolean(post.isV2),
    isRootUserUploaded: Boolean(post.isRootUserUploaded),
    moderated: Boolean(post.moderated),
    rRated: Boolean(post.rRated)
  };
}

function mediaEvidenceFromPost(post) {
  return {
    mediaUrlUuids: extractUuids(post.mediaUrl),
    thumbnailImageUrlUuids: extractUuids(post.thumbnailImageUrl),
    imageUuids: extractUuids(JSON.stringify(post.images || [])),
    videoUuids: extractUuids(JSON.stringify(post.videos || [])),
    inputMediaUuids: extractUuids(JSON.stringify(post.inputMediaItems || [])),
    childPostIds: uniqueSorted((post.childPosts || []).map((child) => child?.id))
  };
}

function buildPromptArchive({ mediaPostRows, conversationRows }) {
  const records = [];
  for (const row of mediaPostRows) {
    if (row.status !== 200 || !row.parsed?.post) continue;
    const post = row.parsed.post;
    const prompt = typeof post.prompt === 'string' && post.prompt.length ? post.prompt : null;
    const originalPrompt = typeof post.originalPrompt === 'string' && post.originalPrompt.length ? post.originalPrompt : null;
    if (!prompt && !originalPrompt) continue;
    records.push({
      promptRefId: promptRecordId(['media-post', row.assetId, post.id, hashString(prompt), hashString(originalPrompt)]),
      source: 'grok_media_post',
      capturedAt: row.capturedAt || null,
      grokAssetId: row.assetId || null,
      grokPostId: post.id || null,
      grokOriginalPostId: post.originalPostId || null,
      prompt,
      originalPrompt,
      promptSha256: prompt ? hashString(prompt) : null,
      originalPromptSha256: originalPrompt ? hashString(originalPrompt) : null,
      metadata: metadataFromPost(post),
      mediaEvidence: mediaEvidenceFromPost(post)
    });
  }

  for (const row of conversationRows) {
    if (row.status !== 200 || !Array.isArray(row.parsed?.responses)) continue;
    for (const response of row.parsed.responses) {
      if (response.sender !== 'human' || typeof response.message !== 'string' || !response.message.length) continue;
      records.push({
        promptRefId: promptRecordId(['conversation', row.sourceConversationId, response.responseId, hashString(response.message)]),
        source: 'grok_conversation_response',
        capturedAt: row.capturedAt || null,
        sourceConversationId: row.sourceConversationId || null,
        responseId: response.responseId || null,
        prompt: response.message,
        originalPrompt: null,
        promptSha256: hashString(response.message),
        originalPromptSha256: null,
        metadata: {
          createTime: response.createTime || null,
          model: response.model || null,
          queryType: response.queryType || null,
          mediaTypes: Array.isArray(response.mediaTypes) ? response.mediaTypes : [],
          shared: Boolean(response.shared),
          manual: Boolean(response.manual),
          partial: Boolean(response.partial)
        },
        mediaEvidence: {
          generatedImageUrlUuids: extractUuids(JSON.stringify(response.generatedImageUrls || [])),
          fileUriUuids: extractUuids(JSON.stringify(response.fileUris || [])),
          imageAttachmentUuids: extractUuids(JSON.stringify(response.imageAttachments || []))
        }
      });
    }
  }
  return records.sort((left, right) => left.promptRefId.localeCompare(right.promptRefId));
}

function buildPromptIndexes(promptArchive) {
  const byPostId = new Map();
  const byAssetId = new Map();
  const byConversationId = new Map();
  for (const record of promptArchive) {
    if (record.grokPostId) pushMap(byPostId, record.grokPostId, record.promptRefId);
    if (record.grokOriginalPostId) pushMap(byPostId, record.grokOriginalPostId, record.promptRefId);
    if (record.grokAssetId) pushMap(byAssetId, record.grokAssetId, record.promptRefId);
    if (record.sourceConversationId) pushMap(byConversationId, record.sourceConversationId, record.promptRefId);
  }
  return { byPostId, byAssetId, byConversationId };
}

function pushMap(map, key, value) {
  const current = map.get(String(key)) || [];
  current.push(value);
  map.set(String(key), current);
}

function promptRefsForStorageObject(row, promptIndexes) {
  const refs = [];
  for (const postId of row.evidence?.grokPostIds || []) refs.push(...(promptIndexes.byPostId.get(String(postId)) || []));
  for (const postId of row.evidence?.grokOriginalPostIds || []) refs.push(...(promptIndexes.byPostId.get(String(postId)) || []));
  for (const assetId of row.evidence?.grokApiAssetIds || []) refs.push(...(promptIndexes.byAssetId.get(String(assetId)) || []));
  for (const conversationId of row.evidence?.grokApiSourceConversationIds || []) {
    refs.push(...(promptIndexes.byConversationId.get(String(conversationId)) || []));
  }
  return uniqueSorted(refs);
}

function logicalIdentityFor(row) {
  const postIds = uniqueSorted(row.evidence?.grokPostIds || []);
  if (postIds.length === 1) return { type: 'grokPostId', value: postIds[0] };
  if (postIds.length > 1) return { type: 'grokPostSet', value: postIds.join('|') };
  if (row.retainedCanonicalKey) return { type: 'retainedStorageObjectKey', value: row.retainedCanonicalKey };
  return { type: 'storageObjectKey', value: row.objectKey };
}

function logicalAssetId(identity) {
  return `asset_${shortHash(`${identity.type}:${identity.value}`, 32)}`;
}

function buildStorageObjects(indexRows, promptIndexes) {
  return indexRows
    .map((row) => {
      const promptRefIds = promptRefsForStorageObject(row, promptIndexes);
      return {
        storageObjectId: `storage_${row.objectKeyHash}`,
        objectKey: row.objectKey,
        objectKeyHash: row.objectKeyHash,
        userIdHash: row.userIdHash,
        status: row.status,
        reason: row.reason,
        retainedCanonicalKey: row.retainedCanonicalKey,
        retainedCanonicalKeyHash: row.retainedCanonicalKeyHash,
        duplicateGroupId: row.duplicateGroupId,
        identityLinksToRetained: row.identityLinksToRetained,
        promptRefIds,
        evidence: {
          pathClass: row.evidence.pathClass,
          mediaType: row.evidence.mediaType,
          size: row.evidence.size,
          sha256: row.evidence.sha256,
          mediaUuid: row.evidence.mediaUuid,
          grokPostIds: uniqueSorted(row.evidence.grokPostIds || []),
          grokOriginalPostIds: uniqueSorted(row.evidence.grokOriginalPostIds || []),
          sourceUrlHashes: uniqueSorted(row.evidence.sourceUrlHashes || []),
          promptSidecarKeys: uniqueSorted(row.evidence.promptSidecarKeys || []),
          assetId: row.evidence.assetId || null,
          d1Covered: Boolean(row.evidence.d1Covered),
          workerCovered: Boolean(row.evidence.workerCovered),
          grokApiCovered: Boolean(row.evidence.grokApiCovered),
          grokApiAssetIds: uniqueSorted(row.evidence.grokApiAssetIds || []),
          grokApiResponseIds: uniqueSorted(row.evidence.grokApiResponseIds || []),
          grokApiSourceConversationIds: uniqueSorted(row.evidence.grokApiSourceConversationIds || []),
          grokApiRootAssetIds: uniqueSorted(row.evidence.grokApiRootAssetIds || []),
          grokApiPromptMessageHashes: uniqueSorted(row.evidence.grokApiPromptMessageHashes || []),
          grokApiPromptMessageCount: row.evidence.grokApiPromptMessageCount || 0,
          grokMediaPostPromptHashes: uniqueSorted(row.evidence.grokMediaPostPromptHashes || []),
          grokMediaPostOriginalPromptHashes: uniqueSorted(row.evidence.grokMediaPostOriginalPromptHashes || []),
          grokMediaPostPromptCount: row.evidence.grokMediaPostPromptCount || 0,
          grokMediaPostOriginalPromptCount: row.evidence.grokMediaPostOriginalPromptCount || 0,
          grokMediaPostModelNames: uniqueSorted(row.evidence.grokMediaPostModelNames || []),
          grokMediaPostMediaTypes: uniqueSorted(row.evidence.grokMediaPostMediaTypes || []),
          uploadStatus: row.evidence.uploadStatus || null,
          verificationStatus: row.evidence.verificationStatus || null,
          hashStatus: row.evidence.hashStatus || null
        }
      };
    })
    .sort((left, right) => left.objectKey.localeCompare(right.objectKey));
}

function buildLogicalAssets(indexRows, storageObjects) {
  const storageByKey = new Map(storageObjects.map((object) => [object.objectKey, object]));
  const groups = new Map();
  for (const row of indexRows) {
    const identity = logicalIdentityFor(row);
    const assetId = logicalAssetId(identity);
    const current = groups.get(assetId) || {
      canonicalAssetId: assetId,
      identity: {
        type: identity.type,
        value: identity.value,
        valueHash: shortHash(identity.value)
      },
      statusCounts: {},
      reasons: {},
      storageObjectKeys: [],
      storageObjectKeyHashes: [],
      canonicalStorageObjectKey: null,
      canonicalStorageObjectKeyHash: null,
      duplicateGroupIds: [],
      mediaUuids: [],
      grokPostIds: [],
      promptRefIds: [],
      reviewRequired: false,
      gapFlags: []
    };
    const storage = storageByKey.get(row.objectKey);
    current.statusCounts[row.status] = (current.statusCounts[row.status] || 0) + 1;
    current.reasons[row.reason] = (current.reasons[row.reason] || 0) + 1;
    current.storageObjectKeys.push(row.objectKey);
    current.storageObjectKeyHashes.push(row.objectKeyHash);
    if (!current.canonicalStorageObjectKey && row.retainedCanonicalKey) {
      current.canonicalStorageObjectKey = row.retainedCanonicalKey;
      current.canonicalStorageObjectKeyHash = row.retainedCanonicalKeyHash;
    }
    if (row.duplicateGroupId) current.duplicateGroupIds.push(row.duplicateGroupId);
    if (row.evidence?.mediaUuid) current.mediaUuids.push(row.evidence.mediaUuid);
    current.grokPostIds.push(...(row.evidence?.grokPostIds || []));
    current.promptRefIds.push(...(storage?.promptRefIds || []));
    if (row.status === 'needs_human_review' || row.status === 'orphan_candidate') current.reviewRequired = true;
    if (!row.evidence?.grokApiCovered) current.gapFlags.push('not_linked_to_current_grok_asset_api');
    if (!row.evidence?.d1Covered && row.evidence?.pathClass === 'canonical-media') current.gapFlags.push('canonical_media_missing_d1');
    if (!row.evidence?.workerCovered && row.evidence?.pathClass === 'canonical-media') current.gapFlags.push('canonical_media_missing_worker');
    if (!storage?.promptRefIds?.length) current.gapFlags.push('no_prompt_ref_linked');
    groups.set(assetId, current);
  }

  return [...groups.values()]
    .map((asset) => ({
      ...asset,
      storageObjectKeys: uniqueSorted(asset.storageObjectKeys),
      storageObjectKeyHashes: uniqueSorted(asset.storageObjectKeyHashes),
      duplicateGroupIds: uniqueSorted(asset.duplicateGroupIds),
      mediaUuids: uniqueSorted(asset.mediaUuids),
      grokPostIds: uniqueSorted(asset.grokPostIds),
      promptRefIds: uniqueSorted(asset.promptRefIds),
      gapFlags: uniqueSorted(asset.gapFlags),
      statusCounts: Object.fromEntries(Object.entries(asset.statusCounts).sort(([left], [right]) => left.localeCompare(right))),
      reasons: Object.fromEntries(Object.entries(asset.reasons).sort(([left], [right]) => left.localeCompare(right)))
    }))
    .sort((left, right) => left.canonicalAssetId.localeCompare(right.canonicalAssetId));
}

function buildGapRecords({ indexRows, mediaPostRows, conversationRows }) {
  const reviewRows = indexRows
    .filter((row) => row.status === 'needs_human_review' || row.status === 'orphan_candidate')
    .map((row) => ({
      type: row.status,
      objectKey: row.objectKey,
      objectKeyHash: row.objectKeyHash,
      reason: row.reason,
      pathClass: row.evidence?.pathClass || null,
      sha256: row.evidence?.sha256 || null,
      duplicateGroupId: row.duplicateGroupId || null,
      retainedCanonicalKeyHash: row.retainedCanonicalKeyHash || null
    }));
  const mediaPostGaps = mediaPostRows
    .filter((row) => row.status !== 200)
    .map((row) => ({
      type: 'grok_media_post_response_gap',
      assetId: row.assetId || null,
      status: row.status,
      capturedAt: row.capturedAt || null,
      parseError: row.parseError || null
    }));
  const conversationGaps = conversationRows
    .filter((row) => row.status !== 200)
    .map((row) => ({
      type: 'grok_conversation_response_gap',
      sourceConversationId: row.sourceConversationId || null,
      status: row.status,
      capturedAt: row.capturedAt || null,
      parseError: row.parseError || null
    }));
  return [...reviewRows, ...mediaPostGaps, ...conversationGaps].sort((left, right) => {
    const leftKey = left.objectKey || left.assetId || left.sourceConversationId || '';
    const rightKey = right.objectKey || right.assetId || right.sourceConversationId || '';
    return left.type.localeCompare(right.type) || leftKey.localeCompare(rightKey);
  });
}

function canonicalSnapshotSchema() {
  return {
    schemaId: SNAPSHOT_SCHEMA_VERSION,
    schemaKind: 'append_only_r2_json_canonical_snapshot',
    productionWritePolicy: 'schema_and_local_dry_run_only_until_explicit_write_approval',
    requiredTopLevelFields: [
      'schemaVersion',
      'snapshotKind',
      'generatedAt',
      'productionWrites',
      'sourceBaseline',
      'sourceArtifacts',
      'sourceCounts',
      'classificationCounts',
      'gapCounts',
      'validationRules',
      'logicalAssets',
      'storageObjects',
      'promptArchive',
      'gapRecords',
      'approvalGate'
    ],
    recordContracts: {
      logicalAssets: {
        identity: 'preferred Grok post identity when available, otherwise retained storage key identity for review',
        storageObjectKeys: 'exact private storage keys in raw snapshot only',
        promptRefIds: 'links to full prompt records inside this snapshot',
        gapFlags: 'machine-readable reasons this logical asset is not yet clean'
      },
      storageObjects: {
        objectKey: 'exact private R2 object key in raw snapshot only',
        status: 'canonical, date_folder_mapped, alternate_duplicate, needs_human_review, orphan_candidate, metadata_only_or_sidecar, or invalid_or_system',
        evidence: 'R2, D1, Worker, Grok, metadata, hash, and local evidence used to classify the object'
      },
      promptArchive: {
        prompt: 'full prompt body allowed only in ignored local dry-run payload or approved R2 data plane',
        metadata: 'selected stable Grok metadata fields; signed/cookie-bearing URLs are not stored verbatim',
        mediaEvidence: 'UUID evidence and hashes rather than signed media URLs'
      },
      gapRecords: {
        reviewRows: 'needs_human_review and orphan_candidate storage objects',
        grokGaps: 'Grok media-post and conversation response gaps carried forward explicitly'
      }
    },
    validationRules: [
      'productionWrites must be false for local dry run',
      'storageObjects length must equal R2 media object count',
      'classification counts must match local-canonical-index-summary.json',
      'gap counts must match canonical-gap-report.json',
      'source artifact SHA-256 values must be recorded',
      'raw payload must be written under docs/audits/**/private/',
      'committed summaries must not include raw prompt bodies, signed URLs, cookies, bearer tokens, or exact private IDs'
    ]
  };
}

function buildApprovalGate({ validation }) {
  return {
    nextAllowedPhase: 'append_only_r2_json_snapshot_write',
    requiresExplicitUserApproval: true,
    approvalMustName: [
      'target R2 bucket and key prefix',
      'exact snapshot object key',
      'payload sha256',
      'stable content hash',
      'source baseline commit',
      'rollback/readback verification plan'
    ],
    stillForbiddenWithoutSeparateApproval: [
      'D1 writes',
      'Worker state writes',
      'Grok actions',
      'object moves',
      'object deletes',
      'repair route calls',
      'sync route calls',
      'physical duplicate cleanup'
    ],
    dryRunValid: validation.ok
  };
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

function validateSnapshot({ snapshot, localSummary, gapReport, manifest }) {
  const errors = [];
  const warnings = [];
  if (snapshot.productionWrites !== false) errors.push('snapshot.productionWrites must be false');
  if (snapshot.snapshotKind !== DRY_RUN_KIND) errors.push(`snapshot.snapshotKind must be ${DRY_RUN_KIND}`);
  if (snapshot.storageObjects.length !== localSummary.sourceCounts.r2MediaObjects) {
    errors.push(`storageObjects length ${snapshot.storageObjects.length} does not match R2 media count ${localSummary.sourceCounts.r2MediaObjects}`);
  }
  if (snapshot.sourceCounts.r2MediaObjects !== manifest.currentCanonicalBaseline?.counts?.r2MediaObjects) {
    errors.push('manifest baseline R2 media count does not match snapshot source count');
  }
  if (JSON.stringify(snapshot.classificationCounts) !== JSON.stringify(localSummary.classification.statusCounts)) {
    errors.push('classificationCounts do not match local-canonical-index-summary.json');
  }
  for (const [key, value] of Object.entries(gapReport.gapCounts || {})) {
    if (snapshot.gapCounts[key] !== value) errors.push(`gapCounts.${key} does not match canonical-gap-report.json`);
  }
  if (!snapshot.promptArchive.length) warnings.push('promptArchive is empty');
  const payloadText = stableStringify(snapshot);
  for (const forbidden of ['X-Amz-', 'signature=', 'Bearer ']) {
    if (payloadText.includes(forbidden)) errors.push(`raw snapshot contains forbidden signed/auth marker: ${forbidden}`);
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checkedAt: nowIso()
  };
}

function buildCommittedSummary({ snapshot, validation, payloadDescriptor, stablePayloadHash }) {
  return {
    generatedAt: nowIso(),
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    mode: 'canonical_snapshot_local_dry_run',
    productionWrites: false,
    privateArtifacts: {
      canonicalSnapshotDryRun: 'private/canonical-snapshot-dry-run.json',
      gitIgnored: true,
      containsPrivateObjectKeys: true,
      containsPrivateGrokIds: true,
      containsRawPromptText: true
    },
    payload: {
      bytes: payloadDescriptor.bytes,
      sha256: payloadDescriptor.sha256,
      stableContentHash: stablePayloadHash
    },
    sourceBaseline: snapshot.sourceBaseline,
    sourceCounts: snapshot.sourceCounts,
    classificationCounts: snapshot.classificationCounts,
    gapCounts: snapshot.gapCounts,
    logicalAssetCount: snapshot.logicalAssets.length,
    storageObjectCount: snapshot.storageObjects.length,
    promptRecordCount: snapshot.promptArchive.length,
    gapRecordCount: snapshot.gapRecords.length,
    duplicateClassification: snapshot.duplicateClassification,
    promptArchiveSummary: {
      sourceCounts: countBy(snapshot.promptArchive, (record) => record.source),
      recordsWithPrompt: snapshot.promptArchive.filter((record) => record.prompt).length,
      recordsWithOriginalPrompt: snapshot.promptArchive.filter((record) => record.originalPrompt).length,
      uniquePromptHashes: new Set(snapshot.promptArchive.map((record) => record.promptSha256).filter(Boolean)).size,
      uniqueOriginalPromptHashes: new Set(snapshot.promptArchive.map((record) => record.originalPromptSha256).filter(Boolean)).size
    },
    validation: {
      ok: validation.ok,
      errorCount: validation.errors.length,
      warningCount: validation.warnings.length
    },
    approvalGate: snapshot.approvalGate,
    committedArtifactPolicy: 'Counts, hashes, schema, and approval gates only. Raw prompts, exact private IDs, and exact object keys remain in ignored private payload.'
  };
}

function renderMarkdownReport(summary, validation) {
  const validationLines = [
    ...(validation.errors.length ? validation.errors.map((error) => `- ERROR: ${error}`) : ['- No validation errors.']),
    ...validation.warnings.map((warning) => `- WARNING: ${warning}`)
  ].join('\n');
  return `# Canonical Snapshot Dry Run

Generated: ${summary.generatedAt}

This report is redacted. It contains counts and hashes only. The exact dry-run payload is ignored at \`${summary.privateArtifacts.canonicalSnapshotDryRun}\`.

## Status

- Production writes: no
- Schema: ${summary.schemaVersion}
- Dry-run valid: ${validation.ok ? 'yes' : 'no'}
- Private payload SHA-256: \`${summary.payload.sha256}\`
- Stable content hash: \`${summary.payload.stableContentHash}\`

## Counts

- Logical assets: ${summary.logicalAssetCount}
- Storage objects: ${summary.storageObjectCount}
- Prompt records: ${summary.promptRecordCount}
- Gap records: ${summary.gapRecordCount}

## Classification Counts

${Object.entries(summary.classificationCounts).map(([status, count]) => `- ${status}: ${count}`).join('\n')}

## Gap Counts

${Object.entries(summary.gapCounts).sort(([left], [right]) => left.localeCompare(right)).map(([name, count]) => `- ${name}: ${count}`).join('\n')}

## Duplicate Evidence

- Same-hash groups: ${summary.duplicateClassification.sameHashGroupCount}
- Accepted linked duplicate objects: ${summary.duplicateClassification.acceptedLinkedDuplicateObjects}
- Hash-only duplicate objects needing review: ${summary.duplicateClassification.hashOnlyDuplicateObjects}

## Approval Gate

The next phase is an append-only R2 JSON snapshot write. It requires explicit user approval naming the target bucket/key, payload SHA-256, stable content hash, source baseline commit, and rollback/readback verification plan. D1 writes, Worker writes, Grok actions, object moves, deletes, repair routes, sync routes, and physical cleanup remain forbidden without separate approval.

## Validation

${validationLines}
`;
}

async function buildDryRun() {
  await fs.mkdir(privateDir, { recursive: true });
  const generatedAt = nowIso();
  const manifest = await readJson('manifest.json');
  const localSummary = await readJson('reconciliations/local-canonical-index-summary.json');
  const gapReport = await readJson('reconciliations/canonical-gap-report.json');
  const grokAssetSummary = await readJson('inventory/grok-assets-current-summary.json');
  const indexRows = await readJsonl('private/local-canonical-index.jsonl');
  const mediaPostRows = await readJsonl('private/grok-media-posts-current.jsonl');
  const conversationRows = await readJsonl('private/grok-conversation-responses-current.jsonl');
  const sourceArtifacts = [];
  for (const relPath of sourceArtifactPaths) sourceArtifacts.push(await artifactDescriptor(relPath));

  const promptArchive = buildPromptArchive({ mediaPostRows, conversationRows });
  const promptIndexes = buildPromptIndexes(promptArchive);
  const storageObjects = buildStorageObjects(indexRows, promptIndexes);
  const logicalAssets = buildLogicalAssets(indexRows, storageObjects);
  const gapRecords = buildGapRecords({ indexRows, mediaPostRows, conversationRows });
  const schema = canonicalSnapshotSchema();

  const snapshotWithoutApproval = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotKind: DRY_RUN_KIND,
    generatedAt,
    productionWrites: false,
    sourceBaseline: {
      evidenceBaselineCommit: manifest.repo?.commit || 'edaaf8134bb545969d6e8036952695a3d8102ca7',
      branch: manifest.repo?.branch || 'codex/production-r2-vault-audit',
      canonicalReportGeneratedAt: localSummary.generatedAt,
      grokSavedInventoryStatus: localSummary.grokSavedInventoryStatus?.status,
      productionWritesAuthorized: false
    },
    sourceArtifacts,
    sourceCounts: localSummary.sourceCounts,
    classificationCounts: localSummary.classification.statusCounts,
    reasonCounts: localSummary.classification.reasonCounts,
    pathClassStatusMatrix: localSummary.classification.pathClassStatusMatrix,
    gapCounts: gapReport.gapCounts,
    duplicateClassification: {
      sameHashGroupCount: localSummary.duplicateClassification.sameHashGroupCount,
      sameHashObjectCount: localSummary.duplicateClassification.sameHashObjectCount,
      acceptedLinkedDuplicateObjects: localSummary.duplicateClassification.acceptedLinkedDuplicateObjects,
      hashOnlyDuplicateObjects: localSummary.duplicateClassification.hashOnlyDuplicateObjects
    },
    grokSavedInventoryStatus: localSummary.grokSavedInventoryStatus,
    grokPromptCounts: {
      promptCandidateCount: grokAssetSummary.responses?.summary?.promptCandidateCount || 0,
      mediaPostPromptCount: grokAssetSummary.mediaPosts?.summary?.promptPresent || 0,
      mediaPostOriginalPromptCount: grokAssetSummary.mediaPosts?.summary?.originalPromptPresent || 0,
      failedConversationResponses: localSummary.grokSavedInventoryStatus?.failedConversationResponses || 0,
      failedMediaPosts: localSummary.grokSavedInventoryStatus?.failedMediaPosts || 0
    },
    validationRules: schema.validationRules,
    logicalAssets,
    storageObjects,
    promptArchive,
    gapRecords,
    rollbackNotes: [
      'This dry-run payload is local-only and ignored by git.',
      'The first approved production write must be append-only R2 JSON and must be read back and hashed after upload.',
      'No D1 projection, product read switch, physical cleanup, move, or delete is authorized by this dry-run.'
    ]
  };
  const validation = validateSnapshot({ snapshot: snapshotWithoutApproval, localSummary, gapReport, manifest });
  const snapshot = {
    ...snapshotWithoutApproval,
    approvalGate: buildApprovalGate({ validation })
  };
  const stablePayloadHash = stableHash(normalizeForStableHash(snapshot));
  const privatePayloadRel = 'private/canonical-snapshot-dry-run.json';
  await writeJson(privatePayloadRel, snapshot);
  const payloadDescriptor = await artifactDescriptor(privatePayloadRel);
  const summary = buildCommittedSummary({ snapshot, validation, payloadDescriptor, stablePayloadHash });
  await writeJson('reconciliations/canonical-snapshot-schema.json', schema);
  await writeJson('reconciliations/canonical-snapshot-dry-run-summary.json', summary);
  await writeJson('logs/canonical-snapshot-dry-run-validation.json', validation);
  await writeText('report-canonical-snapshot-dry-run.md', renderMarkdownReport(summary, validation));

  await updateManifest((current) => {
    current.subsystems ||= {};
    current.subsystems.canonicalSnapshotDryRun = validation.ok ? 'validated' : 'failed';
    current.currentCanonicalSnapshotDryRun = {
      generatedAt: summary.generatedAt,
      schemaVersion: summary.schemaVersion,
      privatePayload: summary.privateArtifacts.canonicalSnapshotDryRun,
      payloadSha256: summary.payload.sha256,
      stableContentHash: summary.payload.stableContentHash,
      validation: summary.validation,
      productionWrites: false,
      nextAllowedPhase: summary.approvalGate.nextAllowedPhase,
      requiresExplicitUserApproval: true
    };
  });

  if (!validation.ok) process.exitCode = 1;
  console.log(`canonical snapshot dry-run payload: ${path.relative(process.cwd(), auditPath(privatePayloadRel))}`);
  console.log(`canonical snapshot dry-run summary: ${path.relative(process.cwd(), auditPath('reconciliations/canonical-snapshot-dry-run-summary.json'))}`);
  console.log(`dry-run validation: ${validation.ok ? 'ok' : 'failed'}`);
}

await buildDryRun();
