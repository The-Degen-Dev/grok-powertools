#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
    evaluateExtensionRecoveryReleaseGate,
    upsertExtensionRecoveryLane
} = require('../lib/extension-recovery-evidence.js');
const { redactEvidence } = require('../lib/run-contract.js');

const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{5,80}$/;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseArguments(argv) {
    const values = {};
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!['--run-id', '--lane', '--status', '--evidence'].includes(key) || value === undefined || values[key]) {
            throw new Error('Expected --run-id, --lane, --status, and --evidence');
        }
        values[key] = value;
    }
    if (Object.keys(values).length !== 4) {
        throw new Error('Expected --run-id, --lane, --status, and --evidence');
    }
    return values;
}

function parseEvidence(value) {
    try {
        return JSON.parse(value);
    } catch {
        try {
            return JSON.parse(fs.readFileSync(value, 'utf8'));
        } catch {
            throw new Error('Evidence must be inline JSON or a readable JSON file');
        }
    }
}

function writeJsonAtomically(filePath, value) {
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tempPath, filePath);
}

const args = parseArguments(process.argv.slice(2));
const runId = args['--run-id'];
if (!RUN_ID_RE.test(runId)) {
    throw new Error('run ID must match ^[a-z0-9][a-z0-9-]{5,80}$');
}

const workbookPath = path.join(repoRoot, 'acceptance/runs', runId, 'extension-recovery.json');
if (!fs.existsSync(workbookPath)) {
    throw new Error('Extension recovery run workbook does not exist');
}

const workbook = JSON.parse(fs.readFileSync(workbookPath, 'utf8'));
const updatedWorkbook = upsertExtensionRecoveryLane(workbook, {
    laneId: args['--lane'],
    status: args['--status'],
    evidence: parseEvidence(args['--evidence'])
});
const releaseGate = evaluateExtensionRecoveryReleaseGate(updatedWorkbook);
const persistedWorkbook = redactEvidence({
    ...updatedWorkbook,
    releaseGate
});

writeJsonAtomically(workbookPath, persistedWorkbook);
console.log(JSON.stringify({
    laneId: args['--lane'],
    status: args['--status'],
    verdict: releaseGate.verdict
}));
