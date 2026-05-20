# Full System Reliability Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute a full reliability, functionality, backup-integrity, and product-discovery audit for Grok Power Tools across the Chrome extension, live Grok Imagine UI, local Vault, Cloudflare Worker/R2 path, and web app.

**Architecture:** Treat the audit as a staged evidence pipeline: scaffold durable artifacts, capture baseline health, inventory data stores, inspect the live Chrome/Grok session, run controlled canaries, expand into stress/failure paths, reconcile all storage locations, and write a prioritized report. Product code should remain unchanged unless a tiny setup fix is explicitly needed to unblock the audit.

**Tech Stack:** Chrome MV3 extension, Chrome/Computer Use automation, local shell tools, Node.js 20+, npm, Jest, Playwright, Next.js 16, Cloudflare Wrangler/Worker/R2, Markdown/HTML/JSON audit artifacts.

---

## Scope Check

The approved spec spans multiple subsystems, but this should remain one implementation plan because the audit value depends on cross-system reconciliation. Splitting into separate subsystem plans would make it harder to prove whether a Grok-created canary appears consistently in extension state, local Vault, and R2.

The plan does not implement feature fixes. It produces evidence, a report, and follow-up priorities.

## File Structure

- Create/maintain: `docs/audits/2026-05-20-grok-powertools-full-system-audit/implementation-notes.html`
  - Running HTML notes requested by the user.
  - Captures design decisions, deviations, tradeoffs, and open questions while the audit is executed.
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json`
  - Machine-readable audit metadata, status, paths, commands, and canary IDs.
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/report.md`
  - Human-readable final audit report and prioritized recommendations.
- Create directory: `docs/audits/2026-05-20-grok-powertools-full-system-audit/inventory/`
  - Vault inventory, prompt export summary, duplicate report, extension storage snapshots, R2 evidence.
- Create directory: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/`
  - Terminal output, server health probes, browser notes, service-worker notes, exact error strings.
- Create directory: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/`
  - Browser, Chrome, extension popup, Grok, and web app screenshots.
- Create directory: `docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/`
  - Before/after deltas and final canary reconciliation.
