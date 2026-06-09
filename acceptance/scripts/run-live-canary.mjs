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
