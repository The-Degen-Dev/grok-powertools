#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const auditRoot = path.resolve(scriptsDir, '..');
const manifestPath = path.join(auditRoot, 'manifest.json');
const privateDir = path.join(auditRoot, 'private');

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;
const PRIVATE_DIR_SEGMENT = `${path.sep}private${path.sep}`;

function nowIso() {
  return new Date().toISOString();
}

function auditPath(...parts) {
  const resolved = path.resolve(auditRoot, ...parts);
  if (resolved !== auditRoot && !resolved.startsWith(`${auditRoot}${path.sep}`)) {
    throw new Error(`Refusing to write outside audit root: ${resolved}`);
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

function extractUuids(value) {
  return [...String(value || '').matchAll(UUID_RE)].map((match) => match[0].toLowerCase());
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

async function optionalJsonl(relPath) {
  try {
    return await readJsonl(relPath);
  } catch {
    return [];
  }
}

async function optionalJson(relPath) {
  try {
    return await readJson(relPath);
  } catch {
    return null;
  }
}

async function writeJson(relPath, value) {
  const filePath = auditPath(relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  if (!isPrivateAuditPath(filePath)) await recordEvidence(filePath);
}

async function writePrivateJsonl(relPath, rows) {
  const filePath = auditPath(relPath);
  if (!isPrivateAuditPath(filePath)) {
    throw new Error(`Private JSONL must be written under private/: ${relPath}`);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const stream = createWriteStream(filePath, { encoding: 'utf8' });
  for (const row of rows) stream.write(`${JSON.stringify(row)}\n`);
  await new Promise((resolve, reject) => {
    stream.end(resolve);
    stream.on('error', reject);
  });
}

async function writeText(relPath, text) {
  const filePath = auditPath(relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text);
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
    ].sort((a, b) => a.path.localeCompare(b.path));
  });
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function parseMaybeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
      if (parsed) return [String(parsed)];
    } catch {
      return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [String(value)];
}

function mediaUuidFromKey(key) {
  const basename = path.basename(String(key || ''), path.extname(String(key || '')));
  return basename.match(UUID_RE)?.[0] || null;
}

function setIntersection(left, right) {
  const leftSet = new Set(left.filter(Boolean));
  return right.filter((value) => leftSet.has(value));
}

function duplicateGroups(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({ key, items }));
}

function chooseRetainedCandidate(group, evidenceByKey) {
  return [...group.items].sort((left, right) => {
    const a = evidenceByKey.get(left.objectKey);
    const b = evidenceByKey.get(right.objectKey);
    return scoreEvidence(b) - scoreEvidence(a) || String(left.objectKey).localeCompare(String(right.objectKey));
  })[0]?.objectKey || null;
}

function scoreEvidence(evidence = {}) {
  let score = 0;
  if (evidence.d1Covered) score += 100;
  if (evidence.grokApiCovered) score += 95;
  if (evidence.workerCovered) score += 90;
  if (evidence.grokPostIds?.length) score += 25;
  if (evidence.pathClass === 'canonical-media') score += 50;
  if (evidence.pathClass === 'conflict-media') score -= 20;
  if (evidence.pathClass === 'legacy-date-media') score -= 10;
  if (evidence.sourceUrlHashes.length) score += 8;
  if (evidence.promptSidecarKeys.length) score += 5;
  return score;
}

function identityLinks(left, right) {
  const links = [];
  if (left.mediaUuid && right.mediaUuid && left.mediaUuid === right.mediaUuid) links.push('same_media_uuid');
  if (setIntersection(left.sourceUrlHashes, right.sourceUrlHashes).length) links.push('same_canonical_source_url_hash');
  if (setIntersection(left.promptSidecarKeys, right.promptSidecarKeys).length) links.push('same_prompt_sidecar_link');
  const leftPostIds = [...(left.grokPostIds || []), left.grokPostId].filter(Boolean);
  const rightPostIds = [...(right.grokPostIds || []), right.grokPostId].filter(Boolean);
  if (setIntersection(leftPostIds, rightPostIds).length) links.push('same_grok_post_id');
  return links;
}

function grokSavedStatusFrom({ rows, summary, assetRows, assetSummary, responseRows, mediaPostRows }) {
  if (assetRows.length || assetSummary) {
    const completedApiPagination = Boolean(assetSummary?.traversal?.completedPagination);
    const completedConversationResponses = Boolean(assetSummary?.responses?.completedResponses);
    const failedConversationResponses = Number(assetSummary?.responses?.failedConversationResponses || 0);
    const promptCandidateCount = Number(assetSummary?.responses?.summary?.promptCandidateCount || 0);
    const completedMediaPosts = Boolean(assetSummary?.mediaPosts?.completedMediaPosts);
    const allAssetIdsAttempted = Boolean(assetSummary?.mediaPosts?.allAssetIdsAttempted);
    const failedMediaPosts = Number(assetSummary?.mediaPosts?.failedMediaPosts || 0);
    const mediaPostPromptCount = Number(assetSummary?.mediaPosts?.summary?.promptPresent || 0);
    const mediaPostOriginalPromptCount = Number(assetSummary?.mediaPosts?.summary?.originalPromptPresent || 0);
    const mediaPostStatusCounts = assetSummary?.mediaPosts?.summary?.statusCounts || {};
    const identityStatus = assetSummary?.identity?.status || 'api_identity_unknown';
    if (completedApiPagination && completedConversationResponses && completedMediaPosts && allAssetIdsAttempted && assetRows.length > 0) {
      return {
        status: failedMediaPosts > 0 ? 'api_captured_post_identity_with_post_gaps' : 'verified',
        rowCount: assetRows.length,
        gridRowCount: rows.length,
        assetApiRowCount: assetRows.length,
        conversationResponseRows: responseRows.length,
        mediaPostRows: mediaPostRows.length,
        completedGridTraversal: Boolean(summary?.traversal?.completedGridTraversal),
        completedApiPagination,
        completedConversationResponses,
        completedMediaPosts,
        allAssetIdsAttempted,
        promptMetadataStatus: failedConversationResponses > 0 || failedMediaPosts > 0 ? 'captured_with_response_gaps' : promptCandidateCount > 0 || mediaPostPromptCount > 0 ? 'captured' : 'no_prompt_candidates_found',
        promptCandidateCount,
        mediaPostPromptCount,
        mediaPostOriginalPromptCount,
        failedConversationResponses,
        failedMediaPosts,
        mediaPostStatusCounts,
        identityStatus,
        identityLimited: false,
        limitation: failedMediaPosts > 0
          ? `Media post identity was captured via /rest/media/post/get for successful rows, but ${failedMediaPosts} asset IDs still have media-post response gaps after retry.`
          : assetSummary?.identity?.limitation || 'Media post identity was captured via /rest/media/post/get without opening detail routes.'
      };
    }
    return {
      status: assetRows.length ? 'partial' : 'blocked',
      rowCount: assetRows.length,
      gridRowCount: rows.length,
      assetApiRowCount: assetRows.length,
      conversationResponseRows: responseRows.length,
      mediaPostRows: mediaPostRows.length,
      completedGridTraversal: Boolean(summary?.traversal?.completedGridTraversal),
      completedApiPagination,
      completedConversationResponses,
      completedMediaPosts,
      allAssetIdsAttempted,
      promptMetadataStatus: promptCandidateCount > 0 ? 'partial' : 'not_captured',
      promptCandidateCount,
      mediaPostPromptCount,
      mediaPostOriginalPromptCount,
      failedMediaPosts,
      mediaPostStatusCounts,
      identityStatus,
      identityLimited: true,
      limitation: assetSummary?.identity?.limitation || 'Grok Saved active-tab API capture did not complete.'
    };
  }

  const allRowsHavePostId = summary?.identity?.status === 'all_rows_have_grok_post_id';
  const identityLimited = rows.length > 0 && !allRowsHavePostId;
  if (!rows.length && !summary) {
    return {
      status: 'blocked',
      rowCount: 0,
      completedGridTraversal: false,
      identityStatus: 'not_captured',
      blocker: 'Current Grok Saved enumeration has not been captured from the visible authenticated tab.'
    };
  }

  const completedGridTraversal = Boolean(summary?.traversal?.completedGridTraversal);
  const identityStatus = summary?.identity?.status || 'unknown';
  if (completedGridTraversal && allRowsHavePostId && rows.length > 0) {
    return {
      status: 'verified',
      rowCount: rows.length,
      completedGridTraversal,
      identityStatus,
      identityLimited: false
    };
  }
  if (completedGridTraversal) {
    return {
      status: 'grid_captured_identity_limited',
      rowCount: rows.length,
      completedGridTraversal,
      identityStatus,
      identityLimited,
      limitation: 'Saved grid traversal reached the end, but logical grokPostId identity is incomplete. Detail-page capture or another identity source is still required before claiming Grok Saved logical completeness.'
    };
  }
  return {
    status: 'partial',
    rowCount: rows.length,
    completedGridTraversal,
    identityStatus,
    identityLimited,
    limitation: identityLimited
      ? 'Saved grid traversal did not reach a verified end state, and captured grid rows do not have complete logical grokPostId identity.'
      : 'Saved grid traversal did not reach a verified end state.'
  };
}

function collectGrokAssetUuids(asset) {
  const uuids = new Set();
  addExtractedUuids(uuids, asset.assetId);
  addExtractedUuids(uuids, asset.rootAssetId);
  addExtractedUuids(uuids, asset.key);
  addExtractedUuids(uuids, asset.previewImageKey);
  addExtractedUuids(uuids, asset.hdKey);
  addExtractedUuids(uuids, asset.hd1080Key);
  if (asset.auxKeys && typeof asset.auxKeys === 'object') {
    for (const value of Object.values(asset.auxKeys)) addExtractedUuids(uuids, value);
  }
  return [...uuids];
}

function collectGrokPostUuids(post, seen = new Set(), depth = 0) {
  if (!post || typeof post !== 'object' || depth > 3) return [];
  if (post.id && seen.has(String(post.id))) return [];
  if (post.id) seen.add(String(post.id));

  const uuids = new Set();
  addExtractedUuids(uuids, post.id);
  addExtractedUuids(uuids, post.originalPostId);
  addExtractedUuids(uuids, post.mediaUrl);
  addExtractedUuids(uuids, post.thumbnailImageUrl);

  for (const key of ['images', 'videos', 'childPosts', 'inputMediaItems', 'audioUrls']) {
    const value = post[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item && typeof item === 'object') {
        for (const uuid of collectGrokPostUuids(item, seen, depth + 1)) uuids.add(uuid);
      } else {
        addExtractedUuids(uuids, item);
      }
    }
  }
  if (post.originalPost && typeof post.originalPost === 'object') {
    for (const uuid of collectGrokPostUuids(post.originalPost, seen, depth + 1)) uuids.add(uuid);
  }
  return [...uuids];
}