- Create directory: `docs/audits/2026-05-20-grok-powertools-full-system-audit/scripts/`
  - Audit-local helper scripts only. These are not product code.
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/scripts/inventory-vault.mjs`
  - Inventories the local Vault and prompt JSON files.
- Modify only if needed: product files such as `tests/e2e/extension.spec.js`, `content.js`, `background.js`, `cloud/src/index.ts`, or `web/src/**`.
  - Product modifications require a notes entry explaining why audit evidence could not be collected without that change.

## Task 1: Scaffold Audit Artifacts and Running Notes

**Files:**
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/report.md`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/inventory/.gitkeep`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/.gitkeep`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/.gitkeep`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/.gitkeep`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/scripts/.gitkeep`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/implementation-notes.html`

- [ ] **Step 1: Create audit directories**

Run:

```bash
mkdir -p docs/audits/2026-05-20-grok-powertools-full-system-audit/{inventory,logs,screenshots,reconciliations,scripts}
touch docs/audits/2026-05-20-grok-powertools-full-system-audit/{inventory,logs,screenshots,reconciliations,scripts}/.gitkeep
```

Expected: directories exist with `.gitkeep` files.

- [ ] **Step 2: Create `manifest.json`**

Use `apply_patch` to create this exact file:

```json
{
  "auditName": "Grok Power Tools full system reliability and functionality audit",
  "auditDate": "2026-05-20",
  "status": "in_progress",
  "repo": {
    "path": "/Users/philipbankier/.codex/worktrees/0657/chrome-extension-powertools",
    "commit": "",
    "gitStatusShort": ""
  },
  "targets": {
    "localWebUrl": "http://localhost:3001",
    "localWorkerUrl": "http://localhost:8787",
    "chromeGrokUrl": "https://grok.com/imagine/saved",
    "localVaultPath": "/Users/philipbankier/Content/Grok IMagine/greymaker/GrokVault"
  },
  "canaries": [],
  "subsystems": {
    "repo": "not_run",
    "extension": "not_run",
    "chromeGrok": "not_run",
    "localVault": "not_run",
    "cloudWorkerR2": "not_run",
    "webApp": "not_run"
  },
  "blockers": [],
  "evidenceIndex": []
}
```

Expected: `jq . docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json` parses successfully.

- [ ] **Step 3: Create `report.md` skeleton**

Use `apply_patch` to create this exact file:

```markdown
# Grok Power Tools Full System Reliability and Functionality Audit

Audit date: 2026-05-20

## Executive Status

| Subsystem | Status | Evidence |
| --- | --- | --- |
| Repo and local runtime | Not run | Pending baseline task |
| Chrome extension | Not run | Pending Chrome/Grok task |
| Live Grok Imagine integration | Not run | Pending Chrome/Grok task |
| Local Vault | Not run | Pending inventory task |
| Worker/R2 backup | Not run | Pending R2 task |
| Web app | Not run | Pending web app task |

## Confirmed Working Flows

No flows have been confirmed in this audit run yet.

## Broken Or Regressed Flows

No broken flows have been confirmed in this audit run yet.

## Blocked Or Unverified Flows

No blocked flows have been confirmed in this audit run yet.

## Backup Completeness Findings

Pending local Vault, Grok Saved, extension storage, and R2 reconciliation.

## UI/UX Drift And Product Discovery

Pending live Grok Imagine walkthrough.

## Feature Opportunities

Pending live Grok Imagine walkthrough.

## Architecture Rethink Triggers

Pending audit evidence.

## Prioritized Next Actions

### P0 Reliability

No P0 items have been confirmed in this audit run yet.

### P1 Functionality

No P1 items have been confirmed in this audit run yet.

### P2 Product And UX

No P2 items have been confirmed in this audit run yet.

## Operator Runbook

The runbook will be completed after baseline, inventory, live browser, canary, and reconciliation tasks have evidence.
```

Expected: file exists and contains every final report section required by the spec.

- [ ] **Step 4: Append a scaffolding note**

Modify `implementation-notes.html` by adding this list item under `Design Decisions`:

```html
<li><strong>Audit scaffold:</strong> The audit uses a timestamped folder with separate inventory, logs, screenshots, reconciliations, and scripts directories so raw evidence is easy to inspect without mixing it into product code.</li>
```

Expected: opening the file in a browser shows the new note under Design Decisions.

- [ ] **Step 5: Commit the scaffold**

Run:

```bash
git add docs/audits/2026-05-20-grok-powertools-full-system-audit
git commit -m "docs: scaffold full system audit artifacts"
```

Expected: commit succeeds. If screenshots/logs later contain private data, do not bulk-stage them without review.

## Task 2: Capture Baseline Repo and Runtime Health

**Files:**
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/baseline-git.txt`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/baseline-node.txt`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/root-test-unit.txt`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/root-lint.txt`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/root-test-e2e.txt`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/cloud-typecheck.txt`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/web-lint.txt`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/web-build.txt`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/report.md`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/implementation-notes.html`

- [ ] **Step 1: Record git and runtime identity**

Run:

```bash
{
  echo "## git status --short --branch"
  git status --short --branch
  echo
  echo "## git rev-parse HEAD"
  git rev-parse HEAD
  echo
  echo "## git log --oneline --decorate -8"
  git log --oneline --decorate -8
} | tee docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/baseline-git.txt

{
  echo "## node -v"
  node -v
  echo
  echo "## npm -v"
  npm -v
  echo
  echo "## npx wrangler --version"
  (cd cloud && npx wrangler --version)
} | tee docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/baseline-node.txt
```

Expected: logs include current git commit, branch state, Node version, npm version, and Wrangler version.

- [ ] **Step 2: Run root unit tests**

Run:

```bash
npm run test:unit 2>&1 | tee docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/root-test-unit.txt
```

Expected: current known baseline is `4 passed, 4 total` test suites and `112 passed` tests. If output differs, record the exact result in `report.md`.

- [ ] **Step 3: Run root lint**

Run:

```bash
npm run lint 2>&1 | tee docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/root-lint.txt
```

Expected: command exits `0` with warnings, not errors. Record warning count and top affected files in `report.md`.

- [ ] **Step 4: Run root E2E tests**

Run:

```bash
npm run test:e2e 2>&1 | tee docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/root-test-e2e.txt
```

Expected: current known baseline fails because the Playwright Chrome API shim lacks `chrome.runtime.getURL`. If it still fails, classify as `P0/P1 test harness reliability` depending on whether live extension load works in Chrome.

- [ ] **Step 5: Run Worker typecheck**

Run:

```bash
(cd cloud && npm run typecheck) 2>&1 | tee docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/cloud-typecheck.txt
```

Expected: command exits `0`.

- [ ] **Step 6: Run web lint**

Run:

```bash
(cd web && npm run lint) 2>&1 | tee docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/web-lint.txt
```

Expected: current known baseline exits nonzero with existing React/Next lint errors. Record exact error count and representative files in `report.md`.

- [ ] **Step 7: Run web build**

Run:

```bash
(cd web && npm run build) 2>&1 | tee docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/web-build.txt
```

Expected: current known baseline builds successfully, with a Next.js workspace-root warning caused by multiple lockfiles.

- [ ] **Step 8: Update manifest baseline fields**

Use `apply_patch` to set:

- `repo.commit` to the `git rev-parse HEAD` value.
- `repo.gitStatusShort` to a concise summary of tracked and untracked changes.
- `subsystems.repo` to `working_with_findings` if unit/lint/typecheck/build pass but E2E/web lint fail.

Expected: `jq . docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json` parses successfully.

- [ ] **Step 9: Update report baseline sections**

Modify `report.md`:

- In `Executive Status`, update `Repo and local runtime`.
- In `Confirmed Working Flows`, add unit tests, root lint, Worker typecheck, and web build if confirmed.
- In `Broken Or Regressed Flows`, add E2E and web lint failures if reproduced.
- In `Prioritized Next Actions`, add a P0/P1 entry for E2E shim and web lint only if the audit confirms they remain failures.

Expected: every claim cites a log file path.

- [ ] **Step 10: Append a baseline note**

Modify `implementation-notes.html` by adding a `Tradeoffs` list item:

```html
<li><strong>Baseline interpretation:</strong> Automated checks are treated as audit evidence, not blockers to live testing, unless they reveal a failure that prevents extension, web app, or Worker runtime from launching.</li>
```

Expected: note is visible under Tradeoffs.

- [ ] **Step 11: Commit baseline evidence**

Run:

```bash
git add docs/audits/2026-05-20-grok-powertools-full-system-audit/{manifest.json,report.md,implementation-notes.html,logs/baseline-git.txt,logs/baseline-node.txt,logs/root-test-unit.txt,logs/root-lint.txt,logs/root-test-e2e.txt,logs/cloud-typecheck.txt,logs/web-lint.txt,logs/web-build.txt}
git commit -m "docs: capture audit baseline health"
```

Expected: commit succeeds unless privacy review is needed for logs. These logs should not contain Grok private media.

## Task 3: Start or Verify Local Services

**Files:**
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/local-services.txt`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/report.md`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/implementation-notes.html`

- [ ] **Step 1: Check port listeners**

Run:

```bash
{
  echo "## lsof port 3001"
  lsof -nP -iTCP:3001 -sTCP:LISTEN || true
  echo
  echo "## lsof port 8787"
  lsof -nP -iTCP:8787 -sTCP:LISTEN || true
} | tee docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/local-services.txt
```

Expected: if services are already running, output shows listeners for `3001` and `8787`. If missing, start them in the next steps.

- [ ] **Step 2: Start web app if port 3001 is not listening**

Run this only if Step 1 shows no listener on `3001`:

```bash
(cd web && npm run dev)
```

Expected: Next reports `Local: http://localhost:3001` and `Ready`.

- [ ] **Step 3: Start local Worker if port 8787 is not listening**

Run this only if Step 1 shows no listener on `8787`:

```bash
(cd cloud && npm run dev)
```

Expected: Wrangler reports `Ready on http://localhost:8787`. Record any compatibility-date fallback warning.

- [ ] **Step 4: Probe service health**

Run:

```bash
{
  echo
  echo "## web HEAD"
  curl -sS -I http://localhost:3001 || true
  echo
  echo "## worker health"
  curl -sS http://localhost:8787/health || true
} | tee -a docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/local-services.txt
```

Expected: web returns `HTTP/1.1 200 OK`; Worker returns JSON with `"ok":true`.

- [ ] **Step 5: Update manifest and report**

Use `apply_patch` to add local service evidence paths to `manifest.evidenceIndex`, set `subsystems.webApp` to `running_pending_browser_smoke`, and set `subsystems.cloudWorkerR2` to `local_worker_running_r2_pending`.

Expected: manifest remains valid JSON and report describes local services as running or records exact blockers.

- [ ] **Step 6: Append a service note if needed**

If Wrangler shows compatibility-date fallback or Next shows workspace-root warning, add a `Deviations` or `Tradeoffs` list item to `implementation-notes.html` explaining that the audit proceeds because the service still runs, while the warning becomes a report finding.

Expected: notes file explains any warning accepted during local bring-up.

- [ ] **Step 7: Commit local service evidence**

Run:

```bash
git add docs/audits/2026-05-20-grok-powertools-full-system-audit/{manifest.json,report.md,implementation-notes.html,logs/local-services.txt}
git commit -m "docs: record local audit services"
```

Expected: commit succeeds.

## Task 4: Create and Run Local Vault Inventory Script

**Files:**
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/scripts/inventory-vault.mjs`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/inventory/local-vault-summary.json`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/inventory/local-vault-files.csv`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/inventory/local-vault-duplicates.json`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/inventory/prompt-json-summary.json`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/local-vault-inventory.txt`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/report.md`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/implementation-notes.html`

- [ ] **Step 1: Write inventory script**

Use `apply_patch` to create `scripts/inventory-vault.mjs` with this exact content:

```js
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
```

Expected: script exists and has no syntax errors.

- [ ] **Step 2: Run inventory script**

Run:

```bash
node docs/audits/2026-05-20-grok-powertools-full-system-audit/scripts/inventory-vault.mjs 2>&1 | tee docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/local-vault-inventory.txt
```

Expected: JSON summary prints. Current known baseline is about `1.6G`, `1,853` files, `1,077` PNG, `774` MP4, `1` JPEG, and one `.DS_Store`; exact script output is the source of truth.

- [ ] **Step 3: Validate generated inventory files**

Run:

```bash
jq . docs/audits/2026-05-20-grok-powertools-full-system-audit/inventory/local-vault-summary.json
jq . docs/audits/2026-05-20-grok-powertools-full-system-audit/inventory/local-vault-duplicates.json
jq . docs/audits/2026-05-20-grok-powertools-full-system-audit/inventory/prompt-json-summary.json
head -5 docs/audits/2026-05-20-grok-powertools-full-system-audit/inventory/local-vault-files.csv
```

Expected: all JSON parses and CSV has a header plus file rows.

- [ ] **Step 4: Update report with local Vault findings**

Modify `report.md`:

- Set `Local Vault` status in `Executive Status`.
- Add counts by extension and date folder in `Backup Completeness Findings`.
- Add duplicate filename/hash findings.
- Add zero-byte file findings.
- Add prompt JSON export findings.

Expected: every count cites one of the inventory files.

- [ ] **Step 5: Update manifest and notes**

Use `apply_patch` to:

- Set `subsystems.localVault` to `inventoried`.
- Add the inventory files to `manifest.evidenceIndex`.
- Add a `Design Decisions` note if the script excludes `node_modules` prompt JSONs.

Expected: manifest remains valid JSON.

- [ ] **Step 6: Commit local inventory evidence**

Run:

```bash
git add docs/audits/2026-05-20-grok-powertools-full-system-audit/{scripts/inventory-vault.mjs,inventory/local-vault-summary.json,inventory/local-vault-files.csv,inventory/local-vault-duplicates.json,inventory/prompt-json-summary.json,logs/local-vault-inventory.txt,manifest.json,report.md,implementation-notes.html}
git commit -m "docs: inventory local Grok Vault"
```

Expected: commit succeeds after confirming CSV size is reasonable for the repository.

## Task 5: Inspect Extension Configuration and Chrome/Grok Starting State

**Files:**
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/chrome-grok-starting-state.md`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/chrome-grok-saved-start.png`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/extension-overlay-start.png`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/extension-popup-cloud-settings.png`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/report.md`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/implementation-notes.html`

- [ ] **Step 1: Open the Chrome/Computer Use skill or tool**

Use Chrome or Computer Use against the user-profile Chrome window, not the in-app Browser. Target the existing tab at `https://grok.com/imagine/saved`.

Expected: the user-profile Chrome window is visible and authenticated state can be inspected.

- [ ] **Step 2: Capture Grok Saved starting screenshot**

Use Chrome/Computer Use screenshot capture and save to:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/chrome-grok-saved-start.png
```

Expected: screenshot shows the current Grok Saved page or a clear auth/blocker state.

- [ ] **Step 3: Check extension overlay**

On `grok.com/imagine/saved`, inspect whether the Grok Power Tools overlay is present. Capture a screenshot to:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/extension-overlay-start.png
```

Expected: overlay is visible, or the absence is recorded as an extension injection finding.

- [ ] **Step 4: Inspect extension popup cloud settings**

Open the Grok Power Tools extension popup in Chrome. Capture a screenshot to:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/extension-popup-cloud-settings.png
```

Record visible non-secret configuration in `logs/chrome-grok-starting-state.md`:

```markdown
# Chrome/Grok Starting State

## Target

- URL observed:
- Auth/session state:
- Saved page loaded:

## Extension Overlay

- Overlay visible:
- Main controls visible:
- Unexpected visual overlap:

## Extension Popup

- Download path:
- Cloud mode:
- Worker URL host:
- API key present:
- Key prefix:
- Unsynced count:
- Last test result:
- Last error:

## Current Grok UI/UX Observations

- Navigation labels observed:
- Creation controls observed:
- Saved/Vault controls observed:
- Initial UX drift notes:
```

Expected: no API key value is written to the log, only whether it is present.

- [ ] **Step 5: Record selector confidence**

Using Chrome DevTools or page inspection through Chrome/Computer Use, record whether these elements appear in the current Grok UI:

```markdown
## Selector Confidence

- `button[aria-label="Make video"]`:
- `button[aria-label="Download"]`:
- `button[aria-label="Video"]`:
- `button` with text `Generate More`:
- media image with `src*="imagine-public.x.ai"`:
- media image with `src*="assets.grok.com/users/"`:
- `video[src]` or `video source[src]`:
```

Expected: each selector is marked `present`, `absent`, or `not checked because <reason>`.

- [ ] **Step 6: Update report, manifest, and notes**

Modify:

- `manifest.subsystems.extension`
- `manifest.subsystems.chromeGrok`
- `report.md` Browser/Grok and UI/UX sections
- `implementation-notes.html` if tool routing or selector interpretation diverges from the spec

Expected: report distinguishes auth/session blockers from extension bugs.

- [ ] **Step 7: Commit Chrome/Grok starting-state evidence**

Run:

```bash
git add docs/audits/2026-05-20-grok-powertools-full-system-audit/{logs/chrome-grok-starting-state.md,screenshots/chrome-grok-saved-start.png,screenshots/extension-overlay-start.png,screenshots/extension-popup-cloud-settings.png,manifest.json,report.md,implementation-notes.html}
git commit -m "docs: capture Chrome Grok starting state"
```

Expected: before committing screenshots, confirm they do not expose sensitive information that should remain local.

## Task 6: Verify Worker/R2 Access Path

**Files:**
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/r2-access.md`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/inventory/r2-evidence.json`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/extension-cloud-test-result.png`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/report.md`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/implementation-notes.html`

- [ ] **Step 1: Record direct Wrangler R2 state**

Run:

```bash
{
  echo "# R2 Access"
  echo
  echo "## wrangler bucket list without explicit account"
  (cd cloud && npx wrangler r2 bucket list) || true
  echo
  echo "## wrangler bucket list account e8d3925cac56cc5a4927c16024531994"
  (cd cloud && CLOUDFLARE_ACCOUNT_ID=e8d3925cac56cc5a4927c16024531994 npx wrangler r2 bucket list) || true
  echo
  echo "## wrangler bucket list account ae55f67eccbee0bca65247faea6d5024"
  (cd cloud && CLOUDFLARE_ACCOUNT_ID=ae55f67eccbee0bca65247faea6d5024 npx wrangler r2 bucket list) || true
} 2>&1 | tee docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/r2-access.md
```

Expected: current known baseline is Cloudflare account ambiguity, one account with R2 disabled, and one account auth error. If corrected access exists, record the actual bucket list.

- [ ] **Step 2: Run extension cloud test if popup has config**

If the extension popup shows a Worker URL and API key are present, click `Test Upload Pipeline`. Capture result screenshot to:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/extension-cloud-test-result.png
```

Append to `logs/r2-access.md`:

```markdown
## Extension Cloud Test

- Ran test:
- Result text:
- Last error:
- Evidence screenshot:
```

Expected: success says `Full pipeline OK (health + presign + R2 upload)` or an exact error prefix such as `[health-check]`, `[presign]`, `[r2-put]`, or validation error.

- [ ] **Step 3: Create `r2-evidence.json`**

Use `apply_patch` to create this file with actual observed values:

```json
{
  "directWranglerAccess": {
    "status": "blocked",
    "details": "Replace this sentence with the exact observed Wrangler result before committing."
  },
  "extensionCloudTest": {
    "ran": false,
    "status": "not_run",
    "message": "Extension popup did not expose a configured Worker/API key during this step."
  },
  "objectLevelEvidence": []
}
```

Before committing, replace the `details` string with exact observed text from `logs/r2-access.md`. If the extension cloud test runs, set `ran` to `true`, set `status` to `passed` or `failed`, and set `message` to the exact popup result.

Expected: `jq . inventory/r2-evidence.json` parses successfully and contains no API key.

- [ ] **Step 4: Update report, manifest, and notes**

Modify:

- `manifest.subsystems.cloudWorkerR2`
- `report.md` Worker/R2 status and backup completeness sections
- `implementation-notes.html` open questions if credentials are still needed

Expected: report does not infer object-level R2 backup success from local Worker health alone.

- [ ] **Step 5: Commit R2 access evidence**

Run:

```bash
git add docs/audits/2026-05-20-grok-powertools-full-system-audit/{logs/r2-access.md,inventory/r2-evidence.json,screenshots/extension-cloud-test-result.png,manifest.json,report.md,implementation-notes.html}
git commit -m "docs: record R2 access evidence"
```

Expected: commit succeeds only after checking screenshots and logs contain no secrets.

## Task 7: Smoke Test Web App Functionality

**Files:**
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/web-smoke.md`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/web-dashboard.png`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/web-collections.png`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/web-edit.png`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/web-movie.png`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/report.md`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/implementation-notes.html`

- [ ] **Step 1: Check HTTP routes**

Run:

```bash
{
  echo "# Web Smoke"
  for path in / /collections /edit /movie /share; do
    echo
    echo "## HEAD http://localhost:3001${path}"
    curl -sS -I "http://localhost:3001${path}" || true
  done
} | tee docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/web-smoke.md
```

Expected: routes return HTTP responses. `/share` may show an app-level missing-data state, which is acceptable if rendered clearly.

- [ ] **Step 2: Browser smoke screenshots**

Use Browser/browser-use or Playwright to open:

- `http://localhost:3001/`
- `http://localhost:3001/collections`
- `http://localhost:3001/edit`
- `http://localhost:3001/movie`

Save screenshots to the four screenshot paths listed in this task.

Expected: each route renders nonblank UI and no severe visual overlap.

- [ ] **Step 3: Record UX findings**

Append to `logs/web-smoke.md`:

```markdown
## Visual/UX Notes

- Dashboard:
- Collections:
- Edit:
- Movie:
- Share:

## Console/Runtime Notes

- Browser console errors:
- Network errors:
- Broken controls:
```

Expected: notes are concrete and point to screenshots.

- [ ] **Step 4: Update report and manifest**

Modify:

- `manifest.subsystems.webApp`
- `report.md` web app status
- `report.md` UI/UX drift and feature opportunities if the web app no longer matches Grok workflow reality

Expected: web app status reflects both build and browser-render evidence.

- [ ] **Step 5: Append notes for interpretation**

If a web feature is demo-only or locally functional but not connected to R2/Grok, add a `Design Decisions` or `Open Questions` entry to `implementation-notes.html` explaining how it was classified.

Expected: no web app capability is overstated.

- [ ] **Step 6: Commit web smoke evidence**

Run:

```bash
git add docs/audits/2026-05-20-grok-powertools-full-system-audit/{logs/web-smoke.md,screenshots/web-dashboard.png,screenshots/web-collections.png,screenshots/web-edit.png,screenshots/web-movie.png,manifest.json,report.md,implementation-notes.html}
git commit -m "docs: capture web app smoke audit"
```

Expected: commit succeeds after screenshot privacy check.

## Task 8: Run Live Grok Creation Canaries

**Files:**
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/grok-canaries.md`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/grok-image-canary-submitted.png`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/grok-image-canary-result.png`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/grok-video-canary-submitted.png`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/grok-video-canary-result.png`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/report.md`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/implementation-notes.html`

- [ ] **Step 1: Record pre-canary Vault count**

Run:

```bash
find '/Users/philipbankier/Content/Grok IMagine/greymaker/GrokVault' -type f | wc -l | tee docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/pre-canary-vault-count.txt
```

Expected: count is recorded before generation/download.

- [ ] **Step 2: Create image canary in Grok**

Using Chrome/Computer Use in the live Grok tab, create an image with this prompt:

```text
AUDIT CANARY 2026-05-20 image: a clean product-style tabletop photo of a small chrome compass on a white desk, no text, square composition, neutral lighting.
```

Capture submission screenshot:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/grok-image-canary-submitted.png
```

Expected: Grok accepts the prompt or displays an exact error/moderation/rate-limit message.

- [ ] **Step 3: Capture image canary result**

When the image result appears, capture screenshot:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/grok-image-canary-result.png
```

Append to `logs/grok-canaries.md`:

```markdown
# Grok Creation Canaries

## Image Canary

- Prompt:
- Submitted:
- Result appeared:
- Result URL or visible ID:
- Errors:
- Screenshot submitted:
- Screenshot result:
```

Expected: result URL/ID is recorded when visible. If no ID is visible, record the page URL and timestamp.

- [ ] **Step 4: Create video canary in Grok**

Using Chrome/Computer Use, create a video canary from the image result or a new video prompt:

```text
AUDIT CANARY 2026-05-20 video: a five-second gentle camera push toward the small chrome compass on a white desk, no text, minimal motion, neutral lighting.
```

Capture submission screenshot:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/grok-video-canary-submitted.png
```

Expected: Grok accepts the video request or displays an exact blocker.

- [ ] **Step 5: Capture video canary result**

When the video result appears, capture screenshot:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/grok-video-canary-result.png
```

Append to `logs/grok-canaries.md`:

```markdown
## Video Canary

- Prompt:
- Submitted:
- Result appeared:
- Result URL or visible ID:
- Errors:
- Screenshot submitted:
- Screenshot result:
```

Expected: result is recorded, or exact blocker is recorded.

- [ ] **Step 6: Update manifest canaries**

Run this command after setting `IMAGE_STATUS`, `IMAGE_GROK_URL`, `VIDEO_STATUS`, and `VIDEO_GROK_URL` from the observed Grok UI. Use an empty string for a URL only when no URL or visible ID exists.

```bash
: "${IMAGE_STATUS:?Set IMAGE_STATUS to created, blocked_rate_limit, blocked_auth, blocked_moderation, or not_available_in_ui}"
: "${VIDEO_STATUS:?Set VIDEO_STATUS to created, blocked_rate_limit, blocked_auth, blocked_moderation, or not_available_in_ui}"
node - <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';

const manifestPath = 'docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.canaries = [
  {
    type: 'image',
    prompt: 'AUDIT CANARY 2026-05-20 image: a clean product-style tabletop photo of a small chrome compass on a white desk, no text, square composition, neutral lighting.',
    status: process.env.IMAGE_STATUS,
    grokUrl: process.env.IMAGE_GROK_URL || '',
    localPath: '',
    r2ObjectKey: ''
  },
  {
    type: 'video',
    prompt: 'AUDIT CANARY 2026-05-20 video: a five-second gentle camera push toward the small chrome compass on a white desk, no text, minimal motion, neutral lighting.',
    status: process.env.VIDEO_STATUS,
    grokUrl: process.env.VIDEO_GROK_URL || '',
    localPath: '',
    r2ObjectKey: ''
  }
];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
NODE
jq . docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json
```

Expected: manifest remains valid JSON and canary statuses use exact observed status values.

- [ ] **Step 7: Update report and notes**

Modify:

- `report.md` confirmed/broken/unverified flows.
- `report.md` UI/UX drift and feature opportunities observed during creation.
- `implementation-notes.html` if Grok's current creation flow forced a different path than expected.

Expected: report separates Grok service limitations from extension failures.

- [ ] **Step 8: Commit canary creation evidence**

Run:

```bash
git add docs/audits/2026-05-20-grok-powertools-full-system-audit/{logs/pre-canary-vault-count.txt,logs/grok-canaries.md,screenshots/grok-image-canary-submitted.png,screenshots/grok-image-canary-result.png,screenshots/grok-video-canary-submitted.png,screenshots/grok-video-canary-result.png,manifest.json,report.md,implementation-notes.html}
git commit -m "docs: record Grok creation canaries"
```

Expected: commit succeeds after screenshot privacy check.

## Task 9: Exercise Download, Local Vault, and R2 Sync

**Files:**
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/download-backup-flow.md`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/canary-local-delta.json`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/canary-r2-delta.json`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/extension-download-flow.png`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/extension-r2-sync-result.png`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/report.md`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/implementation-notes.html`

- [ ] **Step 1: Capture pre-download inventory snapshot**

Run:

```bash
node docs/audits/2026-05-20-grok-powertools-full-system-audit/scripts/inventory-vault.mjs > docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/pre-download-vault-summary.json
```

Expected: snapshot JSON exists.

- [ ] **Step 2: Trigger extension download for canary media**

Using Chrome/Computer Use, use the extension or Grok native download path to download the image and video canaries. Capture screenshot:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/extension-download-flow.png
```

Append to `logs/download-backup-flow.md`:

```markdown
# Download And Backup Flow

## Local Download

- Trigger method:
- Image canary download status:
- Video canary download status:
- Extension log text:
- Browser/Grok errors:
```

Expected: at least one canary downloads locally, or the exact blocker is recorded.

- [ ] **Step 3: Capture post-download inventory snapshot**

Run:

```bash
node docs/audits/2026-05-20-grok-powertools-full-system-audit/scripts/inventory-vault.mjs > docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/post-download-vault-summary.json
```

Expected: snapshot JSON exists.

- [ ] **Step 4: Write local delta**

Run:

```bash
node - <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const pre = JSON.parse(readFileSync('docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/pre-download-vault-summary.json', 'utf8'));
const post = JSON.parse(readFileSync('docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/post-download-vault-summary.json', 'utf8'));
const delta = {
  generatedAt: new Date().toISOString(),
  totalFilesBefore: pre.totalFiles,
  totalFilesAfter: post.totalFiles,
  totalFilesDelta: post.totalFiles - pre.totalFiles,
  totalBytesBefore: pre.totalBytes,
  totalBytesAfter: post.totalBytes,
  totalBytesDelta: post.totalBytes - pre.totalBytes,
  byExtensionBefore: pre.byExtension,
  byExtensionAfter: post.byExtension
};
writeFileSync('docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/canary-local-delta.json', JSON.stringify(delta, null, 2) + '\n');
console.log(JSON.stringify(delta, null, 2));
NODE
```

Expected: local delta shows expected file count increase, or shows zero increase and supports a bug/blocker finding.

- [ ] **Step 5: Trigger R2 sync or record blocker**

If cloud mode is configured, trigger extension cloud sync/retry or R2 backup for the canary. Capture screenshot:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/extension-r2-sync-result.png
```

Create `reconciliations/canary-r2-delta.json` with exact observed status by running this command after setting `R2_ATTEMPTED`, `R2_STATUS`, `R2_STATUS_TEXT`, `R2_ERROR`, and `R2_OBJECT_KEYS_JSON` from the extension/R2 evidence. Use `R2_OBJECT_KEYS_JSON='[]'` when no object keys are available.

```bash
: "${R2_ATTEMPTED:?Set R2_ATTEMPTED to true or false}"
: "${R2_STATUS:?Set R2_STATUS to passed, failed, or blocked}"
: "${R2_OBJECT_KEYS_JSON:?Set R2_OBJECT_KEYS_JSON to a JSON array, for example []}"
node - <<'NODE'
import { writeFileSync } from 'node:fs';

const attempted = process.env.R2_ATTEMPTED === 'true';
const objectKeys = JSON.parse(process.env.R2_OBJECT_KEYS_JSON);
const output = {
  generatedAt: new Date().toISOString(),
  attempted,
  status: process.env.R2_STATUS,
  objectKeys,
  extensionStatusText: process.env.R2_STATUS_TEXT || '',
  error: process.env.R2_ERROR || ''
};
writeFileSync('docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/canary-r2-delta.json', JSON.stringify(output, null, 2) + '\n');
NODE
jq . docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/canary-r2-delta.json
```

Expected: R2 canary is verified with object key evidence or exact blocker.

- [ ] **Step 6: Update manifest and report**

Update:

- `manifest.canaries[*].localPath` for downloaded canaries.
- `manifest.canaries[*].r2ObjectKey` for verified R2 objects.
- `report.md` backup completeness findings.
- `implementation-notes.html` if R2 verification used extension status rather than direct object listing.

Expected: no claim says R2 object exists unless object-level evidence or extension pipeline success supports it.

- [ ] **Step 7: Commit download and backup evidence**

Run:

```bash
git add docs/audits/2026-05-20-grok-powertools-full-system-audit/{logs/download-backup-flow.md,reconciliations/pre-download-vault-summary.json,reconciliations/post-download-vault-summary.json,reconciliations/canary-local-delta.json,reconciliations/canary-r2-delta.json,screenshots/extension-download-flow.png,screenshots/extension-r2-sync-result.png,manifest.json,report.md,implementation-notes.html}
git commit -m "docs: reconcile canary download and backup"
```

Expected: commit succeeds after screenshot/privacy review.

## Task 10: Exercise Saved/Vault Scraper, Backfill, Stop, Retry, and Abort

**Files:**
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/stress-paths.md`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/scraper-running.png`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/scraper-stopped.png`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/backfill-result.png`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/retry-unsynced-result.png`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/report.md`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/implementation-notes.html`

- [ ] **Step 1: Start small scraper run**

Using Chrome/Computer Use on Grok Saved, start a small saved/gallery scrape or media backup run. Capture screenshot while running:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/scraper-running.png
```

Append to `logs/stress-paths.md`:

```markdown
# Stress And Failure Paths

## Scraper

- Start action:
- Scope/count setting:
- Running state visible:
- First progress text:
- Errors:
```

Expected: scraper starts and progress is visible, or exact blocker is recorded.

- [ ] **Step 2: Stop scraper run**

Click the stop/abort control. Capture screenshot:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/scraper-stopped.png
```

Append:

```markdown
## Scraper Stop

- Stop action:
- Stopped state visible:
- Final progress text:
- Errors:
```

Expected: run stops without continuing unexpected bulk activity.

- [ ] **Step 3: Run metadata backfill**

Using the extension popup, click `Run Backfill`. Capture screenshot:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/backfill-result.png
```

Append:

```markdown
## Backfill

- Ran backfill:
- Result:
- Last error:
- Notes:
```

Expected: backfill queues/completes metadata or shows exact R2/config blocker.

- [ ] **Step 4: Retry unsynced**

Using the extension popup, click `Retry Unsynced`. Capture screenshot:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/retry-unsynced-result.png
```

Append:

```markdown
## Retry Unsynced

- Ran retry:
- Unsynced count before:
- Unsynced count after:
- Last error:
- Notes:
```

Expected: unsynced count decreases or exact retry failure is recorded.

- [ ] **Step 5: Update report and notes**

Modify:

- `report.md` confirmed/broken/unverified flows.
- `report.md` P0/P1 findings for stop/abort/retry failures.
- `implementation-notes.html` with any deviation from planned stress scope.

Expected: report clearly separates a controlled stop from a failed abort.

- [ ] **Step 6: Commit stress-path evidence**

Run:

```bash
git add docs/audits/2026-05-20-grok-powertools-full-system-audit/{logs/stress-paths.md,screenshots/scraper-running.png,screenshots/scraper-stopped.png,screenshots/backfill-result.png,screenshots/retry-unsynced-result.png,manifest.json,report.md,implementation-notes.html}
git commit -m "docs: capture scraper and recovery paths"
```

Expected: commit succeeds after screenshot/privacy review.

## Task 11: Exercise Batch and Quality Repeat Where Current UI Allows

**Files:**
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/logs/batch-quality-repeat.md`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/batch-controls.png`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/batch-result.png`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/quality-repeat-controls.png`
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/quality-repeat-result.png`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/report.md`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/implementation-notes.html`

- [ ] **Step 1: Inspect batch controls**

Using Chrome/Computer Use, inspect overlay batch controls and capture:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/batch-controls.png
```

Append to `logs/batch-quality-repeat.md`:

```markdown
# Batch And Quality Repeat

## Batch Controls

- Controls visible:
- Prompt input visible:
- Goal/limit controls visible:
- Stop control visible:
- Selector confidence:
```

Expected: controls are visible or missing controls are recorded.

- [ ] **Step 2: Run smallest safe batch**

Run the smallest safe batch count supported by the UI, ideally `1` or `2`, using a prompt that includes `AUDIT CANARY 2026-05-20 batch`. Capture result screenshot:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/batch-result.png
```

Append:

```markdown
## Batch Run

- Batch count:
- Prompt:
- Started:
- Completed:
- Stop tested:
- Errors:
```

Expected: batch completes or exact blocker is recorded. Stop should be tested if the run lasts long enough to stop safely.

- [ ] **Step 3: Inspect quality repeat controls**

Navigate to a state where Grok displays `Generate More`, if current UI supports it. Capture:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/quality-repeat-controls.png
```

Append:

```markdown
## Quality Repeat Controls

- Generate More visible:
- Inline repeat buttons visible:
- Overlay repeat controls visible:
- Selector confidence:
```

Expected: controls are visible, or absence is recorded as UI drift/unverified.

- [ ] **Step 4: Run smallest safe quality repeat**

If controls are present, run `1` or `2` repeats. Capture:

```text
docs/audits/2026-05-20-grok-powertools-full-system-audit/screenshots/quality-repeat-result.png
```

Append:

```markdown
## Quality Repeat Run

- Repeat count:
- Started:
- Progress text:
- Completed:
- Stop tested:
- Errors:
```

Expected: repeat works, stops cleanly, or exact blocker is recorded.

- [ ] **Step 5: Update report and notes**

Modify:

- `report.md` functionality status for batch and quality repeat.
- `report.md` UI/UX drift if Grok no longer exposes the expected controls.
- `implementation-notes.html` with any tradeoff around limiting batch count.

Expected: report does not mark a flow working unless it was actually exercised.

- [ ] **Step 6: Commit batch/quality evidence**

Run:

```bash
git add docs/audits/2026-05-20-grok-powertools-full-system-audit/{logs/batch-quality-repeat.md,screenshots/batch-controls.png,screenshots/batch-result.png,screenshots/quality-repeat-controls.png,screenshots/quality-repeat-result.png,manifest.json,report.md,implementation-notes.html}
git commit -m "docs: capture batch and quality repeat audit"
```

Expected: commit succeeds after screenshot/privacy review.

## Task 12: Final Reconciliation and Report

**Files:**
- Create: `docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/final-reconciliation.json`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/report.md`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/implementation-notes.html`

- [ ] **Step 1: Run final inventory**

Run:

```bash
node docs/audits/2026-05-20-grok-powertools-full-system-audit/scripts/inventory-vault.mjs > docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/final-vault-summary.json
```

Expected: final local Vault summary exists.

- [ ] **Step 2: Create final reconciliation JSON**

Create `final-reconciliation.json` with observed values by running this command after setting `GROK_SAVED_STATUS`, `EXTENSION_STORAGE_STATUS`, `R2_FINAL_STATUS`, `GROK_EVIDENCE_JSON`, `EXTENSION_EVIDENCE_JSON`, and `UNRESOLVED_GAPS_JSON`. Use JSON arrays for the three `*_JSON` variables.

```bash
: "${GROK_SAVED_STATUS:?Set GROK_SAVED_STATUS to verified, blocked_credentials, blocked_auth, not_configured, or not_exercised_due_to_ui_drift}"
: "${EXTENSION_STORAGE_STATUS:?Set EXTENSION_STORAGE_STATUS to verified, blocked_credentials, blocked_auth, not_configured, or not_exercised_due_to_ui_drift}"
: "${R2_FINAL_STATUS:?Set R2_FINAL_STATUS to verified, blocked_credentials, blocked_auth, not_configured, or not_exercised_due_to_ui_drift}"
: "${GROK_EVIDENCE_JSON:?Set GROK_EVIDENCE_JSON to a JSON array}"
: "${EXTENSION_EVIDENCE_JSON:?Set EXTENSION_EVIDENCE_JSON to a JSON array}"
: "${UNRESOLVED_GAPS_JSON:?Set UNRESOLVED_GAPS_JSON to a JSON array}"
node - <<'NODE'
import { writeFileSync } from 'node:fs';

const output = {
  generatedAt: new Date().toISOString(),
  localVault: {
    initialInventory: 'inventory/local-vault-summary.json',
    finalInventory: 'reconciliations/final-vault-summary.json',
    canaryLocalDelta: 'reconciliations/canary-local-delta.json'
  },
  grokSaved: {
    status: process.env.GROK_SAVED_STATUS,
    evidence: JSON.parse(process.env.GROK_EVIDENCE_JSON)
  },
  extensionStorage: {
    status: process.env.EXTENSION_STORAGE_STATUS,
    evidence: JSON.parse(process.env.EXTENSION_EVIDENCE_JSON)
  },
  r2: {
    status: process.env.R2_FINAL_STATUS,
    evidence: [
      'inventory/r2-evidence.json',
      'reconciliations/canary-r2-delta.json'
    ]
  },
  unresolvedGaps: JSON.parse(process.env.UNRESOLVED_GAPS_JSON)
};
writeFileSync('docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/final-reconciliation.json', JSON.stringify(output, null, 2) + '\n');
NODE
jq . docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/final-reconciliation.json
```

Expected: JSON parses and every unresolved gap is specific.

- [ ] **Step 3: Complete report**

Update `report.md` so every section has final content:

- `Executive Status`
- `Confirmed Working Flows`
- `Broken Or Regressed Flows`
- `Blocked Or Unverified Flows`
- `Backup Completeness Findings`
- `UI/UX Drift And Product Discovery`
- `Feature Opportunities`
- `Architecture Rethink Triggers`
- `Prioritized Next Actions`
- `Operator Runbook`

Expected: no section contains an initial "Pending" sentence.

- [ ] **Step 4: Complete manifest**

Update `manifest.json`:

- Set `status` to `complete` if all planned tasks have been run or precisely blocked.
- Set subsystem statuses to final observed values.
- Add all important evidence paths to `evidenceIndex`.
- Add blockers with exact error strings.

Expected: manifest parses with `jq`.

- [ ] **Step 5: Complete implementation notes**

Review `implementation-notes.html` and add final entries for:

- Design decisions made during execution.
- Deviations from the spec or plan.
- Tradeoffs accepted.
- Open questions for the user.

Expected: notes explain how implementation diverged from or interpreted the spec.

- [ ] **Step 6: Run self-review checks**

Run:

```bash
rg -n "Pending|Not run|not_run|T[O]DO|T[B]D|PLACE[H]OLDER" docs/audits/2026-05-20-grok-powertools-full-system-audit/{manifest.json,report.md,reconciliations/final-reconciliation.json,implementation-notes.html}
jq . docs/audits/2026-05-20-grok-powertools-full-system-audit/manifest.json
jq . docs/audits/2026-05-20-grok-powertools-full-system-audit/reconciliations/final-reconciliation.json
```

Expected: `rg` only reports legitimate historical text if any; otherwise no output. `jq` parses both JSON files.

- [ ] **Step 7: Commit final report**

Run:

```bash
git add docs/audits/2026-05-20-grok-powertools-full-system-audit/{manifest.json,report.md,reconciliations/final-vault-summary.json,reconciliations/final-reconciliation.json,implementation-notes.html}
git commit -m "docs: finalize full system audit report"
```

Expected: commit succeeds. If screenshots/logs were intentionally kept local, note that in the final response.

## Task 13: Plan Self-Review Before Execution

**Files:**
- Modify: `docs/superpowers/plans/2026-05-20-full-system-reliability-audit.md`
- Modify: `docs/audits/2026-05-20-grok-powertools-full-system-audit/implementation-notes.html`

- [ ] **Step 1: Check spec coverage**

Verify each approved spec section maps to plan tasks:

- Local Project Health: Tasks 2 and 3.
- Browser and Grok Integration: Tasks 5, 8, 10, and 11.
- Storage and Backup Integrity: Tasks 4, 6, 9, and 12.
- Web App Functionality: Task 7.
- Live Test Flow: Tasks 2 through 12.
- Evidence Model: Tasks 1 through 12.
- Risk Controls: Tasks 5, 6, 8, 9, 10, and 11.
- Tool Routing: Tasks 5, 7, 8, 10, and 11.
- Success Criteria: Task 12.

Expected: no spec requirement lacks a task.

- [ ] **Step 2: Placeholder scan**

Run:

```bash
rg -n "T[B]D|T[O]DO|PLACE[H]OLDER|fill[ ]in|appropriate error handl[i]ng|similar to Tas[k]" docs/superpowers/plans/2026-05-20-full-system-reliability-audit.md
```

Expected: no output.

- [ ] **Step 3: Type and path consistency check**

Run:

```bash
rg -n "2026-05-20-grok-powertools-full-system-audit|manifest.json|report.md|implementation-notes.html|inventory-vault.mjs" docs/superpowers/plans/2026-05-20-full-system-reliability-audit.md
```

Expected: all referenced paths use the same audit folder and file names.

- [ ] **Step 4: Commit the plan and notes**

Run:

```bash
git add docs/superpowers/plans/2026-05-20-full-system-reliability-audit.md docs/audits/2026-05-20-grok-powertools-full-system-audit/implementation-notes.html
git commit -m "docs: add full system audit implementation plan"
```

Expected: commit succeeds.

## Execution Notes

- Keep `implementation-notes.html` current after every meaningful decision, deviation, tradeoff, or open question.
- Do not commit secrets, API keys, or private Grok account tokens.
- Pause before committing screenshots/logs if they include private account information or sensitive generated media.
- Do not delete or mutate local Vault/R2/Grok content as part of the audit.
- If a tiny setup fix is required to unblock the audit, document it in `implementation-notes.html`, make the smallest possible change, run the relevant validation, and commit it separately from audit evidence.
