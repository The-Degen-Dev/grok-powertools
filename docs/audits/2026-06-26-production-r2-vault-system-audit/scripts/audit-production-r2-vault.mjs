#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const auditRoot = path.resolve(scriptsDir, '..');
const repoRoot = path.resolve(auditRoot, '../../..');
const manifestPath = path.join(auditRoot, 'manifest.json');
const PRIVATE_DIR_SEGMENT = `${path.sep}private${path.sep}`;

const MODES = [
  'scaffold',
  'preflight',
  'r2',
  'd1',
  'metadata',
  'local',
  'worker',
  'reconcile',
  'report',
  'validate-artifacts'
];

const EXPECTED = {
  accountId: 'ba5339fd86e87c226bdc306347636042',
  bucket: 'grok-gallery-001',
  prefix: 'grok-powertools/v1',
  d1Database: 'grok-powertools-db',
  d1DatabaseId: 'ad89e4bb-0b68-4c72-93d9-b90e6eb45aa6',
  workerName: 'grok-r2-backup-worker'
};

const SECRET_KEY_RE = /(apikey|api-key|api_key|accesskey|access-key|access_key|secret|token|cookie|authorization|signature|credential|password|uploadurl|upload-url|upload_url|signedurl|signed-url|signed_url|prompttext|prompt-text|prompt_text)/i;
const STORAGE_IDENTIFIER_KEYS = new Set([
  'key',
  'objectkey',
  'object_key',
  'canonicalobjectkey',
  'canonical_object_key',
  'versionkey',
  'version_key',
  'conflictkey',
  'conflict_key'
]);
const PRIVATE_TEXT_KEYS = new Set([
  'text',
  'prompt',
  'prompttext',
  'negativeprompt',
  'privateprompt',
  'rawprompt',
  'originalprompt'
]);
const MEDIA_EXT_RE = /\.(avif|gif|heic|jpeg|jpg|m4v|mov|mp4|png|webm|webp)$/i;
const IMAGE_EXT_RE = /\.(avif|gif|heic|jpeg|jpg|png|webp)$/i;
const VIDEO_EXT_RE = /\.(m4v|mov|mp4|webm)$/i;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;
const OBJECT_KEY_RE = /grok-powertools\/v1\/users\/[^\s"'<>]+/g;

function nowIso() {
  return new Date().toISOString();
}

function relativeAuditPath(filePath) {
  return path.relative(auditRoot, filePath);
}

function assertAuditPath(filePath) {
  const resolved = path.resolve(filePath);
  if (resolved !== auditRoot && !resolved.startsWith(`${auditRoot}${path.sep}`)) {
    throw new Error(`Refusing to write outside audit root: ${resolved}`);
  }
  return resolved;
}

async function ensureDir(dirPath) {
  await fs.mkdir(assertAuditPath(dirPath), { recursive: true });
}

async function writeText(filePath, text) {
  const resolved = assertAuditPath(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, text);
  await recordEvidence(resolved);
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(redact(value), null, 2)}\n`);
}

async function writeJsonl(filePath, rows) {
  const resolved = assertAuditPath(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const stream = createWriteStream(resolved, { encoding: 'utf8' });
  for (const row of rows) {
    stream.write(`${JSON.stringify(redact(row))}\n`);
  }
  await new Promise((resolve, reject) => {
    stream.end(resolve);
    stream.on('error', reject);
  });
  await recordEvidence(resolved);
}

async function writeCommandTextLog(fileName, result) {
  const text = [
    `$ ${result.command} ${result.args.join(' ')}`,
    `startedAt: ${result.startedAt}`,
    `finishedAt: ${result.finishedAt}`,
    `exitCode: ${result.exitCode}`,
    '',
    'stdout:',
    result.stdout || '',
    '',
    'stderr:',
    result.stderr || ''
  ].join('\n');
  await writeText(path.join(auditRoot, 'logs', fileName), text);
}

async function appendJsonl(filePath, row) {
  const resolved = assertAuditPath(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.appendFile(resolved, `${JSON.stringify(redact(row))}\n`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readJsonl(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: ${error.message}`);
      }
    });
}

async function readManifest() {
  return readJson(manifestPath);
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
  if (!resolved.startsWith(`${auditRoot}${path.sep}`)) return;
  if (resolved.includes(PRIVATE_DIR_SEGMENT)) return;
  if (path.basename(resolved) === 'manifest.json') return;
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isFile()) return;
  const rel = relativeAuditPath(resolved);
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

async function refreshEvidenceIndex() {
  const files = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name === 'private') continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (path.resolve(fullPath) === path.resolve(manifestPath)) continue;
      const stat = await fs.stat(fullPath);
      files.push({
        path: relativeAuditPath(fullPath),
        bytes: stat.size,
        updatedAt: stat.mtime.toISOString()
      });
    }
  }
  await walk(auditRoot);
  await updateManifest((manifest) => {
    manifest.evidenceIndex = files.sort((a, b) => a.path.localeCompare(b.path));
  });
}

function hashString(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function redactedValue(value) {
  const text = String(value ?? '');
  if (!text) return '[redacted-empty]';
  return `[redacted sha256:${hashString(text).slice(0, 16)} length:${text.length}]`;
}

function isPrivateTextKey(key) {
  const normalized = String(key || '').toLowerCase().replace(/[-_\s]/g, '');
  return PRIVATE_TEXT_KEYS.has(normalized);
}

function isStorageIdentifierKey(key) {
  const normalized = String(key || '').toLowerCase().replace(/[-_\s]/g, '');
  return STORAGE_IDENTIFIER_KEYS.has(normalized);
}

function redact(value, keyPath = []) {
  const key = String(keyPath.at(-1) || '');
  const normalizedKey = key.toLowerCase().replace(/[-_\s]/g, '');
  if (!isStorageIdentifierKey(key) && (SECRET_KEY_RE.test(normalizedKey) || isPrivateTextKey(key))) {
    if (typeof value === 'boolean' || typeof value === 'number' || value === null) return value;
    return redactedValue(value);
  }
  if (typeof value === 'string') {
    if (/X-Amz-Signature=|X-Amz-Credential=|Bearer\s+|x-gpt-api-key/i.test(value)) {
      return redactedValue(value);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => redact(item, [...keyPath, String(index)]));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, [...keyPath, entryKey])])
    );
  }
  return value;
}

async function addBlocker(mode, blocker) {
  const entry = {
    mode,
    recordedAt: nowIso(),
    ...redact(blocker)
  };
  const safeName = mode.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const uniqueId = `${Date.now()}-${process.hrtime.bigint().toString(36)}`;
  const blockerPath = path.join(auditRoot, 'logs', `blocker-${safeName}-${uniqueId}.json`);
  await writeJson(blockerPath, entry);
  await updateManifest((manifest) => {
    manifest.status = 'blocked';
    manifest.blockers = [...(manifest.blockers || []), entry];
    if (manifest.subsystems?.[mode] !== undefined) manifest.subsystems[mode] = 'blocked';
  });
  return entry;
}

async function clearModeBlockers(mode) {
  const safeMode = mode.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  await updateManifest((manifest) => {
    manifest.blockers = (manifest.blockers || []).filter((blocker) => blocker.mode !== mode);
    manifest.evidenceIndex = (manifest.evidenceIndex || []).filter((entry) => !entry.path.startsWith(`logs/blocker-${safeMode}-`));
    if (manifest.subsystems?.[mode] !== undefined) manifest.subsystems[mode] = 'not_run';
    if (!(manifest.blockers || []).length && manifest.status === 'blocked') manifest.status = 'in_progress';
  });
  const logsDir = path.join(auditRoot, 'logs');
  const files = await fs.readdir(logsDir).catch(() => []);
  for (const file of files) {
    if (file.startsWith(`blocker-${safeMode}-`) && file.endsWith('.json')) {
      await fs.rm(path.join(logsDir, file), { force: true });
    }
  }
}

async function markSubsystem(name, status) {
  await updateManifest((manifest) => {
    if (!manifest.subsystems) manifest.subsystems = {};
    manifest.subsystems[name] = status;
  });
}

