const {
    REQUIRED_EXTENSION_RECOVERY_LANES,
    normalizeExtensionRecoveryLane,
    parseExtensionRecoveryStatusFiles,
    upsertExtensionRecoveryLane,
    evaluateExtensionRecoveryReleaseGate
} = require('../../acceptance/lib/extension-recovery-evidence.js');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const startScript = path.join(repoRoot, 'acceptance/scripts/start-extension-recovery-run.mjs');
const recordScript = path.join(repoRoot, 'acceptance/scripts/record-extension-recovery-lane.mjs');
const createdRunIds = new Set();

function createRunId() {
    const runId = `task1-r1-${process.pid}-${Date.now()}-${createdRunIds.size}`;
    createdRunIds.add(runId);
    return runId;
}

function runDirectory(runId) {
    return path.join(repoRoot, 'acceptance/runs', runId);
}

function runCli(script, args, options = {}) {
    return execFileSync(process.execPath, [script, ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...options.env }
    });
}

function startSyntheticRun(runId) {
    return runCli(startScript, [], { env: { ACCEPTANCE_RUN_ID: runId } });
}

function recordLane(runId, laneId, status, evidence) {
    return runCli(recordScript, [
        '--run-id', runId,
        '--lane', laneId,
        '--status', status,
        '--evidence', evidence
    ]);
}

function readWorkbook(runId) {
    return JSON.parse(fs.readFileSync(path.join(runDirectory(runId), 'extension-recovery.json'), 'utf8'));
}

function startRecorder(runId, laneId) {
    return spawn(process.execPath, [recordScript,
        '--run-id', runId,
        '--lane', laneId,
        '--status', 'passed',
        '--evidence', '{"count":1}'
    ], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForExit(child) {
    return new Promise((resolve, reject) => {
        let stderr = '';
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Recorder exited with code ${code}: ${stderr}`));
        });
    });
}

afterAll(() => {
    for (const runId of createdRunIds) {
        fs.rmSync(runDirectory(runId), { recursive: true, force: true });
    }
});

test('requires direct pass evidence for every release lane', () => {
    let workbook = { schemaVersion: 1, runId: 'ext-20260816-001', lanes: {} };
    for (const laneId of REQUIRED_EXTENSION_RECOVERY_LANES) {
        workbook = upsertExtensionRecoveryLane(workbook, {
            laneId,
            status: laneId === 'dual-write-sync' ? 'not_run' : 'passed',
            evidence: { count: 1 }
        });
    }
    expect(evaluateExtensionRecoveryReleaseGate(workbook)).toEqual({
        verdict: 'inconclusive',
        missingLanes: ['dual-write-sync'],
        failedLanes: [],
        blockedLanes: []
    });
});

test('redacts secrets and private URLs before storing a lane', () => {
    const workbook = upsertExtensionRecoveryLane(
        { schemaVersion: 1, runId: 'ext-20260816-001', lanes: {} },
        {
            laneId: 'acceptance-cloud',
            status: 'passed',
            evidence: {
                apiKey: 'must-not-survive',
                signedUrl: 'https://bucket.example/x?Signature=must-not-survive',
                identitySuffixes: ['...a1b2c3d4']
            }
        }
    );
    expect(JSON.stringify(workbook)).not.toContain('must-not-survive');
    expect(workbook.lanes['acceptance-cloud'].evidence.identitySuffixes).toEqual(['...a1b2c3d4']);
});

test('requires structured evidence and redacts bearer-shaped keys and values', () => {
    expect(() => normalizeExtensionRecoveryLane({
        laneId: 'deterministic',
        status: 'passed',
        evidence: 'Bearer must-not-survive'
    })).toThrow('structured object');

    const workbook = upsertExtensionRecoveryLane(
        { schemaVersion: 1, runId: 'ext-20260816-001', lanes: {} },
        {
            laneId: 'deterministic',
            status: 'passed',
            evidence: {
                bearer: 'must-not-survive',
                oauthCredential: 'must-not-survive',
                value: 'Bearer must-not-survive'
            }
        }
    );

    expect(JSON.stringify(workbook)).not.toContain('must-not-survive');
});

test('parses porcelain v1 NUL-delimited filenames exactly', () => {
    expect(parseExtensionRecoveryStatusFiles(
        ' M ordinary.js\0 M directory/line\nbreak.js\0?? untracked file.js\0R  renamed.js\0original.js\0C  copied.js\0source.js\0!! ignored.js\0'
    )).toEqual({
        dirtyFiles: ['ordinary.js', 'directory/line\nbreak.js', 'renamed.js', 'original.js', 'copied.js', 'source.js'],
        untrackedFiles: ['untracked file.js']
    });
});

test('records inline and file evidence in a temporary run without overwriting it', () => {
    const runId = createRunId();
    const evidencePath = path.join(runDirectory(runId), 'file-evidence.json');
    startSyntheticRun(runId);
    fs.writeFileSync(evidencePath, JSON.stringify({ count: 2 }));

    recordLane(runId, 'environment-and-state', 'passed', '{"bearer":"must-not-survive","value":"Bearer must-not-survive"}');
    recordLane(runId, 'acceptance-cloud', 'passed', evidencePath);

    const workbook = readWorkbook(runId);
    expect(workbook.lanes['environment-and-state'].status).toBe('passed');
    expect(workbook.lanes['acceptance-cloud'].evidence).toEqual({ count: 2 });
    expect(JSON.stringify(workbook)).not.toContain('must-not-survive');
    expect(() => recordLane(runId, 'deterministic', 'passed', '"Bearer must-not-survive"')).toThrow('structured object');
    expect(readWorkbook(runId).lanes.deterministic.status).toBe('not_run');
    expect(() => startSyntheticRun(runId)).toThrow('Refusing to overwrite');
});

test('serializes concurrent recorder updates while a same-directory lock is held', async () => {
    const runId = createRunId();
    startSyntheticRun(runId);
    const lockPath = path.join(runDirectory(runId), 'extension-recovery.lock');
    fs.writeFileSync(lockPath, 'test lock');

    const deterministic = startRecorder(runId, 'deterministic');
    const promptedBatch = startRecorder(runId, 'prompted-batch');
    await wait(100);
    expect(deterministic.exitCode).toBeNull();
    expect(promptedBatch.exitCode).toBeNull();

    fs.unlinkSync(lockPath);
    await Promise.all([waitForExit(deterministic), waitForExit(promptedBatch)]);

    const workbook = readWorkbook(runId);
    expect(workbook.lanes.deterministic.status).toBe('passed');
    expect(workbook.lanes['prompted-batch'].status).toBe('passed');
});
