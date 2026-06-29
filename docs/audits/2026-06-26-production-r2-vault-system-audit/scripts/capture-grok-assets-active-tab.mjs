#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const auditRoot = path.resolve(scriptsDir, '..');
const manifestPath = path.join(auditRoot, 'manifest.json');
const privateDir = path.join(auditRoot, 'private');
const PRIVATE_DIR_SEGMENT = `${path.sep}private${path.sep}`;
const MEDIA_POST_JSONL_REL_PATH = 'private/grok-media-posts-current.jsonl';
const MEDIA_POST_CAPTURE_MODES = new Set(['async_worker', 'sync_debug']);

const options = {
  pageSize: numberFromEnv('GROK_ASSET_CAPTURE_PAGE_SIZE', 100),
  maxPages: numberFromEnv('GROK_ASSET_CAPTURE_MAX_PAGES', 1000),
  requestWaitMs: numberFromEnv('GROK_ASSET_CAPTURE_WAIT_MS', 75),
  conversationBatchSize: numberFromEnv('GROK_ASSET_CAPTURE_CONVERSATION_BATCH_SIZE', 10),
  mediaPostBatchSize: numberFromEnv('GROK_ASSET_CAPTURE_MEDIA_POST_BATCH_SIZE', 10),
  includeResponses: process.env.GROK_ASSET_CAPTURE_INCLUDE_RESPONSES !== '0',
  includeMediaPosts: process.env.GROK_ASSET_CAPTURE_INCLUDE_MEDIA_POSTS !== '0',
  reuseAssets: process.env.GROK_ASSET_CAPTURE_REUSE_ASSETS === '1',
  retryFailedMediaPosts: process.env.GROK_ASSET_CAPTURE_RETRY_FAILED_MEDIA_POSTS === '1',
  mediaPostCaptureMode: process.env.GROK_ASSET_CAPTURE_MEDIA_POST_MODE || 'async_worker',
  mediaPostWorkerConcurrency: numberFromEnv('GROK_ASSET_CAPTURE_MEDIA_POST_WORKER_CONCURRENCY', 4),
  mediaPostWorkerEnqueueSize: numberFromEnv('GROK_ASSET_CAPTURE_MEDIA_POST_WORKER_ENQUEUE_SIZE', 250),
  mediaPostWorkerDrainSize: numberFromEnv('GROK_ASSET_CAPTURE_MEDIA_POST_WORKER_DRAIN_SIZE', 100),
  mediaPostWorkerPollMs: numberFromEnv('GROK_ASSET_CAPTURE_MEDIA_POST_WORKER_POLL_MS', 1000),
  mediaPostWorkerMaxNoProgressPolls: numberFromEnv('GROK_ASSET_CAPTURE_MEDIA_POST_WORKER_MAX_NO_PROGRESS_POLLS', 90),
  syncMediaPostMaxBatchSize: numberFromEnv('GROK_ASSET_CAPTURE_SYNC_MEDIA_POST_MAX_BATCH_SIZE', 3),
  maxConversations: optionalNumberFromEnv('GROK_ASSET_CAPTURE_MAX_CONVERSATIONS'),
  maxMediaPosts: optionalNumberFromEnv('GROK_ASSET_CAPTURE_MAX_MEDIA_POSTS'),
  maxChromeRssMb: numberFromEnv('GROK_ASSET_CAPTURE_MAX_CHROME_RSS_MB', 34000),
  maxChromeRssDeltaMb: numberFromEnv('GROK_ASSET_CAPTURE_MAX_CHROME_RSS_DELTA_MB', 2000),
  maxConsecutiveMediaPostFailureBatches: numberFromEnv('GROK_ASSET_CAPTURE_MAX_MEDIA_POST_FAILURE_BATCHES', 3),
  mediaPostProgressEveryBatches: numberFromEnv('GROK_ASSET_CAPTURE_MEDIA_POST_PROGRESS_EVERY_BATCHES', 25)
};

if (!MEDIA_POST_CAPTURE_MODES.has(options.mediaPostCaptureMode)) {
  throw new Error(`GROK_ASSET_CAPTURE_MEDIA_POST_MODE must be one of ${[...MEDIA_POST_CAPTURE_MODES].join(', ')}`);
}