async function runCommand(name, command, args, options = {}) {
  const startedAt = nowIso();
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd || repoRoot,
      maxBuffer: options.maxBuffer || 1024 * 1024 * 20,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:${process.env.PATH || ''}`,
        npm_config_cache: process.env.npm_config_cache || '/tmp/codex-wrangler-npx-cache',
        ...(options.env || {})
      }
    });
    const log = {
      name,
      command,
      args,
      startedAt,
      finishedAt: nowIso(),
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr
    };
    if (options.persist !== false) await writeJson(path.join(auditRoot, 'logs', `${name}.json`), log);
    return { ok: true, ...log };
  } catch (error) {
    const log = {
      name,
      command,
      args,
      startedAt,
      finishedAt: nowIso(),
      exitCode: typeof error.code === 'number' ? error.code : 1,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message
    };
    if (options.persist !== false) await writeJson(path.join(auditRoot, 'logs', `${name}.json`), log);
    return { ok: false, ...log };
  }
}

function envPresence(names) {
  return Object.fromEntries(names.map((name) => [name, Boolean(process.env[name])]));
}

function configuredValue(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function broadWranglerSelectOnlyApproved() {
  return /^(1|true|yes)$/i.test(String(process.env.AUDIT_APPROVE_BROAD_WRANGLER_SELECT_ONLY || '').trim());
}

async function scaffold() {
  for (const dir of ['inventory', 'reconciliations', 'logs', 'screenshots', 'browser-samples', 'scripts']) {
    await ensureDir(path.join(auditRoot, dir));
  }
  await markSubsystem('preflight', (await readManifest()).subsystems.preflight || 'not_run');
  console.log(`scaffold ok: ${auditRoot}`);
}

async function preflight() {
  await scaffold();
  await clearModeBlockers('preflight');
  const gitStatus = await runCommand('preflight-git-status', 'git', ['status', '--short']);
  const gitBranch = await runCommand('preflight-git-branch', 'git', ['branch', '--show-current']);
  const gitHead = await runCommand('preflight-git-head', 'git', ['rev-parse', 'HEAD']);
  const gitDiffCheck = await runCommand('preflight-git-diff-check', 'git', ['diff', '--check']);
  const nodeVersion = await runCommand('preflight-node-version', 'node', ['--version']);
  const npmVersion = await runCommand('preflight-npm-version', 'npm', ['--version']);
  const node24Version = await runCommand('preflight-node24-version', 'mise', ['exec', 'node@24', '--', 'node', '--version']);
  const wranglerWhoamiRaw = await runCommand('wrangler-whoami', 'mise', [
    'exec',
    'node@24',
    '--',
    'npx',
    '--yes',
    'wrangler@latest',
    'whoami'
  ], { persist: false });
  const wranglerWhoami = sanitizeWranglerWhoamiResult(wranglerWhoamiRaw);
  await writeJson(path.join(auditRoot, 'logs', 'wrangler-whoami.json'), wranglerWhoami);
  const wranglerVersion = await runCommand('wrangler-version', 'mise', [
    'exec',
    'node@24',
    '--',
    'npx',
    '--yes',
    'wrangler@latest',
    '--version'
  ]);
  const wranglerR2Help = await runCommand('wrangler-r2-object-help', 'mise', [
    'exec',
    'node@24',
    '--',
    'npx',
    '--yes',
    'wrangler@latest',
    'r2',
    'object',
    '--help'
  ]);
  const wranglerD1Help = await runCommand('wrangler-d1-execute-help', 'mise', [
    'exec',
    'node@24',
    '--',
    'npx',
    '--yes',
    'wrangler@latest',
    'd1',
    'execute',
    '--help'
  ]);
  const routeSafety = await runCommand('route-safety-source', 'rg', [
    '-n',
    'POST /v1/objects/verify|/v1/metadata/snapshot|/v1/presign|/v1/sync/push|repair/approve|repair/run|gap-fill/run|reconcile/index|HEAD /v1/objects/verify|/api/vault/repair/proof',
    'cloud/src',
    'web/src/app/api/vault'
  ]);
  const nextRouteSafety = await runCommand('next-route-safety-source', 'rg', [
    '-n',
    'export async function|workerJson|fetch\\(|NextResponse|REPAIR_|LIVE_GROK|RECONCILE_|GAP|approve|run|plan|HEAD|POST|GET',
    'web/src/app/api/vault',
    'web/src/lib/vault-preview-server.ts',
    'web/src/lib/vault-server.ts'
  ]);
  const wranglerToml = await fs.readFile(path.join(repoRoot, 'cloud', 'wrangler.toml'), 'utf8');
  await writeText(path.join(auditRoot, 'logs', 'production-wrangler-config.txt'), wranglerToml);
  await writeCommandTextLog('preflight-git.txt', {
    command: 'git',
    args: ['status --short', 'branch --show-current', 'rev-parse HEAD', 'diff --check'],
    startedAt: gitStatus.startedAt,
    finishedAt: gitDiffCheck.finishedAt,
    exitCode: gitStatus.ok && gitBranch.ok && gitHead.ok && gitDiffCheck.ok ? 0 : 1,
    stdout: [
      'git status --short',
      gitStatus.stdout,
      'git branch --show-current',
      gitBranch.stdout,
      'git rev-parse HEAD',
      gitHead.stdout,
      'git diff --check',
      gitDiffCheck.stdout
    ].join('\n'),
    stderr: [gitStatus.stderr, gitBranch.stderr, gitHead.stderr, gitDiffCheck.stderr].filter(Boolean).join('\n')
  });
  await writeCommandTextLog('preflight-runtime.txt', {
    command: 'runtime',
    args: ['node --version', 'npm --version', 'mise exec node@24 -- node --version'],
    startedAt: nodeVersion.startedAt,
    finishedAt: node24Version.finishedAt,
    exitCode: nodeVersion.ok && npmVersion.ok && node24Version.ok ? 0 : 1,
    stdout: [
      `node: ${nodeVersion.stdout.trim()}`,
      `npm: ${npmVersion.stdout.trim()}`,
      `node@24: ${node24Version.stdout.trim()}`
    ].join('\n'),
    stderr: [nodeVersion.stderr, npmVersion.stderr, node24Version.stderr].filter(Boolean).join('\n')
  });
  await writeCommandTextLog('wrangler-version.txt', wranglerVersion);
  await writeCommandTextLog('wrangler-whoami.txt', wranglerWhoami);
  await writeCommandTextLog('wrangler-r2-object-help.txt', wranglerR2Help);
  await writeCommandTextLog('wrangler-d1-execute-help.txt', wranglerD1Help);
  await writeText(path.join(auditRoot, 'logs', 'route-safety-source.txt'), routeSafety.stdout || routeSafety.stderr || '');
  await writeText(path.join(auditRoot, 'logs', 'next-route-safety-source.txt'), nextRouteSafety.stdout || nextRouteSafety.stderr || '');

  const r2Proof = await preflightR2Proof();
  const d1Proof = await preflightD1Proof();

  const identity = {
    expected: EXPECTED,
    envPresence: envPresence([
      'CLOUDFLARE_ACCOUNT_ID',
      'AUDIT_R2_BUCKET',
      'AUDIT_R2_PREFIX',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'WORKER_URL',
      'WORKER_API_KEY',
      'CLIENT_API_KEY',
      'AUDIT_APPROVE_BROAD_WRANGLER_SELECT_ONLY'
    ]),
    envMatches: {
      CLOUDFLARE_ACCOUNT_ID:
        process.env.CLOUDFLARE_ACCOUNT_ID === undefined
          ? false
          : process.env.CLOUDFLARE_ACCOUNT_ID === EXPECTED.accountId,
      AUDIT_R2_BUCKET: configuredValue('AUDIT_R2_BUCKET', EXPECTED.bucket) === EXPECTED.bucket,
      AUDIT_R2_PREFIX: configuredValue('AUDIT_R2_PREFIX', EXPECTED.prefix) === EXPECTED.prefix
    },
    methods: {
      rawR2Listing: 'S3-compatible ListObjectsV2 with read-only credential expectation',
      rawR2Hashing: 'S3-compatible GetObject stream into SHA-256 digest, bytes discarded',
      d1Read: 'wrangler d1 execute --remote --json --command with SELECT-only statements',
      workerRead: 'GET /v1/vault/* and HEAD /v1/objects/verify only'
    },
    redactionRules: [
      'keys containing key, token, secret, cookie, authorization, signature, credential, password, uploadUrl, signedUrl, or promptText are hashed and redacted',
      'private prompt/text fields are not written verbatim',
      'signed URLs and bearer/API-key strings are hashed and redacted'
    ],
    commandStatus: {
      gitStatus: gitStatus.ok,
      gitBranch: gitBranch.ok,
      gitHead: gitHead.ok,
      nodeVersion: nodeVersion.ok,
      npmVersion: npmVersion.ok,
      node24Version: node24Version.ok,
      gitDiffCheck: gitDiffCheck.ok,
      wranglerWhoami: wranglerWhoami.ok,
      wranglerVersion: wranglerVersion.ok,
      wranglerR2Help: wranglerR2Help.ok,
      wranglerD1Help: wranglerD1Help.ok,
      routeSafety: routeSafety.ok,
      nextRouteSafety: nextRouteSafety.ok
    },
    authenticatedProof: {
      r2: r2Proof,
      d1: d1Proof,
      broadWranglerTokenForSelectOnlyD1: {
        approved: broadWranglerSelectOnlyApproved(),
        scope: 'Remote D1 SELECT-only reads',
        writesAllowed: false
      }
    }
  };
  await writeJson(path.join(auditRoot, 'inventory', 'preflight-identity.json'), identity);
  await updateManifest((manifest) => {
    manifest.repo.branch = gitBranch.stdout?.trim() || manifest.repo.branch;
    manifest.repo.commit = gitHead.stdout?.trim() || manifest.repo.commit;
    manifest.repo.gitStatusShort = gitStatus.stdout || manifest.repo.gitStatusShort;
  });

  const blockers = [];
  if (process.env.CLOUDFLARE_ACCOUNT_ID !== EXPECTED.accountId) {
    blockers.push({
      reason: 'CLOUDFLARE_ACCOUNT_ID missing or does not match production account from cloud/wrangler.toml',
      expected: EXPECTED.accountId,
      actualPresent: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID),
      neededUserDecision: 'Provide read-only production Cloudflare/R2 environment for this shell or approve an alternate account-proof method.'
    });
  }
  if (!wranglerR2Help.stdout.includes('get') || !wranglerR2Help.stdout.includes('put')) {
    blockers.push({
      reason: 'Wrangler R2 object help did not match expected command surface',
      command: 'wrangler r2 object --help',
      neededUserDecision: 'Review current Wrangler R2 command surface before raw inventory.'
    });
  }
  if (!wranglerD1Help.stdout.includes('--remote') || !wranglerD1Help.stdout.includes('--command')) {
    blockers.push({
      reason: 'Wrangler D1 execute help does not expose required read-only remote command flags',
      command: 'wrangler d1 execute --help',
      neededUserDecision: 'Confirm an alternate D1 read method.'
    });
  }
  if (!gitDiffCheck.ok) {
    blockers.push({
      reason: 'git diff --check failed',
      command: 'git diff --check',
      error: gitDiffCheck.stderr || gitDiffCheck.stdout,
      neededUserDecision: 'Fix whitespace/conflict-marker issues before committing audit artifacts.'
    });
  }
  if (!r2Proof.ok) {
    blockers.push({
      reason: 'Authenticated R2 bucket/prefix proof failed',
      commandOrApiPath: 'S3 HeadBucket and ListObjectsV2 MaxKeys=1',
      error: r2Proof.error || r2Proof.reason,
      neededUserDecision: 'Provide read-only production R2 credentials or approve a different read-only bucket/prefix proof.'
    });
  }
  if (wranglerWhoami.scopeSummary.writeOrAdminScopes.length > 0 && !broadWranglerSelectOnlyApproved()) {
    blockers.push({
      reason: 'Cloudflare Wrangler auth token appears broader than read-only',
      command: 'wrangler whoami',
      evidence: 'whoami output includes write or admin scopes',
      neededUserDecision: 'Provide a read-only Cloudflare token for D1 proof, or explicitly approve using the current broad token for SELECT-only D1 audit reads.'
    });
  }
  if (wranglerWhoami.scopeSummary.writeOrAdminScopes.length > 0 && broadWranglerSelectOnlyApproved()) {
    await writeJson(path.join(auditRoot, 'logs', 'd1-broad-token-select-only-approval.json'), {
      generatedAt: nowIso(),
      approvalEnv: 'AUDIT_APPROVE_BROAD_WRANGLER_SELECT_ONLY',
      approved: true,
      scope: 'Remote D1 SELECT-only audit reads against grok-powertools-db',
      writesAllowed: false,
      writeOrAdminScopeCount: wranglerWhoami.scopeSummary.writeOrAdminScopes.length,
      note: 'Approval is for using the currently authenticated broad Wrangler token only for SELECT statements. Production writes remain forbidden.'
    });
  }
  if (!d1Proof.ok) {
    blockers.push({
      reason: 'Authenticated D1 identity/schema proof failed',
      commandOrApiPath: 'wrangler d1 execute grok-powertools-db --remote --json --command SELECT ...',
      error: d1Proof.error || d1Proof.reason,
      neededUserDecision: 'Confirm Cloudflare D1 auth or approve a different read-only D1 proof.'
    });
  }
  if (blockers.length) {
    for (const blocker of blockers) await addBlocker('preflight', blocker);
    console.error(`preflight blocked: ${blockers.length} blocker(s)`);
    process.exitCode = 1;
    return;
  }

  await markSubsystem('preflight', 'verified');
  console.log('preflight verified');
}

function sanitizeWranglerWhoamiResult(result) {
  const stdout = String(result.stdout || '');
  const accountIds = [...stdout.matchAll(/[a-f0-9]{32}/gi)].map((match) => match[0]);
  const scopes = [...stdout.matchAll(/-\s+([a-z0-9_.-]+)\s*(?:\((read|write|admin|run)\))?/gi)]
    .map((match) => ({
      scope: match[1],
      access: match[2] || 'unknown'
    }))
    .filter((entry) => entry.scope !== 'Getting');
  const writeOrAdminScopes = scopes
    .filter((entry) => entry.access === 'write' || entry.access === 'admin')
    .map((entry) => `${entry.scope}:${entry.access}`);
  return {
    name: result.name,
    command: result.command,
    args: result.args,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    exitCode: result.exitCode,
    ok: result.ok,
    stdout: JSON.stringify({
      wranglerAuthenticated: result.ok,
      accountIds: [...new Set(accountIds)],
      expectedAccountPresent: accountIds.includes(EXPECTED.accountId),
      credentialScopeClasses: [...new Set(scopes.map((entry) => entry.access))].sort(),
      writeOrAdminScopes
    }, null, 2),
    stderr: result.stderr,
    scopeSummary: {
      accountIds: [...new Set(accountIds)],
      expectedAccountPresent: accountIds.includes(EXPECTED.accountId),
      writeOrAdminScopes
    }
  };
}

async function preflightR2Proof() {
  const missing = ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].filter((name) => !process.env[name]);
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_ACCOUNT_ID !== EXPECTED.accountId) {
    missing.push('CLOUDFLARE_ACCOUNT_ID_MATCH');
  }
  if (missing.length) {
    return { ok: false, reason: 'missing required R2 env', missing };
  }
  try {
    const { S3Client, HeadBucketCommand, ListObjectsV2Command } = loadCloudS3();
    const client = new S3Client(s3ClientConfig());
    await client.send(new HeadBucketCommand({ Bucket: EXPECTED.bucket }));
    const prefixResult = await client.send(new ListObjectsV2Command({
      Bucket: EXPECTED.bucket,
      Prefix: `${EXPECTED.prefix}/`,
      MaxKeys: 1
    }));
    const keyCount = Number(prefixResult.KeyCount || 0);
    return {
      ok: keyCount > 0,
      method: 'S3 HeadBucket plus ListObjectsV2 MaxKeys=1',
      bucket: EXPECTED.bucket,
      prefix: EXPECTED.prefix,
      firstPageKeyCount: keyCount,
      isTruncated: Boolean(prefixResult.IsTruncated),
      reason: keyCount > 0 ? undefined : 'expected populated prefix returned zero objects'
    };
  } catch (error) {
    return { ok: false, method: 'S3 HeadBucket plus ListObjectsV2 MaxKeys=1', error: error.message };
  }
}

async function preflightD1Proof() {
  try {
    const parsed = await d1Execute(
      'preflight-schema-smoke',
      "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name"
    );
    const rows = extractD1Rows(parsed);
    await writeJson(path.join(auditRoot, 'inventory', 'preflight-d1-schema.json'), {
      generatedAt: nowIso(),
      database: EXPECTED.d1Database,
      databaseId: EXPECTED.d1DatabaseId,
      rowCount: rows.length,
      requiredTablesPresent: {
        r2_dedupe_index: rows.some((row) => row.name === 'r2_dedupe_index'),
        metadata_snapshot_index: rows.some((row) => row.name === 'metadata_snapshot_index'),
        vault_overlays: rows.some((row) => row.name === 'vault_overlays')
      },
      rows
    });
    return {
      ok: rows.length > 0,
      method: 'wrangler d1 execute remote schema SELECT',
      database: EXPECTED.d1Database,
      databaseId: EXPECTED.d1DatabaseId,
      rowCount: rows.length,
      reason: rows.length > 0 ? undefined : 'schema query returned zero rows'
    };
  } catch (error) {
    return {
      ok: false,
      method: 'wrangler d1 execute remote schema SELECT',
      database: EXPECTED.d1Database,
      databaseId: EXPECTED.d1DatabaseId,
      error: error.message
    };
  }
}

function loadCloudS3() {
  const cloudRequire = createRequire(new URL('../../../../cloud/package.json', import.meta.url));
  return cloudRequire('@aws-sdk/client-s3');
}

function s3ClientConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  return {
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  };
}

async function requireR2Env(mode = 'rawR2') {
  const missing = ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].filter((name) => !process.env[name]);
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_ACCOUNT_ID !== EXPECTED.accountId) {
    missing.push('CLOUDFLARE_ACCOUNT_ID_MATCH');
  }
  if (missing.length) {
    await addBlocker(mode, {
      reason: 'Missing or mismatched read-only R2 environment variables',
      missing,
      commandOrApiPath: 'S3-compatible ListObjectsV2/GetObject',
      neededUserDecision: 'Provide read-only production R2 credentials for the expected account, or approve an alternate read-only raw listing method.'
    });
    return false;
  }
  return true;
}

async function requirePreflightVerified(mode) {
  const manifest = await readManifest();
  if (manifest.subsystems?.preflight === 'verified') return true;
  await addBlocker(mode, {
    reason: 'Production mode refused because preflight is not verified',
    currentPreflightStatus: manifest.subsystems?.preflight || 'missing',
    neededUserDecision: 'Run and satisfy preflight gates before production inventory.'
  });
  return false;
}

function classifyObjectKey(key, contentType = '') {
  const parts = key.split('/');
  const usersIndex = parts.indexOf('users');
  const userId = usersIndex >= 0 ? parts[usersIndex + 1] || null : null;
  const byAsset = key.match(/\/media\/by-asset\/([^/.?#/]+)/);
  const conflict = key.match(/\/media\/conflicts\/([^/.?#/]+)/);
  const assetId = byAsset?.[1] || conflict?.[1] || null;
  const lower = key.toLowerCase();
  let pathClass = 'unknown';
  if (!key.startsWith(`${EXPECTED.prefix}/`)) pathClass = 'out-of-prefix';
  else if (key.includes('/metadata/')) pathClass = 'metadata';
  else if (key.endsWith('.prompt.json')) pathClass = 'prompt-sidecar';
  else if (key.includes('/media/by-asset/')) pathClass = 'canonical-media';
  else if (key.includes('/media/conflicts/')) pathClass = 'conflict-media';
  else if (/\/media\/\d{4}[-/]\d{2}[-/]\d{2}/.test(key)) pathClass = 'legacy-date-media';
  else if (key.includes('/_system/') || key.includes('/upload-test')) pathClass = 'system';
  else if (key.includes('/repair/')) pathClass = 'repair';
  const content = String(contentType || '').toLowerCase();
  const mediaType = content.startsWith('image/') || IMAGE_EXT_RE.test(lower)
    ? 'image'
    : content.startsWith('video/') || VIDEO_EXT_RE.test(lower)
      ? 'video'
      : MEDIA_EXT_RE.test(lower)
        ? 'unknown-media'
        : 'non-media';
  const isMedia = key.includes('/media/') && !key.endsWith('.prompt.json') && mediaType !== 'non-media';
  const malformed = !key.startsWith(`${EXPECTED.prefix}/users/`) && pathClass !== 'out-of-prefix';
  return { userId, pathClass, assetId, mediaType, isMedia, malformed };
}

async function bodyToHash(body) {
  const hash = createHash('sha256');
  let bytes = 0;
  if (!body) return { sha256: null, bytesRead: 0 };
  if (typeof body.transformToByteArray === 'function') {
    const data = await body.transformToByteArray();
    hash.update(data);
    bytes += data.byteLength;
    return { sha256: hash.digest('hex'), bytesRead: bytes };
  }
  if (typeof body.getReader === 'function') {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      bytes += value.byteLength;
    }
    return { sha256: hash.digest('hex'), bytesRead: bytes };
  }
  for await (const chunk of body) {
    hash.update(chunk);
    bytes += chunk.length || chunk.byteLength || 0;
  }
  return { sha256: hash.digest('hex'), bytesRead: bytes };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  async function worker() {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function r2Inventory() {
  if (!(await requirePreflightVerified('rawR2'))) {
    process.exitCode = 1;
    return;
  }
  if (!(await requireR2Env('rawR2'))) {
    process.exitCode = 1;
    return;
  }
  const bucket = configuredValue('AUDIT_R2_BUCKET', EXPECTED.bucket);
  const prefix = configuredValue('AUDIT_R2_PREFIX', EXPECTED.prefix);
  if (bucket !== EXPECTED.bucket || prefix !== EXPECTED.prefix) {
    await addBlocker('rawR2', {
      reason: 'R2 target env does not match expected production bucket or prefix',
      expected: { bucket: EXPECTED.bucket, prefix: EXPECTED.prefix },
      actual: { bucket, prefix },
      neededUserDecision: 'Correct the target env or explicitly approve the alternate target.'
    });
    process.exitCode = 1;
    return;
  }

  let s3;
  try {
    s3 = loadCloudS3();
  } catch (error) {
    await addBlocker('rawR2', {
      reason: 'Unable to load @aws-sdk/client-s3 from cloud dependencies',
      error: error.message,
      neededUserDecision: 'Run npm install --prefix cloud, then rerun R2 inventory.'
    });
    process.exitCode = 1;
    return;
  }
  const { S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand } = s3;
  const client = new S3Client(s3ClientConfig());
  const listedObjects = [];
  const pages = [];
  let continuationToken;
  let page = 0;
  const maxObjects = Number(process.env.AUDIT_MAX_R2_OBJECTS || 100000);
  const maxHashBytes = Number(process.env.AUDIT_MAX_R2_HASH_BYTES || 100 * 1024 * 1024 * 1024);
  const headConcurrency = Math.max(1, Number(process.env.AUDIT_R2_HEAD_CONCURRENCY || 16));
  const hashConcurrency = Math.max(1, Number(process.env.AUDIT_R2_HASH_CONCURRENCY || 4));
  const hashBatchSize = Math.max(1, Number(process.env.AUDIT_R2_HASH_BATCH_SIZE || 50));

  for (;;) {
    page += 1;
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000
    }));
    pages.push({
      page,
      keyCount: response.KeyCount || 0,
      isTruncated: Boolean(response.IsTruncated),
      continuationTokenPresent: Boolean(continuationToken),
      nextContinuationTokenPresent: Boolean(response.NextContinuationToken),
      timestamp: nowIso()
    });
    for (const item of response.Contents || []) {
      const key = item.Key;
      if (!key) continue;
      listedObjects.push({
        key,
        listedSize: Number(item.Size ?? 0),
        listedEtag: item.ETag,
        listedLastModified: item.LastModified ? item.LastModified.toISOString() : undefined
      });
      if (listedObjects.length > maxObjects) {
        await writeJsonl(path.join(auditRoot, 'inventory', 'r2-objects-listing-checkpoint.jsonl'), listedObjects);
        await writeJson(path.join(auditRoot, 'inventory', 'r2-pages.json'), { method: 'S3 ListObjectsV2', pages });
        await addBlocker('rawR2', {
          reason: 'R2 listing exceeded configured object safety limit',
          maxObjects,
          observedObjects: listedObjects.length,
          neededUserDecision: 'Approve continuing with a higher AUDIT_MAX_R2_OBJECTS limit or split the run.'
        });
        process.exitCode = 1;
        return;
      }
    }
    continuationToken = response.NextContinuationToken;
    if (!response.IsTruncated || !continuationToken) break;
  }

  await writeJsonl(path.join(auditRoot, 'inventory', 'r2-objects-listing-checkpoint.jsonl'), listedObjects);
  await writeJson(path.join(auditRoot, 'inventory', 'r2-listing-checkpoint.json'), {
    generatedAt: nowIso(),
    method: 'S3 ListObjectsV2 before HeadObject enrichment',
    bucket,
    prefix,
    objectCount: listedObjects.length,
    pageCount: pages.length,
    finalTruncatedState: pages.at(-1)?.isTruncated || false,
    headConcurrency,
    hashConcurrency,
    hashBatchSize
  });

  const objects = await mapLimit(listedObjects, headConcurrency, async (listed) => {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: listed.key })).catch((error) => ({ __headError: error }));
    const headError = head.__headError;
    const contentType = headError ? undefined : head.ContentType;
    const size = Number(listed.listedSize ?? (headError ? 0 : head.ContentLength) ?? 0);
    const classification = classifyObjectKey(listed.key, contentType);
    return {
      key: listed.key,
      size,
      etag: listed.listedEtag || (headError ? undefined : head.ETag),
      uploadedAt: listed.listedLastModified,
      contentType,
      customMetadata: headError ? undefined : head.Metadata || {},
      headStatus: headError ? 'failed' : 'ok',
      headError: headError ? headError.message : undefined,
      ...classification
    };
  });

  await writeJsonl(path.join(auditRoot, 'inventory', 'r2-objects.jsonl'), objects);
  await writeJson(path.join(auditRoot, 'inventory', 'r2-pages.json'), {
    method: 'S3 ListObjectsV2',
    bucket,
    prefix,
    pageSize: 1000,
    pageCount: pages.length,
    finalTruncatedState: pages.at(-1)?.isTruncated || false,
    headMethod: 'S3 HeadObject for every listed object',
    headConcurrency,
    pages
  });
  if (objects.length === 0) {
    await addBlocker('rawR2', {
      reason: 'Raw R2 listing returned zero objects for known production prefix',
      bucket,
      prefix,
      neededUserDecision: 'Confirm the credentials, account, bucket, and prefix before continuing.'
    });
    process.exitCode = 1;
    return;
  }

  const mediaObjects = objects.filter((object) => object.isMedia);
  const mediaBytes = mediaObjects.reduce((sum, object) => sum + (Number(object.size) || 0), 0);
  if (mediaBytes > maxHashBytes) {
    await writeJson(path.join(auditRoot, 'inventory', 'r2-objects-summary.json'), r2Summary(objects, []));
    await addBlocker('r2ByteHashes', {
      reason: 'R2 media byte hashing exceeds configured safety limit',
      maxHashBytes,
      observedMediaBytes: mediaBytes,
      mediaObjects: mediaObjects.length,
      neededUserDecision: 'Approve continuing with a higher AUDIT_MAX_R2_HASH_BYTES limit, or split hashing into a separate run.'
    });
    process.exitCode = 1;
    return;
  }

  const hashPath = path.join(auditRoot, 'inventory', 'r2-media-hashes.jsonl');
  const existingHashRows = await optionalJsonl(hashPath);
  if (!existingHashRows.length) await fs.writeFile(assertAuditPath(hashPath), '');
  const hashRowsByKey = new Map();
  for (const row of existingHashRows) {
    if (row?.objectKey) hashRowsByKey.set(row.objectKey, row);
  }
  await writeJson(path.join(auditRoot, 'logs', 'r2-hash-resume-state.json'), {
    generatedAt: nowIso(),
    mediaObjects: mediaObjects.length,
    existingHashRows: existingHashRows.length,
    remainingHashRows: mediaObjects.filter((object) => !hashRowsByKey.has(object.key)).length,
    hashConcurrency,
    hashBatchSize
  });
  const remainingMediaObjects = mediaObjects.filter((object) => !hashRowsByKey.has(object.key));
  for (let index = 0; index < remainingMediaObjects.length; index += hashBatchSize) {
    const batch = remainingMediaObjects.slice(index, index + hashBatchSize);
    const batchRows = await mapLimit(batch, hashConcurrency, async (object) => hashR2MediaObject(client, GetObjectCommand, bucket, object));
    for (const row of batchRows) {
      hashRowsByKey.set(row.objectKey, row);
      await appendJsonl(hashPath, row);
    }
  }
  const hashRows = [...hashRowsByKey.values()];
  await recordEvidence(hashPath);
  await writeJson(path.join(auditRoot, 'inventory', 'r2-objects-summary.json'), r2Summary(objects, hashRows));
  await markSubsystem('rawR2', 'verified');
  await markSubsystem('r2ByteHashes', hashRows.some((row) => row.status !== 'ok') ? 'dirty' : 'verified');
  console.log(`r2 inventory complete: ${objects.length} objects, ${mediaObjects.length} media objects`);
}

async function hashR2MediaObject(client, GetObjectCommand, bucket, object) {
  const startedAt = nowIso();
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.key }));
    const hashed = await bodyToHash(response.Body);
    return {
      objectKey: object.key,
      bytesRead: hashed.bytesRead,
      sha256: hashed.sha256,
      status: 'ok',
      method: 'S3 GetObject streamed to SHA-256 digest',
      startedAt,
      finishedAt: nowIso()
    };
  } catch (error) {
    return {
      objectKey: object.key,
      bytesRead: 0,
      sha256: null,
      status: 'failed',
      error: error.message,
      method: 'S3 GetObject streamed to SHA-256 digest',
      startedAt,
      finishedAt: nowIso()
    };
  }
}

function r2Summary(objects, hashRows) {
  const byClass = countBy(objects, (object) => object.pathClass);
  const byMediaType = countBy(objects, (object) => object.mediaType);
  return {
    generatedAt: nowIso(),
    rawObjectCount: objects.length,
    mediaObjectCount: objects.filter((object) => object.isMedia).length,
    metadataObjectCount: objects.filter((object) => object.pathClass === 'metadata').length,
    totalBytes: objects.reduce((sum, object) => sum + (Number(object.size) || 0), 0),
    byClass,
    byMediaType,
    hashCoverage: {
      attempted: hashRows.length,
      ok: hashRows.filter((row) => row.status === 'ok').length,
      failed: hashRows.filter((row) => row.status !== 'ok').length
    }
  };
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function extractD1Rows(parsed) {
  if (Array.isArray(parsed)) {
    const first = parsed.find((entry) => entry?.results || entry?.result?.results || entry?.result?.[0]?.results);
    return extractD1Rows(first || {});
  }
  if (Array.isArray(parsed?.results)) return parsed.results;
  if (Array.isArray(parsed?.result?.results)) return parsed.result.results;
  if (Array.isArray(parsed?.result?.[0]?.results)) return parsed.result[0].results;
  if (Array.isArray(parsed?.result)) return parsed.result.flatMap((entry) => entry.results || []);
  return [];
}

async function d1Execute(name, sql) {
  assertSelectOnlySql(name, sql);
  const result = await runCommand(`d1-${name}`, 'mise', [
    'exec',
    'node@24',
    '--',
    'npx',
    '--yes',
    'wrangler@latest',
    'd1',
    'execute',
    EXPECTED.d1Database,
    '--remote',
    '--json',
    '--command',
    sql
  ], { cwd: path.join(repoRoot, 'cloud'), persist: false });
  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    parseError = error;
  }
  await writeJson(path.join(auditRoot, 'logs', `d1-${name}.json`), {
    name: result.name,
    command: result.command,
    args: result.args,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    exitCode: result.exitCode,
    ok: result.ok,
    sqlShape: selectSqlShape(sql),
    stdoutBytes: Buffer.byteLength(result.stdout || ''),
    stdoutSha256: result.stdout ? hashString(result.stdout) : null,
    parsedRowCount: parsed ? extractD1Rows(parsed).length : null,
    rowsWritten: extractD1Meta(parsed, 'rows_written'),
    changedDb: extractD1Meta(parsed, 'changed_db'),
    stderr: result.stderr,
    parseError: parseError?.message
  });
  if (!result.ok) throw new Error(result.stderr || `${name} failed`);
  if (parseError) throw new Error(`D1 ${name} returned non-JSON output: ${parseError.message}`);
  return parsed;
}

function assertSelectOnlySql(name, sql) {
  const trimmed = String(sql || '').trim();
  const singleStatement = trimmed.replace(/;\s*$/, '');
  if (!/^select\b/i.test(singleStatement)) {
    throw new Error(`Refusing non-SELECT D1 SQL for ${name}`);
  }
  if (/[;]/.test(singleStatement)) {
    throw new Error(`Refusing multi-statement D1 SQL for ${name}`);
  }
  if (/\b(insert|update|delete|upsert|replace|drop|alter|create|pragma|attach|detach|vacuum|reindex)\b/i.test(singleStatement)) {
    throw new Error(`Refusing mutation-capable D1 SQL for ${name}`);
  }
}

function selectSqlShape(sql) {
  return String(sql || '')
    .replace(/\s+/g, ' ')
    .replace(/\bSELECT\s+\*/i, 'SELECT *')
    .trim()
    .slice(0, 240);
}

function extractD1Meta(parsed, field) {
  if (!parsed) return null;
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  for (const entry of entries) {
    const meta = entry?.meta || entry?.result?.meta || entry?.result?.[0]?.meta;
    if (meta && Object.prototype.hasOwnProperty.call(meta, field)) return meta[field];
  }
  return null;
}

async function d1Inventory() {
  if (!(await requirePreflightVerified('d1'))) {
    process.exitCode = 1;
    return;
  }
  try {
    const schemaRaw = await d1Execute(
      'schema',
      "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name"
    );
    const schemaRows = extractD1Rows(schemaRaw);
    await writeJson(path.join(auditRoot, 'inventory', 'd1-schema.json'), {
      generatedAt: nowIso(),
      database: EXPECTED.d1Database,
      databaseId: EXPECTED.d1DatabaseId,
      rows: schemaRows
    });
    const tableNames = new Set(schemaRows.filter((row) => row.type === 'table').map((row) => row.name));
    const exports = [
      ['r2_dedupe_index', 'd1-r2-dedupe-index.jsonl'],
      ['metadata_snapshot_index', 'd1-metadata-snapshot-index.jsonl'],
      ['vault_overlays', 'd1-vault-overlays.jsonl']
    ];
    for (const [table, fileName] of exports) {
      if (!tableNames.has(table)) {
        await writeJsonl(path.join(auditRoot, 'inventory', fileName), []);
        continue;
      }
      const rowsRaw = await d1Execute(table, `SELECT * FROM ${table}`);
      const rows = extractD1Rows(rowsRaw).map((row) => redactD1Row(table, row));
      await writeJsonl(path.join(auditRoot, 'inventory', fileName), rows);
    }
    await markSubsystem('d1', 'verified');
    console.log(`d1 inventory complete: ${schemaRows.length} schema rows`);
  } catch (error) {
    await addBlocker('d1', {
      reason: 'Remote D1 read failed',
      commandOrApiPath: 'wrangler d1 execute grok-powertools-db --remote --json --command SELECT ...',
      error: error.message,
      database: EXPECTED.d1Database,
      databaseId: EXPECTED.d1DatabaseId,
      neededUserDecision: 'Confirm Cloudflare D1 auth for read-only production SELECTs or approve a different D1 export source.'
    });
    process.exitCode = 1;
  }
}

function redactD1Row(table, row) {
  const copy = { ...row };
  if (typeof copy.data === 'string') {
    copy.dataSha256 = hashString(copy.data);
    copy.dataBytes = Buffer.byteLength(copy.data);
    delete copy.data;
  }
  copy._table = table;
  return copy;
}

async function metadataInventory() {
  if (!(await requirePreflightVerified('metadata'))) {
    process.exitCode = 1;
    return;
  }
  if (!(await requireR2Env('metadata'))) {
    process.exitCode = 1;
    return;
  }
  const objectPath = path.join(auditRoot, 'inventory', 'r2-objects.jsonl');
  let objects;
  try {
    objects = await readJsonl(objectPath);
  } catch (error) {
    await addBlocker('metadata', {
      reason: 'Metadata inventory requires raw R2 object inventory first',
      missingArtifact: relativeAuditPath(objectPath),
      error: error.message,
      neededUserDecision: 'Run raw R2 inventory or approve metadata-only listing.'
    });
    process.exitCode = 1;
    return;
  }
  const s3 = loadCloudS3();
  const { S3Client, GetObjectCommand } = s3;
  const client = new S3Client(s3ClientConfig());
  const bucket = configuredValue('AUDIT_R2_BUCKET', EXPECTED.bucket);
  const metadataObjects = objects.filter((object) =>
    object.pathClass === 'metadata' ||
    object.pathClass === 'prompt-sidecar' ||
    /backfill-manifest\.[a-f0-9]+\.json$/i.test(object.key) ||
    /\/metadata\/.*\.json$/i.test(object.key)
  );
  const objectRows = [];
  const references = [];
  for (const object of metadataObjects) {
    const startedAt = nowIso();
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.key }));
      const chunks = [];
      let bytesRead = 0;
      for await (const chunk of response.Body) {
        chunks.push(Buffer.from(chunk));
        bytesRead += chunk.length || chunk.byteLength || 0;
      }
      const buffer = Buffer.concat(chunks);
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const text = buffer.toString('utf8');
      let parsed;
      let parseStatus = 'ok';
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        parseStatus = `failed: ${error.message}`;
      }
      const summary = parsed === undefined ? {} : summarizeMetadata(parsed, object.key);
      objectRows.push({
        objectKey: object.key,
        size: object.size,
        bytesRead,
        sha256,
        contentType: object.contentType,
        parseStatus,
        schemaVersion: parsed?.schemaVersion,
        recordCount: summary.recordCount || 0,
        redactionStatus: 'raw metadata body omitted; references only',
        startedAt,
        finishedAt: nowIso()
      });
      references.push({
        objectKey: object.key,
        sha256,
        parseStatus,
        ...summary
      });
    } catch (error) {
      objectRows.push({
        objectKey: object.key,
        size: object.size,
        parseStatus: 'read_failed',
        error: error.message,
        redactionStatus: 'raw metadata body omitted',
        startedAt,
        finishedAt: nowIso()
      });
      references.push({ objectKey: object.key, parseStatus: 'read_failed', error: error.message });
    }
  }
  await writeJson(path.join(auditRoot, 'inventory', 'metadata-objects.json'), {
    generatedAt: nowIso(),
    count: objectRows.length,
    objects: objectRows
  });
  await writeJson(path.join(auditRoot, 'inventory', 'metadata-references.json'), {
    generatedAt: nowIso(),
    count: references.length,
    references
  });
  await markSubsystem('metadata', objectRows.some((row) => row.parseStatus !== 'ok') ? 'dirty' : 'verified');
  console.log(`metadata inventory complete: ${objectRows.length} objects`);
}

function summarizeMetadata(value, objectKey) {
  const assetIds = new Set();
  const objectKeys = new Set();
  const promptIds = new Set();
  const hashes = new Set();
  let recordCount = 0;
  function visit(node, keyPath = []) {
    if (Array.isArray(node)) {
      if (keyPath.length <= 3) recordCount = Math.max(recordCount, node.length);
      node.forEach((item, index) => visit(item, [...keyPath, String(index)]));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (typeof child === 'string') {
          const lower = key.toLowerCase();
          if (lower.includes('asset') && child) assetIds.add(child);
          if (lower.includes('objectkey') || lower === 'object_key' || child.startsWith(`${EXPECTED.prefix}/users/`)) {
            for (const match of child.match(OBJECT_KEY_RE) || [child]) objectKeys.add(match);
          }
          if (lower.includes('prompt') && lower.includes('id')) promptIds.add(child);
          if (lower.includes('hash') || lower.includes('sha')) hashes.add(child);
        }
        visit(child, [...keyPath, key]);
      }
      return;
    }
    if (typeof node === 'string') {
      for (const match of node.match(OBJECT_KEY_RE) || []) objectKeys.add(match);
    }
  }
  visit(value);
  if (!recordCount && value?.data && Array.isArray(value.data)) recordCount = value.data.length;
  return {
    objectKey,
    recordCount,
    assetIds: [...assetIds].sort(),
    objectKeys: [...objectKeys].sort(),
    promptIds: [...promptIds].sort(),
    contentHashes: [...hashes].sort()
  };
}

async function localInventory() {
  const vaultRoot = '/Users/philipbankier/Content/Grok IMagine/greymaker/GrokVault';
  const parentRoot = '/Users/philipbankier/Content/Grok IMagine/greymaker';
  const blockers = [];
  for (const dir of [vaultRoot, parentRoot]) {
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) blockers.push(dir);
  }
  if (blockers.length) {
    await addBlocker('localFiles', {
      reason: 'Required local media roots are missing',
      missingRoots: blockers,
      neededUserDecision: 'Mount or restore the local Grok media folder before claiming local completeness.'
    });
    process.exitCode = 1;
    return;
  }
  const vaultRows = await scanMediaRoot(vaultRoot, { mode: 'vault', includeAllFiles: true });
  const parentRows = await scanMediaRoot(parentRoot, { mode: 'parent', includeAllFiles: false, skipPrefix: vaultRoot });
  annotateDuplicateLocalGroups(vaultRows, parentRows);
  await writeText(path.join(auditRoot, 'inventory', 'local-vault-files.csv'), csv(vaultRows));
  await writeText(path.join(auditRoot, 'inventory', 'local-parent-media-files.csv'), csv(parentRows));
  await writeJson(path.join(auditRoot, 'inventory', 'local-media-summary.json'), localSummary(vaultRows, parentRows));
  await markSubsystem('localFiles', 'verified');
  console.log(`local inventory complete: ${vaultRows.length} vault files, ${parentRows.length} parent candidates`);
}

async function scanMediaRoot(root, options) {
  const rows = [];
  const excludeDirs = new Set([
    '.git',
    'node_modules',
    '.next',
    'dist',
    'build',
    '.wrangler',
    '.cache',
    'cache',
    'Caches',
    'coverage',
    '.turbo',
    '.npm',
    '.pnpm-store'
  ]);
  async function walk(dir) {
    if (options.skipPrefix && path.resolve(dir).startsWith(path.resolve(options.skipPrefix))) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!options.includeAllFiles && !MEDIA_EXT_RE.test(entry.name)) continue;
      const stat = await fs.stat(fullPath);
      const hash = await hashFile(fullPath);
      const mediaType = mediaTypeFromPath(entry.name);
      const signature = await mediaSignature(fullPath);
      const uuids = [...entry.name.matchAll(UUID_RE)].map((match) => match[0].toLowerCase());
      rows.push({
        scope: options.mode === 'vault' ? 'GrokVault' : 'parent',
        inclusionReason: options.includeAllFiles ? 'full-vault-scan' : 'media-extension-under-parent-root',
        absolutePath: fullPath,
        relativePath: path.relative(root, fullPath),
        size: stat.size,
        extension: path.extname(entry.name).toLowerCase(),
        mediaType,
        sha256: hash,
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
        filenameUuids: uuids.join('|'),
        likelyGrokIds: likelyIds(entry.name).join('|'),
        zeroByte: stat.size === 0,
        duplicateFilenameGroup: '',
        duplicateHashGroup: '',
        signatureStatus: signature.status,
        signatureType: signature.type
      });
    }
  }
  await walk(root);
  return rows.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function mediaTypeFromPath(filePath) {
  if (IMAGE_EXT_RE.test(filePath)) return 'image';
  if (VIDEO_EXT_RE.test(filePath)) return 'video';
  if (MEDIA_EXT_RE.test(filePath)) return 'unknown';
  return 'non-media';
}

function annotateDuplicateLocalGroups(...rowGroups) {
  const rows = rowGroups.flat();
  const filenameGroups = groupedValues(rows, (row) => path.basename(row.absolutePath));
  const hashGroups = groupedValues(rows, (row) => row.sha256);
  let filenameIndex = 0;
  for (const group of filenameGroups.values()) {
    if (group.length < 2) continue;
    filenameIndex += 1;
    for (const row of group) row.duplicateFilenameGroup = `filename-${filenameIndex}`;
  }
  let hashIndex = 0;
  for (const group of hashGroups.values()) {
    if (group.length < 2) continue;
    hashIndex += 1;
    for (const row of group) row.duplicateHashGroup = `hash-${hashIndex}`;
  }
}

function groupedValues(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  }
  return groups;
}

async function mediaSignature(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead);
    if (head.length === 0) return { status: 'zero-byte', type: 'none' };
    if (head.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) return { status: 'ok', type: 'jpeg' };
    if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { status: 'ok', type: 'png' };
    if (head.subarray(0, 3).toString() === 'GIF') return { status: 'ok', type: 'gif' };
    if (head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP') return { status: 'ok', type: 'webp' };
    if (head.subarray(4, 8).toString() === 'ftyp') return { status: 'ok', type: 'mp4-family' };
    return { status: MEDIA_EXT_RE.test(filePath) ? 'unknown-signature' : 'not-media-checked', type: 'unknown' };
  } finally {
    await handle.close();
  }
}

function likelyIds(name) {
  const stem = path.basename(name, path.extname(name));
  return stem.split(/[^a-zA-Z0-9-]+/).filter((part) => part.length >= 12);
}

function csv(rows) {
  const headers = [
    'scope',
    'inclusionReason',
    'absolutePath',
    'relativePath',
    'size',
    'extension',
    'mediaType',
    'sha256',
    'createdAt',
    'modifiedAt',
    'filenameUuids',
    'likelyGrokIds',
    'zeroByte',
    'duplicateFilenameGroup',
    'duplicateHashGroup',
    'signatureStatus',
    'signatureType'
  ];
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')).join('\n')}\n`;
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function localSummary(vaultRows, parentRows) {
  const all = [...vaultRows.map((row) => ({ ...row, source: 'vault' })), ...parentRows.map((row) => ({ ...row, source: 'parent' }))];
  return {
    generatedAt: nowIso(),
    counts: {
      vaultFiles: vaultRows.length,
      parentCandidates: parentRows.length,
      total: all.length,
      image: all.filter((row) => row.mediaType === 'image').length,
      video: all.filter((row) => row.mediaType === 'video').length,
      nonMedia: all.filter((row) => row.mediaType === 'non-media').length
    },
    totalBytes: all.reduce((sum, row) => sum + Number(row.size || 0), 0),
    zeroByteFiles: all.filter((row) => Number(row.size) === 0).map((row) => row.absolutePath),
    duplicateFilenameGroups: duplicateGroups(all, (row) => path.basename(row.absolutePath)),
    duplicateHashGroups: duplicateGroups(all, (row) => row.sha256),
    suspiciousMediaSignatures: all.filter((row) => row.signatureStatus !== 'ok' && row.mediaType !== 'non-media')
  };
}

function duplicateGroups(rows, keyFn) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const current = grouped.get(key) || [];
    current.push(row);
    grouped.set(key, current);
  }
  return [...grouped.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, count: group.length, items: group.map((row) => row.absolutePath || row.key || row.objectKey) }));
}

