# Main Cleanup GitHub Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `The-Degen-Dev/grok-powertools` GitHub `main` up to date from the local work while leaving this machine with a clean, reproducible local setup.

**Architecture:** Treat this as a gated release cleanup, not as a feature bundle. First make installs and CI reproducible, then commit the existing TDD-backed R2 backup fix, then validate every local surface, then push through a temporary branch before updating GitHub `main`. Keep unrelated local product work, especially `codex/collection-watch-mode`, out of the main cleanup path.

**Tech Stack:** Git/GitHub CLI, GitHub Actions, Node.js 24 in CI, npm lockfiles, Jest, Playwright, Next.js 16, Cloudflare Worker TypeScript, Chrome MV3 extension, existing Chrome session for live Grok validation, Cloudflare R2 as the only non-local service.

---

## Scope Check

This plan covers one connected release objective: make current local main publishable and make GitHub main current. It touches repo hygiene, CI, dependency reproducibility, the existing backup fix, validation, Git remotes, and stale local worktree cleanup because those are all required to make "clean and on main" true.

This plan does not merge `codex/collection-watch-mode`. That branch has 11 unique commits and should be handled as a separate product plan after GitHub main is stable.

## Open Questions And Stop Gates

- Lockfiles: this plan assumes root `package-lock.json` and `web/package-lock.json` should become tracked files. Reason: CI already runs `npm ci`, GitHub Actions setup-node recommends committing lockfiles, and current CI fails because no root lockfile exists on GitHub.
- Push policy: this plan assumes a temporary branch is pushed first, then GitHub `main` is fast-forwarded only after CI and local validation pass. Direct push to `main` is technically allowed because the branch is unprotected, but it conflicts with the standing rule not to push default branches without explicit permission.
- Agent cleanup docs: this plan treats the untracked `docs/superpowers/plans/2026-05-24-agent-config-cleanup*.{md,html}` files as historical notes and keeps them out of the main release unless the user explicitly wants them committed.
- `temp_ref/`: this plan preserves the ignored `temp_ref` clone during the main sync because it is reference material from `jason-merrell/grok-auto-retry`, not generated junk.

## Evidence Baseline

- GitHub source of truth: `The-Degen-Dev/grok-powertools`, default branch `main`.
- GitHub `main`: `965cf7f84fadf46504bd8c95e370a494d94e1755`.
- Local `main`: `c124c57c29ec9f401f0bf297d5b3e296f1b74c56`, 21 commits ahead of GitHub `main`.
- Current local dirty files: `background.js`, `content.js`, `popup.js`.
- Current untracked files: `tests/unit/grokScraperBackup.test.js`, `docs/superpowers/plans/2026-05-24-agent-config-cleanup.md`, `docs/superpowers/plans/2026-05-24-agent-config-cleanup-implementation-notes.html`.
- Current root validation: `npm run test:unit` passes with 127 tests; `npm run test:e2e` passes with 2 tests; `npm run lint` exits 0 with 16 warnings.
- Current web/cloud validation fails before code runs because `web/node_modules` and `cloud/node_modules` are absent.
- Current GitHub CI failure is caused by missing root lockfile before install.
- Current CI uses stale `actions/checkout@v3`, `actions/setup-node@v3`, and Node 18.

## File Structure

- Create: `tests/unit/reproducibleInstall.test.js`
  - Jest contract test for tracked npm lockfiles and `.gitignore` behavior.
- Modify: `.gitignore`
  - Stop ignoring all `package-lock.json` files.
- Add to Git: `package-lock.json`
  - Root extension/Jest/Playwright/ESLint dependency lockfile.
- Add to Git: `web/package-lock.json`
  - Next.js web app dependency lockfile.
- Already tracked: `cloud/package-lock.json`
  - Cloud Worker dependency lockfile.
- Create: `tests/unit/ciWorkflow.test.js`
  - Jest contract test for GitHub Actions checkout/setup-node versions, Node version, cache dependency paths, and root/web/cloud commands.