function addExtractedUuids(set, value) {
  for (const uuid of extractUuids(value)) set.add(uuid);
}

function makeEmptyGrokApiEvidence(mediaUuid) {
  return {
    mediaUuid,
    assetIds: new Set(),
    responseIds: new Set(),
    sourceConversationIds: new Set(),
    rootAssetIds: new Set(),
    assetKeys: new Set(),
    promptMessageHashes: new Set(),
    promptMessageCount: 0,
    responseCount: 0,
    grokPostIds: new Set(),
    originalPostIds: new Set(),
    mediaPostPromptHashes: new Set(),
    mediaPostOriginalPromptHashes: new Set(),
    mediaPostPromptCount: 0,
    mediaPostOriginalPromptCount: 0,
    mediaPostModelNames: new Set(),
    mediaPostMediaTypes: new Set()
  };
}

function addMediaPostEvidence(current, post) {
  if (!post || typeof post !== 'object') return;
  if (post.id) current.grokPostIds.add(String(post.id));
  if (post.originalPostId) current.originalPostIds.add(String(post.originalPostId));
  if (post.modelName) current.mediaPostModelNames.add(String(post.modelName));
  if (post.mediaType) current.mediaPostMediaTypes.add(String(post.mediaType));
  if (typeof post.prompt === 'string' && post.prompt.length > 0) {
    current.mediaPostPromptHashes.add(hashString(post.prompt));
    current.mediaPostPromptCount += 1;
  }
  if (typeof post.originalPrompt === 'string' && post.originalPrompt.length > 0) {
    current.mediaPostOriginalPromptHashes.add(hashString(post.originalPrompt));
    current.mediaPostOriginalPromptCount += 1;
  }
}