async function workerInventory() {
  if (!(await requirePreflightVerified('workerRoutes'))) {
    process.exitCode = 1;
    return;
  }
  const workerUrl = process.env.WORKER_URL;
  const apiKey = process.env.WORKER_API_KEY || process.env.CLIENT_API_KEY;
  if (!workerUrl || !apiKey) {
    await addBlocker('workerRoutes', {
      reason: 'Worker route cross-check requires WORKER_URL and WORKER_API_KEY or CLIENT_API_KEY',
      missing: ['WORKER_URL', !apiKey ? 'WORKER_API_KEY_or_CLIENT_API_KEY' : null].filter(Boolean),
      neededUserDecision: 'Provide production Worker URL and API key in env, or approve skipping Worker/web route proof.'
    });
    process.exitCode = 1;
    return;
  }
  const headers = { 'x-gpt-api-key': apiKey };
  const base = workerUrl.replace(/\/+$/, '');
  const identity = await fetchJson(`${base}/v1/vault/identity`, { headers });
  await writeJson(path.join(auditRoot, 'logs', 'worker-vault-identity.json'), identity);
  const pages = [];
  const assets = [];
  let cursor = null;
  for (let page = 1; page <= 100; page += 1) {
    const url = new URL(`${base}/v1/vault/inventory`);
    url.searchParams.set('limit', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);
    const inventory = await fetchJson(url, { headers });
    const items = Array.isArray(inventory.items) ? inventory.items : [];
    pages.push({
      page,
      itemCount: items.length,
      nextCursorPresent: Boolean(inventory.nextCursor),
      counts: inventory.counts || null,
      timestamp: nowIso()
    });
    for (const item of items) assets.push(item);
    cursor = inventory.nextCursor || null;
    if (!cursor) break;
  }
  await writeJsonl(path.join(auditRoot, 'inventory', 'worker-vault-assets.jsonl'), assets);
  await writeJson(path.join(auditRoot, 'inventory', 'worker-vault-pages.json'), {
    generatedAt: nowIso(),
    workerUrlHost: new URL(base).host,
    pageCount: pages.length,
    truncatedAtPageLimit: Boolean(cursor),
    pages
  });
  const metadataKinds = ['savedPrompts', 'promptHistory', 'processedIds', 'backfillManifest', 'savedList'];
  const metadataSummaries = [];
  for (const kind of metadataKinds) {
    const result = await fetchJson(`${base}/v1/vault/metadata/${kind}`, { headers }).catch((error) => ({ ok: false, error: error.message }));
    metadataSummaries.push({
      kind,
      ok: result.ok !== false,
      count: Array.isArray(result.data) ? result.data.length : 0,
      error: result.error
    });
  }
  await writeJson(path.join(auditRoot, 'logs', 'worker-metadata-summary.json'), {
    generatedAt: nowIso(),
    metadataSummaries
  });
  await markSubsystem('workerRoutes', cursor ? 'dirty' : 'verified');
  console.log(`worker inventory complete: ${assets.length} assets across ${pages.length} pages`);
}