- Modify: `.github/workflows/ci.yml`
  - Split CI into extension, web, and cloud jobs using current official GitHub Actions versions and Node 24.
- Add to Git: `tests/unit/grokScraperBackup.test.js`
  - Existing TDD regression coverage for R2 backup media selection, scan exhaustion, upload status accounting, and popup status text.
- Modify: `content.js`
  - Existing backup fix: robust generated-media selection, scroll exhaustion detection, upload status accounting, and processed-ID persistence rules.
- Modify: `background.js`
  - Existing backup fix: accurate R2 backup completion/stopped logging.
- Modify: `popup.js`
  - Existing backup fix: accurate popup backup status labels and counters.
- Local Git config only: remote/tracking changes.
  - Remove dead `origin`, rename `upstream` to `origin`, and track `origin/main`.
- Local cleanup only: stale worktree metadata and safe ignored files.
  - Prune stale `.git/worktrees` metadata and remove `.DS_Store`/test-result files after the push path is complete.

## Task 1: Create A Reproducible Install Contract Test

**Files:**
- Create: `tests/unit/reproducibleInstall.test.js`
- Read: `.gitignore`
- Read: `package-lock.json`
- Read: `web/package-lock.json`
- Read: `cloud/package-lock.json`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/reproducibleInstall.test.js` with this exact content:

```js
const fs = require('fs');
const { execSync } = require('child_process');

function trackedFiles() {
    return execSync('git ls-files package-lock.json web/package-lock.json cloud/package-lock.json', {
        encoding: 'utf8'
    })
        .split('\n')
        .filter(Boolean);
}