function buildGrokApiEvidenceByMediaUuid(assetRows, responseRows, mediaPostRows) {
  const responsesByConversation = new Map();
  for (const row of responseRows) {
    if (!row.sourceConversationId) continue;
    responsesByConversation.set(String(row.sourceConversationId), row);
  }

  const postsByAssetId = new Map();
  for (const row of mediaPostRows) {
    const post = row.parsed?.post;
    if (row.status === 200 && post && row.assetId) postsByAssetId.set(String(row.assetId), post);
  }

  const byMediaUuid = new Map();
  for (const row of assetRows) {
    const asset = row.asset || {};
    const uuids = collectGrokAssetUuids(asset);
    const conversation = asset.sourceConversationId ? responsesByConversation.get(String(asset.sourceConversationId)) : null;
    const responses = Array.isArray(conversation?.parsed?.responses) ? conversation.parsed.responses : [];
    const promptMessages = responses.filter((response) => response.sender === 'human' && response.message).map((response) => response.message);
    const post = asset.assetId ? postsByAssetId.get(String(asset.assetId)) : null;
    if (post) {
      for (const uuid of collectGrokPostUuids(post)) uuids.push(uuid);
    }
    for (const uuid of uuids) {
      const current = byMediaUuid.get(uuid) || makeEmptyGrokApiEvidence(uuid);
      if (asset.assetId) current.assetIds.add(String(asset.assetId));
      if (asset.responseId) current.responseIds.add(String(asset.responseId));
      if (asset.sourceConversationId) current.sourceConversationIds.add(String(asset.sourceConversationId));
      if (asset.rootAssetId) current.rootAssetIds.add(String(asset.rootAssetId));
      if (asset.key) current.assetKeys.add(String(asset.key));
      current.responseCount += responses.length;
      current.promptMessageCount += promptMessages.length;
      for (const message of promptMessages) current.promptMessageHashes.add(hashString(message));
      addMediaPostEvidence(current, post);
      byMediaUuid.set(uuid, current);
    }
  }

  for (const row of mediaPostRows) {
    const post = row.parsed?.post;
    if (row.status !== 200 || !post) continue;
    for (const uuid of collectGrokPostUuids(post)) {
      const current = byMediaUuid.get(uuid) || makeEmptyGrokApiEvidence(uuid);
      if (row.assetId) current.assetIds.add(String(row.assetId));
      addMediaPostEvidence(current, post);
      byMediaUuid.set(uuid, current);
    }
  }

  return new Map([...byMediaUuid.entries()].map(([uuid, value]) => [uuid, {
    mediaUuid: uuid,
    assetIds: [...value.assetIds],
    responseIds: [...value.responseIds],
    sourceConversationIds: [...value.sourceConversationIds],
    rootAssetIds: [...value.rootAssetIds],
    assetKeys: [...value.assetKeys],
    promptMessageHashes: [...value.promptMessageHashes],
    promptMessageCount: value.promptMessageCount,
    responseCount: value.responseCount,
    grokPostIds: [...value.grokPostIds],
    originalPostIds: [...value.originalPostIds],
    mediaPostPromptHashes: [...value.mediaPostPromptHashes],
    mediaPostOriginalPromptHashes: [...value.mediaPostOriginalPromptHashes],
    mediaPostPromptCount: value.mediaPostPromptCount,
    mediaPostOriginalPromptCount: value.mediaPostOriginalPromptCount,
    mediaPostModelNames: [...value.mediaPostModelNames],
    mediaPostMediaTypes: [...value.mediaPostMediaTypes]
  }]));
}