async function fetchJson(url, init) {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { rawTextSha256: hashString(text), rawTextBytes: text.length };
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.response = parsed;
    throw error;
  }
  return parsed;
}

async function reconcile() {
  const r2Objects = await optionalJsonl(path.join(auditRoot, 'inventory', 'r2-objects.jsonl'));
  const r2Hashes = await optionalJsonl(path.join(auditRoot, 'inventory', 'r2-media-hashes.jsonl'));
  const d1Rows = await optionalJsonl(path.join(auditRoot, 'inventory', 'd1-r2-dedupe-index.jsonl'));
  const metadataRefs = await optionalJson(path.join(auditRoot, 'inventory', 'metadata-references.json'));
  const workerAssets = await optionalJsonl(path.join(auditRoot, 'inventory', 'worker-vault-assets.jsonl'));
  const localSummaryJson = await optionalJson(path.join(auditRoot, 'inventory', 'local-media-summary.json'));
  const localRows = await readLocalCsvRows();

  const r2ByKey = new Map(r2Objects.map((object) => [object.key, object]));
  const d1ByKey = new Map(d1Rows.map((row) => [row.canonical_object_key, row]).filter(([key]) => key));
  const workerByKey = new Map(workerAssets.map((row) => [row.canonicalObjectKey, row]).filter(([key]) => key));
  const localByHash = new Map(localRows.map((row) => [row.sha256, row]).filter(([hash]) => hash));
  const r2HashByKey = new Map(r2Hashes.map((row) => [row.objectKey, row]));

  const mediaObjects = r2Objects.filter((object) => object.isMedia);
  await writeJson(path.join(auditRoot, 'reconciliations', 'r2-d1-delta.json'), {
    generatedAt: nowIso(),
    r2MediaWithoutD1: mediaObjects.filter((object) => !d1ByKey.has(object.key)).map((object) => object.key),
    d1WithoutR2: d1Rows.filter((row) => row.canonical_object_key && !r2ByKey.has(row.canonical_object_key)).map((row) => row.canonical_object_key),
    conflictingD1Status: d1Rows
      .filter((row) => row.canonical_object_key && r2ByKey.has(row.canonical_object_key) && row.upload_status && !['verified', 'uploaded'].includes(row.upload_status))
      .map((row) => ({ objectKey: row.canonical_object_key, uploadStatus: row.upload_status }))
  });

  const referencedObjectKeys = new Set((metadataRefs?.references || []).flatMap((ref) => ref.objectKeys || []));
  await writeJson(path.join(auditRoot, 'reconciliations', 'r2-metadata-delta.json'), {
    generatedAt: nowIso(),
    metadataReferencesMissingMedia: [...referencedObjectKeys].filter((key) => !r2ByKey.has(key)),
    r2MediaWithoutMetadataReference: mediaObjects.filter((object) => !referencedObjectKeys.has(object.key)).map((object) => object.key)
  });

  await writeJson(path.join(auditRoot, 'reconciliations', 'r2-local-delta.json'), {
    generatedAt: nowIso(),
    r2MediaMissingLocallyByHash: mediaObjects
      .map((object) => ({ objectKey: object.key, sha256: r2HashByKey.get(object.key)?.sha256 }))
      .filter((row) => row.sha256 && !localByHash.has(row.sha256)),
    localMediaMissingInR2ByHash: localRows
      .filter((row) => row.mediaType !== 'non-media' && row.sha256 && !r2Hashes.some((hash) => hash.sha256 === row.sha256))
      .map((row) => ({ path: row.absolutePath, sha256: row.sha256 }))
  });

  await writeJson(path.join(auditRoot, 'reconciliations', 'worker-raw-delta.json'), {
    generatedAt: nowIso(),
    r2MediaMissingFromWorker: mediaObjects.filter((object) => !workerByKey.has(object.key)).map((object) => object.key),
    workerAssetsMissingFromR2: workerAssets.filter((row) => row.canonicalObjectKey && !r2ByKey.has(row.canonicalObjectKey)).map((row) => row.canonicalObjectKey)
  });

  await writeJson(path.join(auditRoot, 'reconciliations', 'duplicate-groups.json'), {
    generatedAt: nowIso(),
    sameContentHash: duplicateGroups(
      r2Hashes.filter((row) => row.sha256),
      (row) => row.sha256
    ).map((group) => ({
      classification: 'same hash under multiple R2 keys, requires review unless canonical plus allowed legacy/conflict context is proven',
      ...group
    })),
    sameAssetId: duplicateGroups(
      mediaObjects.filter((object) => object.assetId),
      (object) => object.assetId
    ).map((group) => ({
      classification: 'same asset ID under multiple R2 media keys, requires canonical/conflict classification',
      ...group
    })),
    localDuplicateHashGroups: localSummaryJson?.duplicateHashGroups || []
  });

  await writeJson(path.join(auditRoot, 'reconciliations', 'malformed-keys.json'), {
    generatedAt: nowIso(),
    malformed: r2Objects.filter((object) => object.malformed || object.pathClass === 'out-of-prefix'),
    unknownMediaType: r2Objects.filter((object) => object.mediaType === 'unknown-media'),
    suspiciousSmallMedia: mediaObjects.filter((object) => Number(object.size) <= 0)
  });

  const unresolved = [];
  for (const file of [
    'r2-d1-delta.json',
    'r2-metadata-delta.json',
    'r2-local-delta.json',
    'worker-raw-delta.json',
    'malformed-keys.json'
  ]) {
    const value = await readJson(path.join(auditRoot, 'reconciliations', file));
    unresolved.push(...flattenUnresolved(file, value));
  }
  await writeJson(path.join(auditRoot, 'reconciliations', 'unresolved-items.json'), {
    generatedAt: nowIso(),
    items: unresolved
  });
  await writeJson(path.join(auditRoot, 'reconciliations', 'sample-set.json'), sampleSet(mediaObjects, r2Hashes));
  await markSubsystem('reconciliation', unresolved.length ? 'dirty' : 'verified');
  console.log(`reconciliation complete: ${unresolved.length} unresolved items`);
}

