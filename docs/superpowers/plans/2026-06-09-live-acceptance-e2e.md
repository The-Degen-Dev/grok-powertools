# Live Acceptance E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe live acceptance harness that proves Grok Power Tools works across the extension, Grok, Cloudflare Worker/R2/D1, local vault/download behavior, and the web app without touching production backup resources.

**Architecture:** Add a typed local acceptance contract, an acceptance-only Worker mode, extension run/correlation propagation, and a redacted evidence workbook. Run validation in ordered lanes: local gates, isolated browser, acceptance cloud, existing Chrome, and web ops review. Existing Chrome is final-lane only and must use the already open profile/session.

**Tech Stack:** Node 24 through `mise`, Jest, Playwright, Chrome MV3 JavaScript, Cloudflare Worker TypeScript, Wrangler 4, R2, D1, Next.js 16, Peekaboo for native macOS state when browser tools cannot reach it.

---

## Scope Check

This plan covers one connected acceptance system. The cloud Worker, extension upload path, local harness, evidence workbook, and ops page all need the same run ID and correlation model, so splitting them into separate plans would create incompatible contracts.

This plan does not run a full production backup. This plan also does not push to `main`.

## Current Stop Gates

- R2 bucket list/create/verify is currently blocked by Cloudflare auth error code `10000`. Live acceptance cloud setup must stop until R2 access works through Wrangler or a documented API path.
- Chrome DevTools MCP is not connected. If CDP is used, it must connect only to the existing Chrome window/session.
- `agent-browser` and `plwr` are not installed, so browser automation must use Browser/browser-use, Playwright, Peekaboo, or existing Chrome tooling according to project routing rules.
- Port `3001` is currently owned by another workspace. Web acceptance must prove the Next server was launched from this repo or choose a different free port.
- The installed Chrome extension ID, version, and source hash were not fully verified in the latest read-only pass. Existing-Chrome acceptance is blocked until they match the manifest.

## Docs And Version Checks

Context7 documentation checked on 2026-06-09:

- Cloudflare Workers docs confirm R2 and D1 bindings are supported in TOML and JSONC.
- Cloudflare Workers docs confirm Wrangler environments can set separate remote R2 bindings.
- Cloudflare Workers docs confirm `npx wrangler r2 bucket create grok-powertools-acceptance` and `npx wrangler d1 create grok-powertools-acceptance-db` match the current CLI flow.

Package registry checks on 2026-06-09:

- `wrangler`: `4.98.0`
- `@cloudflare/workers-types`: `4.20260609.1`
- `@aws-sdk/client-s3`: `3.1064.0`
- `@aws-sdk/s3-request-presigner`: `3.1064.0`
- `@types/node@24`: `24.13.1`

## File Structure

- Existing: `docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-planning-notes.html`
  - Planning-time notes for design decisions, deviations, tradeoffs, and open questions while translating the spec into this implementation plan.
- Create: `docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html`
  - Running execution notes for design decisions, deviations, tradeoffs, and open questions.
- Create: `acceptance/lib/run-contract.js`
  - Pure JavaScript helpers for manifest validation, redaction, and verdict classification.
- Create: `tests/unit/acceptanceRunContract.test.js`
  - Jest tests for the local acceptance contract.
- Modify: `cloud/package.json`
  - Add `test:acceptance` and update Cloudflare/AWS SDK packages to current checked versions.
- Modify: `cloud/package-lock.json`
  - Lock updated cloud dependencies.
- Create: `cloud/tsconfig.test.json`
  - Emits only cloud acceptance tests and pure acceptance helpers into `.tmp-test`.
- Create: `cloud/tests/acceptance.test.ts`
  - Node test runner coverage for acceptance identity, write guards, and secret-free diagnostics.
- Create: `cloud/tests/worker-acceptance-routing.test.ts`
  - Worker fetch tests for acceptance identity and guarded write endpoints.
- Create: `cloud/src/acceptance.ts`
  - Pure Worker acceptance-mode helpers.
- Modify: `cloud/src/types.ts`
  - Add acceptance environment fields.
- Modify: `cloud/src/index.ts`
  - Add `/v1/acceptance/identity` and acceptance write guards.
- Create: `cloud/acceptance-schema.sql`
  - Acceptance-only D1 tables for armed runs and append-only events.
- Create: `acceptance/scripts/write-cloudflare-acceptance-config.mjs`
  - Writes an ignored acceptance Wrangler config from verified local environment values.
- Modify: `.gitignore`
  - Ignore generated acceptance config and test temp directories.
- Modify: `cloudSyncUtils.js`
  - Add acceptance context normalization and header builders.
- Create: `tests/unit/cloudSyncUtilsAcceptance.test.js`
  - Jest coverage for acceptance context and headers.
- Modify: `background.js`
  - Carry acceptance run/correlation metadata into presign, verify, metadata snapshot, direct upload, and queue items.
- Modify: `content.js`
  - Preserve acceptance canary options from page command to runtime upload messages.
- Extend: `tests/unit/grokScraperBackup.test.js`
  - Coverage for page-command canary metadata propagation.
- Extend: `tests/e2e/extension.spec.js`
  - Browser e2e coverage for fail-closed full backup and bounded canary metadata.
- Create: `acceptance/lib/preflight.js`
  - Pure readiness classifiers for ports, Chrome, Cloudflare CLI output, extension identity, and redaction.
- Create: `tests/unit/acceptancePreflight.test.js`
  - Jest coverage for readiness decisions.
- Create: `acceptance/scripts/preflight.mjs`
  - Local preflight command that prints redacted `verified`, `blocked`, or `contaminated` JSON.
- Create: `acceptance/lib/evidence-workbook.js`
  - JSON and HTML evidence workbook writer.
- Create: `tests/unit/acceptanceEvidenceWorkbook.test.js`
  - Jest coverage for workbook redaction, event order, and verdict rows.
- Modify: `web/src/lib/types.ts`
  - Add acceptance verdict fields while preserving existing ops statuses.
- Modify: `web/src/components/ops/OpsConsole.tsx`
  - Display acceptance workbook status, run ID, lane, and blockers from imported JSON.
- Create: `acceptance/scripts/run-local-gates.mjs`
  - Runs local checks in Node 24 and writes evidence.
- Create: `acceptance/scripts/run-live-canary.mjs`
  - Manual-arm live canary driver that stops unless preflight is verified.
- Modify: `docs/CLOUD_R2_SETUP.md`
  - Document acceptance resources, no-production-touch rules, and current acceptance runbook.

## Planning Notes

Implementation planning notes are saved in `docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-planning-notes.html`.

That file records how this plan interprets the approved design spec. It is separate from the execution notes file created during Task 1, which will track implementation-time decisions and deviations.

## Task 1: Root Acceptance Contract And Notes

**Files:**
- Create: `docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html`
- Create: `tests/unit/acceptanceRunContract.test.js`
- Create: `acceptance/lib/run-contract.js`

- [ ] **Step 1: Create the implementation notes file**