function makeEvidence({ object, hashRow, d1ByKey, workerByKey, promptSidecarsByMediaKey, grokApiByMediaUuid }) {
  const d1 = d1ByKey.get(object.key) || null;
  const worker = workerByKey.get(object.key) || null;
  const customMetadata = object.customMetadata || {};
  const mediaUuid = mediaUuidFromKey(object.key);
  const grokApi = mediaUuid ? grokApiByMediaUuid.get(mediaUuid) || null : null;
  const sourceUrlHashes = [
    customMetadata['source-url-hash'],
    ...parseMaybeList(d1?.source_url_hashes),
    worker?.sourceUrlHash
  ].filter(Boolean).map(String);
  return {
    objectKey: object.key,
    objectKeyHash: shortHash(object.key),
    userIdHash: object.userId ? shortHash(object.userId) : null,
    pathClass: object.pathClass,
    mediaType: object.mediaType,
    size: Number(object.size || 0),
    sha256: hashRow?.sha256 || customMetadata.sha256 || d1?.content_sha256 || worker?.sha256 || null,
    mediaUuid,
    grokPostId: grokApi?.grokPostIds?.length === 1 ? grokApi.grokPostIds[0] : null,
    grokPostIds: grokApi?.grokPostIds || [],
    grokOriginalPostIds: grokApi?.originalPostIds || [],
    sourceUrlHashes: [...new Set(sourceUrlHashes)],
    promptSidecarKeys: [...(promptSidecarsByMediaKey.get(object.key) || [])],
    assetId: object.assetId || customMetadata['asset-id'] || d1?.asset_id || worker?.assetId || null,
    d1Covered: Boolean(d1),
    workerCovered: Boolean(worker),
    grokApiCovered: Boolean(grokApi),
    grokApiAssetIds: grokApi?.assetIds || [],
    grokApiResponseIds: grokApi?.responseIds || [],
    grokApiSourceConversationIds: grokApi?.sourceConversationIds || [],
    grokApiRootAssetIds: grokApi?.rootAssetIds || [],
    grokApiPromptMessageHashes: grokApi?.promptMessageHashes || [],
    grokApiPromptMessageCount: grokApi?.promptMessageCount || 0,
    grokApiResponseCount: grokApi?.responseCount || 0,
    grokMediaPostPromptHashes: grokApi?.mediaPostPromptHashes || [],
    grokMediaPostOriginalPromptHashes: grokApi?.mediaPostOriginalPromptHashes || [],
    grokMediaPostPromptCount: grokApi?.mediaPostPromptCount || 0,
    grokMediaPostOriginalPromptCount: grokApi?.mediaPostOriginalPromptCount || 0,
    grokMediaPostModelNames: grokApi?.mediaPostModelNames || [],
    grokMediaPostMediaTypes: grokApi?.mediaPostMediaTypes || [],
    uploadStatus: d1?.upload_status || null,
    verificationStatus: worker?.verificationStatus || null,
    hashStatus: hashRow?.status || (hashRow?.sha256 ? 'ok' : 'missing')
  };
}

