#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    classifyCloudflareAccountId,
    classifyCloudflareR2,
    classifyPortOwner,
    resolveAcceptanceWebPort,
    summarizePreflight,
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

const cloudflareAccountId = classifyCloudflareAccountId(process.env.CLOUDFLARE_ACCOUNT_ID);
const r2Probe = cloudflareAccountId.status === 'verified'
    ? spawnSync('mise', ['exec', 'node@24', '--', 'npm', '--prefix', 'cloud', 'exec', '--', 'wrangler', 'r2', 'bucket', 'list'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID }
    })
    : null;

const webPortConfig = resolveAcceptanceWebPort(process.env.ACCEPTANCE_WEB_PORT);
const webPort = webPortConfig.status === 'verified'
    ? classifyPortOwner({
        port: webPortConfig.port,
        cwd: portOwnerCwd(webPortConfig.port),
        expectedRepo: repoRoot
    })
    : webPortConfig;

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
    webPort,
    cloudflareAccountId,
    r2: r2Probe
        ? classifyCloudflareR2({
            exitCode: r2Probe.status ?? 1,
            stderr: redactCommandOutput(r2Probe.stderr || r2Probe.stdout || '')
        })
        : cloudflareAccountId,
    envFiles: {
        webEnvLocalExists: fs.existsSync(path.join(repoRoot, 'web/.env.local')),
        cloudDevVarsExists: fs.existsSync(path.join(repoRoot, 'cloud/.dev.vars'))
    }
};

result.summary = summarizePreflight(result);

console.log(JSON.stringify(result, null, 2));
process.exit(result.summary.status === 'verified' ? 0 : 2);
