#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
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
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;

const options = {
  maxViewports: numberFromEnv('GROK_CAPTURE_MAX_VIEWPORTS', 25),
  scrollRatio: numberFromEnv('GROK_CAPTURE_SCROLL_RATIO', 0.75),
  waitMs: numberFromEnv('GROK_CAPTURE_WAIT_MS', 1200),
  maxChromeRssMb: numberFromEnv('GROK_CAPTURE_MAX_CHROME_RSS_MB', 34000),
  maxChromeRssDeltaMb: numberFromEnv('GROK_CAPTURE_MAX_CHROME_RSS_DELTA_MB', 2000),
  maxVisibleMedia: numberFromEnv('GROK_CAPTURE_MAX_VISIBLE_MEDIA', 120),
  resetToTop: process.env.GROK_CAPTURE_RESET_TO_TOP !== '0'
};

function numberFromEnv(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

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
  if (value == null || value === '') return null;
  return hashString(value).slice(0, length);
}

function extractUuids(value) {
  return [...String(value || '').matchAll(UUID_RE)].map((match) => match[0].toLowerCase());
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
    maxBuffer: 16 * 1024 * 1024
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
      readyState: document.readyState,
      images: document.images.length,
      videos: document.querySelectorAll('video').length
    };
  })())`;
}

function resetJs() {
  return `JSON.stringify((function(){
    var scroller = (${findScrollerSource()})();
    if (!scroller) return { ok:false, reason:'no_main_scroller' };
    var before = Math.round(scroller.scrollTop);
    scroller.scrollTop = 0;
    return { ok:true, before: before, after: Math.round(scroller.scrollTop) };
  })())`;
}

function captureViewportJs(viewportIndex) {
  return `JSON.stringify((function(){
    var UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;
    function cleanUrl(value) {
      if (!value) return null;
      try {
        var url = new URL(String(value), location.href);
        url.search = '';
        url.hash = '';
        return url.href;
      } catch (_) {
        return String(value).split(/[?#]/, 1)[0] || null;
      }
    }
    function uuids(value) {
      return Array.from(String(value || '').matchAll(UUID_RE)).map(function(match) { return match[0].toLowerCase(); });
    }
    function rect(el) {
      var r = el.getBoundingClientRect();
      return {
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height)
      };
    }
    function classText(el) {
      return typeof el.className === 'string' ? el.className : '';
    }
    function inScrollerView(el, scrollerRect) {
      var r = el.getBoundingClientRect();
      return r.width > 50 && r.height > 50 && r.bottom > scrollerRect.top && r.top < scrollerRect.bottom && r.right > scrollerRect.left && r.left < scrollerRect.right;
    }
    function cardFor(el, scroller) {
      var scrollerRect = scroller.getBoundingClientRect();
      var fallback = el.parentElement || el;
      for (var node = el.parentElement, depth = 0; node && node !== scroller && depth < 10; node = node.parentElement, depth += 1) {
        var r = node.getBoundingClientRect();
        var cls = classText(node);
        var looksCard = r.width >= 120 && r.height >= 120 && r.left >= scrollerRect.left - 8 && r.right <= scrollerRect.right + 8 && r.height <= scrollerRect.height * 0.9;
        if (!looksCard) continue;
        fallback = node;
        if (node.tagName === 'A' || node.getAttribute('role') === 'button' || /cursor-pointer|rounded|overflow-hidden|group/.test(cls)) return node;
      }
      return fallback;
    }
    function mediaInfo(media) {
      var urls = [
        cleanUrl(media.currentSrc),
        cleanUrl(media.src),
        cleanUrl(media.poster),
        cleanUrl(media.getAttribute('src')),
        cleanUrl(media.getAttribute('poster'))
      ].filter(Boolean);
      urls = Array.from(new Set(urls));
      return {
        tag: media.tagName.toLowerCase(),
        rect: rect(media),
        urls: urls,
        mediaUuids: Array.from(new Set(urls.flatMap(uuids))),
        alt: media.getAttribute('alt') || null,
        ariaLabel: media.getAttribute('aria-label') || null
      };
    }
    function collectHrefs(card) {
      var hrefs = Array.from(card.querySelectorAll('a[href]')).map(function(link) { return cleanUrl(link.getAttribute('href')); }).filter(Boolean);
      if (card.tagName === 'A') hrefs.push(cleanUrl(card.getAttribute('href')));
      return Array.from(new Set(hrefs));
    }
    var scroller = (${findScrollerSource()})();
    if (!scroller) return { ok:false, reason:'no_main_scroller', href: location.href };
    var scrollerRect = scroller.getBoundingClientRect();
    var media = Array.from(scroller.querySelectorAll('img,video')).filter(function(el) { return inScrollerView(el, scrollerRect); });
    var byCard = new Map();
    for (var i = 0; i < media.length; i += 1) {
      var card = cardFor(media[i], scroller);
      var key = JSON.stringify(rect(card));
      if (!byCard.has(key)) {
        byCard.set(key, {
          viewportIndex: ${Number(viewportIndex)},
          cardRect: rect(card),
          role: card.getAttribute('role') || null,
          tag: card.tagName.toLowerCase(),
          className: classText(card).split(/\\s+/).slice(0, 8).join(' '),
          ariaLabel: card.getAttribute('aria-label') || null,
          title: card.getAttribute('title') || null,
          text: (card.innerText || '').trim().slice(0, 12000),
          hrefs: collectHrefs(card),
          media: []
        });
      }
      byCard.get(key).media.push(mediaInfo(media[i]));
    }
    var cards = Array.from(byCard.values()).map(function(card, index) {
      var urls = Array.from(new Set(card.media.flatMap(function(item) { return item.urls; }).concat(card.hrefs)));
      var uuidsFound = Array.from(new Set(urls.flatMap(uuids)));
      var postIds = Array.from(new Set(card.hrefs.filter(function(href) { return /\\/imagine\\/post\\//.test(href); }).flatMap(uuids)));
      card.candidateIndex = index;
      card.urls = urls;
      card.mediaUuids = uuidsFound;
      card.grokPostIds = postIds;
      return card;
    });
    return {
      ok: true,
      href: location.href,
      title: document.title,
      readyState: document.readyState,
      viewportIndex: ${Number(viewportIndex)},
      scrollTop: Math.round(scroller.scrollTop),
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
      atEnd: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4,
      totalImages: document.images.length,
      totalVideos: document.querySelectorAll('video').length,
      visibleMedia: media.length,
      cards: cards
    };
  })())`;
}

function scrollJs(scrollRatio) {
  return `JSON.stringify((function(){
    var scroller = (${findScrollerSource()})();
    if (!scroller) return { ok:false, reason:'no_main_scroller' };
    var before = Math.round(scroller.scrollTop);
    var delta = Math.max(1, Math.floor(scroller.clientHeight * ${Number(scrollRatio)}));
    scroller.scrollTop = Math.min(scroller.scrollTop + delta, scroller.scrollHeight - scroller.clientHeight);
    return {
      ok:true,
      before: before,
      after: Math.round(scroller.scrollTop),
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight
    };
  })())`;
}

function restoreJs(scrollTop) {
  return `JSON.stringify((function(){
    var scroller = (${findScrollerSource()})();
    if (!scroller) return { ok:false, reason:'no_main_scroller' };
    scroller.scrollTop = ${Number(scrollTop)};
    return { ok:true, scrollTop: Math.round(scroller.scrollTop) };
  })())`;
}

function findScrollerSource() {
  return `function(){
    var candidates = Array.from(document.querySelectorAll('body *')).map(function(el) {
      var r = el.getBoundingClientRect();
      return {
        el: el,
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        scrollable: el.scrollHeight - el.clientHeight
      };
    }).filter(function(item) {
      return item.scrollable > 100 && item.width > 500 && item.height > 500 && item.left > 150;
    }).sort(function(a, b) {
      return b.scrollable - a.scrollable;
    });
    return candidates[0] ? candidates[0].el : null;
  }`;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function makeRawRow(runId, viewport, card) {
  const grokPostSeed = [...(card.grokPostIds || [])].sort().join('|');
  const urlSeed = [...(card.urls || [])].sort().join('|');
  const rawIdentitySeed = grokPostSeed
    ? `post:${grokPostSeed}`
    : urlSeed
      ? `urls:${urlSeed}`
      : [
          'fallback',
          card.text || '',
          JSON.stringify(card.cardRect || {})
        ].join('\n');
  return {
    schemaVersion: 1,
    captureRunId: runId,
    capturedAt: nowIso(),
    source: 'grok_saved_active_tab_grid',
    route: '/imagine/saved',
    viewportIndex: viewport.viewportIndex,
    scrollTop: viewport.scrollTop,
    candidateIndex: card.candidateIndex,
    candidateSignature: hashString(rawIdentitySeed),
    cardRect: card.cardRect,
    tag: card.tag,
    role: card.role,
    className: card.className,
    ariaLabel: card.ariaLabel,
    title: card.title,
    text: card.text,
    hrefs: card.hrefs || [],
    urls: card.urls || [],
    mediaUuids: card.mediaUuids || [],
    grokPostIds: card.grokPostIds || [],
    media: card.media || []
  };
}

function summarizeRows(rows) {
  const mediaUrlHashes = new Set();
  const mediaUuidHashes = new Set();
  const grokPostIdHashes = new Set();
  let rowsWithText = 0;
  let rowsWithGrokPostId = 0;
  let imageMedia = 0;
  let videoMedia = 0;

  for (const row of rows) {
    if (row.text) rowsWithText += 1;
    if (row.grokPostIds.length) rowsWithGrokPostId += 1;
    for (const url of row.urls) mediaUrlHashes.add(shortHash(url));
    for (const uuid of row.mediaUuids) mediaUuidHashes.add(shortHash(uuid));
    for (const postId of row.grokPostIds) grokPostIdHashes.add(shortHash(postId));
    for (const media of row.media) {
      if (media.tag === 'video') videoMedia += 1;
      if (media.tag === 'img') imageMedia += 1;
    }
  }

  return {
    uniqueCandidateCount: rows.length,
    uniqueMediaUrlHashCount: mediaUrlHashes.size,
    uniqueMediaUuidHashCount: mediaUuidHashes.size,
    uniqueGrokPostIdHashCount: grokPostIdHashes.size,
    rowsWithText,
    rowsWithGrokPostId,
    mediaElementCounts: {
      image: imageMedia,
      video: videoMedia
    },
    sampleCandidateHashes: rows.slice(0, 20).map((row) => shortHash(row.candidateSignature)),
    sampleMediaUrlHashes: [...mediaUrlHashes].filter(Boolean).slice(0, 20),
    sampleMediaUuidHashes: [...mediaUuidHashes].filter(Boolean).slice(0, 20),
    sampleGrokPostIdHashes: [...grokPostIdHashes].filter(Boolean).slice(0, 20)
  };
}

async function main() {
  await fs.mkdir(privateDir, { recursive: true });

  const startedAt = nowIso();
  const runId = randomUUID();
  const initialMemory = await chromeRssMb();
  const probe = await runActiveTabJs(pageProbeJs());
  if (probe.host !== 'grok.com' || probe.pathname !== '/imagine/saved') {
    throw new Error(`Refusing to capture: active Chrome tab is ${probe.href || 'unknown'}, expected https://grok.com/imagine/saved`);
  }

  const initialViewport = await runActiveTabJs(captureViewportJs(0));
  if (!initialViewport.ok) throw new Error(`Cannot find Grok Saved gallery scroller: ${initialViewport.reason || 'unknown'}`);
  const restoreScrollTop = initialViewport.scrollTop;
  if (options.resetToTop && restoreScrollTop !== 0) await runActiveTabJs(resetJs());

  const rawRowsBySignature = new Map();
  const viewportSummaries = [];
  let completedGridTraversal = false;
  let stoppedReason = null;

  try {
    for (let viewportIndex = 0; viewportIndex < options.maxViewports; viewportIndex += 1) {
      const memory = await chromeRssMb();
      const memoryDeltaMb = Math.round((memory.totalRssMb - initialMemory.totalRssMb) * 10) / 10;
      if (memory.totalRssMb > options.maxChromeRssMb || memoryDeltaMb > options.maxChromeRssDeltaMb) {
        stoppedReason = 'chrome_memory_guard';
        viewportSummaries.push({
          viewportIndex,
          skipped: true,
          memory,
          memoryDeltaMb,
          guard: {
            maxChromeRssMb: options.maxChromeRssMb,
            maxChromeRssDeltaMb: options.maxChromeRssDeltaMb
          }
        });
        break;
      }

      const viewport = await runActiveTabJs(captureViewportJs(viewportIndex));
      if (!viewport.ok) {
        stoppedReason = viewport.reason || 'capture_failed';
        break;
      }
      if (viewport.href !== probe.href && !viewport.href.startsWith('https://grok.com/imagine/saved')) {
        stoppedReason = 'route_changed';
        break;
      }
      if (viewport.visibleMedia > options.maxVisibleMedia) {
        stoppedReason = 'visible_media_guard';
        viewportSummaries.push({
          viewportIndex,
          scrollTop: viewport.scrollTop,
          visibleMedia: viewport.visibleMedia,
          guard: { maxVisibleMedia: options.maxVisibleMedia }
        });
        break;
      }

      let newRows = 0;
      for (const card of viewport.cards || []) {
        const row = makeRawRow(runId, viewport, card);
        if (rawRowsBySignature.has(row.candidateSignature)) continue;
        rawRowsBySignature.set(row.candidateSignature, row);
        newRows += 1;
      }

      viewportSummaries.push({
        viewportIndex,
        scrollTop: viewport.scrollTop,
        clientHeight: viewport.clientHeight,
        scrollHeight: viewport.scrollHeight,
        atEnd: viewport.atEnd,
        totalImages: viewport.totalImages,
        totalVideos: viewport.totalVideos,
        visibleMedia: viewport.visibleMedia,
        cardCount: viewport.cards?.length || 0,
        newRows,
        memory,
        memoryDeltaMb
      });

      if (viewport.atEnd) {
        completedGridTraversal = true;
        stoppedReason = 'reached_end';
        break;
      }

      const scroll = await runActiveTabJs(scrollJs(options.scrollRatio));
      if (!scroll.ok || scroll.after === scroll.before) {
        completedGridTraversal = true;
        stoppedReason = scroll.ok ? 'scroll_unchanged' : (scroll.reason || 'scroll_failed');
        break;
      }
      await sleep(options.waitMs);
    }
  } finally {
    await runActiveTabJs(restoreJs(restoreScrollTop)).catch(() => null);
  }

  if (!stoppedReason) stoppedReason = 'max_viewports';

  const runRows = [...rawRowsBySignature.values()];
  const previousRows = process.env.GROK_CAPTURE_MERGE_EXISTING === '0'
    ? []
    : await optionalPrivateJsonl('private/grok-saved-current-inventory.jsonl');
  const mergedRowsBySignature = new Map();
  for (const row of previousRows) {
    if (row.candidateSignature) mergedRowsBySignature.set(row.candidateSignature, row);
  }
  for (const row of runRows) mergedRowsBySignature.set(row.candidateSignature, row);
  const rows = [...mergedRowsBySignature.values()];
  const finishedAt = nowIso();
  const rowSummary = summarizeRows(rows);
  const identityStatus = rowSummary.rowsWithGrokPostId === rows.length && rows.length > 0
    ? 'all_rows_have_grok_post_id'
    : rowSummary.rowsWithGrokPostId > 0
      ? 'some_rows_have_grok_post_id'
      : 'grid_has_no_grok_post_ids';

  const privateSummary = {
    schemaVersion: 1,
    runId,
    startedAt,
    finishedAt,
    productionWrites: false,
    method: 'active_chrome_front_tab_javascript',
    route: probe.href,
    options,
    initialMemory,
    completedGridTraversal,
    stoppedReason,
    identityStatus,
    runUniqueCandidateCount: runRows.length,
    previousUniqueCandidateCount: previousRows.length,
    mergedExistingInventory: process.env.GROK_CAPTURE_MERGE_EXISTING !== '0',
    rowSummary,
    viewportSummaries,
    rawArtifacts: {
      inventoryJsonl: 'private/grok-saved-current-inventory.jsonl',
      summaryJson: 'private/grok-saved-current-summary.json'
    }
  };

  const committedSummary = {
    schemaVersion: 1,
    generatedAt: finishedAt,
    productionWrites: false,
    method: 'active_chrome_front_tab_javascript',
    route: '/imagine/saved',
    rawArtifacts: {
      inventoryJsonl: 'private/grok-saved-current-inventory.jsonl',
      summaryJson: 'private/grok-saved-current-summary.json',
      gitIgnored: true
    },
    traversal: {
      completedGridTraversal,
      stoppedReason,
      viewportCount: viewportSummaries.filter((viewport) => !viewport.skipped).length,
      maxViewports: options.maxViewports,
      scrollRatio: options.scrollRatio,
      resetToTop: options.resetToTop,
      runUniqueCandidateCount: runRows.length,
      previousUniqueCandidateCount: previousRows.length,
      mergedExistingInventory: process.env.GROK_CAPTURE_MERGE_EXISTING !== '0'
    },
    identity: {
      status: identityStatus,
      rowsWithGrokPostId: rowSummary.rowsWithGrokPostId,
      uniqueGrokPostIdHashCount: rowSummary.uniqueGrokPostIdHashCount,
      note: identityStatus === 'grid_has_no_grok_post_ids'
        ? 'The Saved grid did not expose /imagine/post/{uuid} identifiers in captured card hrefs. Detail-page capture is still required before claiming logical Grok identity completeness.'
        : 'Grok post IDs are represented only as hashes in committed artifacts.'
    },
    counts: rowSummary,
    viewportSummaries: viewportSummaries.map((viewport) => ({
      viewportIndex: viewport.viewportIndex,
      skipped: Boolean(viewport.skipped),
      scrollTop: viewport.scrollTop,
      clientHeight: viewport.clientHeight,
      scrollHeight: viewport.scrollHeight,
      atEnd: Boolean(viewport.atEnd),
      visibleMedia: viewport.visibleMedia,
      cardCount: viewport.cardCount,
      newRows: viewport.newRows,
      memoryTotalRssMb: viewport.memory?.totalRssMb ?? null,
      memoryDeltaMb: viewport.memoryDeltaMb ?? null,
      guard: viewport.guard || null
    })),
    redaction: {
      committedExactUrls: false,
      committedExactMediaUuids: false,
      committedExactGrokPostIds: false,
      committedRawPromptOrCardText: false,
      rawPrivateArtifactContainsExactUrlsAndVisibleText: true
    }
  };

  await writePrivateJsonl('private/grok-saved-current-inventory.jsonl', rows);
  await writeJson('private/grok-saved-current-summary.json', privateSummary);
  await writeJson('inventory/grok-saved-current-summary.json', committedSummary);
  await writeJson('logs/grok-saved-active-tab-capture.json', {
    generatedAt: finishedAt,
    productionWrites: false,
    method: 'active_chrome_front_tab_javascript',
    route: '/imagine/saved',
    completedGridTraversal,
    stoppedReason,
    uniqueCandidateCount: rowSummary.uniqueCandidateCount,
    viewportCount: committedSummary.traversal.viewportCount,
    identityStatus,
    chromeMemory: {
      initialTotalRssMb: initialMemory.totalRssMb,
      maxObservedTotalRssMb: Math.max(...viewportSummaries.map((viewport) => viewport.memory?.totalRssMb || initialMemory.totalRssMb)),
      maxObservedDeltaMb: Math.max(...viewportSummaries.map((viewport) => viewport.memoryDeltaMb || 0))
    },
    rawArtifactsGitIgnored: true
  });

  await updateManifest((manifest) => {
    manifest.status = 'in_progress';
    manifest.subsystems ||= {};
    manifest.subsystems.grokSavedInventory = completedGridTraversal ? 'grid_captured_identity_limited' : 'partial';
    manifest.browserCapture ||= {};
    manifest.browserCapture.grokSavedActiveTab = {
      generatedAt: finishedAt,
      method: 'active_chrome_front_tab_javascript',
      route: '/imagine/saved',
      completedGridTraversal,
      stoppedReason,
      uniqueCandidateCount: rowSummary.uniqueCandidateCount,
      identityStatus,
      committedSummary: 'inventory/grok-saved-current-summary.json',
      rawInventory: 'private/grok-saved-current-inventory.jsonl'
    };
  });

  console.log(`grok saved grid rows: ${rows.length}`);
  console.log(`grid traversal: ${completedGridTraversal ? 'complete' : 'partial'} (${stoppedReason})`);
  console.log(`identity status: ${identityStatus}`);
  console.log('raw inventory: docs/audits/2026-06-26-production-r2-vault-system-audit/private/grok-saved-current-inventory.jsonl');
  console.log('redacted summary: docs/audits/2026-06-26-production-r2-vault-system-audit/inventory/grok-saved-current-summary.json');
}

await main();