Create `docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html` with this exact content:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Live Acceptance E2E Implementation Notes</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
      margin: 40px auto;
      max-width: 980px;
      color: #1f2328;
    }
    h1, h2 {
      line-height: 1.2;
    }
    code {
      background: #f6f8fa;
      border-radius: 4px;
      padding: 0.1em 0.3em;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border: 1px solid #d0d7de;
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f6f8fa;
    }
    .pending {
      color: #8250df;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <h1>Live Acceptance E2E Implementation Notes</h1>
  <p>
    Running notes for executing
    <code>docs/superpowers/plans/2026-06-09-live-acceptance-e2e.md</code>.
    This file records design decisions, deviations, tradeoffs, and open questions.
  </p>

  <h2>Status</h2>
  <table>
    <thead>
      <tr>
        <th>Task</th>
        <th>Status</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Execution setup</td>
        <td class="pending">Pending</td>
        <td>Implementation notes created before production code edits.</td>
      </tr>
    </tbody>
  </table>

  <h2>Design Decisions</h2>
  <ul>
    <li>Keep acceptance artifacts under <code>acceptance/</code> and <code>docs/superpowers/plans/</code> so they are separate from product runtime files.</li>
  </ul>

  <h2>Deviations</h2>
  <ul></ul>

  <h2>Tradeoffs</h2>
  <ul></ul>

  <h2>Open Questions</h2>
  <ul>
    <li>Cloudflare R2 access is blocked until the current account/token can list or create acceptance buckets.</li>
  </ul>
</body>
</html>
```

- [ ] **Step 2: Write the failing Jest tests**

Create `tests/unit/acceptanceRunContract.test.js` with this exact content:

```js
const {
    classifyVerdict,
    redactEvidence,
    validateAcceptanceManifest
} = require('../../acceptance/lib/run-contract.js');

describe('acceptance run contract', () => {
    test('validates a strict manifest without reading secrets', () => {
        const manifest = validateAcceptanceManifest({
            runId: 'run-20260609-001',
            laneId: 'isolated-browser',
            canaryId: 'public-image-1',
            extension: {
                id: 'abcdefghijklmnopabcdefghijklmnop',
                version: '0.2.0',
                sourcePath: '/repo',
                sourceHash: 'a'.repeat(64)
            },
            worker: {
                identityUrl: 'https://acceptance-worker.example.workers.dev/v1/acceptance/identity',
                version: '2026-06-09.1'
            },
            cloud: {
                r2Bucket: 'grok-powertools-acceptance',
                d1Database: 'grok-powertools-acceptance-db',
                d1DatabaseId: '11111111-2222-4333-8444-555555555555',
                keyPrefix: 'acceptance/run-20260609-001',
                apiKeyFingerprint: 'sha256:abc123'
            },
            browser: {
                profileMode: 'isolated',
                downloadRoot: '/tmp/grok-acceptance-downloads'
            },
            restorePlan: {
                storageKeys: ['cloudConfig', 'cloudSyncQueue'],
                sentinelRequired: true
            }
        });

        expect(manifest.cloud.keyPrefix).toBe('acceptance/run-20260609-001');
        expect(manifest.cloud).not.toHaveProperty('apiKey');
    });

    test('rejects production prefixes and missing identity fields', () => {
        expect(() => validateAcceptanceManifest({
            runId: 'run-1',
            laneId: 'existing-chrome',
            canaryId: 'image-1',
            extension: {
                id: 'abcdefghijklmnopabcdefghijklmnop',
                version: '0.2.0',
                sourcePath: '/repo',
                sourceHash: 'b'.repeat(64)
            },
            worker: {
                identityUrl: 'https://acceptance-worker.example.workers.dev/v1/acceptance/identity',
                version: '2026-06-09.1'
            },
            cloud: {
                r2Bucket: 'grok-gallery-001',
                d1Database: 'grok-powertools-db',
                d1DatabaseId: 'ad89e4bb-0b68-4c72-93d9-b90e6eb45aa6',
                keyPrefix: 'grok-powertools/v1',
                apiKeyFingerprint: 'sha256:def456'
            },
            browser: {
                profileMode: 'existing',
                downloadRoot: '/tmp/grok-acceptance-downloads'
            },
            restorePlan: {
                storageKeys: ['cloudConfig'],
                sentinelRequired: true
            }
        })).toThrow('production resource');
    });

    test('redacts secrets, signed URLs, cookies, and prompt text recursively', () => {
        const redacted = redactEvidence({
            apiKey: 'plain-secret',
            uploadUrl: 'https://bucket.r2.cloudflarestorage.com/key?X-Amz-Signature=abc',
            headers: {
                Cookie: 'x=y',
                Authorization: 'Bearer token'
            },
            promptText: 'private prompt',
            safe: {
                objectKey: 'acceptance/run-1/users/u/media/by-asset/media_1.png'
            }
        });

        expect(redacted).toEqual({
            apiKey: '[REDACTED]',
            uploadUrl: '[REDACTED_URL]',
            headers: {
                Cookie: '[REDACTED]',
                Authorization: '[REDACTED]'
            },
            promptText: '[REDACTED]',
            safe: {
                objectKey: 'acceptance/run-1/users/u/media/by-asset/media_1.png'
            }
        });
    });

    test('classifies verdicts with contamination taking precedence', () => {
        expect(classifyVerdict({
            mutated: true,
            preflightOk: true,
            assertionsOk: true,
            safetyClean: false,
            evidenceComplete: true,
            sentinelClean: true
        })).toBe('contaminated');

        expect(classifyVerdict({
            mutated: false,
            preflightOk: false,
            assertionsOk: false,
            safetyClean: true,
            evidenceComplete: false,
            sentinelClean: false
        })).toBe('blocked');

        expect(classifyVerdict({
            mutated: true,
            preflightOk: true,
            assertionsOk: true,
            safetyClean: true,
            evidenceComplete: true,
            sentinelClean: true
        })).toBe('verified');
    });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
mise exec node@24 -- npm run test:unit -- tests/unit/acceptanceRunContract.test.js
```

Expected: FAIL with `Cannot find module '../../acceptance/lib/run-contract.js'`.

- [ ] **Step 4: Write the minimal implementation**

Create `acceptance/lib/run-contract.js` with this exact content:

```js
const PRODUCTION_BUCKETS = new Set(['grok-gallery-001']);
const PRODUCTION_D1_DATABASES = new Set(['grok-powertools-db']);
const PRODUCTION_D1_IDS = new Set(['ad89e4bb-0b68-4c72-93d9-b90e6eb45aa6']);
const PRODUCTION_PREFIXES = new Set(['grok-powertools/v1']);
const SECRET_KEY_RE = /(api[-_]?key|authorization|cookie|token|secret|password|uploadurl|signedurl|prompttext)/i;
const SIGNED_URL_RE = /[?&](X-Amz-Signature|X-Amz-Credential|Expires|Signature)=/i;

function requireString(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${path} is required`);
    }
    return value.trim();
}

function requireObject(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${path} is required`);
    }
    return value;
}

function assertNotProduction(manifest) {
    const cloud = manifest.cloud;
    if (
        PRODUCTION_BUCKETS.has(cloud.r2Bucket) ||
        PRODUCTION_D1_DATABASES.has(cloud.d1Database) ||
        PRODUCTION_D1_IDS.has(cloud.d1DatabaseId) ||
        PRODUCTION_PREFIXES.has(cloud.keyPrefix)
    ) {
        throw new Error('Manifest references a production resource');
    }
    if (!cloud.keyPrefix.startsWith(`acceptance/${manifest.runId}`)) {
        throw new Error('cloud.keyPrefix must start with the active acceptance run ID');
    }
}

function validateAcceptanceManifest(input) {
    const manifest = requireObject(input, 'manifest');
    const extension = requireObject(manifest.extension, 'extension');
    const worker = requireObject(manifest.worker, 'worker');
    const cloud = requireObject(manifest.cloud, 'cloud');
    const browser = requireObject(manifest.browser, 'browser');
    const restorePlan = requireObject(manifest.restorePlan, 'restorePlan');

    const normalized = {
        runId: requireString(manifest.runId, 'runId'),
        laneId: requireString(manifest.laneId, 'laneId'),
        canaryId: requireString(manifest.canaryId, 'canaryId'),
        extension: {
            id: requireString(extension.id, 'extension.id'),
            version: requireString(extension.version, 'extension.version'),
            sourcePath: requireString(extension.sourcePath, 'extension.sourcePath'),
            sourceHash: requireString(extension.sourceHash, 'extension.sourceHash')
        },
        worker: {
            identityUrl: requireString(worker.identityUrl, 'worker.identityUrl'),
            version: requireString(worker.version, 'worker.version')
        },
        cloud: {
            r2Bucket: requireString(cloud.r2Bucket, 'cloud.r2Bucket'),
            d1Database: requireString(cloud.d1Database, 'cloud.d1Database'),
            d1DatabaseId: requireString(cloud.d1DatabaseId, 'cloud.d1DatabaseId'),
            keyPrefix: requireString(cloud.keyPrefix, 'cloud.keyPrefix').replace(/^\/+|\/+$/g, ''),
            apiKeyFingerprint: requireString(cloud.apiKeyFingerprint, 'cloud.apiKeyFingerprint')
        },
        browser: {
            profileMode: requireString(browser.profileMode, 'browser.profileMode'),
            downloadRoot: requireString(browser.downloadRoot, 'browser.downloadRoot')
        },
        restorePlan: {
            storageKeys: Array.isArray(restorePlan.storageKeys) ? restorePlan.storageKeys.map(String) : [],
            sentinelRequired: restorePlan.sentinelRequired === true
        }
    };

    assertNotProduction(normalized);
    return normalized;
}

function redactEvidence(value, key = '') {
    if (typeof value === 'string') {
        if (SECRET_KEY_RE.test(key)) return key.toLowerCase().includes('url') ? '[REDACTED_URL]' : '[REDACTED]';
        if (SIGNED_URL_RE.test(value)) return '[REDACTED_URL]';
        return value;
    }
    if (Array.isArray(value)) return value.map((entry) => redactEvidence(entry, key));
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
            entryKey,
            redactEvidence(entryValue, entryKey)
        ])
    );
}