async function optionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function optionalJsonl(filePath) {
  try {
    return await readJsonl(filePath);
  } catch {
    return [];
  }
}

async function readLocalCsvRows() {
  const rows = [];
  for (const fileName of ['local-vault-files.csv', 'local-parent-media-files.csv']) {
    const filePath = path.join(auditRoot, 'inventory', fileName);
    const text = await fs.readFile(filePath, 'utf8').catch(() => '');
    if (!text.trim()) continue;
    const [headerLine, ...lines] = text.trim().split('\n');
    const headers = parseCsvLine(headerLine);
    for (const line of lines) {
      const values = parseCsvLine(line);
      rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
    }
  }
  return rows;
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function flattenUnresolved(source, value) {
  const items = [];
  function visit(node, keyPath = []) {
    if (Array.isArray(node)) {
      if (node.length) items.push({ source, path: keyPath.join('.'), count: node.length, sample: node.slice(0, 10) });
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (['generatedAt'].includes(key)) continue;
        visit(child, [...keyPath, key]);
      }
    }
  }
  visit(value);
  return items;
}

function sampleSet(mediaObjects, r2Hashes) {
  const byUploaded = [...mediaObjects].sort((a, b) => String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || '')));
  const firstPage = mediaObjects.slice(0, 1);
  const beyondFirstPage = mediaObjects.slice(1000, 1001);
  const image = mediaObjects.find((object) => object.mediaType === 'image');
  const video = mediaObjects.find((object) => object.mediaType === 'video');
  const duplicate = duplicateGroups(r2Hashes.filter((row) => row.sha256), (row) => row.sha256)[0]?.items?.[0];
  return {
    generatedAt: nowIso(),
    newestR2Media: byUploaded.at(-1)?.key || null,
    oldestR2Media: byUploaded.at(0)?.key || null,
    firstPageMedia: firstPage[0]?.key || null,
    beyondFirstPageMedia: beyondFirstPage[0]?.key || null,
    imageSample: image?.key || null,
    videoSample: video?.key || null,
    duplicateCandidate: duplicate || null,
    missingMetadataCandidate: null,
    localOnlyCandidate: null,
    r2OnlyCandidate: null
  };
}