function classifyStorageObject({ object, evidence, duplicateInfo }) {
  if (!object.isMedia) return { status: 'metadata_only_or_sidecar', reason: 'non_media_or_sidecar' };
  if (object.pathClass === 'system' || object.malformed) return { status: 'invalid_or_system', reason: 'system_or_malformed' };
  if (object.pathClass === 'metadata' || object.pathClass === 'prompt-sidecar') {
    return { status: 'metadata_only_or_sidecar', reason: 'metadata_or_prompt_sidecar' };
  }
  if (duplicateInfo?.isRetainedCandidate) {
    if (evidence.d1Covered || evidence.workerCovered || object.pathClass === 'canonical-media') {
      return { status: 'canonical', reason: 'retained_duplicate_group_candidate' };
    }
    return { status: 'needs_human_review', reason: 'retained_hash_group_candidate_without_index_or_grok_saved_evidence' };
  }
  if (duplicateInfo?.identityLinks?.length) {
    if (object.pathClass === 'legacy-date-media') return { status: 'date_folder_mapped', reason: 'duplicate_hash_plus_identity_link_to_retained_candidate' };
    return { status: 'alternate_duplicate', reason: 'duplicate_hash_plus_identity_link_to_retained_candidate' };
  }
  if (duplicateInfo?.isHashOnlyDuplicate) {
    return { status: 'needs_human_review', reason: 'same_sha256_without_accepted_identity_link' };
  }
  if (object.pathClass === 'legacy-date-media' && evidence.grokApiCovered) {
    return { status: 'date_folder_mapped', reason: 'date_folder_media_seen_in_current_grok_saved_api' };
  }
  if (object.pathClass === 'canonical-media' && (evidence.d1Covered || evidence.workerCovered)) {
    return { status: 'canonical', reason: 'canonical_media_indexed_by_d1_or_worker' };
  }
  if (object.pathClass === 'canonical-media' && evidence.grokApiCovered) {
    return { status: 'canonical', reason: 'canonical_media_seen_in_current_grok_saved_api' };
  }
  if (object.pathClass === 'canonical-media') {
    return { status: 'needs_human_review', reason: 'canonical_media_missing_d1_worker_and_grok_saved_evidence' };
  }
  if (object.pathClass === 'legacy-date-media') {
    return { status: 'orphan_candidate', reason: 'date_folder_media_not_linked_to_canonical_identity' };
  }
  if (object.pathClass === 'conflict-media') {
    return { status: 'needs_human_review', reason: 'conflict_path_requires_manual_classification' };
  }
  return { status: 'orphan_candidate', reason: 'media_not_linked_to_canonical_identity' };
}

function summarizeMatrix(rows, rowKey, colKey) {
  const matrix = {};
  for (const row of rows) {
    const outer = rowKey(row) || 'unknown';
    const inner = colKey(row) || 'unknown';
    matrix[outer] ||= {};
    matrix[outer][inner] = (matrix[outer][inner] || 0) + 1;
  }
  return matrix;
}