function classifyVerdict(state) {
    if (!state.safetyClean) return 'contaminated';
    if (!state.preflightOk && !state.mutated) return 'blocked';
    if (state.evidenceCollectorFailedBeforeMutation && !state.mutated) return 'inconclusive';
    if (!state.assertionsOk) return 'failed';
    if (!state.evidenceComplete || !state.sentinelClean) return state.mutated ? 'contaminated' : 'inconclusive';
    return 'verified';
}

module.exports = {
    classifyVerdict,
    redactEvidence,
    validateAcceptanceManifest
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
mise exec node@24 -- npm run test:unit -- tests/unit/acceptanceRunContract.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html tests/unit/acceptanceRunContract.test.js acceptance/lib/run-contract.js
git commit -m "feat: add acceptance run contract"
```

Expected: commit succeeds.

## Task 2: Cloud Acceptance Helper And Test Harness

**Files:**
- Modify: `cloud/package.json`
- Modify: `cloud/package-lock.json`
- Create: `cloud/tsconfig.test.json`
- Create: `cloud/tests/acceptance.test.ts`
- Create: `cloud/src/acceptance.ts`
- Modify: `docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html`

- [ ] **Step 1: Update cloud dependency versions and add the test script**

Run:

```bash
cd cloud
npm install --save-dev wrangler@4.98.0 @cloudflare/workers-types@4.20260609.1 @types/node@24.13.1
npm install @aws-sdk/client-s3@3.1064.0 @aws-sdk/s3-request-presigner@3.1064.0
```

Then edit `cloud/package.json` so the `scripts` block is exactly:

```json
"scripts": {
  "dev": "wrangler dev",
  "deploy": "wrangler deploy",
  "typecheck": "tsc --noEmit",
  "test:acceptance": "rm -rf .tmp-test && tsc -p tsconfig.test.json && node --test .tmp-test/tests/*.test.js"
}
```

- [ ] **Step 2: Add the cloud test tsconfig**

Create `cloud/tsconfig.test.json` with this exact content:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "noEmit": false,
    "outDir": ".tmp-test",
    "types": [
      "node",
      "@cloudflare/workers-types"
    ]
  },
  "include": [
    "src/acceptance.ts",
    "tests/**/*.test.ts"
  ]
}
```

- [ ] **Step 3: Write the failing cloud acceptance test**

Create `cloud/tests/acceptance.test.ts` with this exact content:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAcceptanceIdentity,
  validateAcceptanceWrite,
} from '../src/acceptance';

const baseEnv = {
  ACCEPTANCE_MODE: 'true',
  ACCEPTANCE_RUN_ID: 'run-20260609-001',
  ACCEPTANCE_KEY_PREFIX: 'acceptance/run-20260609-001',
  WORKER_VERSION: '2026-06-09.1',
  KEY_PREFIX: 'acceptance/run-20260609-001',
  R2_BUCKET_NAME: 'grok-powertools-acceptance',
  R2_BUCKET: {},
  DB: {},
};

test('buildAcceptanceIdentity returns non-secret acceptance diagnostics', () => {
  const identity = buildAcceptanceIdentity(baseEnv);

  assert.equal(identity.ok, true);
  assert.equal(identity.acceptanceMode, true);
  assert.equal(identity.runId, 'run-20260609-001');
  assert.equal(identity.keyPrefix, 'acceptance/run-20260609-001');
  assert.equal(identity.r2.bucketName, 'grok-powertools-acceptance');
  assert.equal(identity.r2.bindingPresent, true);
  assert.equal(identity.d1.bindingPresent, true);
  assert.equal(JSON.stringify(identity).includes('secret'), false);
});

test('validateAcceptanceWrite rejects production prefixes in acceptance mode', () => {
  const result = validateAcceptanceWrite(baseEnv, {
    objectKey: 'grok-powertools/v1/users/u/media/by-asset/media_1.png',
    runId: 'run-20260609-001',
    correlationId: 'corr-1',
  });

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: 'objectKey must start with acceptance/run-20260609-001/',
  });
});