async function generateReport() {
  const manifest = await readManifest();
  const r2SummaryJson = await optionalJson(path.join(auditRoot, 'inventory', 'r2-objects-summary.json'));
  const localSummaryJson = await optionalJson(path.join(auditRoot, 'inventory', 'local-media-summary.json'));
  const localChecksJson = await optionalJson(path.join(auditRoot, 'logs', 'local-checks-summary.json'));
  const duplicateJson = await optionalJson(path.join(auditRoot, 'reconciliations', 'duplicate-groups.json'));
  const unresolvedJson = await optionalJson(path.join(auditRoot, 'reconciliations', 'unresolved-items.json'));
  const unresolvedSummaryJson = await optionalJson(path.join(auditRoot, 'reconciliations', 'unresolved-summary.json'));
  const webWorkerDeltaJson = await optionalJson(path.join(auditRoot, 'reconciliations', 'web-worker-delta.json'));
  const statuses = manifest.subsystems || {};
  const productionSubsystems = ['rawR2', 'r2ByteHashes', 'd1', 'metadata', 'localFiles', 'workerRoutes', 'webRoutes', 'reconciliation'];
  const productionBlockerModes = new Set(['preflight', ...productionSubsystems]);
  const productionBlockers = (manifest.blockers || []).filter((blocker) => productionBlockerModes.has(blocker.mode));
  const productionReady = productionSubsystems
    .every((name) => statuses[name] === 'verified');
  const productionStatus = productionBlockers.length
    ? 'blocked'
    : productionReady
      ? 'clean'
      : statuses.reconciliation === 'dirty'
        ? 'dirty'
        : 'inconclusive';
  const grokSavedStatus = statuses.liveGrok === 'verified'
    ? 'sample_verified'
    : (manifest.blockers || []).some((blocker) => blocker.mode === 'liveGrok')
      ? 'blocked'
      : 'inconclusive';
  const localStatus = ['localFiles', 'localSystem'].every((name) => statuses[name] === 'verified')
    ? 'clean'
    : statuses.localSystem === 'failed'
      ? 'dirty'
      : 'inconclusive';
  const auditComplete = !(manifest.blockers || []).length &&
    ['preflight', 'rawR2', 'r2ByteHashes', 'd1', 'metadata', 'localFiles', 'workerRoutes', 'webRoutes', 'localSystem', 'liveGrok']
      .every((name) => statuses[name] === 'verified') &&
    ['verified', 'dirty'].includes(statuses.reconciliation);
  const nextActions = [
    statuses.liveGrok === 'verified'
      ? '- P0 data correctness: Review unresolved canonical raw-R2-only objects, duplicate hash groups, and local/R2 overlap findings before any repair plan.'
      : '- P0 live validation: Bring the existing Grok Saved tab/window to the foreground for read-only live Grok and extension inspection.',
    '- P2 backup pipeline reliability: Only after this read-only audit, design a separate repair/backfill plan for confirmed gaps.',
    '- P2 product visibility and operator UX: Improve preview/reporting only after raw R2 and D1 truth are reconciled.'
  ].join('\n');
  const report = `# Production R2 Vault System Audit

Plan date: 2026-06-26
Execution started: ${manifest.executionStartedAt || 'unknown'}
Report generated: ${nowIso()}

## Split Verdicts

| Verdict | Status | Evidence |
| ------- | ------ | -------- |
| Production R2 internal correctness | ${productionStatus} | Raw R2: ${statuses.rawR2}; hashes: ${statuses.r2ByteHashes}; D1: ${statuses.d1}; metadata: ${statuses.metadata}; local: ${statuses.localFiles}; Worker: ${statuses.workerRoutes}; web: ${statuses.webRoutes}; reconciliation: ${statuses.reconciliation}. |
| Current Grok Saved completeness | ${grokSavedStatus} | Full Saved completeness requires an authoritative current Saved enumeration; visual samples alone do not prove it. |
| Local system health | ${localStatus} | Local checks: ${statuses.localSystem}; local files: ${statuses.localFiles}. |

## Identity Proof

- R2 bucket: ${EXPECTED.bucket}
- D1 database: ${EXPECTED.d1Database}
- D1 database ID: ${EXPECTED.d1DatabaseId}
- Key prefix: ${EXPECTED.prefix}
- Worker name: ${EXPECTED.workerName}
- Account ID from config: ${EXPECTED.accountId}

## Counts

- Raw R2 objects: ${r2SummaryJson?.rawObjectCount ?? 'not_run'}
- Raw R2 media objects: ${r2SummaryJson?.mediaObjectCount ?? 'not_run'}
- Raw R2 metadata objects: ${r2SummaryJson?.metadataObjectCount ?? 'not_run'}
- R2 hash attempts: ${r2SummaryJson?.hashCoverage?.attempted ?? 'not_run'}
- R2 hash failures: ${r2SummaryJson?.hashCoverage?.failed ?? 'not_run'}
- Local media/files inventoried: ${localSummaryJson?.counts?.total ?? 'not_run'}
- D1/Worker indexed assets: ${webWorkerDeltaJson?.workerAssetCount ?? 'not_run'}
- Web route assets: ${webWorkerDeltaJson?.webAssetCount ?? 'not_run'}

## Duplicate Findings

See \`reconciliations/duplicate-groups.json\`. Same-hash groups: ${duplicateJson?.sameContentHash?.length ?? 'not_run'}.
See \`reconciliations/unresolved-summary.json\` for duplicate and legacy/canonical classification. Duplicate hash object groups: ${unresolvedSummaryJson?.duplicateContentHash?.groupCount ?? 'not_run'}.
Duplicate byte hashes are real byte-identical groups, not automatic corruption or deletion candidates. They require classification because many involve legacy date-folder repeats, and some canonical-only groups remain unresolved.

## Missing Media

See \`reconciliations/r2-local-delta.json\`, \`reconciliations/r2-d1-delta.json\`, and \`reconciliations/worker-raw-delta.json\`.
R2 media missing from D1 by class: ${JSON.stringify(unresolvedSummaryJson?.d1Coverage?.missingByPathClass || {})}.
R2 media missing from Worker by class: ${JSON.stringify(unresolvedSummaryJson?.workerCoverage?.missingByPathClass || {})}.
Interpretation: exact-key D1/Worker gaps include legacy date-folder media that the current D1/Worker inventory does not index by design, plus canonical \`media/by-asset\` objects that remain unresolved raw-R2-only evidence until another artifact proves they are intentionally out of scope.

## Metadata Reference Coverage

See \`reconciliations/r2-metadata-delta.json\`.
\`metadataReferencesMissingMedia\` means metadata references pointing at missing media. \`r2MediaWithoutMetadataReference\` is not proof that required metadata is missing; the metadata reference artifact is mostly prompt sidecar references and is not an authoritative coverage map for every R2 object.

## Malformed Keys

See \`reconciliations/malformed-keys.json\`.

## Local-Only And R2-Only Findings

See \`reconciliations/r2-local-delta.json\`.
Interpretation: local/R2 deltas are SHA-256 overlap findings between production R2 and the scanned local macOS corpus only. They do not prove that R2 lost local files or that the local machine is expected to contain every R2 asset.

## Worker And Product Route Mismatches

See \`reconciliations/worker-raw-delta.json\`.
See \`reconciliations/web-worker-delta.json\`. Web/Worker asset ID mismatches: ${(webWorkerDeltaJson?.workerAssetsMissingFromWebByAssetId?.length ?? 'not_run')} worker-only and ${(webWorkerDeltaJson?.webAssetsMissingFromWorkerByAssetId?.length ?? 'not_run')} web-only.
Interpretation: web route parity proves the product route matches Worker/D1 inventory. It does not prove the web Vault covers every raw R2 object because the Worker inventory prefers D1-indexed rows.

## Route Safety Evidence

- Worker route source proof: \`logs/route-safety-source.txt\`
- Next route source proof: \`logs/next-route-safety-source.txt\`
- Production write routes remain denied until a separate approved repair plan.

## Live Grok Samples

Status: ${statuses.liveGrok}. Evidence goes in \`browser-samples/live-grok-samples.md\`.

## Extension Status

Status: ${statuses.liveGrok}. Evidence goes in \`browser-samples/live-grok-samples.md\`.

## Local System Checks

${localChecksJson?.checks?.length ? localChecksJson.checks.map((check) => `- ${check.name}: ${check.status} (${check.log})`).join('\n') : 'Not run.'}

## Blockers

${(manifest.blockers || []).length ? (manifest.blockers || []).map((blocker, index) => `${index + 1}. ${blocker.mode}: ${blocker.reason || blocker.error || 'blocked'}`).join('\n') : 'None recorded.'}

## Unresolved Items

${unresolvedJson?.items?.length ? `See \`reconciliations/unresolved-items.json\` for ${unresolvedJson.items.length} unresolved groups.` : 'None recorded.'}