async function buildCanonicalIndex() {
  await fs.mkdir(privateDir, { recursive: true });

  const r2Objects = await readJsonl('inventory/r2-objects.jsonl');
  const r2Hashes = await readJsonl('inventory/r2-media-hashes.jsonl');
  const d1Rows = await readJsonl('inventory/d1-r2-dedupe-index.jsonl');
  const workerRows = await readJsonl('inventory/worker-vault-assets.jsonl');
  const metadataRefs = await readJson('inventory/metadata-references.json');
  const localSummary = await readJson('inventory/local-media-summary.json');
  const grokSavedRows = await optionalJsonl('private/grok-saved-current-inventory.jsonl');
  const grokSavedSummary = await optionalJson('inventory/grok-saved-current-summary.json');
  const grokAssetRows = await optionalJsonl('private/grok-assets-current-inventory.jsonl');
  const grokAssetSummary = await optionalJson('inventory/grok-assets-current-summary.json');
  const grokConversationRows = await optionalJsonl('private/grok-conversation-responses-current.jsonl');
  const grokMediaPostRows = await optionalJsonl('private/grok-media-posts-current.jsonl');

  const mediaObjects = r2Objects.filter((object) => object.isMedia);
  const hashByKey = new Map(r2Hashes.map((row) => [row.objectKey, row]));
  const d1ByKey = new Map(d1Rows.filter((row) => row.canonical_object_key).map((row) => [row.canonical_object_key, row]));
  const workerByKey = new Map(workerRows.filter((row) => row.canonicalObjectKey).map((row) => [row.canonicalObjectKey, row]));
  const grokApiByMediaUuid = buildGrokApiEvidenceByMediaUuid(grokAssetRows, grokConversationRows, grokMediaPostRows);
  const promptSidecarsByMediaKey = new Map();
  for (const ref of metadataRefs.references || []) {
    for (const objectKey of ref.objectKeys || []) {
      const current = promptSidecarsByMediaKey.get(objectKey) || [];
      current.push(ref.objectKey);
      promptSidecarsByMediaKey.set(objectKey, current);
    }
  }

  const evidenceByKey = new Map();
  for (const object of mediaObjects) {
    evidenceByKey.set(object.key, makeEvidence({
      object,
      hashRow: hashByKey.get(object.key),
      d1ByKey,
      workerByKey,
      promptSidecarsByMediaKey,
      grokApiByMediaUuid
    }));
  }

  const duplicateHashGroups = duplicateGroups(
    mediaObjects
      .map((object) => ({ objectKey: object.key, sha256: evidenceByKey.get(object.key)?.sha256 }))
      .filter((row) => row.sha256),
    (row) => row.sha256
  );
  const duplicateInfoByKey = new Map();
  const duplicateGroupSummaries = [];
  for (const group of duplicateHashGroups) {
    const retainedKey = chooseRetainedCandidate(group, evidenceByKey);
    const retainedEvidence = evidenceByKey.get(retainedKey);
    let linkedCount = 0;
    let hashOnlyCount = 0;
    for (const item of group.items) {
      const evidence = evidenceByKey.get(item.objectKey);
      const links = item.objectKey === retainedKey ? [] : identityLinks(evidence, retainedEvidence);
      if (item.objectKey !== retainedKey && links.length) linkedCount += 1;
      if (item.objectKey !== retainedKey && !links.length) hashOnlyCount += 1;
      duplicateInfoByKey.set(item.objectKey, {
        duplicateGroupHash: group.key,
        duplicateGroupId: shortHash(group.key),
        retainedKey,
        retainedKeyHash: retainedKey ? shortHash(retainedKey) : null,
        isRetainedCandidate: item.objectKey === retainedKey,
        isHashOnlyDuplicate: item.objectKey !== retainedKey && !links.length,
        identityLinks: links
      });
    }
    duplicateGroupSummaries.push({
      duplicateGroupId: shortHash(group.key),
      objectCount: group.items.length,
      retainedKeyHash: retainedKey ? shortHash(retainedKey) : null,
      linkedDuplicateCount: linkedCount,
      hashOnlyDuplicateCount: hashOnlyCount,
      pathClassComposition: countBy(group.items, (item) => evidenceByKey.get(item.objectKey)?.pathClass)
    });
  }

  const indexRows = mediaObjects.map((object) => {
    const evidence = evidenceByKey.get(object.key);
    const duplicateInfo = duplicateInfoByKey.get(object.key) || null;
    const classification = classifyStorageObject({ object, evidence, duplicateInfo });
    return {
      schemaVersion: 1,
      generatedAt: null,
      objectKey: object.key,
      objectKeyHash: evidence.objectKeyHash,
      userIdHash: evidence.userIdHash,
      status: classification.status,
      reason: classification.reason,
      retainedCanonicalKey: duplicateInfo?.retainedKey || (classification.status === 'canonical' ? object.key : null),
      retainedCanonicalKeyHash: duplicateInfo?.retainedKeyHash || (classification.status === 'canonical' ? evidence.objectKeyHash : null),
      duplicateGroupId: duplicateInfo?.duplicateGroupId || null,
      identityLinksToRetained: duplicateInfo?.identityLinks || [],
      evidence
    };
  });

  const generatedAt = nowIso();
  for (const row of indexRows) row.generatedAt = generatedAt;

  await writePrivateJsonl('private/local-canonical-index.jsonl', indexRows);

  const statusCounts = countBy(indexRows, (row) => row.status);
  const reasonCounts = countBy(indexRows, (row) => row.reason);
  const pathClassStatusMatrix = summarizeMatrix(indexRows, (row) => row.evidence.pathClass, (row) => row.status);
  const d1MissingCanonicalMedia = indexRows.filter((row) => row.evidence.pathClass === 'canonical-media' && !row.evidence.d1Covered).length;
  const workerMissingCanonicalMedia = indexRows.filter((row) => row.evidence.pathClass === 'canonical-media' && !row.evidence.workerCovered).length;
  const metadataLinkedMedia = indexRows.filter((row) => row.evidence.promptSidecarKeys.length > 0).length;
  const grokApiCoveredMedia = indexRows.filter((row) => row.evidence.grokApiCovered).length;
  const grokApiPromptLinkedMedia = indexRows.filter((row) => row.evidence.grokApiPromptMessageCount > 0).length;
  const grokMediaPostLinkedMedia = indexRows.filter((row) => row.evidence.grokPostIds.length > 0).length;
  const grokMediaPostPromptLinkedMedia = indexRows.filter((row) => row.evidence.grokMediaPostPromptCount > 0 || row.evidence.grokMediaPostOriginalPromptCount > 0).length;
  const hashOnlyDuplicateObjects = indexRows.filter((row) => row.reason === 'same_sha256_without_accepted_identity_link').length;
  const acceptedLinkedDuplicateObjects = indexRows.filter((row) => row.identityLinksToRetained.length > 0).length;
  const grokSavedInventoryStatus = grokSavedStatusFrom({
    rows: grokSavedRows,
    summary: grokSavedSummary,
    assetRows: grokAssetRows,
    assetSummary: grokAssetSummary,
    responseRows: grokConversationRows,
    mediaPostRows: grokMediaPostRows
  });

  const summary = {
    generatedAt,
    schemaVersion: 1,
    mode: 'read_only_local_canonical_index',
    productionWrites: false,
    privateArtifacts: {
      localCanonicalIndexJsonl: 'private/local-canonical-index.jsonl',
      gitIgnored: true,
      containsPrivateObjectKeys: true,
      containsRawPromptText: false
    },
    sourceArtifacts: {
      r2Objects: 'inventory/r2-objects.jsonl',
      r2MediaHashes: 'inventory/r2-media-hashes.jsonl',
      d1Rows: 'inventory/d1-r2-dedupe-index.jsonl',
      workerRows: 'inventory/worker-vault-assets.jsonl',
      metadataReferences: 'inventory/metadata-references.json',
      localSummary: 'inventory/local-media-summary.json',
      grokSavedInventory: grokSavedRows.length ? 'private/grok-saved-current-inventory.jsonl' : null,
      grokSavedSummary: grokSavedSummary ? 'inventory/grok-saved-current-summary.json' : null,
      grokAssetsInventory: grokAssetRows.length ? 'private/grok-assets-current-inventory.jsonl' : null,
      grokAssetsSummary: grokAssetSummary ? 'inventory/grok-assets-current-summary.json' : null,
      grokConversationResponses: grokConversationRows.length ? 'private/grok-conversation-responses-current.jsonl' : null,
      grokMediaPosts: grokMediaPostRows.length ? 'private/grok-media-posts-current.jsonl' : null
    },
    sourceCounts: {
      r2Objects: r2Objects.length,
      r2MediaObjects: mediaObjects.length,
      r2HashRows: r2Hashes.length,
      d1Rows: d1Rows.length,
      workerRows: workerRows.length,
      metadataReferences: metadataRefs.references?.length || 0,
      localFiles: localSummary.counts?.total || localSummary.totalFiles || localSummary.files || null,
      grokSavedRows: grokAssetRows.length || grokSavedRows.length,
      grokSavedGridRows: grokSavedRows.length,
      grokAssetApiRows: grokAssetRows.length,
      grokConversationResponseRows: grokConversationRows.length,
      grokMediaPostRows: grokMediaPostRows.length
    },
    grokSavedInventoryStatus,
    classification: {
      statusCounts,
      reasonCounts,
      pathClassStatusMatrix
    },
    duplicateClassification: {
      sameHashGroupCount: duplicateHashGroups.length,
      sameHashObjectCount: duplicateHashGroups.reduce((sum, group) => sum + group.items.length, 0),
      acceptedLinkedDuplicateObjects,
      hashOnlyDuplicateObjects,
      groupSummaries: duplicateGroupSummaries.slice(0, 25)
    },
    gapCounts: {
      d1MissingCanonicalMedia,
      workerMissingCanonicalMedia,
      metadataLinkedMedia,
      metadataUnlinkedMedia: mediaObjects.length - metadataLinkedMedia,
      grokApiCoveredMedia,
      grokApiPromptLinkedMedia,
      grokMediaPostLinkedMedia,
      grokMediaPostPromptLinkedMedia,
      grokMediaPostUnlinkedMedia: mediaObjects.length - grokMediaPostLinkedMedia,
      grokApiUnlinkedMedia: mediaObjects.length - grokApiCoveredMedia,
      needsHumanReview: statusCounts.needs_human_review || 0,
      orphanCandidates: statusCounts.orphan_candidate || 0,
      grokSavedInventoryBlocked: grokSavedInventoryStatus.status === 'blocked' ? 1 : 0,
      grokSavedInventoryPartial: grokSavedInventoryStatus.status === 'partial' ? 1 : 0,
      grokSavedIdentityLimited: grokSavedInventoryStatus.identityLimited ? 1 : 0
    },
    confidenceLimits: [
      'Grok media post IDs were captured through the read-style /rest/media/post/get API; individual /imagine/post/{uuid} routes were not opened per item.',
      `${grokSavedInventoryStatus.failedMediaPosts || 0} Grok media-post rows remain response gaps after retry and are reported as metadata/post-identity gaps rather than inferred missing media.`,
      'D1 asset_id is preserved as evidence but is not treated as primary Grok identity.',
      'Same SHA-256 without an accepted identity-link signal remains needs_human_review.',
      'This is a local-only canonical index proposal and does not authorize production writes, object moves, deletes, or repair actions.'
    ]
  };

  const gapReport = {
    generatedAt,
    reportType: 'redacted_canonical_gap_report',
    productionWrites: false,
    grokSavedInventoryStatus,
    counts: summary.sourceCounts,
    statusCounts,
    gapCounts: summary.gapCounts,
    duplicateClassification: {
      sameHashGroupCount: summary.duplicateClassification.sameHashGroupCount,
      acceptedLinkedDuplicateObjects,
      hashOnlyDuplicateObjects
    },
    topReasons: Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([reason, count]) => ({ reason, count })),
    sampleObjectKeyHashesByStatus: Object.fromEntries(
      Object.keys(statusCounts).sort().map((status) => [
        status,
        indexRows.filter((row) => row.status === status).slice(0, 10).map((row) => row.objectKeyHash)
      ])
    ),
    residualRisks: summary.confidenceLimits
  };

  await writeJson('reconciliations/local-canonical-index-summary.json', summary);
  await writeJson('reconciliations/canonical-gap-report.json', gapReport);
  await writeJson('logs/grok-saved-browser-control-blocker.json', {
    generatedAt,
    status: grokSavedInventoryStatus.status,
    visibleWindowPreviouslyVerified: true,
    visibleUrlPath: 'grok.com/imagine/saved',
    activeTabBrowserControl: grokAssetRows.length || grokMediaPostRows.length ? 'verified' : 'not_captured',
    blockedRequirement: 'current Grok Saved inventory from the existing authenticated Chrome tab',
    nextAction: grokSavedInventoryStatus.status === 'blocked'
      ? 'Capture the current Grok Saved inventory from the visible authenticated tab.'
      : grokSavedInventoryStatus.identityLimited
        ? 'Capture detail-page grokPostId evidence for rows without logical identity, without production writes or Grok actions.'
        : 'Review and, if needed, retry remaining media-post response gaps; do not treat them as physical duplicate cleanup approval.'
  });
  await writeText('report-canonical.md', renderMarkdownReport(summary));

  await updateManifest((manifest) => {
    manifest.status = 'in_progress';
    manifest.subsystems ||= {};
    manifest.subsystems.canonicalIndex = grokSavedInventoryStatus.status === 'verified' ? 'verified' : 'partial';
    manifest.subsystems.grokSavedInventory = grokSavedInventoryStatus.status;
    manifest.blockers = (manifest.blockers || []).filter((blocker) => blocker.mode !== 'grokSavedInventory');
    if (grokSavedInventoryStatus.status === 'blocked' || grokSavedInventoryStatus.identityLimited) {
      manifest.blockers.push({
        mode: 'grokSavedInventory',
        recordedAt: generatedAt,
        reason: grokSavedInventoryStatus.limitation || grokSavedInventoryStatus.blocker || 'Current Grok Saved logical completeness is not proven.',
        nextAction: grokSavedInventoryStatus.status === 'blocked'
          ? 'Capture the current Grok Saved inventory from the visible authenticated tab.'
          : 'Review whether the active-tab API asset/response identity is sufficient for this read-only audit, or explicitly approve controlled detail-page navigation to capture grokPostId identity without production writes.'
      });
    }
    manifest.finalVerdicts ||= {};
    manifest.finalVerdicts.currentGrokSavedCompleteness = grokSavedInventoryStatus.status === 'verified'
      ? 'inventory_captured'
      : grokSavedInventoryStatus.status;
    manifest.finalVerdicts.productionR2InternalCorrectness = manifest.finalVerdicts.productionR2InternalCorrectness || 'dirty';
  });

  console.log(`local canonical index rows: ${indexRows.length}`);
  console.log(`redacted canonical report: ${path.relative(process.cwd(), auditPath('report-canonical.md'))}`);
  if (grokSavedInventoryStatus.status !== 'verified') {
    console.log(`grok saved inventory: ${grokSavedInventoryStatus.status}`);
  }
}