describe('reproducible npm installs', () => {
    test('root, web, and cloud lockfiles are tracked', () => {
        expect(trackedFiles().sort()).toEqual([
            'cloud/package-lock.json',
            'package-lock.json',
            'web/package-lock.json'
        ]);
    });

    test('root gitignore does not ignore npm package lockfiles', () => {
        const gitignore = fs.readFileSync('.gitignore', 'utf8');
        const ignoredLines = gitignore
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'));

        expect(ignoredLines).not.toContain('package-lock.json');
        expect(ignoredLines).not.toContain('**/package-lock.json');
    });

    test('all package lockfiles parse as npm lockfile v3', () => {
        for (const file of ['package-lock.json', 'web/package-lock.json', 'cloud/package-lock.json']) {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            expect(parsed.lockfileVersion).toBe(3);
            expect(parsed.packages).toBeTruthy();
            expect(Object.keys(parsed.packages).length).toBeGreaterThan(0);
        }
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test:unit -- tests/unit/reproducibleInstall.test.js
```

Expected: FAIL because `git ls-files` only reports `cloud/package-lock.json`, and `.gitignore` still contains `package-lock.json`.

- [ ] **Step 3: Commit nothing**

Run:

```bash
git status --short -- tests/unit/reproducibleInstall.test.js .gitignore package-lock.json web/package-lock.json cloud/package-lock.json
```

Expected: `tests/unit/reproducibleInstall.test.js` is untracked; no commit is made in this task.

## Task 2: Track Root And Web Lockfiles

**Files:**
- Modify: `.gitignore`
- Add to Git: `package-lock.json`
- Add to Git: `web/package-lock.json`
- Test: `tests/unit/reproducibleInstall.test.js`

- [ ] **Step 1: Update `.gitignore`**

Replace the Node/dependency section in `.gitignore` with this exact block:

```gitignore
# Node / dependencies
node_modules/
yarn.lock
```

The resulting top of `.gitignore` should be:

```gitignore
# OS Files
.DS_Store
Thumbs.db
*.swp

# Node / dependencies
node_modules/
yarn.lock

# Logs
*.log
npm-debug.log*
```

- [ ] **Step 2: Stage the lockfiles and test**

Run:

```bash
git add .gitignore tests/unit/reproducibleInstall.test.js package-lock.json web/package-lock.json cloud/package-lock.json
```

Expected: command exits 0. Root and web lockfiles are no longer ignored.

- [ ] **Step 3: Run the reproducible install test**

Run:

```bash
npm run test:unit -- tests/unit/reproducibleInstall.test.js
```

Expected: PASS.

- [ ] **Step 4: Verify install dry-runs for all package surfaces**

Run:

```bash
npm ci --dry-run
npm ci --prefix web --dry-run
npm ci --prefix cloud --dry-run
```

Expected: all three commands exit 0. The web command may warn on the current local Node `20.18.1`; CI will use Node 24.

- [ ] **Step 5: Commit**

Run:

```bash
git commit -m "chore: track npm lockfiles"
```

Expected: commit succeeds with `.gitignore`, `tests/unit/reproducibleInstall.test.js`, `package-lock.json`, and `web/package-lock.json`.

## Task 3: Create A CI Workflow Contract Test

**Files:**
- Create: `tests/unit/ciWorkflow.test.js`
- Read: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ciWorkflow.test.js` with this exact content:

```js
const fs = require('fs');

const workflowPath = '.github/workflows/ci.yml';

function workflowText() {
    return fs.readFileSync(workflowPath, 'utf8');
}

describe('GitHub Actions CI workflow', () => {
    test('uses current checkout and setup-node actions on Node 24', () => {
        const ci = workflowText();

        expect(ci).toContain('uses: actions/checkout@v6');
        expect(ci).toContain('uses: actions/setup-node@v6');
        expect(ci).toMatch(/node-version:\s*24/);
    });

    test('has separate extension, web, and cloud jobs', () => {
        const ci = workflowText();

        expect(ci).toMatch(/\n\s+extension:/);
        expect(ci).toMatch(/\n\s+web:/);
        expect(ci).toMatch(/\n\s+cloud:/);
    });

    test('caches each npm surface with its own lockfile', () => {
        const ci = workflowText();

        expect(ci).toContain('cache-dependency-path: package-lock.json');
        expect(ci).toContain('cache-dependency-path: web/package-lock.json');
        expect(ci).toContain('cache-dependency-path: cloud/package-lock.json');
    });

    test('runs documented validation commands for each surface', () => {
        const ci = workflowText();

        expect(ci).toContain('npm ci');
        expect(ci).toContain('npm run lint');
        expect(ci).toContain('npm run test:unit');
        expect(ci).toContain('npm run test:e2e');
        expect(ci).toContain('npm ci --prefix web');
        expect(ci).toContain('npm run lint --prefix web');
        expect(ci).toContain('npm run build --prefix web');
        expect(ci).toContain('npm ci --prefix cloud');
        expect(ci).toContain('npm run typecheck --prefix cloud');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test:unit -- tests/unit/ciWorkflow.test.js
```

Expected: FAIL because `.github/workflows/ci.yml` still uses `actions/checkout@v3`, `actions/setup-node@v3`, Node 18, one root-only job, and no web/cloud checks.

- [ ] **Step 3: Commit nothing**

Run:

```bash
git status --short -- tests/unit/ciWorkflow.test.js .github/workflows/ci.yml
```

Expected: `tests/unit/ciWorkflow.test.js` is untracked; no commit is made in this task.

## Task 4: Modernize GitHub Actions CI

**Files:**
- Modify: `.github/workflows/ci.yml`
- Test: `tests/unit/ciWorkflow.test.js`

- [ ] **Step 1: Replace CI workflow**

Replace `.github/workflows/ci.yml` with this exact content:

```yaml
name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

permissions:
  contents: read

jobs:
  extension:
    name: Extension
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v6

      - name: Use Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: package-lock.json

      - name: Install root dependencies
        run: npm ci

      - name: Run root linter
        run: npm run lint

      - name: Run unit tests
        run: npm run test:unit

      - name: Install Playwright Chromium
        run: npx playwright install --with-deps chromium

      - name: Run extension E2E tests
        run: npm run test:e2e

  web:
    name: Web
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v6

      - name: Use Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: web/package-lock.json

      - name: Install web dependencies
        run: npm ci --prefix web

      - name: Run web linter
        run: npm run lint --prefix web

      - name: Build web app
        run: npm run build --prefix web

  cloud:
    name: Cloud Worker
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v6

      - name: Use Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: cloud/package-lock.json

      - name: Install cloud dependencies
        run: npm ci --prefix cloud

      - name: Run cloud typecheck
        run: npm run typecheck --prefix cloud
```

- [ ] **Step 2: Run the CI workflow test**

Run:

```bash
npm run test:unit -- tests/unit/ciWorkflow.test.js
```

Expected: PASS.

- [ ] **Step 3: Run all unit contract tests**

Run:

```bash
npm run test:unit -- tests/unit/reproducibleInstall.test.js tests/unit/ciWorkflow.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add .github/workflows/ci.yml tests/unit/ciWorkflow.test.js
git commit -m "ci: validate all local surfaces"
```

Expected: commit succeeds.

## Task 5: Prove The Existing R2 Backup Fix Is TDD-Backed

**Files:**
- Create: `tests/unit/grokScraperBackup.test.js`
- Modify: `content.js`
- Modify: `background.js`
- Modify: `popup.js`

- [ ] **Step 1: Write the backup regression test**

Create `tests/unit/grokScraperBackup.test.js` with this exact content:

```js
const {
    recordBackupUploadStatus,
    resolveBackupScrollAttempt,
    selectBackupMediaElement,
    shouldPersistBackupProcessedId
} = require('../../content.js');
const {
    formatR2BackupDetails,
    getR2BackupDoneStatusLabel
} = require('../../popup.js');

function setElementBox(el, { width, height, top = 0, left = 0, naturalWidth = width }) {
    Object.defineProperty(el, 'naturalWidth', {
        configurable: true,
        value: naturalWidth
    });
    Object.defineProperty(el, 'naturalHeight', {
        configurable: true,
        value: height
    });
    el.getBoundingClientRect = () => ({
        x: left,
        y: top,
        top,
        left,
        width,
        height,
        right: left + width,
        bottom: top + height
    });
}

describe('Grok backup media selection', () => {
    afterEach(() => {
        document.body.textContent = '';
    });

    test('selects the large generated detail image instead of profile and UI images', () => {
        document.body.innerHTML = `
            <img id="pfp" alt="pfp" src="https://assets.grok.com/users/user-1/profile-picture.webp">
            <img id="share" alt="" src="https://imagine-public.x.ai/i/imagine-public/share-images/share-card.jpg">
            <img id="smallThumb" alt="Most recent favorite" src="https://assets.grok.com/users/user-1/old-favorite/content">
            <img id="generated" alt="Generated detail image" src="https://assets.grok.com/users/user-1/real-media-id/content">
        `;

        setElementBox(document.getElementById('pfp'), { width: 30, height: 30, naturalWidth: 300 });
        setElementBox(document.getElementById('share'), { width: 35, height: 36, naturalWidth: 720 });
        setElementBox(document.getElementById('smallThumb'), { width: 48, height: 48, naturalWidth: 720 });
        setElementBox(document.getElementById('generated'), { width: 421, height: 748, naturalWidth: 720 });

        const media = selectBackupMediaElement(document);

        expect(media).toBe(document.getElementById('generated'));
    });

    test('prefers the active video element when a detail page has video media', () => {
        document.body.innerHTML = `
            <img id="poster" src="https://assets.grok.com/users/user-1/video-thumb/content">
            <video id="video" src="https://assets.grok.com/users/user-1/media-id/generated_video.mp4"></video>
        `;
        setElementBox(document.getElementById('poster'), { width: 400, height: 400, naturalWidth: 720 });
        setElementBox(document.getElementById('video'), { width: 720, height: 720, naturalWidth: 0 });

        const media = selectBackupMediaElement(document);

        expect(media).toBe(document.getElementById('video'));
    });

    test('ignores small rendered thumbnails even when they report large natural dimensions', () => {
        document.body.innerHTML = `
            <img id="pfp" alt="pfp" src="https://assets.grok.com/users/user-1/profile-picture.webp">
            <img id="thumb" alt="" src="https://assets.grok.com/users/user-1/thumb-media-id/content">
        `;
        setElementBox(document.getElementById('pfp'), { width: 30, height: 30, naturalWidth: 300 });
        setElementBox(document.getElementById('thumb'), { width: 48, height: 48, naturalWidth: 720 });
        Object.defineProperty(document.getElementById('thumb'), 'naturalHeight', {
            configurable: true,
            value: 720
        });

        const media = selectBackupMediaElement(document);

        expect(media).toBeNull();
    });
});

describe('Grok backup scan exhaustion', () => {
    test('does not exhaust while the gallery scroll position is still advancing', () => {
        const result = resolveBackupScrollAttempt({
            before: { scrollTop: 100, scrollHeight: 2000, clientHeight: 500 },
            after: { scrollTop: 600, scrollHeight: 2000, clientHeight: 500 },
            beforeSignature: 'same-cards',
            afterSignature: 'same-cards',
            staleRetries: 99,
            maxStaleRetries: 100
        });

        expect(result.exhausted).toBe(false);
        expect(result.nextStaleRetries).toBe(0);
    });

    test('does not exhaust at the bottom when newly loaded card identities changed', () => {
        const result = resolveBackupScrollAttempt({
            before: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
            after: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
            beforeSignature: 'old-cards',
            afterSignature: 'new-cards',
            staleRetries: 99,
            maxStaleRetries: 100
        });

        expect(result.exhausted).toBe(false);
        expect(result.nextStaleRetries).toBe(0);
    });

    test('exhausts only after repeated stable no-new scans at the gallery bottom', () => {
        const result = resolveBackupScrollAttempt({
            before: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
            after: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
            beforeSignature: 'same-cards',
            afterSignature: 'same-cards',
            staleRetries: 99,
            maxStaleRetries: 100
        });

        expect(result.exhausted).toBe(true);
        expect(result.nextStaleRetries).toBe(100);
    });
});

describe('Grok backup upload stats', () => {
    test('tracks uploaded, already-present, and queued statuses separately', () => {
        const stats = { uploaded: 0, alreadyPresent: 0, queued: 0, errors: 0 };

        expect(recordBackupUploadStatus(stats, 'uploaded')).toBe(true);
        expect(recordBackupUploadStatus(stats, 'already_present')).toBe(true);
        expect(recordBackupUploadStatus(stats, 'queued')).toBe(true);

        expect(stats).toEqual({
            uploaded: 1,
            alreadyPresent: 1,
            queued: 1,
            errors: 0
        });
    });

    test('does not persist processed IDs for queued uploads before R2 success is proven', () => {
        expect(shouldPersistBackupProcessedId('uploaded')).toBe(true);
        expect(shouldPersistBackupProcessedId('already_present')).toBe(true);
        expect(shouldPersistBackupProcessedId('conflict_uploaded')).toBe(true);
        expect(shouldPersistBackupProcessedId('queued')).toBe(false);
    });
});

describe('Grok backup popup status text', () => {
    test('labels scan-limit stops as paused instead of complete', () => {
        expect(getR2BackupDoneStatusLabel({ stopReason: 'scan_limit' })).toBe('Paused');
    });

    test('shows uploaded, already-present, queued, and error counts separately', () => {
        expect(formatR2BackupDetails({
            uploaded: 2,
            alreadyPresent: 3,
            queued: 4,
            errors: 1
        })).toBe('2 uploaded / 3 already present / 4 queued / 1 errors');
    });
});
```

- [ ] **Step 2: Prove the test fails against the pre-fix base**

Run:

```bash
TMPDIR="$(mktemp -d)"
git worktree add "$TMPDIR/base" HEAD
cp tests/unit/grokScraperBackup.test.js "$TMPDIR/base/tests/unit/grokScraperBackup.test.js"
(
  cd "$TMPDIR/base"
  npm ci
  npm run test:unit -- tests/unit/grokScraperBackup.test.js
)
git worktree remove "$TMPDIR/base" --force
rmdir "$TMPDIR"
```

Expected: FAIL in the temporary worktree because `HEAD` does not export the new backup helper functions and does not have the fixed backup behavior.

- [ ] **Step 3: Confirm the implementation contains the minimal helper surface**

Inspect `content.js` and confirm these functions exist near the other top-level helpers:

```js
function getBackupMediaElementSrc(el) {
    if (!el) return '';
    if (el.tagName && el.tagName.toLowerCase() === 'video') {
        return el.src || el.currentSrc || el.querySelector?.('source')?.src || '';
    }
    return el.currentSrc || el.src || '';
}

function recordBackupUploadStatus(stats, status) {
    if (!stats) return false;
    if (status === 'uploaded' || status === 'conflict_uploaded') {
        stats.uploaded = (stats.uploaded || 0) + 1;
        return true;
    }
    if (status === 'already_present') {
        stats.alreadyPresent = (stats.alreadyPresent || 0) + 1;
        return true;
    }
    if (status === 'queued') {
        stats.queued = (stats.queued || 0) + 1;
        return true;
    }
    return false;
}

function shouldPersistBackupProcessedId(status) {
    return status === 'uploaded' || status === 'already_present' || status === 'conflict_uploaded';
}
```

- [ ] **Step 4: Run the backup regression test in the real worktree**

Run:

```bash
npm run test:unit -- tests/unit/grokScraperBackup.test.js
```

Expected: PASS.

- [ ] **Step 5: Run all root unit tests**

Run:

```bash
npm run test:unit
```

Expected: PASS with 127 or more tests. If the count is higher because of the new CI/reproducibility tests, confirm the new total is expected.

- [ ] **Step 6: Commit the backup fix**

Run:

```bash
git add background.js content.js popup.js tests/unit/grokScraperBackup.test.js
git commit -m "fix: harden grok saved r2 backup scan"
```

Expected: commit succeeds.

## Task 6: Install Local Dependencies And Run Full Local Validation

**Files:**
- No source files changed.
- Uses: `package-lock.json`
- Uses: `web/package-lock.json`
- Uses: `cloud/package-lock.json`

- [ ] **Step 1: Install root dependencies from the tracked lockfile**

Run:

```bash
npm ci
```

Expected: command exits 0.

- [ ] **Step 2: Install web dependencies from the tracked lockfile**

Run:

```bash
npm ci --prefix web
```

Expected: command exits 0 on Node 24 or Node `20.19+`. If local Node is still `20.18.1`, switch Node before continuing.

- [ ] **Step 3: Install cloud dependencies from the tracked lockfile**

Run:

```bash
npm ci --prefix cloud
```

Expected: command exits 0 on Node 24 or Node `20.19+`.

- [ ] **Step 4: Run root validation**

Run:

```bash
npm run test:unit
npm run test:e2e
npm run lint
```

Expected:
- Unit tests pass.
- Extension E2E passes.
- Root lint exits 0. Existing warnings are acceptable only if the count and files are reviewed and unchanged from the known 16-warning baseline.

- [ ] **Step 5: Run web validation**

Run:

```bash
npm run lint --prefix web
npm run build --prefix web
```

Expected: both commands exit 0.

- [ ] **Step 6: Run cloud validation**

Run:

```bash
npm run typecheck --prefix cloud
```

Expected: command exits 0.

- [ ] **Step 7: Commit nothing**

Run:

```bash
git status --short -- node_modules web/node_modules cloud/node_modules
```

Expected: no tracked changes. Dependency folders remain ignored.

## Task 7: Repair Git Remote Configuration

**Files:**
- Local Git config only.

- [ ] **Step 1: Confirm current remote problem**

Run:

```bash
git remote -v
git remote show origin || true
git remote show upstream
```

Expected:
- `origin` points to `https://github.com/philipbankier/grok-powertools.git` and fails.
- `upstream` points to `git@github.com:The-Degen-Dev/grok-powertools.git` and works.

- [ ] **Step 2: Replace the dead origin with the real GitHub remote**

Run:

```bash
git remote remove origin
git remote rename upstream origin
git fetch origin --prune --tags
git branch --set-upstream-to=origin/main main
```

Expected: command exits 0.

- [ ] **Step 3: Verify remotes and branch tracking**

Run:

```bash
git remote -v
git status --short --branch
git rev-list --left-right --count origin/main...main
```

Expected:
- `origin` points to `git@github.com:The-Degen-Dev/grok-powertools.git`.
- `main` tracks `origin/main`.
- Local branch is ahead of GitHub `main` by the known commit count and behind by 0.

## Task 8: Push A Review Branch And Verify GitHub CI

**Files:**
- No source files changed.

- [ ] **Step 1: Create or switch to the cleanup branch**

Run:

```bash
git switch -c codex/main-cleanup-github-sync
```

Expected: branch is created from the current validated local `main`. If the branch already exists, run `git switch codex/main-cleanup-github-sync`.

- [ ] **Step 2: Push the cleanup branch**

Run:

```bash
git push -u origin codex/main-cleanup-github-sync
```

Expected: branch pushes to GitHub.

- [ ] **Step 3: Watch CI**

Run:

```bash
gh run list --repo The-Degen-Dev/grok-powertools --branch codex/main-cleanup-github-sync --limit 5
```

Expected: a new CI run appears.

- [ ] **Step 4: Wait for CI completion**

Run:

```bash
gh run watch --repo The-Degen-Dev/grok-powertools
```

Expected: CI completes successfully. If it fails, run:

```bash
gh run view --repo The-Degen-Dev/grok-powertools --log-failed
```

Expected: failed logs identify the exact job and command to fix before any `main` push.

## Task 9: Live Extension And R2 Canary Validation

**Files:**
- No source files changed unless validation exposes a bug.

- [ ] **Step 1: Confirm browser automation tool availability**

Run:

```bash
command -v agent-browser || true
command -v plwr || true
```

Expected: record which tools are available. For authenticated Grok state, use the existing Chrome window/session only. Do not start a detached Chrome profile.

- [ ] **Step 2: Reload the unpacked extension in existing Chrome**

Use the existing Chrome window. Navigate to `chrome://extensions`, reload Grok Power Tools, then refresh the existing `https://grok.com/imagine/saved` tab.

Expected: the Grok Power Tools overlay appears in the existing authenticated Grok tab.

- [ ] **Step 3: Run a one-item backup canary**

In the existing Grok Saved tab:
- Start R2 backup with the smallest safe limit available.
- Let one generated media item process.
- Stop the backup immediately after one item reaches `uploaded` or `already_present`.

Expected:
- The selected media is generated content, not a profile image, share image, or thumbnail.
- Popup/overlay status distinguishes `uploaded`, `already_present`, `queued`, and `errors`.
- No `queued` item is added to `processedIds` before R2 presence is proven.

- [ ] **Step 4: Record evidence without exposing secrets**

Record only:
- current commit hash,
- local validation commands and statuses,
- Grok URL,
- non-secret Worker host,
- backup status counts,
- object key suffix or redacted object key,
- whether R2 verification was direct Worker verification or existing-object verification.

Expected: no API keys, cookies, bearer tokens, raw signed URLs, prompt text, or private media thumbnails are written to repo files.

## Task 10: Fast-Forward GitHub Main After Approval

**Files:**
- No source files changed.

- [ ] **Step 1: Stop for approval**

Ask the user:

```text
CI passed on codex/main-cleanup-github-sync and local validation passed. Approve fast-forwarding GitHub main now?
```

Expected: user explicitly approves before continuing.

- [ ] **Step 2: Fast-forward local main to the cleanup branch**

Run:

```bash
git switch main
git merge --ff-only codex/main-cleanup-github-sync
```

Expected: local `main` points to the validated cleanup branch tip.

- [ ] **Step 3: Dry-run main push**

Run:

```bash
git push --dry-run origin main:main
```

Expected: dry-run reports a fast-forward update to GitHub `main`.

- [ ] **Step 4: Push main**

Run:

```bash
git push origin main:main
```

Expected: GitHub `main` updates.

- [ ] **Step 5: Verify GitHub main**

Run:

```bash
git fetch origin --prune
git rev-parse main
git rev-parse origin/main
git rev-list --left-right --count origin/main...main
gh run list --repo The-Degen-Dev/grok-powertools --branch main --limit 3
```

Expected:
- `git rev-parse main` and `git rev-parse origin/main` match.
- Ahead/behind count is `0 0`.
- A main CI run exists and is passing or in progress.

## Task 11: Clean Local Workspace Metadata

**Files:**
- Local Git metadata and ignored local files only.

- [ ] **Step 1: Prune stale Git worktrees**

Run:

```bash
git worktree prune --dry-run -v
git worktree prune -v
git worktree list --porcelain
```

Expected: stale worktree metadata for missing Codex worktrees is removed. The remaining worktree list includes the current repo only unless another valid worktree exists.

- [ ] **Step 2: Preserve unmerged collection branch**

Run:

```bash
git branch --list codex/collection-watch-mode
git rev-list --left-right --count main...codex/collection-watch-mode
```

Expected: branch still exists. It remains separate because it has unique work not covered by this plan.

- [ ] **Step 3: Delete obsolete R2 branch only after main contains the equivalent patch**

Run:

```bash
git cherry -v main codex/r2-dedupe-reliability
```

Expected: output starts with `-` for the R2 commit, proving patch equivalence.

Then run:

```bash
git branch -d codex/r2-dedupe-reliability
```

Expected: branch deletes cleanly.

- [ ] **Step 4: Remove safe ignored local junk**

Run:

```bash
rm -f .DS_Store cloud/.DS_Store web/.DS_Store
rm -rf test-results playwright-report
```

Expected: command exits 0.

- [ ] **Step 5: Keep sensitive and reference local files**

Run:

```bash
test -f web/.env.local
test -d temp_ref
```

Expected: both commands exit 0. Do not delete `web/.env.local` or `temp_ref` in this plan.

- [ ] **Step 6: Final clean status check**

Run:

```bash
git status --short --branch --untracked-files=all
git status --short --ignored --untracked-files=all | sed -n '1,80p'
```

Expected:
- Normal status shows a clean tracked and untracked working tree.
- Ignored status may show dependency folders, `web/.env.local`, `cloud/.wrangler`, root/web lockfiles only if the lockfile tracking task was not followed, and `temp_ref`.

## Task 12: Final Safety Report

**Files:**
- No source files changed.

- [ ] **Step 1: Produce final command summary**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
git remote -v
gh run list --repo The-Degen-Dev/grok-powertools --branch main --limit 3
```

Expected: output proves local main and GitHub main are aligned and CI status is visible.

- [ ] **Step 2: Report remaining separate work**

Report these exact items:

```text
Remaining separate work:
- codex/collection-watch-mode is preserved and not merged.
- temp_ref is preserved as ignored reference material.
- web/.env.local is preserved and not committed.
- R2 bucket state was touched only by the approved one-item canary.
```

Expected: user has a clear boundary between completed main cleanup and deferred product work.

## Self-Review

### Spec Coverage

- Local vs GitHub source of truth: covered by Tasks 7, 8, and 10.
- GitHub main fully up to date: covered by Task 10.
- Clean local setup: covered by Tasks 1, 2, 6, 7, 11, and 12.
- CI failure and stale Actions versions: covered by Tasks 3 and 4.
- TDD-driven backup fix: covered by Task 5.
- Web and cloud local validation: covered by Task 6.
- R2 as the only non-local service: covered by Task 9.
- Other local workspaces and branches: covered by Task 11.
- Collection-watch branch isolation: covered by Scope Check and Task 11.

### Filler Scan

No task contains unresolved filler text. Decision gates are explicit stop points with exact prompts and expected outcomes.

### Type And Command Consistency

- Test file names match task commands.
- GitHub workflow command strings match `tests/unit/ciWorkflow.test.js`.
- Lockfile paths match `tests/unit/reproducibleInstall.test.js`.
- Commit messages use semantic prefixes.