## Prioritized Next Actions

${nextActions}
`;
  await writeText(path.join(auditRoot, 'report.md'), report);
  await updateManifest((updated) => {
    updated.finalVerdicts.productionR2InternalCorrectness = productionStatus;
    updated.finalVerdicts.currentGrokSavedCompleteness = grokSavedStatus;
    updated.finalVerdicts.localSystemHealth = localStatus;
    updated.status = (manifest.blockers || []).length ? 'blocked' : auditComplete ? 'complete' : 'in_progress';
  });
  console.log('report generated');
}

async function validateArtifacts() {
  const requiredJson = [
    'manifest.json',
    'inventory/preflight-identity.json',
    'inventory/r2-objects-summary.json',
    'inventory/r2-pages.json',
    'inventory/metadata-objects.json',
    'inventory/metadata-references.json',
    'inventory/local-media-summary.json',
    'inventory/grok-assets-current-summary.json',
    'reconciliations/r2-d1-delta.json',
    'reconciliations/r2-metadata-delta.json',
    'reconciliations/r2-local-delta.json',
    'reconciliations/worker-raw-delta.json',
    'reconciliations/web-worker-delta.json',
    'reconciliations/duplicate-groups.json',
    'reconciliations/malformed-keys.json',
    'reconciliations/unresolved-items.json',
    'reconciliations/unresolved-summary.json',
    'reconciliations/local-canonical-index-summary.json',
    'reconciliations/canonical-gap-report.json',
    'reconciliations/canonical-snapshot-schema.json',
    'reconciliations/canonical-snapshot-dry-run-summary.json',
    'reconciliations/d1-canonical-projection-schema.json',
    'reconciliations/d1-canonical-projection-dry-run-summary.json',
    'logs/web-vault-identity.json',
    'logs/web-vault-inventory-pages.json',
    'logs/web-vault-preview.json',
    'logs/web-repair-scan.json',
    'logs/web-route-smoke-summary.json',
    'logs/web-ui-smoke.json',
    'logs/grok-saved-browser-control-blocker.json',
    'logs/grok-assets-active-tab-capture.json',
    'logs/canonical-snapshot-dry-run-validation.json',
    'logs/d1-canonical-projection-dry-run-validation.json',
    'logs/d1-canonical-projection-write-plan.json',
    'logs/d1-canonical-projection-write-readback.json',
    'reconciliations/sample-set.json'
  ];
  const requiredJsonl = [
    'inventory/r2-objects.jsonl',
    'inventory/r2-media-hashes.jsonl',
    'inventory/web-vault-assets.jsonl',
    'inventory/worker-vault-assets.jsonl',
    'inventory/d1-r2-dedupe-index.jsonl'
  ];
  const missing = [];
  const parseFailures = [];
  for (const rel of requiredJson) {
    const full = path.join(auditRoot, rel);
    try {
      await readJson(full);
    } catch (error) {
      missing.push(rel);
      parseFailures.push({ path: rel, error: error.message });
    }
  }
  for (const rel of requiredJsonl) {
    const full = path.join(auditRoot, rel);
    try {
      await readJsonl(full);
    } catch (error) {
      missing.push(rel);
      parseFailures.push({ path: rel, error: error.message });
    }
  }
  await writeJson(path.join(auditRoot, 'logs', 'validate-artifacts.json'), {
    generatedAt: nowIso(),
    ok: missing.length === 0,
    missing,
    parseFailures
  });
  await refreshEvidenceIndex();
  if (missing.length) {
    console.error(`artifact validation failed: ${missing.length} missing or invalid artifact(s)`);
    process.exitCode = 1;
    return;
  }
  console.log('artifact validation ok');
}

function usage() {
  console.log(`Usage: node ${path.relative(repoRoot, scriptPath)} <mode>`);
  console.log(`Modes: ${MODES.join(', ')}`);
}

async function main() {
  const mode = process.argv[2];
  if (!mode) {
    usage();
    return;
  }
  if (!MODES.includes(mode)) {
    usage();
    process.exitCode = 2;
    return;
  }
  if (mode === 'scaffold') return scaffold();
  if (mode === 'preflight') return preflight();
  if (mode === 'r2') return r2Inventory();
  if (mode === 'd1') return d1Inventory();
  if (mode === 'metadata') return metadataInventory();
  if (mode === 'local') return localInventory();
  if (mode === 'worker') return workerInventory();
  if (mode === 'reconcile') return reconcile();
  if (mode === 'report') return generateReport();
  if (mode === 'validate-artifacts') return validateArtifacts();
}

main().catch(async (error) => {
  await addBlocker('runner', {
    reason: 'Unhandled audit runner error',
    error: error.stack || error.message,
    neededUserDecision: 'Inspect runner failure before continuing.'
  }).catch(() => undefined);
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
