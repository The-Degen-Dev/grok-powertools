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