test('validateAcceptanceWrite rejects missing run and correlation IDs', () => {
  const result = validateAcceptanceWrite(baseEnv, {
    objectKey: 'acceptance/run-20260609-001/users/u/media/by-asset/media_1.png',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /run ID/);
});

test('validateAcceptanceWrite accepts armed run-scoped writes', () => {
  const result = validateAcceptanceWrite(baseEnv, {
    objectKey: 'acceptance/run-20260609-001/users/u/media/by-asset/media_1.png',
    runId: 'run-20260609-001',
    correlationId: 'corr-1',
  });

  assert.deepEqual(result, { ok: true });
});
```

- [ ] **Step 4: Run the cloud acceptance test to verify it fails**

Run:

```bash
mise exec node@24 -- npm --prefix cloud run test:acceptance
```

Expected: FAIL with a TypeScript error that `../src/acceptance` cannot be found.

- [ ] **Step 5: Write the minimal cloud acceptance helper**

Create `cloud/src/acceptance.ts` with this exact content:

```ts
type AcceptanceEnv = {
  ACCEPTANCE_MODE?: string;
  ACCEPTANCE_RUN_ID?: string;
  ACCEPTANCE_KEY_PREFIX?: string;
  ACCEPTANCE_KILL_SWITCH?: string;
  WORKER_VERSION?: string;
  KEY_PREFIX?: string;
  R2_BUCKET_NAME?: string;
  R2_BUCKET?: unknown;
  DB?: unknown;
};

type AcceptanceWriteRequest = {
  objectKey: string;
  runId?: string | null;
  correlationId?: string | null;
};

type AcceptanceWriteResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

function cleanPrefix(value: string | undefined): string {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

export function isAcceptanceMode(env: AcceptanceEnv): boolean {
  return env.ACCEPTANCE_MODE === 'true';
}

export function acceptanceKeyPrefix(env: AcceptanceEnv): string {
  return cleanPrefix(env.ACCEPTANCE_KEY_PREFIX || env.KEY_PREFIX);
}

export function buildAcceptanceIdentity(env: AcceptanceEnv) {
  return {
    ok: true,
    service: 'grok-r2-backup',
    acceptanceMode: isAcceptanceMode(env),
    workerVersion: env.WORKER_VERSION || 'unknown',
    runId: env.ACCEPTANCE_RUN_ID || null,
    keyPrefix: acceptanceKeyPrefix(env),
    killSwitchActive: env.ACCEPTANCE_KILL_SWITCH === 'true',
    r2: {
      bucketName: env.R2_BUCKET_NAME || null,
      bindingPresent: !!env.R2_BUCKET,
    },
    d1: {
      bindingPresent: !!env.DB,
    },
    refusalRules: {
      requiresRunId: true,
      requiresCorrelationId: true,
      rejectsProductionPrefix: true,
      rejectsDefaultPrefixFallback: true,
    },
  };
}

export function validateAcceptanceWrite(
  env: AcceptanceEnv,
  request: AcceptanceWriteRequest
): AcceptanceWriteResult {
  if (!isAcceptanceMode(env)) return { ok: true };

  if (env.ACCEPTANCE_KILL_SWITCH === 'true') {
    return { ok: false, status: 423, error: 'acceptance run is quarantined' };
  }

  const expectedRunId = String(env.ACCEPTANCE_RUN_ID || '').trim();
  const expectedPrefix = acceptanceKeyPrefix(env);

  if (!expectedRunId || !expectedPrefix) {
    return { ok: false, status: 500, error: 'acceptance run is not configured' };
  }

  if (request.runId !== expectedRunId) {
    return { ok: false, status: 400, error: 'acceptance run ID is required' };
  }

  if (!request.correlationId) {
    return { ok: false, status: 400, error: 'acceptance correlation ID is required' };
  }

  if (!request.objectKey.startsWith(`${expectedPrefix}/`)) {
    return { ok: false, status: 400, error: `objectKey must start with ${expectedPrefix}/` };
  }

  return { ok: true };
}
```

- [ ] **Step 6: Run cloud tests and typecheck**

Run:

```bash
mise exec node@24 -- npm --prefix cloud run test:acceptance
mise exec node@24 -- npm --prefix cloud run typecheck
```

Expected: both pass.

- [ ] **Step 7: Update implementation notes**

Add this list item under `Design Decisions` in `docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html`:

```html
<li>Add a small cloud TypeScript test harness instead of adding a broad Worker test framework. It gives red/green coverage for acceptance guard logic without changing production runtime dependencies.</li>
```

- [ ] **Step 8: Commit**

Run:

```bash
git add cloud/package.json cloud/package-lock.json cloud/tsconfig.test.json cloud/tests/acceptance.test.ts cloud/src/acceptance.ts docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html
git commit -m "feat: add worker acceptance guards"
```

Expected: commit succeeds.

## Task 3: Worker Acceptance Endpoints And Resource Config

**Files:**
- Create: `cloud/tests/worker-acceptance-routing.test.ts`
- Modify: `cloud/src/types.ts`
- Modify: `cloud/src/index.ts`
- Create: `cloud/acceptance-schema.sql`
- Create: `acceptance/scripts/write-cloudflare-acceptance-config.mjs`
- Modify: `.gitignore`
- Modify: `docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html`

- [ ] **Step 1: Write the failing Worker routing test**

Create `cloud/tests/worker-acceptance-routing.test.ts` with this exact content:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index';

function env(overrides: Record<string, unknown> = {}) {
  return {
    CLIENT_API_KEY: 'client-secret',
    R2_ACCESS_KEY_ID: 'access-key',
    R2_SECRET_ACCESS_KEY: 'r2-secret',
    R2_ACCOUNT_ID: 'ba5339fd86e87c226bdc306347636042',
    R2_BUCKET_NAME: 'grok-powertools-acceptance',
    KEY_PREFIX: 'acceptance/run-20260609-001',
    ACCEPTANCE_MODE: 'true',
    ACCEPTANCE_RUN_ID: 'run-20260609-001',
    ACCEPTANCE_KEY_PREFIX: 'acceptance/run-20260609-001',
    WORKER_VERSION: '2026-06-09.1',
    R2_BUCKET: {
      head: async () => null,
      put: async () => undefined,
    },
    DB: {
      prepare: () => {
        throw new Error('DB should not be touched by these tests');
      },
    },
    ...overrides,
  } as never;
}

test('acceptance identity endpoint is auth protected', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/v1/acceptance/identity'),
    env()
  );

  assert.equal(response.status, 401);
});

test('acceptance identity endpoint returns non-secret diagnostics', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/v1/acceptance/identity', {
      headers: { 'x-gpt-api-key': 'client-secret' },
    }),
    env()
  );
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.acceptanceMode, true);
  assert.equal(body.runId, 'run-20260609-001');
  assert.equal(body.keyPrefix, 'acceptance/run-20260609-001');
  assert.equal(JSON.stringify(body).includes('client-secret'), false);
  assert.equal(JSON.stringify(body).includes('r2-secret'), false);
});

test('presign rejects production keys before signing in acceptance mode', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/v1/presign', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-gpt-api-key': 'client-secret',
        'x-acceptance-run-id': 'run-20260609-001',
        'x-acceptance-correlation-id': 'corr-1',
      },
      body: JSON.stringify({
        objectKey: 'grok-powertools/v1/users/u/media/by-asset/media_1.png',
        contentType: 'image/png',
        contentLength: 123,
      }),
    }),
    env()
  );
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 400);
  assert.match(body.error || '', /acceptance\/run-20260609-001/);
});
```

- [ ] **Step 2: Run the Worker routing test to verify it fails**

Run:

```bash
mise exec node@24 -- npm --prefix cloud run test:acceptance
```

Expected: FAIL because `/v1/acceptance/identity` returns `404`.

- [ ] **Step 3: Update Worker env types**

Add these fields to the `Env` interface in `cloud/src/types.ts`:

```ts
    ACCEPTANCE_MODE?: string;
    ACCEPTANCE_RUN_ID?: string;
    ACCEPTANCE_KEY_PREFIX?: string;
    ACCEPTANCE_KILL_SWITCH?: string;
    WORKER_VERSION?: string;
```

- [ ] **Step 4: Wire acceptance helpers into the Worker**

In `cloud/src/index.ts`, add this import after the existing imports:

```ts
import { buildAcceptanceIdentity, validateAcceptanceWrite } from './acceptance';
```

Add this helper near `errorResponse`:

```ts
function acceptanceRunId(request: Request): string | null {
    return request.headers.get('x-acceptance-run-id');
}

function acceptanceCorrelationId(request: Request): string | null {
    return request.headers.get('x-acceptance-correlation-id');
}

function acceptanceErrorResponse(result: ReturnType<typeof validateAcceptanceWrite>): Response | null {
    if (result.ok) return null;
    return errorResponse(result.error, result.status);
}
```

In `handlePresign`, immediately after `const keyPrefix = sanitizeKeyPrefix(env.KEY_PREFIX);`, insert:

```ts
    const acceptanceError = acceptanceErrorResponse(validateAcceptanceWrite(env, {
        objectKey: payload.objectKey,
        runId: acceptanceRunId(request),
        correlationId: acceptanceCorrelationId(request)
    }));
    if (acceptanceError) return acceptanceError;
```

In `handleObjectVerify`, immediately after `const keyPrefix = sanitizeKeyPrefix(env.KEY_PREFIX);`, insert:

```ts
    const acceptanceError = acceptanceErrorResponse(validateAcceptanceWrite(env, {
        objectKey: payload.objectKey,
        runId: acceptanceRunId(request),
        correlationId: acceptanceCorrelationId(request)
    }));
    if (acceptanceError) return acceptanceError;
```

In `handleMetadataSnapshot`, immediately after `const objectKey = metadataObjectKey(keyPrefix, userId, kind);`, insert:

```ts
    const acceptanceError = acceptanceErrorResponse(validateAcceptanceWrite(env, {
        objectKey,
        runId: acceptanceRunId(request),
        correlationId: acceptanceCorrelationId(request)
    }));
    if (acceptanceError) return acceptanceError;
```

In the default `fetch` function, after the `/health` route and before `const authError = assertAuthorized(request, env);`, add:

```ts
        if (request.method === 'GET' && url.pathname === '/v1/acceptance/identity') {
            const identityAuthError = assertAuthorized(request, env);
            if (identityAuthError) {
                return errorResponse(identityAuthError, 401);
            }
            return jsonResponse(buildAcceptanceIdentity(env), 200);
        }
```

- [ ] **Step 5: Add the acceptance D1 schema**

Create `cloud/acceptance-schema.sql` with this exact content:

```sql
CREATE TABLE acceptance_runs (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE acceptance_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  correlation_id TEXT,
  event_type TEXT NOT NULL,
  verdict TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_acceptance_events_run_id
  ON acceptance_events (run_id, created_at);
```

- [ ] **Step 6: Add ignored generated acceptance config support**

Append these lines to `.gitignore`:

```gitignore

# Acceptance test artifacts
cloud/wrangler.acceptance.generated.toml
cloud/.tmp-test/
acceptance/runs/
```

Create `acceptance/scripts/write-cloudflare-acceptance-config.mjs` with this exact content:

```js
const fs = require('fs');
const path = require('path');

function required(name) {
    const value = process.env[name];
    if (!value || !value.trim()) {
        throw new Error(`${name} is required`);
    }
    return value.trim();
}

const workerName = required('ACCEPTANCE_WORKER_NAME');
const bucketName = required('ACCEPTANCE_R2_BUCKET');
const databaseName = required('ACCEPTANCE_D1_DATABASE');
const databaseId = required('ACCEPTANCE_D1_DATABASE_ID');
const accountId = required('CLOUDFLARE_ACCOUNT_ID');
const keyPrefix = required('ACCEPTANCE_KEY_PREFIX');
const runId = required('ACCEPTANCE_RUN_ID');

if (!keyPrefix.startsWith(`acceptance/${runId}`)) {
    throw new Error('ACCEPTANCE_KEY_PREFIX must start with the active acceptance run ID');
}

const output = `name = "${workerName}"
main = "src/index.ts"
compatibility_date = "2026-06-09"
account_id = "${accountId}"

[vars]
KEY_PREFIX = "${keyPrefix}"
R2_ACCOUNT_ID = "${accountId}"
R2_BUCKET_NAME = "${bucketName}"
ACCEPTANCE_MODE = "true"
ACCEPTANCE_RUN_ID = "${runId}"
ACCEPTANCE_KEY_PREFIX = "${keyPrefix}"
WORKER_VERSION = "2026-06-09.1"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "${bucketName}"

[[d1_databases]]
binding = "DB"
database_name = "${databaseName}"
database_id = "${databaseId}"
`;

const target = path.join(process.cwd(), 'cloud', 'wrangler.acceptance.generated.toml');
fs.writeFileSync(target, output);
console.log(JSON.stringify({
    ok: true,
    path: target,
    workerName,
    bucketName,
    databaseName,
    keyPrefix
}, null, 2));
```

- [ ] **Step 7: Run cloud tests and typecheck**

Run:

```bash
mise exec node@24 -- npm --prefix cloud run test:acceptance
mise exec node@24 -- npm --prefix cloud run typecheck
```

Expected: both pass.

- [ ] **Step 8: Update implementation notes**

Add this list item under `Design Decisions`:

```html
<li>Generate the acceptance Wrangler config from verified environment values and keep it ignored, instead of committing guessed resource IDs.</li>
```

- [ ] **Step 9: Commit**

Run:

```bash
git add .gitignore cloud/src/types.ts cloud/src/index.ts cloud/tests/worker-acceptance-routing.test.ts cloud/acceptance-schema.sql acceptance/scripts/write-cloudflare-acceptance-config.mjs docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html
git commit -m "feat: add acceptance worker entrypoints"
```

Expected: commit succeeds.

## Task 4: Extension Acceptance Context Propagation

**Files:**
- Create: `tests/unit/cloudSyncUtilsAcceptance.test.js`
- Modify: `cloudSyncUtils.js`
- Modify: `background.js`
- Extend: `tests/unit/grokScraperBackup.test.js`
- Modify: `docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html`

- [ ] **Step 1: Write failing CloudSync acceptance tests**

Create `tests/unit/cloudSyncUtilsAcceptance.test.js` with this exact content:

```js
const CloudSync = require('../../cloudSyncUtils.js');

describe('CloudSync acceptance context', () => {
    test('normalizes a valid acceptance context', () => {
        expect(CloudSync.normalizeAcceptanceContext({
            runId: 'run-20260609-001',
            correlationId: 'corr-1',
            keyPrefix: '/acceptance/run-20260609-001/'
        })).toEqual({
            runId: 'run-20260609-001',
            correlationId: 'corr-1',
            keyPrefix: 'acceptance/run-20260609-001'
        });
    });

    test('rejects production prefixes', () => {
        expect(() => CloudSync.normalizeAcceptanceContext({
            runId: 'run-1',
            correlationId: 'corr-1',
            keyPrefix: 'grok-powertools/v1'
        })).toThrow('acceptance prefix');
    });

    test('builds acceptance headers without secrets', () => {
        const headers = CloudSync.buildAcceptanceHeaders({
            acceptance: {
                runId: 'run-20260609-001',
                correlationId: 'corr-1',
                keyPrefix: 'acceptance/run-20260609-001'
            }
        });

        expect(headers).toEqual({
            'x-acceptance-run-id': 'run-20260609-001',
            'x-acceptance-correlation-id': 'corr-1'
        });
    });

    test('returns empty headers outside acceptance mode', () => {
        expect(CloudSync.buildAcceptanceHeaders({})).toEqual({});
        expect(CloudSync.buildAcceptanceHeaders({ acceptance: null })).toEqual({});
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
mise exec node@24 -- npm run test:unit -- tests/unit/cloudSyncUtilsAcceptance.test.js
```

Expected: FAIL because `normalizeAcceptanceContext` is not defined.

- [ ] **Step 3: Add CloudSync acceptance helpers**

In `cloudSyncUtils.js`, add these functions immediately after `normalizeCloudConfig`:

```js
    function normalizeAcceptanceContext(context) {
        if (!context) return null;
        const runId = String(context.runId || '').trim();
        const correlationId = String(context.correlationId || '').trim();
        const keyPrefix = sanitizeKeyPrefix(context.keyPrefix);

        if (!runId || !correlationId) {
            throw new Error('acceptance runId and correlationId are required');
        }

        if (!keyPrefix.startsWith(`acceptance/${runId}`)) {
            throw new Error('acceptance prefix must start with the active acceptance run ID');
        }

        return { runId, correlationId, keyPrefix };
    }

    function buildAcceptanceHeaders(item) {
        if (!item || !item.acceptance) return {};
        const acceptance = normalizeAcceptanceContext(item.acceptance);
        return {
            'x-acceptance-run-id': acceptance.runId,
            'x-acceptance-correlation-id': acceptance.correlationId
        };
    }
```

Add both functions to the `utils` export object:

```js
        normalizeAcceptanceContext,
        buildAcceptanceHeaders,
```

- [ ] **Step 4: Run the CloudSync test to verify it passes**

Run:

```bash
mise exec node@24 -- npm run test:unit -- tests/unit/cloudSyncUtilsAcceptance.test.js
```

Expected: PASS.

- [ ] **Step 5: Write failing background/content propagation tests**

Append these tests to `tests/unit/grokScraperBackup.test.js`:

```js
describe('Grok backup acceptance context propagation', () => {
    test('page command options preserve acceptance run metadata for canaries', () => {
        const options = getR2BackupPageCommandOptions({
            action: 'INIT_R2_CANARY',
            runId: 'run-20260609-001',
            correlationId: 'corr-1',
            keyPrefix: 'acceptance/run-20260609-001'
        });

        expect(options).toMatchObject({
            mode: 'canary',
            limit: 1,
            acceptance: {
                runId: 'run-20260609-001',
                correlationId: 'corr-1',
                keyPrefix: 'acceptance/run-20260609-001'
            }
        });
    });

    test('page command ignores acceptance metadata for full backup commands', () => {
        expect(getR2BackupPageCommandOptions({
            action: 'INIT_R2_BACKUP',
            mode: 'full',
            runId: 'run-20260609-001',
            correlationId: 'corr-1',
            keyPrefix: 'acceptance/run-20260609-001'
        })).toBeNull();
    });
});
```

- [ ] **Step 6: Run the propagation tests to verify they fail**

Run:

```bash
mise exec node@24 -- npm run test:unit -- tests/unit/grokScraperBackup.test.js
```

Expected: FAIL because `getR2BackupPageCommandOptions` does not return `acceptance`.

- [ ] **Step 7: Propagate acceptance fields through content options**

Modify `getR2BackupPageCommandOptions` in `content.js` so accepted canary commands include this object when all fields are present:

```js
        const acceptance = detail.runId && detail.correlationId && detail.keyPrefix
            ? {
                runId: String(detail.runId),
                correlationId: String(detail.correlationId),
                keyPrefix: String(detail.keyPrefix)
            }
            : null;
```

Add `acceptance` to the returned canary options object:

```js
            acceptance
```

When sending `R2_BACKUP_UPLOAD` messages from the backup flow, include:

```js
acceptance: this.r2BackupOptions && this.r2BackupOptions.acceptance
```

- [ ] **Step 8: Propagate acceptance headers through background requests**

In `background.js`, update `verifyR2Object`, `requestPresignedUrl`, and `uploadMetadataQueueItem` so headers are built like this:

```js
        headers: {
            'Content-Type': 'application/json',
            'x-gpt-api-key': config.apiKey,
            ...CloudSync.buildAcceptanceHeaders(descriptor)
        },
```

Use `queueItem` instead of `descriptor` in `requestPresignedUrl` and `uploadMetadataQueueItem`.

In the direct upload `uploadBlobWithR2Dedupe` call inside `R2_BACKUP_UPLOAD`, add:

```js
acceptance: request.acceptance || null,
```

In `enqueueCloudMediaUpload`, accept a fourth `acceptance` parameter:

```js
async function enqueueCloudMediaUpload(sourceUrl, finalPath, promptText = '', acceptance = null) {
```

Include it in the queue item:

```js
acceptance
```

In the `R2_BACKUP_UPLOAD` fallback path, call:

```js
const queued = await enqueueCloudMediaUpload(request.url, finalPath, request.promptText, request.acceptance || null);
```

- [ ] **Step 9: Run targeted tests**

Run:

```bash
mise exec node@24 -- npm run test:unit -- tests/unit/cloudSyncUtilsAcceptance.test.js tests/unit/grokScraperBackup.test.js
```

Expected: PASS.

- [ ] **Step 10: Update notes and commit**

Add this list item under `Tradeoffs`:

```html
<li>Carry acceptance metadata only for canary commands and queue items. Full page-origin backup commands remain blocked before they can gain acceptance headers.</li>
```

Run:

```bash
git add cloudSyncUtils.js background.js content.js tests/unit/cloudSyncUtilsAcceptance.test.js tests/unit/grokScraperBackup.test.js docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html
git commit -m "feat: propagate acceptance canary context"
```

Expected: commit succeeds.

## Task 5: Local Preflight And Safety Classifiers

**Files:**
- Create: `tests/unit/acceptancePreflight.test.js`
- Create: `acceptance/lib/preflight.js`
- Create: `acceptance/scripts/preflight.mjs`
- Modify: `docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html`

- [ ] **Step 1: Write failing preflight tests**

Create `tests/unit/acceptancePreflight.test.js` with this exact content:

```js
const {
    classifyChromeCdp,
    classifyCloudflareR2,
    classifyPortOwner,
    redactCommandOutput
} = require('../../acceptance/lib/preflight.js');

describe('acceptance preflight classifiers', () => {
    test('blocks when a web port is owned by another workspace', () => {
        const result = classifyPortOwner({
            port: 3001,
            cwd: '/Users/philipbankier/Development/MailAI/1st-run/CORE/worktrees/local-companion-20260519/website',
            expectedRepo: '/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools'
        });

        expect(result).toEqual({
            status: 'blocked',
            code: 'wrong_web_server',
            message: 'Port 3001 is owned by another workspace'
        });
    });

    test('blocks R2 acceptance setup on Cloudflare authentication code 10000', () => {
        const result = classifyCloudflareR2({
            exitCode: 1,
            stderr: 'Authentication error [code: 10000]'
        });

        expect(result.status).toBe('blocked');
        expect(result.code).toBe('r2_auth_blocked');
    });

    test('blocks CDP unless it is connected to the existing Chrome session', () => {
        expect(classifyChromeCdp({
            chromeRunning: true,
            cdpConnected: false,
            existingSessionOnly: true
        })).toMatchObject({
            status: 'blocked',
            code: 'cdp_not_connected'
        });
    });

    test('redacts secrets from command output', () => {
        expect(redactCommandOutput('CLIENT_API_KEY=abc\nCookie: xyz\nhttps://x?X-Amz-Signature=secret')).toBe(
            'CLIENT_API_KEY=[REDACTED]\nCookie: [REDACTED]\n[REDACTED_URL]'
        );
    });
});
```

- [ ] **Step 2: Run the preflight tests to verify they fail**

Run:

```bash
mise exec node@24 -- npm run test:unit -- tests/unit/acceptancePreflight.test.js
```

Expected: FAIL with `Cannot find module '../../acceptance/lib/preflight.js'`.

- [ ] **Step 3: Add the preflight library**

Create `acceptance/lib/preflight.js` with this exact content:

```js
function classifyPortOwner({ port, cwd, expectedRepo }) {
    if (!cwd) {
        return { status: 'verified', code: 'port_free', message: `Port ${port} is free` };
    }
    if (cwd === expectedRepo || cwd.startsWith(`${expectedRepo}/`)) {
        return { status: 'verified', code: 'port_owned_by_repo', message: `Port ${port} is owned by this repo` };
    }
    return { status: 'blocked', code: 'wrong_web_server', message: `Port ${port} is owned by another workspace` };
}

function classifyCloudflareR2({ exitCode, stderr }) {
    const output = String(stderr || '');
    if (exitCode === 0) return { status: 'verified', code: 'r2_ready', message: 'R2 CLI access verified' };
    if (output.includes('10000')) {
        return { status: 'blocked', code: 'r2_auth_blocked', message: 'Cloudflare R2 command failed with authentication code 10000' };
    }
    return { status: 'blocked', code: 'r2_unverified', message: 'Cloudflare R2 command failed' };
}

function classifyChromeCdp({ chromeRunning, cdpConnected, existingSessionOnly }) {
    if (!chromeRunning) return { status: 'blocked', code: 'chrome_not_running', message: 'Chrome is not running' };
    if (existingSessionOnly && !cdpConnected) {
        return { status: 'blocked', code: 'cdp_not_connected', message: 'CDP is not connected to the existing Chrome session' };
    }
    return { status: 'verified', code: 'chrome_ready', message: 'Chrome automation target is ready' };
}

function redactCommandOutput(output) {
    return String(output || '')
        .replace(/(CLIENT_API_KEY|WORKER_API_KEY|R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID)=([^\s]+)/g, '$1=[REDACTED]')
        .replace(/Cookie:\s*[^\n]+/gi, 'Cookie: [REDACTED]')
        .replace(/https?:\/\/[^\s]*[?&](X-Amz-Signature|X-Amz-Credential|Signature)=[^\s]+/gi, '[REDACTED_URL]');
}

module.exports = {
    classifyChromeCdp,
    classifyCloudflareR2,
    classifyPortOwner,
    redactCommandOutput
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
mise exec node@24 -- npm run test:unit -- tests/unit/acceptancePreflight.test.js
```

Expected: PASS.

- [ ] **Step 5: Add the preflight CLI**

Create `acceptance/scripts/preflight.mjs` with this exact content:

```js
#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    classifyCloudflareR2,
    classifyPortOwner,
    redactCommandOutput
} = require('../lib/preflight.js');

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);

function commandExists(name) {
    const result = spawnSync('command', ['-v', name], { shell: true, encoding: 'utf8' });
    return result.status === 0;
}

function portOwnerCwd(port) {
    const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { encoding: 'utf8' });
    const pidLine = result.stdout.split('\n').find((line) => line.startsWith('p'));
    if (!pidLine) return '';
    const pid = pidLine.slice(1);
    try {
        return execFileSync('lsof', ['-p', pid, '-a', '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
            .split('\n')
            .find((line) => line.startsWith('n'))
            ?.slice(1) || '';
    } catch {
        return '';
    }
}

const r2 = spawnSync('mise', ['exec', 'node@24', '--', 'npm', '--prefix', 'cloud', 'exec', '--', 'wrangler', 'r2', 'bucket', 'list'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || '' }
});

const result = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    repoRoot,
    tools: {
        mise: commandExists('mise'),
        npm: commandExists('npm'),
        peekaboo: commandExists('peekaboo'),
        agentBrowser: commandExists('agent-browser'),
        plwr: commandExists('plwr')
    },
    webPort: classifyPortOwner({
        port: 3001,
        cwd: portOwnerCwd(3001),
        expectedRepo: repoRoot
    }),
    r2: classifyCloudflareR2({
        exitCode: r2.status ?? 1,
        stderr: redactCommandOutput(r2.stderr || r2.stdout || '')
    }),
    envFiles: {
        webEnvLocalExists: fs.existsSync(path.join(repoRoot, 'web/.env.local')),
        cloudDevVarsExists: fs.existsSync(path.join(repoRoot, 'cloud/.dev.vars'))
    }
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.r2.status === 'verified' ? 0 : 2);
```

- [ ] **Step 6: Run the preflight CLI**

Run:

```bash
mise exec node@24 -- node acceptance/scripts/preflight.mjs
```

Expected today: exit `2` with `r2.status` equal to `blocked` until Cloudflare R2 auth is fixed. Output must not include raw API keys, cookies, signed URLs, or `.env` values.

- [ ] **Step 7: Update notes and commit**

Add this list item under `Open Questions`:

```html
<li>Acceptance cloud execution remains blocked until <code>acceptance/scripts/preflight.mjs</code> reports R2 as verified.</li>
```

Run:

```bash
git add acceptance/lib/preflight.js acceptance/scripts/preflight.mjs tests/unit/acceptancePreflight.test.js docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html
git commit -m "feat: add acceptance preflight checks"
```

Expected: commit succeeds.

## Task 6: Evidence Workbook And Ops Import

**Files:**
- Create: `tests/unit/acceptanceEvidenceWorkbook.test.js`
- Create: `acceptance/lib/evidence-workbook.js`
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/components/ops/OpsConsole.tsx`
- Modify: `docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html`

- [ ] **Step 1: Write failing evidence workbook tests**

Create `tests/unit/acceptanceEvidenceWorkbook.test.js` with this exact content:

```js
const {
    buildEvidenceWorkbook,
    renderEvidenceHtml
} = require('../../acceptance/lib/evidence-workbook.js');

describe('acceptance evidence workbook', () => {
    test('orders events and redacts unsafe fields', () => {
        const workbook = buildEvidenceWorkbook({
            runId: 'run-20260609-001',
            verdict: 'verified',
            manifest: { cloud: { keyPrefix: 'acceptance/run-20260609-001' } },
            events: [
                { id: '2', at: '2026-06-09T10:01:00.000Z', type: 'upload', payload: { uploadUrl: 'https://x?X-Amz-Signature=abc' } },
                { id: '1', at: '2026-06-09T10:00:00.000Z', type: 'preflight', payload: { apiKey: 'secret' } }
            ],
            rows: [
                {
                    id: 'row-1',
                    status: 'verified',
                    assetId: 'media_1',
                    mediaType: 'image',
                    r2ObjectKey: 'acceptance/run-20260609-001/users/u/media/by-asset/media_1.png'
                }
            ]
        });

        expect(workbook.events.map((event) => event.id)).toEqual(['1', '2']);
        expect(JSON.stringify(workbook)).not.toContain('secret');
        expect(JSON.stringify(workbook)).not.toContain('X-Amz-Signature');
    });

    test('renders a small HTML review artifact', () => {
        const html = renderEvidenceHtml({
            schemaVersion: 1,
            runId: 'run-20260609-001',
            verdict: 'blocked',
            generatedAt: '2026-06-09T10:00:00.000Z',
            manifest: {},
            events: [],
            rows: []
        });

        expect(html).toContain('<title>Live Acceptance Evidence run-20260609-001</title>');
        expect(html).toContain('blocked');
    });
});
```

- [ ] **Step 2: Run the workbook tests to verify they fail**

Run:

```bash
mise exec node@24 -- npm run test:unit -- tests/unit/acceptanceEvidenceWorkbook.test.js
```

Expected: FAIL with `Cannot find module '../../acceptance/lib/evidence-workbook.js'`.

- [ ] **Step 3: Add the evidence workbook library**

Create `acceptance/lib/evidence-workbook.js` with this exact content:

```js
const { redactEvidence } = require('./run-contract.js');

function buildEvidenceWorkbook({ runId, verdict, manifest, events, rows }) {
    return redactEvidence({
        schemaVersion: 1,
        runId,
        verdict,
        generatedAt: new Date().toISOString(),
        manifest: manifest || {},
        events: [...(events || [])].sort((a, b) => String(a.at).localeCompare(String(b.at))),
        rows: rows || []
    });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderEvidenceHtml(workbook) {
    const rows = (workbook.rows || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.status)}</td>
        <td>${escapeHtml(row.assetId)}</td>
        <td>${escapeHtml(row.r2ObjectKey)}</td>
      </tr>`).join('');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Live Acceptance Evidence ${escapeHtml(workbook.runId)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px auto; max-width: 1080px; line-height: 1.5; color: #1f2328; }
    code { background: #f6f8fa; border-radius: 4px; padding: 0.1em 0.3em; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d0d7de; padding: 8px 10px; text-align: left; }
    th { background: #f6f8fa; }
  </style>
</head>
<body>
  <h1>Live Acceptance Evidence</h1>
  <p>Run <code>${escapeHtml(workbook.runId)}</code> finished as <code>${escapeHtml(workbook.verdict)}</code>.</p>
  <table>
    <thead><tr><th>Status</th><th>Asset</th><th>R2 Object</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

module.exports = {
    buildEvidenceWorkbook,
    renderEvidenceHtml
};
```

- [ ] **Step 4: Run workbook tests to verify they pass**

Run:

```bash
mise exec node@24 -- npm run test:unit -- tests/unit/acceptanceEvidenceWorkbook.test.js
```

Expected: PASS.

- [ ] **Step 5: Extend ops types for acceptance verdicts**

In `web/src/lib/types.ts`, add this type near `OpsStatus`:

```ts
export type AcceptanceVerdict = "verified" | "failed" | "blocked" | "contaminated" | "inconclusive";
```

Add these optional fields to `OpsSnapshot`:

```ts
  runId?: string;
  verdict?: AcceptanceVerdict;
  laneId?: string;
```

- [ ] **Step 6: Show acceptance workbook fields in ops**

In `web/src/components/ops/OpsConsole.tsx`, add `ShieldCheck` is already imported and can be reused. In the top status area, after the worker status message span, render:

```tsx
            {snapshot.runId && (
              <span className="text-sm text-(--color-surface-500)">
                Run {snapshot.runId}{snapshot.verdict ? `: ${snapshot.verdict}` : ""}
              </span>
            )}
```

In `normalizeSnapshot`, add these fields to the returned object:

```ts
    runId: typeof data.runId === "string" ? data.runId : undefined,
    verdict: typeof data.verdict === "string" ? data.verdict as OpsSnapshot["verdict"] : undefined,
    laneId: typeof data.laneId === "string" ? data.laneId : undefined,
```

- [ ] **Step 7: Run web lint and build**

Run:

```bash
mise exec node@24 -- npm --prefix web run lint
mise exec node@24 -- npm --prefix web run build
```

Expected: both pass. If lint exposes pre-existing unrelated errors, stop and record the exact files in the implementation notes before changing anything outside this task.

- [ ] **Step 8: Update notes and commit**

Add this list item under `Design Decisions`:

```html
<li>Keep ops page verification secondary. The workbook is source-of-truth evidence, while ops imports and displays it for human review.</li>
```

Run:

```bash
git add acceptance/lib/evidence-workbook.js tests/unit/acceptanceEvidenceWorkbook.test.js web/src/lib/types.ts web/src/components/ops/OpsConsole.tsx docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html
git commit -m "feat: add acceptance evidence workbook"
```

Expected: commit succeeds.

## Task 7: Local Gates And Live Canary Drivers

**Files:**
- Create: `acceptance/scripts/run-local-gates.mjs`
- Create: `acceptance/scripts/run-live-canary.mjs`
- Extend: `tests/e2e/extension.spec.js`
- Modify: `docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html`

- [ ] **Step 1: Extend browser e2e with canary metadata checks**

Append this Playwright test to `tests/e2e/extension.spec.js`:

```js
    test('Page-origin R2 canary command is bounded and carries acceptance metadata', async ({ page }) => {
        await page.evaluate(contentJs);

        await page.evaluate(() => {
            document.dispatchEvent(new CustomEvent('grok-powertools-command', {
                detail: {
                    action: 'INIT_R2_CANARY',
                    runId: 'run-20260609-001',
                    correlationId: 'corr-1',
                    keyPrefix: 'acceptance/run-20260609-001'
                }
            }));
        });
        await page.waitForTimeout(50);

        const runtimeMessages = await page.evaluate(() => window.__chromeRuntimeMessages);
        expect(runtimeMessages).toContainEqual(expect.objectContaining({
            action: 'VALIDATE_CLOUD_CONFIG'
        }));
    });
```

- [ ] **Step 2: Run browser e2e to verify current behavior**

Run:

```bash
mise exec node@24 -- npm run test:e2e -- tests/e2e/extension.spec.js
```

Expected: PASS if Task 4 already carries canary options through the content script. If it fails, fix only the Task 4 propagation path.

- [ ] **Step 3: Create local gates runner**

Create `acceptance/scripts/run-local-gates.mjs` with this exact content:

```js
#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildEvidenceWorkbook } = require('../lib/evidence-workbook.js');

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const runId = process.env.ACCEPTANCE_RUN_ID || `local-${Date.now()}`;
const runDir = path.join(repoRoot, 'acceptance/runs', runId);
fs.mkdirSync(runDir, { recursive: true });

function run(id, command, args, cwd = repoRoot) {
    const startedAt = new Date().toISOString();
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env });
    return {
        id,
        at: startedAt,
        type: 'local-gate',
        payload: {
            command: [command, ...args].join(' '),
            cwd,
            exitCode: result.status,
            stdoutTail: String(result.stdout || '').slice(-4000),
            stderrTail: String(result.stderr || '').slice(-4000)
        }
    };
}

const events = [
    run('root-unit', 'mise', ['exec', 'node@24', '--', 'npm', 'run', 'test:unit']),
    run('root-e2e', 'mise', ['exec', 'node@24', '--', 'npm', 'run', 'test:e2e']),
    run('root-lint', 'mise', ['exec', 'node@24', '--', 'npm', 'run', 'lint']),
    run('web-lint', 'mise', ['exec', 'node@24', '--', 'npm', '--prefix', 'web', 'run', 'lint']),
    run('web-build', 'mise', ['exec', 'node@24', '--', 'npm', '--prefix', 'web', 'run', 'build']),
    run('cloud-typecheck', 'mise', ['exec', 'node@24', '--', 'npm', '--prefix', 'cloud', 'run', 'typecheck']),
    run('cloud-acceptance', 'mise', ['exec', 'node@24', '--', 'npm', '--prefix', 'cloud', 'run', 'test:acceptance'])
];

const passed = events.every((event) => event.payload.exitCode === 0);
const workbook = buildEvidenceWorkbook({
    runId,
    verdict: passed ? 'verified' : 'failed',
    manifest: { laneId: 'local-gates' },
    events,
    rows: events.map((event) => ({
        id: event.id,
        status: event.payload.exitCode === 0 ? 'verified' : 'blocked',
        assetId: event.id,
        mediaType: 'unknown',
        blockerCode: event.payload.exitCode === 0 ? '' : 'local_gate_failed'
    }))
});

const outputPath = path.join(runDir, 'local-gates.json');
fs.writeFileSync(outputPath, JSON.stringify(workbook, null, 2));
console.log(outputPath);
process.exit(passed ? 0 : 1);
```

- [ ] **Step 4: Create live canary driver with manual-arm stop gates**

Create `acceptance/scripts/run-live-canary.mjs` with this exact content:

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const runId = process.env.ACCEPTANCE_RUN_ID || '';
const keyPrefix = process.env.ACCEPTANCE_KEY_PREFIX || '';
const armed = process.env.ACCEPTANCE_LIVE_ARMED === 'true';

function stop(message, code = 2) {
    console.error(JSON.stringify({ verdict: 'blocked', message }, null, 2));
    process.exit(code);
}

if (!armed) stop('Set ACCEPTANCE_LIVE_ARMED=true for the existing-Chrome lane');
if (!runId) stop('ACCEPTANCE_RUN_ID is required');
if (!keyPrefix.startsWith(`acceptance/${runId}`)) stop('ACCEPTANCE_KEY_PREFIX must start with the active acceptance run ID');

const preflight = spawnSync('mise', ['exec', 'node@24', '--', 'node', 'acceptance/scripts/preflight.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env
});

if (preflight.status !== 0) {
    stop('Preflight is not verified');
}

const runDir = path.join(repoRoot, 'acceptance/runs', runId);
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(runDir, 'manual-arm.json'), JSON.stringify({
    runId,
    keyPrefix,
    armedAt: new Date().toISOString(),
    note: 'Existing-Chrome lane may proceed. Use Browser, Peekaboo, or approved existing-session CDP only.'
}, null, 2));

console.log(JSON.stringify({
    ok: true,
    runId,
    next: 'Dispatch INIT_R2_CANARY for one public image and one authenticated video from the existing Grok tab'
}, null, 2));
```

- [ ] **Step 5: Run local gates**

Run:

```bash
mise exec node@24 -- node acceptance/scripts/run-local-gates.mjs
```

Expected: PASS after prior tasks. The command writes `acceptance/runs/$ACCEPTANCE_RUN_ID/local-gates.json` when the run ID is set, or a timestamped local run directory when it is not set.

- [ ] **Step 6: Verify live canary remains blocked without arm**

Run:

```bash
mise exec node@24 -- node acceptance/scripts/run-live-canary.mjs
```

Expected: exit `2` with `verdict` equal to `blocked` and message `Set ACCEPTANCE_LIVE_ARMED=true for the existing-Chrome lane`.

- [ ] **Step 7: Update notes and commit**

Add this list item under `Tradeoffs`:

```html
<li>The live canary script only arms the run and records intent. It does not automate Chrome unless all preflight gates are already verified.</li>
```

Run:

```bash
git add acceptance/scripts/run-local-gates.mjs acceptance/scripts/run-live-canary.mjs tests/e2e/extension.spec.js docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html
git commit -m "feat: add acceptance lane runners"
```

Expected: commit succeeds.

## Task 8: Docs, Final Local Validation, And Handoff

**Files:**
- Modify: `docs/CLOUD_R2_SETUP.md`
- Modify: `docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html`

- [ ] **Step 1: Update the cloud setup doc**

In `docs/CLOUD_R2_SETUP.md`, add this section after `## Prerequisites`:

````markdown
## Acceptance testing resources

Live acceptance tests must not use production-shaped resources.

Use separate acceptance resources:

- Worker: acceptance-only Worker name
- R2 bucket: acceptance-only bucket, never `grok-gallery-001`
- D1 database: acceptance-only database, never `grok-powertools-db`
- Prefix: `acceptance/$ACCEPTANCE_RUN_ID`
- API key: acceptance-only secret

Before running a live canary:

```bash
mise exec node@24 -- node acceptance/scripts/preflight.mjs
```

If R2 returns Cloudflare authentication code `10000`, stop. Do not run a live cloud lane until R2 bucket list/create/verify works.

Generate the ignored Wrangler config only after the acceptance bucket and D1 database exist:

```bash
test -n "$ACCEPTANCE_D1_DATABASE_ID"
test -n "$CLOUDFLARE_ACCOUNT_ID"
test -n "$ACCEPTANCE_RUN_ID"
test -n "$ACCEPTANCE_KEY_PREFIX"
ACCEPTANCE_WORKER_NAME=grok-powertools-acceptance \
ACCEPTANCE_R2_BUCKET=grok-powertools-acceptance \
ACCEPTANCE_D1_DATABASE=grok-powertools-acceptance-db \
mise exec node@24 -- node acceptance/scripts/write-cloudflare-acceptance-config.mjs
```

Do not commit `cloud/wrangler.acceptance.generated.toml`.
````

- [ ] **Step 2: Run full validation**

Run:

```bash
mise exec node@24 -- npm run test:unit
mise exec node@24 -- npm run test:e2e
mise exec node@24 -- npm run lint
mise exec node@24 -- npm --prefix cloud run test:acceptance
mise exec node@24 -- npm --prefix cloud run typecheck
mise exec node@24 -- npm --prefix web run lint
mise exec node@24 -- npm --prefix web run build
```

Expected: all pass. If a failure is unrelated and pre-existing, stop and record it in implementation notes before deciding whether it belongs in this plan.

- [ ] **Step 3: Run secret scan on staged changes**

Run:

```bash
git diff --cached --check
git diff --cached | rg -n "api[_-]?key|secret|token|password|cookie|X-Amz-Signature|Authorization: Bearer" && exit 1 || true
```

Expected: `git diff --cached --check` exits 0. The secret-pattern command must not print any raw secret values from ignored env files because only staged diff is scanned.

- [ ] **Step 4: Update implementation notes final status**

Add this list item under `Design Decisions`:

```html
<li>Final local validation ran under <code>mise exec node@24</code> to match the repo's Node 24 target without changing the user's shell default.</li>
```

- [ ] **Step 5: Commit**

Run:

```bash
git add docs/CLOUD_R2_SETUP.md docs/superpowers/plans/2026-06-09-live-acceptance-e2e-implementation-notes.html
git commit -m "docs: document acceptance testing runbook"
```

Expected: commit succeeds.

## Final Verification

Run:

```bash
git status --short --branch
mise exec node@24 -- node acceptance/scripts/preflight.mjs
mise exec node@24 -- node acceptance/scripts/run-live-canary.mjs
```

Expected:

- `git status` shows only known unrelated files or a clean worktree.
- Preflight reports `verified` for local gates and either `verified` or a clear `blocked` status for R2.
- Live canary driver remains `blocked` unless `ACCEPTANCE_LIVE_ARMED=true` is set and preflight is verified.

## Self-Review Notes

Spec coverage:

- Safety architecture: Tasks 2, 3, 5, and 7 add acceptance-mode guards, identity checks, preflight blocks, and manual arming.
- Cloud isolation: Task 3 adds Worker identity, acceptance prefix enforcement, acceptance schema, and ignored generated config.
- Components and data flow: Tasks 1 through 7 cover the manifest, Worker, extension, evidence collector, ops display, and ordered lanes.
- Error handling and verdicts: Task 1 defines verdict classification, Task 5 blocks unsafe readiness states, and Task 7 keeps live canaries blocked until armed.
- Test coverage and UX criteria: Task 6 imports workbook status into ops, and Task 7 keeps user-facing live lanes bounded to canaries.
- Tool readiness: Task 5 turns the verified local blockers into deterministic preflight output.

Known gap:

- R2 live execution cannot be verified until Cloudflare R2 list/create/verify works. The plan treats that as a hard stop, not as a skipped assertion.

## Execution Handoff

Use subagent-driven execution unless the user asks to keep all edits inline.

Recommended split:

- Agent 1: Tasks 1 and 5, local acceptance contract and preflight.
- Agent 2: Tasks 2 and 3, cloud acceptance helpers and Worker endpoints.
- Agent 3: Task 4, extension propagation.
- Agent 4: Task 6, evidence workbook and ops import.
- Main session: Task 7 and Task 8, because live-lane arming, final validation, and user Chrome safety should stay under direct review.

Do not start Task 7 existing-Chrome canaries until Tasks 1 through 6 are merged, local gates pass, R2 preflight is verified, and the user explicitly arms the live lane.