function renderMarkdownReport(summary) {
  return `# Local Canonical Index And Gap Report

Generated: ${summary.generatedAt}

This report is redacted. It contains counts and hashes only, not raw prompts, cookies, bearer tokens, signed URLs, API keys, exact Grok post IDs, or exact private object keys.

## Status

- Production writes: ${summary.productionWrites ? 'yes' : 'no'}
- Raw local canonical index: \`${summary.privateArtifacts.localCanonicalIndexJsonl}\` (gitignored)
- Grok Saved inventory: ${summary.grokSavedInventoryStatus.status}
- Canonical index status: ${summary.grokSavedInventoryStatus.identityLimited ? 'partial because current Grok Saved logical identity is not fully proven' : 'complete for captured sources, with reported response gaps where present'}

## Source Counts

- R2 objects: ${summary.sourceCounts.r2Objects}
- R2 media objects: ${summary.sourceCounts.r2MediaObjects}
- R2 hash rows: ${summary.sourceCounts.r2HashRows}
- D1 rows: ${summary.sourceCounts.d1Rows}
- Worker rows: ${summary.sourceCounts.workerRows}
- Metadata references: ${summary.sourceCounts.metadataReferences}
- Grok Saved rows: ${summary.sourceCounts.grokSavedRows}
- Grok Saved grid rows: ${summary.sourceCounts.grokSavedGridRows}
- Grok asset API rows: ${summary.sourceCounts.grokAssetApiRows}
- Grok conversation response rows: ${summary.sourceCounts.grokConversationResponseRows}
- Grok media post rows: ${summary.sourceCounts.grokMediaPostRows}

## Classification Counts

${Object.entries(summary.classification.statusCounts).sort((a, b) => a[0].localeCompare(b[0])).map(([status, count]) => `- ${status}: ${count}`).join('\n')}

## Gap Counts

${Object.entries(summary.gapCounts).sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => `- ${name}: ${count}`).join('\n')}

## Duplicate Classification

- Same-hash groups: ${summary.duplicateClassification.sameHashGroupCount}
- Objects in same-hash groups: ${summary.duplicateClassification.sameHashObjectCount}
- Accepted linked duplicate objects: ${summary.duplicateClassification.acceptedLinkedDuplicateObjects}
- Hash-only duplicate objects needing review: ${summary.duplicateClassification.hashOnlyDuplicateObjects}

## Residual Risks

${summary.confidenceLimits.map((risk) => `- ${risk}`).join('\n')}
`;
}

await buildCanonicalIndex();
