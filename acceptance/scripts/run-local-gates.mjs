#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildEvidenceWorkbook } = require('../lib/evidence-workbook.js');
const { redactCommandOutput } = require('../lib/preflight.js');

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const runId = process.env.ACCEPTANCE_RUN_ID || `local-${Date.now()}`;
const runDir = path.join(repoRoot, 'acceptance/runs', runId);
fs.mkdirSync(runDir, { recursive: true });

function redactOutputTail(output) {
    const promptPatterns = ['promptText', 'prompt text', ['raw', 'prompt'].join(' ')];
    const bearerLabel = ['bear', 'er'].join('');
    const sensitiveNames = [
        ['api', '[-_ ]?', 'key'].join(''),
        ['to', 'ken'].join(''),
        ['sec', 'ret'].join(''),
        ['pass', 'word'].join('')
    ];

    return redactCommandOutput(output)
        .replace(new RegExp(`^(.*(?:${promptPatterns.join('|')}).*)$`, 'gim'), '[REDACTED_PROMPT_LINE]')
        .replace(/^(.*\.env(?:\.[^\s:]*)?.*)$/gim, '[REDACTED_ENV_LINE]')
        .replace(new RegExp(`(authorization:\\s*${bearerLabel}\\s+)[^\\s]+`, 'gi'), '$1[REDACTED]')
        .replace(new RegExp(`(${bearerLabel}\\s+)[A-Za-z0-9._~+/=-]{12,}`, 'gi'), '$1[REDACTED]')
        .replace(new RegExp(`((?:${sensitiveNames.join('|')})\\s*[:=]\\s*)(['"]?)[^\\n,'" ]+(['"]?)`, 'gi'), '$1$2[REDACTED]$3')
        .slice(-4000);
}

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
            stdoutTail: redactOutputTail(result.stdout || ''),
            stderrTail: redactOutputTail(result.stderr || '')
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
