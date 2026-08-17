#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
    REQUIRED_EXTENSION_RECOVERY_LANES,
    evaluateExtensionRecoveryReleaseGate,
    upsertExtensionRecoveryLane
} = require('../lib/extension-recovery-evidence.js');

const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{5,80}$/;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runId = process.env.ACCEPTANCE_RUN_ID || '';

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function git(args, options = {}) {
    return execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options
    });
}

function readUpstream() {
    try {
        return git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).trim() || null;
    } catch {
        return null;
    }
}

function statusFiles(statusShort) {
    const dirtyFiles = [];
    const untrackedFiles = [];
    for (const line of statusShort.split('\n')) {
        if (!line) continue;
        const fileName = line.slice(3);
        if (line.startsWith('?? ')) untrackedFiles.push(fileName);
        else dirtyFiles.push(fileName);
    }
    return { dirtyFiles, untrackedFiles };
}

function writeJsonAtomically(filePath, value) {
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tempPath, filePath);
}

if (!RUN_ID_RE.test(runId)) {
    throw new Error('ACCEPTANCE_RUN_ID must match ^[a-z0-9][a-z0-9-]{5,80}$');
}

const runDir = path.join(repoRoot, 'acceptance/runs', runId);
if (fs.existsSync(runDir)) {
    throw new Error('Refusing to overwrite an existing extension recovery run directory');
}

const statusShort = git(['status', '--short']);
const baselinePatch = git(['diff', '--binary']);
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8'));
const { dirtyFiles, untrackedFiles } = statusFiles(statusShort);

let workbook = {
    schemaVersion: 1,
    runId,
    startedAt: new Date().toISOString(),
    repository: {
        branch: git(['branch', '--show-current']).trim() || null,
        head: git(['rev-parse', 'HEAD']).trim(),
        upstream: readUpstream(),
        manifestVersion: String(manifest.version || ''),
        repoPathSha256: sha256(repoRoot),
        trackedDiffSha256: sha256(baselinePatch),
        dirtyFiles,
        untrackedFiles
    },
    lanes: {}
};

for (const laneId of REQUIRED_EXTENSION_RECOVERY_LANES) {
    workbook = upsertExtensionRecoveryLane(workbook, { laneId, status: 'not_run' });
}
workbook = upsertExtensionRecoveryLane(workbook, {
    laneId: 'environment-and-state',
    status: 'in_progress'
});
workbook.releaseGate = evaluateExtensionRecoveryReleaseGate(workbook);

fs.mkdirSync(runDir, { recursive: false });
fs.writeFileSync(path.join(runDir, 'baseline.patch'), baselinePatch);
writeJsonAtomically(path.join(runDir, 'extension-recovery.json'), workbook);

console.log(JSON.stringify({ runId, status: 'started', verdict: workbook.releaseGate.verdict }));