function numberFromEnv(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

function optionalNumberFromEnv(name) {
  const value = process.env[name];
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (value == null || value === '') return null;
  return hashString(value).slice(0, length);
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function addSetValue(set, value) {
  if (value == null || value === '') return;
  set.add(String(value));
}

function addMaybeArrayValues(set, value) {
  if (value == null || value === '') return;
  if (Array.isArray(value)) {
    for (const item of value) addSetValue(set, item);
    return;
  }
  addSetValue(set, value);
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

async function writeJson(relPath, value) {
  const filePath = auditPath(relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  if (!isPrivateAuditPath(filePath)) await recordEvidence(filePath);
}

async function writePrivateJsonl(relPath, rows) {
  const filePath = auditPath(relPath);
  if (!isPrivateAuditPath(filePath)) throw new Error(`Private JSONL must be under private/: ${relPath}`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const stream = createWriteStream(filePath, { encoding: 'utf8' });
  for (const row of rows) stream.write(`${JSON.stringify(row)}\n`);
  await new Promise((resolve, reject) => {
    stream.end(resolve);
    stream.on('error', reject);
  });
}

async function appendPrivateJsonl(relPath, rows) {
  if (!rows.length) return;
  const filePath = auditPath(relPath);
  if (!isPrivateAuditPath(filePath)) throw new Error(`Private JSONL must be under private/: ${relPath}`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const text = rows.map((row) => JSON.stringify(row)).join('\n');
  await fs.appendFile(filePath, `${text}\n`);
}

async function optionalPrivateJsonl(relPath) {
  const filePath = auditPath(relPath);
  if (!isPrivateAuditPath(filePath)) throw new Error(`Private JSONL must be under private/: ${relPath}`);
  const text = await fs.readFile(filePath, 'utf8').catch(() => '');
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

async function optionalJson(relPath) {
  const filePath = auditPath(relPath);
  const text = await fs.readFile(filePath, 'utf8').catch(() => '');
  return text ? JSON.parse(text) : null;
}

async function chromeRssMb() {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'rss=,comm='], { maxBuffer: 16 * 1024 * 1024 });
  let rssKb = 0;
  let processCount = 0;
  for (const line of stdout.split('\n')) {
    if (!line.includes('Google Chrome')) continue;
    const rss = Number(line.trim().split(/\s+/, 1)[0]);
    if (!Number.isFinite(rss)) continue;
    rssKb += rss;
    processCount += 1;
  }
  return {
    processCount,
    totalRssMb: Math.round((rssKb / 1024) * 10) / 10
  };
}

async function runActiveTabJs(expression) {
  const appleScript = `
on run argv
  tell application "Google Chrome"
    return execute active tab of front window javascript (item 1 of argv)
  end tell
end run
`;
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', appleScript, expression], {
    maxBuffer: 64 * 1024 * 1024
  });
  const text = stdout.trim();
  if (!text) throw new Error('Active Chrome tab returned empty JavaScript result');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Active Chrome tab returned non-JSON result: ${error.message}`);
  }
}

function pageProbeJs() {
  return `JSON.stringify((function(){
    return {
      href: location.href,
      host: location.host,
      pathname: location.pathname,
      title: document.title,
      readyState: document.readyState
    };
  })())`;
}

function getJsonJs(url) {
  return `JSON.stringify((function(){
    var xhr = new XMLHttpRequest();
    xhr.open("GET", ${JSON.stringify(url)}, false);
    xhr.setRequestHeader("accept", "application/json");
    xhr.send(null);
    return {
      href: String(location.href),
      status: xhr.status,
      contentType: xhr.getResponseHeader("content-type"),
      textLength: (xhr.responseText || "").length,
      text: xhr.responseText || ""
    };
  })())`;
}

function getConversationBatchJs(conversationIds) {
  return `JSON.stringify((function(){
    function request(conversationId) {
      var url = "/rest/app-chat/conversations/" + encodeURIComponent(String(conversationId)) + "/responses";
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, false);
      xhr.setRequestHeader("accept", "application/json");
      xhr.send(null);
      return {
        sourceConversationId: String(conversationId),
        url: url,
        status: xhr.status,
        contentType: xhr.getResponseHeader("content-type"),
        textLength: (xhr.responseText || "").length,
        text: xhr.responseText || ""
      };
    }
    return {
      href: String(location.href),
      results: ${JSON.stringify(conversationIds)}.map(request)
    };
  })())`;
}

function getMediaPostBatchJs(assetIds) {
  return `JSON.stringify((function(){
    function request(assetId) {
      var url = "/rest/media/post/get";
      var xhr = new XMLHttpRequest();
      xhr.open("POST", url, false);
      xhr.setRequestHeader("accept", "application/json");
      xhr.setRequestHeader("content-type", "application/json");
      xhr.send(JSON.stringify({ id: String(assetId) }));
      return {
        assetId: String(assetId),
        url: url,
        status: xhr.status,
        contentType: xhr.getResponseHeader("content-type"),
        textLength: (xhr.responseText || "").length,
        text: xhr.responseText || ""
      };
    }
    return {
      href: String(location.href),
      results: ${JSON.stringify(assetIds)}.map(request)
    };
  })())`;
}

function installMediaPostWorkerJs(jobId, concurrency) {
  return `JSON.stringify((function(){
    if (location.host !== "grok.com" || !location.pathname.startsWith("/imagine/saved")) {
      return { status: "wrong_page", href: String(location.href) };
    }
    var existing = window.__grokAuditMediaPostWorker;
    if (existing && existing.running && !existing.done) {
      return {
        status: "already_running",
        href: String(location.href),
        state: {
          jobId: existing.jobId,
          queueLength: existing.queue.length,
          inFlight: existing.inFlight,
          completed: existing.completed,
          pendingResults: existing.results.length,
          done: existing.done,
          stopped: existing.stopped
        }
      };
    }
    var worker = {
      jobId: ${JSON.stringify(jobId)},
      concurrency: ${JSON.stringify(concurrency)},
      queue: [],
      seen: Object.create(null),
      inFlight: 0,
      completed: 0,
      accepted: 0,
      ok: 0,
      failed: 0,
      statusCounts: Object.create(null),
      results: [],
      running: true,
      done: false,
      stopped: false,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      lastProgressAt: null
    };
    worker.publicState = function publicState() {
      return {
        jobId: worker.jobId,
        concurrency: worker.concurrency,
        queueLength: worker.queue.length,
        inFlight: worker.inFlight,
        completed: worker.completed,
        accepted: worker.accepted,
        ok: worker.ok,
        failed: worker.failed,
        statusCounts: worker.statusCounts,
        pendingResults: worker.results.length,
        running: worker.running,
        done: worker.done,
        stopped: worker.stopped,
        startedAt: worker.startedAt,
        finishedAt: worker.finishedAt,
        lastProgressAt: worker.lastProgressAt
      };
    };
    worker.finishIfIdle = function finishIfIdle() {
      if (worker.queue.length || worker.inFlight) return;
      worker.running = false;
      worker.done = true;
      worker.finishedAt = worker.finishedAt || new Date().toISOString();
    };
    worker.record = function record(result) {
      worker.completed += 1;
      worker.lastProgressAt = new Date().toISOString();
      worker.statusCounts[String(result.status)] = (worker.statusCounts[String(result.status)] || 0) + 1;
      if (result.status === 200) worker.ok += 1;
      else worker.failed += 1;
      worker.results.push(result);
    };
    worker.pump = function pump() {
      if (worker.stopped) {
        worker.queue = [];
        worker.finishIfIdle();
        return;
      }
      while (worker.inFlight < worker.concurrency && worker.queue.length > 0) {
        var assetId = worker.queue.shift();
        worker.inFlight += 1;
        (async function run(assetIdForRequest) {
          var url = "/rest/media/post/get";
          var status = 0;
          var contentType = null;
          var text = "";
          var parseError = null;
          try {
            var response = await fetch(url, {
              method: "POST",
              credentials: "include",
              headers: {
                "accept": "application/json",
                "content-type": "application/json"
              },
              body: JSON.stringify({ id: String(assetIdForRequest) })
            });
            status = response.status;
            contentType = response.headers.get("content-type");
            text = await response.text();
          } catch (error) {
            parseError = "fetch_error: " + (error && error.message ? error.message : String(error));
          } finally {
            worker.inFlight -= 1;
            worker.record({
              assetId: String(assetIdForRequest),
              url: url,
              status: status,
              contentType: contentType,
              textLength: (text || "").length,
              text: text || "",
              parseError: parseError
            });
            worker.pump();
            worker.finishIfIdle();
          }
        })(assetId);
      }
      worker.finishIfIdle();
    };
    window.__grokAuditMediaPostWorker = worker;
    return { status: "installed", href: String(location.href), state: worker.publicState() };
  })())`;
}

function enqueueMediaPostWorkerJs(jobId, assetIds) {
  return `JSON.stringify((function(){
    var worker = window.__grokAuditMediaPostWorker;
    if (!worker || worker.jobId !== ${JSON.stringify(jobId)}) {
      return { status: "missing_worker", href: String(location.href) };
    }
    if (location.host !== "grok.com" || !location.pathname.startsWith("/imagine/saved")) {
      return { status: "wrong_page", href: String(location.href), state: worker.publicState() };
    }
    var accepted = 0;
    var ids = ${JSON.stringify(assetIds)};
    for (var index = 0; index < ids.length; index += 1) {
      var id = String(ids[index]);
      if (worker.seen[id]) continue;
      worker.seen[id] = true;
      worker.queue.push(id);
      accepted += 1;
    }
    worker.accepted += accepted;
    if (accepted > 0) {
      worker.running = true;
      worker.done = false;
      worker.finishedAt = null;
    }
    worker.pump();
    return { status: "enqueued", href: String(location.href), accepted: accepted, state: worker.publicState() };
  })())`;
}

function drainMediaPostWorkerJs(jobId, limit) {
  return `JSON.stringify((function(){
    var worker = window.__grokAuditMediaPostWorker;
    if (!worker || worker.jobId !== ${JSON.stringify(jobId)}) {
      return { status: "missing_worker", href: String(location.href), results: [] };
    }
    var results = worker.results.splice(0, ${JSON.stringify(limit)});
    return { status: "drained", href: String(location.href), results: results, state: worker.publicState() };
  })())`;
}

function stopMediaPostWorkerJs(jobId) {
  return `JSON.stringify((function(){
    var worker = window.__grokAuditMediaPostWorker;
    if (!worker || worker.jobId !== ${JSON.stringify(jobId)}) {
      return { status: "missing_worker", href: String(location.href) };
    }
    worker.stopped = true;
    worker.queue = [];
    worker.pump();
    worker.finishIfIdle();
    return { status: "stopped", href: String(location.href), state: worker.publicState() };
  })())`;
}

function parseResponseText(result, label) {
  try {
    return JSON.parse(result.text || '{}');
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

function assetUrl(pageToken = null) {
  const params = new URLSearchParams({
    includeImagineFiles: 'true',
    pageSize: String(options.pageSize),
    source: 'SOURCE_GENERATED',
    isLatest: 'true',
    orderBy: 'ORDER_BY_CREATE_TIME'
  });
  if (pageToken) params.set('pageToken', pageToken);
  return `/rest/assets?${params.toString()}`;
}

function assertGrokSavedProbe(probe) {
  if (probe.host !== 'grok.com' || !probe.pathname.startsWith('/imagine/saved')) {
    throw new Error(`Active Chrome tab is not Grok Saved: ${probe.href}`);
  }
}

function summarizeAssets(assetRows) {
  const assetIds = new Set();
  const keys = new Set();
  const previewKeys = new Set();
  const mediaKeys = new Set();
  const responseIds = new Set();
  const sourceConversationIds = new Set();
  const rootAssetIds = new Set();
  const rootSourceConversationIds = new Set();
  const fieldPresence = {};
  const auxKeyNameCounts = {};
  const messageKeyCandidates = new Set();
  let deleted = 0;
  let latest = 0;
  let publicCount = 0;
  let modelGenerated = 0;

  for (const row of assetRows) {
    const asset = row.asset || {};
    for (const key of Object.keys(asset)) {
      const value = asset[key];
      if (value != null && value !== '' && !(Array.isArray(value) && value.length === 0)) {
        fieldPresence[key] = (fieldPresence[key] || 0) + 1;
      }
    }
    addSetValue(assetIds, asset.assetId);
    addSetValue(keys, asset.key);
    addSetValue(previewKeys, asset.previewImageKey);
    addSetValue(responseIds, asset.responseId);
    addSetValue(sourceConversationIds, asset.sourceConversationId);
    addSetValue(rootAssetIds, asset.rootAssetId);
    addSetValue(rootSourceConversationIds, asset.rootAssetSourceConversationId);
    addSetValue(mediaKeys, asset.key);
    addSetValue(mediaKeys, asset.previewImageKey);
    addSetValue(mediaKeys, asset.hdKey);
    addSetValue(mediaKeys, asset.hd1080Key);
    if (asset.auxKeys && typeof asset.auxKeys === 'object') {
      for (const [key, value] of Object.entries(asset.auxKeys)) {
        auxKeyNameCounts[key] = (auxKeyNameCounts[key] || 0) + 1;
        addSetValue(mediaKeys, value);
        if (/prompt|message|query|metadata|reference|source|preview|image/i.test(key)) messageKeyCandidates.add(key);
      }
    }
    if (asset.isDeleted) deleted += 1;
    if (asset.isLatest) latest += 1;
    if (asset.isPublic) publicCount += 1;
    if (asset.isModelGenerated) modelGenerated += 1;
  }

  return {
    rowCount: assetRows.length,
    unique: {
      assetIds: assetIds.size,
      keys: keys.size,
      previewKeys: previewKeys.size,
      mediaKeys: mediaKeys.size,
      responseIds: responseIds.size,
      sourceConversationIds: sourceConversationIds.size,
      rootAssetIds: rootAssetIds.size,
      rootSourceConversationIds: rootSourceConversationIds.size
    },
    hashSamples: {
      assetIds: [...assetIds].slice(0, 20).map((value) => shortHash(value)),
      sourceConversationIds: [...sourceConversationIds].slice(0, 20).map((value) => shortHash(value)),
      responseIds: [...responseIds].slice(0, 20).map((value) => shortHash(value)),
      mediaKeys: [...mediaKeys].slice(0, 20).map((value) => shortHash(value))
    },
    fieldPresence,
    auxKeyNameCounts,
    auxKeysWithPossibleMetadata: [...messageKeyCandidates].sort(),
    mimeTypeCounts: countBy(assetRows, (row) => row.asset?.mimeType),
    fileSourceCounts: countBy(assetRows, (row) => row.asset?.fileSource),
    flags: {
      isDeletedTrue: deleted,
      isLatestTrue: latest,
      isPublicTrue: publicCount,
      isModelGeneratedTrue: modelGenerated
    }
  };
}

function pageSummariesFromAssetRows(assetRows, memory) {
  const byPage = new Map();
  for (const row of assetRows) {
    const pageIndex = Number.isFinite(Number(row.pageIndex)) ? Number(row.pageIndex) : 0;
    const current = byPage.get(pageIndex) || 0;
    byPage.set(pageIndex, current + 1);
  }
  return [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pageIndex, assetCount]) => ({
      pageIndex,
      status: 200,
      assetCount,
      textLength: null,
      nextPageTokenPresent: null,
      memory,
      memoryDeltaMb: 0,
      reusedExistingArtifact: true
    }));
}

function summarizeConversationResponses(responseRows, assetRows) {
  const assetResponseIds = new Set(assetRows.map((row) => row.asset?.responseId).filter(Boolean).map(String));
  const assetConversationIds = new Set(assetRows.map((row) => row.asset?.sourceConversationId).filter(Boolean).map(String));
  const responseIds = new Set();
  const parentResponseIds = new Set();
  const messageHashes = new Set();
  const messageLengths = [];
  const senderCounts = {};
  const modelCounts = {};
  const queryTypeCounts = {};
  const statusCounts = countBy(responseRows, (row) => String(row.status));
  let responseCount = 0;
  let promptCandidateCount = 0;
  let assistantResponseCount = 0;
  let parseFailures = 0;
  let responseIdsMatchedToAssets = 0;
  let conversationsWithPromptCandidate = 0;
  let conversationsWithAssetResponseId = 0;

  for (const row of responseRows) {
    if (!row.parsed || !Array.isArray(row.parsed.responses)) {
      if (row.status === 200) parseFailures += 1;
      continue;
    }
    let conversationHasPrompt = false;
    let conversationHasAssetResponse = false;
    for (const response of row.parsed.responses) {
      responseCount += 1;
      const sender = response.sender || 'unknown';
      senderCounts[sender] = (senderCounts[sender] || 0) + 1;
      if (response.model) modelCounts[response.model] = (modelCounts[response.model] || 0) + 1;
      if (response.queryType) queryTypeCounts[response.queryType] = (queryTypeCounts[response.queryType] || 0) + 1;
      addSetValue(responseIds, response.responseId);
      addSetValue(parentResponseIds, response.parentResponseId);
      if (response.responseId && assetResponseIds.has(String(response.responseId))) {
        responseIdsMatchedToAssets += 1;
        conversationHasAssetResponse = true;
      }
      if (typeof response.message === 'string' && response.message.length > 0) {
        messageLengths.push(response.message.length);
        messageHashes.add(hashString(response.message));
        if (sender === 'human') {
          promptCandidateCount += 1;
          conversationHasPrompt = true;
        }
      }
      if (sender === 'ASSISTANT') assistantResponseCount += 1;
    }
    if (conversationHasPrompt) conversationsWithPromptCandidate += 1;
    if (conversationHasAssetResponse) conversationsWithAssetResponseId += 1;
  }

  return {
    requestedConversationIds: assetConversationIds.size,
    capturedConversationRows: responseRows.length,
    statusCounts,
    responseCount,
    promptCandidateCount,
    assistantResponseCount,
    conversationsWithPromptCandidate,
    conversationsWithAssetResponseId,
    responseIdsMatchedToAssets,
    parseFailures,
    unique: {
      responseIds: responseIds.size,
      parentResponseIds: parentResponseIds.size,
      promptMessageHashes: messageHashes.size
    },
    hashSamples: {
      responseIds: [...responseIds].slice(0, 20).map((value) => shortHash(value)),
      promptMessageHashes: [...messageHashes].slice(0, 20).map((value) => value.slice(0, 16))
    },
    senderCounts,
    modelCounts,
    queryTypeCounts,
    messageLengthStats: messageLengths.length
      ? {
          count: messageLengths.length,
          min: Math.min(...messageLengths),
          max: Math.max(...messageLengths),
          average: Math.round((messageLengths.reduce((sum, value) => sum + value, 0) / messageLengths.length) * 10) / 10
        }
      : { count: 0, min: null, max: null, average: null }
  };
}

function summarizeMediaPosts(postRows, assetRows) {
  const assetIds = new Set(assetRows.map((row) => row.asset?.assetId).filter(Boolean).map(String));
  const postIds = new Set();
  const originalPostIds = new Set();
  const promptHashes = new Set();
  const originalPromptHashes = new Set();
  const promptLengths = [];
  const originalPromptLengths = [];
  const statusCounts = countBy(postRows, (row) => String(row.status));
  const mediaTypeCounts = {};
  const modeCounts = {};
  const modelNameCounts = {};
  let postCount = 0;
  let promptPresent = 0;
  let originalPromptPresent = 0;
  let assetIdsMatchedToPostIds = 0;
  let childPostCount = 0;
  let inputMediaItemCount = 0;
  let failed = 0;

  for (const row of postRows) {
    if (row.status !== 200 || row.parseError || !row.parsed?.post) {
      failed += 1;
      continue;
    }
    const post = row.parsed.post;
    postCount += 1;
    addSetValue(postIds, post.id);
    addSetValue(originalPostIds, post.originalPostId);
    if (post.id && assetIds.has(String(post.id))) assetIdsMatchedToPostIds += 1;
    if (post.mediaType) mediaTypeCounts[post.mediaType] = (mediaTypeCounts[post.mediaType] || 0) + 1;
    if (post.mode) modeCounts[post.mode] = (modeCounts[post.mode] || 0) + 1;
    if (post.modelName) modelNameCounts[post.modelName] = (modelNameCounts[post.modelName] || 0) + 1;
    if (Array.isArray(post.childPosts)) childPostCount += post.childPosts.length;
    if (Array.isArray(post.inputMediaItems)) inputMediaItemCount += post.inputMediaItems.length;
    if (typeof post.prompt === 'string' && post.prompt.length > 0) {
      promptPresent += 1;
      promptLengths.push(post.prompt.length);
      promptHashes.add(hashString(post.prompt));
    }
    if (typeof post.originalPrompt === 'string' && post.originalPrompt.length > 0) {
      originalPromptPresent += 1;
      originalPromptLengths.push(post.originalPrompt.length);
      originalPromptHashes.add(hashString(post.originalPrompt));
    }
  }

  function lengthStats(lengths) {
    return lengths.length
      ? {
          count: lengths.length,
          min: Math.min(...lengths),
          max: Math.max(...lengths),
          average: Math.round((lengths.reduce((sum, value) => sum + value, 0) / lengths.length) * 10) / 10
        }
      : { count: 0, min: null, max: null, average: null };
  }

  return {
    requestedAssetIds: assetIds.size,
    capturedPostRows: postRows.length,
    statusCounts,
    postCount,
    failedMediaPosts: failed,
    promptPresent,
    originalPromptPresent,
    assetIdsMatchedToPostIds,
    childPostCount,
    inputMediaItemCount,
    unique: {
      postIds: postIds.size,
      originalPostIds: originalPostIds.size,
      promptHashes: promptHashes.size,
      originalPromptHashes: originalPromptHashes.size
    },
    hashSamples: {
      postIds: [...postIds].slice(0, 20).map((value) => shortHash(value)),
      originalPostIds: [...originalPostIds].slice(0, 20).map((value) => shortHash(value)),
      promptHashes: [...promptHashes].slice(0, 20).map((value) => value.slice(0, 16)),
      originalPromptHashes: [...originalPromptHashes].slice(0, 20).map((value) => value.slice(0, 16))
    },
    mediaTypeCounts,
    modeCounts,
    modelNameCounts,
    promptLengthStats: lengthStats(promptLengths),
    originalPromptLengthStats: lengthStats(originalPromptLengths)
  };
}

async function captureAssetPages(initialMemory) {
  const rows = [];
  const pageSummaries = [];
  const seenPageTokens = new Set();
  let nextPageToken = null;
  let completedPagination = false;
  let stoppedReason = null;

  for (let pageIndex = 0; pageIndex < options.maxPages; pageIndex += 1) {
    const memory = await chromeRssMb();
    const memoryDeltaMb = Math.round((memory.totalRssMb - initialMemory.totalRssMb) * 10) / 10;
    if (memory.totalRssMb > options.maxChromeRssMb || memoryDeltaMb > options.maxChromeRssDeltaMb) {
      stoppedReason = 'chrome_memory_guard';
      pageSummaries.push({ pageIndex, skipped: true, memory, memoryDeltaMb, stoppedReason });
      break;
    }

    const url = assetUrl(nextPageToken);
    const result = await runActiveTabJs(getJsonJs(url));
    const parsed = parseResponseText(result, `asset page ${pageIndex + 1}`);
    const assets = Array.isArray(parsed.assets) ? parsed.assets : [];
    const capturedAt = nowIso();
    for (let assetIndex = 0; assetIndex < assets.length; assetIndex += 1) {
      rows.push({
        schemaVersion: 1,
        capturedAt,
        source: 'grok_rest_assets',
        pageIndex,
        assetIndex,
        asset: assets[assetIndex]
      });
    }
    pageSummaries.push({
      pageIndex,
      status: result.status,
      assetCount: assets.length,
      textLength: result.textLength,
      nextPageTokenPresent: Boolean(parsed.nextPageToken),
      memory,
      memoryDeltaMb
    });

    if (result.status !== 200) {
      stoppedReason = `asset_http_${result.status}`;
      break;
    }
    if (!parsed.nextPageToken) {
      completedPagination = true;
      stoppedReason = 'end_of_pagination';
      break;
    }
    if (seenPageTokens.has(parsed.nextPageToken)) {
      stoppedReason = 'repeated_next_page_token';
      break;
    }
    seenPageTokens.add(parsed.nextPageToken);
    nextPageToken = parsed.nextPageToken;
    if (options.requestWaitMs) await sleep(options.requestWaitMs);
  }

  if (!completedPagination && !stoppedReason) stoppedReason = 'max_pages_reached';
  return { rows, pageSummaries, completedPagination, stoppedReason };
}

async function captureConversationResponses(assetRows, initialMemory, existingRows = []) {
  if (!options.includeResponses) {
    return {
      rows: existingRows,
      batchSummaries: [],
      completedResponses: existingRows.length > 0,
      allConversationIdsAttempted: existingRows.length > 0,
      failedConversationResponses: existingRows.filter((row) => row.status !== 200 || row.parseError).length,
      stoppedReason: 'disabled_by_env_retained_existing_rows',
      uniqueConversationIds: new Set(assetRows.map((row) => row.asset?.sourceConversationId).filter(Boolean).map(String)).size,
      existingConversationRows: existingRows.length,
      uncapturedConversationIdsBeforeRun: 0
    };
  }

  const uniqueConversationIds = [
    ...new Set(assetRows.map((row) => row.asset?.sourceConversationId).filter(Boolean).map(String))
  ];
  const existingByConversationId = new Map();
  for (const row of existingRows) {
    if (row.sourceConversationId) existingByConversationId.set(String(row.sourceConversationId), row);
  }
  const uncapturedConversationIds = uniqueConversationIds.filter((id) => !existingByConversationId.has(id));
  const targetConversationIds = uncapturedConversationIds.slice(0, options.maxConversations);
  const rows = uniqueConversationIds
    .filter((id) => existingByConversationId.has(id))
    .map((id) => existingByConversationId.get(id));
  const batchSummaries = [];
  let stoppedEarly = false;
  let stoppedReason = targetConversationIds.length === uncapturedConversationIds.length
    ? 'all_requested_conversations_attempted'
    : 'max_conversations_reached';

  for (let start = 0; start < targetConversationIds.length; start += options.conversationBatchSize) {
    const memory = await chromeRssMb();
    const memoryDeltaMb = Math.round((memory.totalRssMb - initialMemory.totalRssMb) * 10) / 10;
    if (memory.totalRssMb > options.maxChromeRssMb || memoryDeltaMb > options.maxChromeRssDeltaMb) {
      stoppedEarly = true;
      stoppedReason = 'chrome_memory_guard';
      batchSummaries.push({ batchIndex: batchSummaries.length, skipped: true, memory, memoryDeltaMb, stoppedReason });
      break;
    }

    const batch = targetConversationIds.slice(start, start + options.conversationBatchSize);
    const result = await runActiveTabJs(getConversationBatchJs(batch));
    const capturedAt = nowIso();
    let okCount = 0;
    let retryableFailureCount = 0;
    let terminalGapCount = 0;
    for (const item of result.results || []) {
      let parsed = null;
      let parseError = null;
      try {
        parsed = JSON.parse(item.text || '{}');
      } catch (error) {
        parseError = error.message;
      }
      if (item.status === 200 && parsed) okCount += 1;
      if (item.status === 404) terminalGapCount += 1;
      if (item.status === 429 || item.status >= 500 || parseError) retryableFailureCount += 1;
      rows.push({
        schemaVersion: 1,
        capturedAt,
        source: 'grok_app_chat_conversation_responses',
        sourceConversationId: item.sourceConversationId,
        status: item.status,
        contentType: item.contentType,
        textLength: item.textLength,
        parseError,
        parsed
      });
    }
    batchSummaries.push({
      batchIndex: batchSummaries.length,
      requested: batch.length,
      okCount,
      terminalGapCount,
      retryableFailureCount,
      memory,
      memoryDeltaMb
    });
    if (retryableFailureCount > 0) {
      stoppedEarly = true;
      stoppedReason = 'conversation_response_retryable_http_or_parse_failure';
      break;
    }
    if (options.requestWaitMs) await sleep(options.requestWaitMs);
  }

  const attemptedConversationIds = new Set(rows.map((row) => row.sourceConversationId).filter(Boolean).map(String));
  const allConversationIdsAttempted = uniqueConversationIds.every((id) => attemptedConversationIds.has(id));
  const failedConversationResponses = rows.filter((row) => row.status !== 200 || row.parseError).length;
  return {
    rows,
    batchSummaries,
    completedResponses: allConversationIdsAttempted && !stoppedEarly,
    allConversationIdsAttempted,
    failedConversationResponses,
    stoppedReason: allConversationIdsAttempted && !stoppedEarly
      ? (failedConversationResponses ? 'all_conversations_attempted_with_response_gaps' : 'all_conversation_responses_captured')
      : stoppedReason,
    uniqueConversationIds: uniqueConversationIds.length,
    existingConversationRows: existingRows.length,
    uncapturedConversationIdsBeforeRun: uncapturedConversationIds.length
  };
}

function mediaPostItemToRow(item, capturedAt) {
  let parsed = null;
  let parseError = item.parseError || null;
  if (!parseError) {
    try {
      parsed = JSON.parse(item.text || '{}');
    } catch (error) {
      parseError = error.message;
    }
  }
  return {
    schemaVersion: 1,
    capturedAt,
    source: 'grok_media_post_get',
    assetId: item.assetId,
    status: item.status,
    contentType: item.contentType,
    textLength: item.textLength,
    parseError,
    parsed
  };
}

function summarizeMediaPostBatch(rows) {
  return {
    requested: rows.length,
    okCount: rows.filter((row) => row.status === 200 && row.parsed?.post).length,
    terminalGapCount: rows.filter((row) => row.status === 404).length,
    retryableFailureCount: rows.filter((row) => row.status === 429 || row.status >= 500 || row.parseError).length
  };
}

function mediaPostProgress(rows, uniqueAssetIds) {
  return {
    attempted: new Set(rows.map((row) => row.assetId).filter(Boolean).map(String)).size,
    total: uniqueAssetIds.length,
    ok: rows.filter((row) => row.status === 200 && row.parsed?.post).length,
    failed: rows.filter((row) => row.status !== 200 || row.parseError || !row.parsed?.post).length
  };
}

async function captureMediaPosts(assetRows, initialMemory, existingRows = []) {
  if (!options.includeMediaPosts) {
    const uniqueAssetIds = new Set(assetRows.map((row) => row.asset?.assetId).filter(Boolean).map(String));
    return {
      rows: existingRows,
      batchSummaries: [],
      completedMediaPosts: existingRows.length > 0,
      allAssetIdsAttempted: existingRows.length > 0,
      failedMediaPosts: existingRows.filter((row) => row.status !== 200 || row.parseError || !row.parsed?.post).length,
      stoppedReason: 'disabled_by_env_retained_existing_rows',
      uniqueAssetIds: uniqueAssetIds.size,
      existingMediaPostRows: existingRows.length,
      uncapturedMediaPostsBeforeRun: 0,
      retryFailedMediaPostsBeforeRun: 0,
      captureMode: options.mediaPostCaptureMode
    };
  }

  const uniqueAssetIds = [
    ...new Set(assetRows.map((row) => row.asset?.assetId).filter(Boolean).map(String))
  ];
  const existingByAssetId = new Map();
  const existingSuccessByAssetId = new Map();
  for (const row of existingRows) {
    if (!row.assetId) continue;
    const assetId = String(row.assetId);
    existingByAssetId.set(assetId, row);
    if (row.status === 200 && row.parsed?.post) existingSuccessByAssetId.set(assetId, row);
  }
  const uncapturedAssetIds = uniqueAssetIds.filter((id) => !existingByAssetId.has(id));
  const retryAssetIds = options.retryFailedMediaPosts
    ? uniqueAssetIds.filter((id) => existingByAssetId.has(id) && !existingSuccessByAssetId.has(id))
    : [];
  const retryAssetIdSet = new Set(retryAssetIds);
  const targetAssetIds = [...uncapturedAssetIds, ...retryAssetIds].slice(0, options.maxMediaPosts);
  const rows = uniqueAssetIds
    .filter((id) => existingByAssetId.has(id) && !retryAssetIdSet.has(id))
    .map((id) => existingByAssetId.get(id));
  const batchSummaries = [];
  let stoppedEarly = false;
  let stoppedReason = targetAssetIds.length === uncapturedAssetIds.length + retryAssetIds.length
    ? 'all_requested_media_posts_attempted'
    : 'max_media_posts_reached';
  let consecutiveRetryableFailureBatches = 0;

  if (targetAssetIds.length === 0) {
    const attemptedAssetIds = new Set(rows.map((row) => row.assetId).filter(Boolean).map(String));
    const allAssetIdsAttempted = uniqueAssetIds.every((id) => attemptedAssetIds.has(id));
    const failedMediaPosts = rows.filter((row) => row.status !== 200 || row.parseError || !row.parsed?.post).length;
    return {
      rows,
      batchSummaries,
      completedMediaPosts: allAssetIdsAttempted,
      allAssetIdsAttempted,
      failedMediaPosts,
      stoppedReason: allAssetIdsAttempted
        ? (failedMediaPosts ? 'all_media_posts_attempted_with_response_gaps' : 'all_media_posts_captured')
        : 'no_target_media_posts_selected',
      uniqueAssetIds: uniqueAssetIds.length,
      existingMediaPostRows: existingRows.length,
      uncapturedMediaPostsBeforeRun: uncapturedAssetIds.length,
      retryFailedMediaPostsBeforeRun: retryAssetIds.length,
      captureMode: options.mediaPostCaptureMode
    };
  }

  if (options.mediaPostCaptureMode === 'sync_debug') {
    if (options.mediaPostBatchSize > options.syncMediaPostMaxBatchSize) {
      throw new Error(`sync_debug media-post batch size must be <= ${options.syncMediaPostMaxBatchSize}`);
    }
    if (targetAssetIds.length > options.syncMediaPostMaxBatchSize) {
      throw new Error(`sync_debug media-post target count must be <= ${options.syncMediaPostMaxBatchSize}`);
    }
  }

  if (options.mediaPostCaptureMode === 'async_worker') {
    const jobId = `grok-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let install = await runActiveTabJs(installMediaPostWorkerJs(jobId, options.mediaPostWorkerConcurrency));
    if (install.status === 'already_running' && install.state?.jobId) {
      await runActiveTabJs(stopMediaPostWorkerJs(install.state.jobId));
      await sleep(250);
      install = await runActiveTabJs(installMediaPostWorkerJs(jobId, options.mediaPostWorkerConcurrency));
    }
    if (install.status !== 'installed') {
      throw new Error(`Could not install Grok media-post worker: ${install.status} ${install.href || ''}`.trim());
    }

    for (let start = 0; start < targetAssetIds.length; start += options.mediaPostWorkerEnqueueSize) {
      const memory = await chromeRssMb();
      const memoryDeltaMb = Math.round((memory.totalRssMb - initialMemory.totalRssMb) * 10) / 10;
      if (memory.totalRssMb > options.maxChromeRssMb || memoryDeltaMb > options.maxChromeRssDeltaMb) {
        stoppedEarly = true;
        stoppedReason = 'chrome_memory_guard_before_worker_enqueue';
        batchSummaries.push({ batchIndex: batchSummaries.length, skipped: true, memory, memoryDeltaMb, stoppedReason });
        await runActiveTabJs(stopMediaPostWorkerJs(jobId)).catch(() => null);
        break;
      }
      const enqueue = await runActiveTabJs(enqueueMediaPostWorkerJs(
        jobId,
        targetAssetIds.slice(start, start + options.mediaPostWorkerEnqueueSize)
      ));
      if (enqueue.status !== 'enqueued') {
        stoppedEarly = true;
        stoppedReason = `media_post_worker_enqueue_${enqueue.status}`;
        batchSummaries.push({ batchIndex: batchSummaries.length, skipped: true, memory, memoryDeltaMb, stoppedReason });
        await runActiveTabJs(stopMediaPostWorkerJs(jobId)).catch(() => null);
        break;
      }
    }

    let noProgressPolls = 0;
    while (!stoppedEarly) {
      const memory = await chromeRssMb();
      const memoryDeltaMb = Math.round((memory.totalRssMb - initialMemory.totalRssMb) * 10) / 10;
      if (memory.totalRssMb > options.maxChromeRssMb || memoryDeltaMb > options.maxChromeRssDeltaMb) {
        stoppedEarly = true;
        stoppedReason = 'chrome_memory_guard';
        batchSummaries.push({ batchIndex: batchSummaries.length, skipped: true, memory, memoryDeltaMb, stoppedReason });
        await runActiveTabJs(stopMediaPostWorkerJs(jobId)).catch(() => null);
      }

      const drain = await runActiveTabJs(drainMediaPostWorkerJs(jobId, options.mediaPostWorkerDrainSize));
      if (drain.status !== 'drained') {
        stoppedEarly = true;
        stoppedReason = `media_post_worker_drain_${drain.status}`;
        batchSummaries.push({ batchIndex: batchSummaries.length, skipped: true, memory, memoryDeltaMb, stoppedReason });
        break;
      }

      const capturedAt = nowIso();
      const batchRows = (drain.results || []).map((item) => mediaPostItemToRow(item, capturedAt));
      if (batchRows.length > 0) {
        rows.push(...batchRows);
        await appendPrivateJsonl(MEDIA_POST_JSONL_REL_PATH, batchRows);
        const batchSummary = summarizeMediaPostBatch(batchRows);
        batchSummaries.push({
          batchIndex: batchSummaries.length,
          requested: batchSummary.requested,
          okCount: batchSummary.okCount,
          terminalGapCount: batchSummary.terminalGapCount,
          retryableFailureCount: batchSummary.retryableFailureCount,
          memory,
          memoryDeltaMb,
          workerState: drain.state
        });
        noProgressPolls = 0;
        if (options.mediaPostProgressEveryBatches && batchSummaries.length % options.mediaPostProgressEveryBatches === 0) {
          const progress = mediaPostProgress(rows, uniqueAssetIds);
          console.error(`media post progress: attempted ${progress.attempted}/${progress.total}, ok ${progress.ok}, failed ${progress.failed}`);
        }
      } else {
        noProgressPolls += 1;
      }

      if (drain.state?.done && drain.state.pendingResults === 0 && batchRows.length === 0) break;
      if (noProgressPolls >= options.mediaPostWorkerMaxNoProgressPolls) {
        stoppedEarly = true;
        stoppedReason = 'media_post_worker_no_progress_timeout';
        await runActiveTabJs(stopMediaPostWorkerJs(jobId)).catch(() => null);
        break;
      }
      if (options.mediaPostWorkerPollMs) await sleep(options.mediaPostWorkerPollMs);
    }
  }

  if (options.mediaPostCaptureMode === 'sync_debug') {
    for (let start = 0; start < targetAssetIds.length; start += options.mediaPostBatchSize) {
      const memory = await chromeRssMb();
      const memoryDeltaMb = Math.round((memory.totalRssMb - initialMemory.totalRssMb) * 10) / 10;
      if (memory.totalRssMb > options.maxChromeRssMb || memoryDeltaMb > options.maxChromeRssDeltaMb) {
        stoppedEarly = true;
        stoppedReason = 'chrome_memory_guard';
        batchSummaries.push({ batchIndex: batchSummaries.length, skipped: true, memory, memoryDeltaMb, stoppedReason });
        break;
      }

      const batch = targetAssetIds.slice(start, start + options.mediaPostBatchSize);
      const result = await runActiveTabJs(getMediaPostBatchJs(batch));
      const capturedAt = nowIso();
      const batchRows = (result.results || []).map((item) => mediaPostItemToRow(item, capturedAt));
      const batchSummary = summarizeMediaPostBatch(batchRows);
      rows.push(...batchRows);
      await appendPrivateJsonl(MEDIA_POST_JSONL_REL_PATH, batchRows);
      batchSummaries.push({
        batchIndex: batchSummaries.length,
        requested: batchSummary.requested,
        okCount: batchSummary.okCount,
        terminalGapCount: batchSummary.terminalGapCount,
        retryableFailureCount: batchSummary.retryableFailureCount,
        memory,
        memoryDeltaMb
      });
      if (batchSummary.retryableFailureCount > 0 && batchSummary.okCount === 0 && batchSummary.terminalGapCount === 0) {
        consecutiveRetryableFailureBatches += 1;
      } else {
        consecutiveRetryableFailureBatches = 0;
      }
      if (options.mediaPostProgressEveryBatches && batchSummaries.length % options.mediaPostProgressEveryBatches === 0) {
        const progress = mediaPostProgress(rows, uniqueAssetIds);
        console.error(`media post progress: attempted ${progress.attempted}/${progress.total}, ok ${progress.ok}, failed ${progress.failed}`);
      }
      if (consecutiveRetryableFailureBatches >= options.maxConsecutiveMediaPostFailureBatches) {
        stoppedEarly = true;
        stoppedReason = 'media_post_consecutive_retryable_http_or_parse_failures';
        break;
      }
      if (options.requestWaitMs) await sleep(options.requestWaitMs);
    }
  }

  const attemptedAssetIds = new Set(rows.map((row) => row.assetId).filter(Boolean).map(String));
  const allAssetIdsAttempted = uniqueAssetIds.every((id) => attemptedAssetIds.has(id));
  const failedMediaPosts = rows.filter((row) => row.status !== 200 || row.parseError || !row.parsed?.post).length;
  return {
    rows,
    batchSummaries,
    completedMediaPosts: allAssetIdsAttempted && !stoppedEarly,
    allAssetIdsAttempted,
    failedMediaPosts,
    stoppedReason: allAssetIdsAttempted && !stoppedEarly
      ? (failedMediaPosts ? 'all_media_posts_attempted_with_response_gaps' : 'all_media_posts_captured')
      : stoppedReason,
    uniqueAssetIds: uniqueAssetIds.length,
    existingMediaPostRows: existingRows.length,
    uncapturedMediaPostsBeforeRun: uncapturedAssetIds.length,
    retryFailedMediaPostsBeforeRun: retryAssetIds.length,
    captureMode: options.mediaPostCaptureMode
  };
}

async function main() {
  await fs.mkdir(privateDir, { recursive: true });
  const startedAt = nowIso();
  const initialMemory = await chromeRssMb();
  const probe = await runActiveTabJs(pageProbeJs());
  assertGrokSavedProbe(probe);

  const previousAssetSummary = await optionalJson('inventory/grok-assets-current-summary.json');
  const existingAssetRows = await optionalPrivateJsonl('private/grok-assets-current-inventory.jsonl');
  const canReuseAssets = options.reuseAssets &&
    existingAssetRows.length > 0 &&
    previousAssetSummary?.traversal?.completedPagination;
  const assetCapture = canReuseAssets
    ? {
        rows: existingAssetRows,
        pageSummaries: pageSummariesFromAssetRows(existingAssetRows, initialMemory),
        completedPagination: true,
        stoppedReason: 'reused_existing_complete_asset_inventory',
        reusedExistingArtifact: true
      }
    : await captureAssetPages(initialMemory);
  if (!canReuseAssets) await writePrivateJsonl('private/grok-assets-current-inventory.jsonl', assetCapture.rows);

  const existingConversationRows = await optionalPrivateJsonl('private/grok-conversation-responses-current.jsonl');
  const responseCapture = await captureConversationResponses(assetCapture.rows, initialMemory, existingConversationRows);
  await writePrivateJsonl('private/grok-conversation-responses-current.jsonl', responseCapture.rows);

  const existingMediaPostRows = await optionalPrivateJsonl(MEDIA_POST_JSONL_REL_PATH);
  const mediaPostCapture = await captureMediaPosts(assetCapture.rows, initialMemory, existingMediaPostRows);
  await writePrivateJsonl(MEDIA_POST_JSONL_REL_PATH, mediaPostCapture.rows);

  const finishedAt = nowIso();
  const finalMemory = await chromeRssMb();
  const assetSummary = summarizeAssets(assetCapture.rows);
  const responseSummary = summarizeConversationResponses(responseCapture.rows, assetCapture.rows);
  const mediaPostSummary = summarizeMediaPosts(mediaPostCapture.rows, assetCapture.rows);
  const completed = assetCapture.completedPagination && mediaPostCapture.completedMediaPosts;
  const status = completed
    ? (mediaPostCapture.failedMediaPosts ? 'api_captured_post_identity_with_post_gaps' : 'api_captured_post_identity')
    : assetCapture.rows.length
      ? 'partial'
      : 'blocked';
  const identityStatus = completed
    ? 'api_media_post_ids_captured'
    : 'api_has_asset_and_response_ids_no_complete_media_post_ids';
  const limitation = completed
    ? 'Media post IDs were captured through the read-style /rest/media/post/get API without opening detail routes. Detail-route equivalence was not re-opened per item.'
    : 'The active-tab API inventory captured asset IDs, but media post identity capture did not complete.';

  const committedSummary = {
    generatedAt: finishedAt,
    startedAt,
    status,
    productionWrites: false,
    method: 'active_chrome_front_tab_same_origin_api',
    route: '/imagine/saved',
    api: {
      assets: '/rest/assets',
      conversationResponses: '/rest/app-chat/conversations/{sourceConversationId}/responses'
    },
    traversal: {
      completedPagination: assetCapture.completedPagination,
      stoppedReason: assetCapture.stoppedReason,
      reusedExistingArtifact: Boolean(assetCapture.reusedExistingArtifact),
      pageCount: assetCapture.reusedTraversal?.pageCount ?? assetCapture.pageSummaries.filter((page) => !page.skipped).length,
      requestedPageSize: options.pageSize,
      observedPageAssetCounts: assetCapture.reusedTraversal?.observedPageAssetCounts ?? countBy(assetCapture.pageSummaries.filter((page) => !page.skipped), (page) => String(page.assetCount)),
      pageSummaries: (assetCapture.reusedTraversal?.pageSummaries || assetCapture.pageSummaries).map((page) => ({
        pageIndex: page.pageIndex,
        skipped: Boolean(page.skipped),
        status: page.status || null,
        assetCount: page.assetCount || 0,
        textLength: page.textLength || null,
        nextPageTokenPresent: page.nextPageTokenPresent == null ? null : Boolean(page.nextPageTokenPresent),
        memoryTotalRssMb: page.memory?.totalRssMb ?? null,
        memoryDeltaMb: page.memoryDeltaMb ?? null,
        stoppedReason: page.stoppedReason || null
      }))
    },
    responses: {
      completedResponses: responseCapture.completedResponses,
      allConversationIdsAttempted: responseCapture.allConversationIdsAttempted,
      failedConversationResponses: responseCapture.failedConversationResponses,
      stoppedReason: responseCapture.stoppedReason,
      batchCount: responseCapture.batchSummaries.filter((batch) => !batch.skipped).length,
      batchSize: options.conversationBatchSize,
      uniqueConversationIds: responseCapture.uniqueConversationIds || 0,
      existingConversationRows: responseCapture.existingConversationRows || 0,
      uncapturedConversationIdsBeforeRun: responseCapture.uncapturedConversationIdsBeforeRun || 0,
      batchSummaries: responseCapture.batchSummaries.map((batch) => ({
        batchIndex: batch.batchIndex,
        skipped: Boolean(batch.skipped),
        requested: batch.requested || 0,
        okCount: batch.okCount || 0,
        terminalGapCount: batch.terminalGapCount || 0,
        retryableFailureCount: batch.retryableFailureCount || 0,
        memoryTotalRssMb: batch.memory?.totalRssMb ?? null,
        memoryDeltaMb: batch.memoryDeltaMb ?? null,
        stoppedReason: batch.stoppedReason || null
      })),
      summary: responseSummary
    },
    mediaPosts: {
      captureMode: mediaPostCapture.captureMode,
      completedMediaPosts: mediaPostCapture.completedMediaPosts,
      allAssetIdsAttempted: mediaPostCapture.allAssetIdsAttempted,
      failedMediaPosts: mediaPostCapture.failedMediaPosts,
      stoppedReason: mediaPostCapture.stoppedReason,
      batchCount: mediaPostCapture.batchSummaries.filter((batch) => !batch.skipped).length,
      batchSize: options.mediaPostBatchSize,
      workerConcurrency: options.mediaPostWorkerConcurrency,
      workerEnqueueSize: options.mediaPostWorkerEnqueueSize,
      workerDrainSize: options.mediaPostWorkerDrainSize,
      workerPollMs: options.mediaPostWorkerPollMs,
      uniqueAssetIds: mediaPostCapture.uniqueAssetIds || 0,
      existingMediaPostRows: mediaPostCapture.existingMediaPostRows || 0,
      uncapturedMediaPostsBeforeRun: mediaPostCapture.uncapturedMediaPostsBeforeRun || 0,
      retryFailedMediaPostsBeforeRun: mediaPostCapture.retryFailedMediaPostsBeforeRun || 0,
      batchSummaries: mediaPostCapture.batchSummaries.map((batch) => ({
        batchIndex: batch.batchIndex,
        skipped: Boolean(batch.skipped),
        requested: batch.requested || 0,
        okCount: batch.okCount || 0,
        terminalGapCount: batch.terminalGapCount || 0,
        retryableFailureCount: batch.retryableFailureCount || 0,
        memoryTotalRssMb: batch.memory?.totalRssMb ?? null,
        memoryDeltaMb: batch.memoryDeltaMb ?? null,
        stoppedReason: batch.stoppedReason || null
      })),
      summary: mediaPostSummary
    },
    assets: assetSummary,
    identity: {
      status: identityStatus,
      preferredIdentityCaptured: completed,
      identityLimited: !completed,
      limitation
    },
    chromeMemory: {
      initialTotalRssMb: initialMemory.totalRssMb,
      finalTotalRssMb: finalMemory.totalRssMb,
      maxObservedAssetPageTotalRssMb: Math.max(
        initialMemory.totalRssMb,
        ...assetCapture.pageSummaries.map((page) => page.memory?.totalRssMb || initialMemory.totalRssMb)
      ),
      maxObservedResponseBatchTotalRssMb: Math.max(
        initialMemory.totalRssMb,
        ...responseCapture.batchSummaries.map((batch) => batch.memory?.totalRssMb || initialMemory.totalRssMb)
      ),
      maxObservedMediaPostBatchTotalRssMb: Math.max(
        initialMemory.totalRssMb,
        ...mediaPostCapture.batchSummaries.map((batch) => batch.memory?.totalRssMb || initialMemory.totalRssMb)
      )
    },
    rawArtifacts: {
      assetInventoryJsonl: 'private/grok-assets-current-inventory.jsonl',
      conversationResponsesJsonl: 'private/grok-conversation-responses-current.jsonl',
      mediaPostsJsonl: 'private/grok-media-posts-current.jsonl',
      gitIgnored: true,
      containsExactAssetIds: true,
      containsExactSourceConversationIds: true,
      containsExactMediaKeys: true,
      containsRawPromptMessages: true,
      containsRawMediaPostPrompts: true
    },
    committedExactPrivateValues: false
  };

  await writeJson('inventory/grok-assets-current-summary.json', committedSummary);
  await writeJson('logs/grok-assets-active-tab-capture.json', {
    generatedAt: finishedAt,
    productionWrites: false,
    status,
    method: committedSummary.method,
    route: committedSummary.route,
    assetRows: assetSummary.rowCount,
    uniqueAssetIds: assetSummary.unique.assetIds,
    uniqueSourceConversationIds: assetSummary.unique.sourceConversationIds,
    promptCandidateCount: responseSummary.promptCandidateCount,
    mediaPostPromptCount: mediaPostSummary.promptPresent,
    mediaPostOriginalPromptCount: mediaPostSummary.originalPromptPresent,
    mediaPostCaptureMode: mediaPostCapture.captureMode,
    completedAssetPagination: assetCapture.completedPagination,
    completedConversationResponses: responseCapture.completedResponses,
    allConversationIdsAttempted: responseCapture.allConversationIdsAttempted,
    failedConversationResponses: responseCapture.failedConversationResponses,
    completedMediaPosts: mediaPostCapture.completedMediaPosts,
    allAssetIdsAttempted: mediaPostCapture.allAssetIdsAttempted,
    failedMediaPosts: mediaPostCapture.failedMediaPosts,
    stoppedReason: completed ? 'completed_api_capture_post_identity' : `${assetCapture.stoppedReason}; ${responseCapture.stoppedReason}; ${mediaPostCapture.stoppedReason}`,
    identityLimited: !completed,
    rawArtifactsGitIgnored: true
  });

  await updateManifest((manifest) => {
    manifest.status = 'in_progress';
    manifest.subsystems ||= {};
    manifest.subsystems.grokSavedInventory = status;
    manifest.browserCapture ||= {};
    manifest.browserCapture.grokSavedActiveTabApi = {
      generatedAt: finishedAt,
      status,
      method: committedSummary.method,
      route: committedSummary.route,
      assetRows: assetSummary.rowCount,
      uniqueSourceConversationIds: assetSummary.unique.sourceConversationIds,
      promptCandidateCount: responseSummary.promptCandidateCount,
      mediaPostPromptCount: mediaPostSummary.promptPresent,
      mediaPostOriginalPromptCount: mediaPostSummary.originalPromptPresent,
      mediaPostCaptureMode: mediaPostCapture.captureMode,
      completedAssetPagination: assetCapture.completedPagination,
      completedConversationResponses: responseCapture.completedResponses,
      allConversationIdsAttempted: responseCapture.allConversationIdsAttempted,
      failedConversationResponses: responseCapture.failedConversationResponses,
      completedMediaPosts: mediaPostCapture.completedMediaPosts,
      allAssetIdsAttempted: mediaPostCapture.allAssetIdsAttempted,
      failedMediaPosts: mediaPostCapture.failedMediaPosts,
      committedSummary: 'inventory/grok-assets-current-summary.json',
      rawAssetInventory: 'private/grok-assets-current-inventory.jsonl',
      rawConversationResponses: 'private/grok-conversation-responses-current.jsonl',
      rawMediaPosts: 'private/grok-media-posts-current.jsonl',
      identityStatus: committedSummary.identity.status
    };
  });

  console.log(`grok asset rows: ${assetSummary.rowCount}`);
  console.log(`asset pagination: ${assetCapture.completedPagination ? 'complete' : 'partial'} (${assetCapture.stoppedReason})`);
  console.log(`conversation responses: ${responseCapture.completedResponses ? 'complete' : 'partial'} (${responseCapture.stoppedReason})`);
  console.log(`conversation response gaps: ${responseCapture.failedConversationResponses || 0}`);
  console.log(`media posts: ${mediaPostCapture.completedMediaPosts ? 'complete' : 'partial'} (${mediaPostCapture.stoppedReason})`);
  console.log(`media post gaps: ${mediaPostCapture.failedMediaPosts || 0}`);
  console.log(`prompt candidates: ${responseSummary.promptCandidateCount}`);
  console.log(`media post prompts: ${mediaPostSummary.promptPresent}`);
  console.log(`identity status: ${committedSummary.identity.status}`);
  console.log('raw asset inventory: docs/audits/2026-06-26-production-r2-vault-system-audit/private/grok-assets-current-inventory.jsonl');
  console.log('raw conversation responses: docs/audits/2026-06-26-production-r2-vault-system-audit/private/grok-conversation-responses-current.jsonl');
  console.log('raw media posts: docs/audits/2026-06-26-production-r2-vault-system-audit/private/grok-media-posts-current.jsonl');
  console.log('redacted summary: docs/audits/2026-06-26-production-r2-vault-system-audit/inventory/grok-assets-current-summary.json');
}

await main();
