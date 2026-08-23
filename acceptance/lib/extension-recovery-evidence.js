const { redactEvidence } = require('./run-contract.js');

const REQUIRED_EXTENSION_RECOVERY_LANES = Object.freeze([
    'environment-and-state',
    'deterministic',
    'acceptance-cloud',
    'prompted-batch',
    'cloud-only-sync',
    'dual-write-sync',
    'stop-reload',
    'full-production-backup',
    'state-restoration'
]);
const LANE_STATUSES = new Set(['passed', 'failed', 'blocked', 'not_run', 'in_progress']);
const SENSITIVE_EVIDENCE_KEY_RE = /api[-_]?key|authorization|bearer|cookie|credential|oauth|pass(word)?|secret|session|token/i;
const SENSITIVE_EVIDENCE_VALUE_RE = /\b(?:bearer|oauth)\s+[^\s]+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b(?:sk|rk|gh[pous]|xox[baprs])[-_][A-Za-z0-9._-]{8,}/i;

function sanitizeExtensionRecoveryEvidence(value, key = '') {
    if (typeof value === 'string') {
        return SENSITIVE_EVIDENCE_KEY_RE.test(key) || SENSITIVE_EVIDENCE_VALUE_RE.test(value)
            ? '[REDACTED]'
            : value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeExtensionRecoveryEvidence(entry, key));
    }
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
            entryKey,
            sanitizeExtensionRecoveryEvidence(entryValue, entryKey)
        ])
    );
}

function parseExtensionRecoveryStatusFiles(statusOutput) {
    const dirtyFiles = [];
    const untrackedFiles = [];
    const records = statusOutput.split('\0');

    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (!record) continue;

        const status = record.slice(0, 2);
        const fileName = record.slice(3);
        if (status === '!!') continue;
        if (status === '??') {
            untrackedFiles.push(fileName);
            continue;
        }

        dirtyFiles.push(fileName);
        if (status.includes('R') || status.includes('C')) {
            const originalFileName = records[index + 1];
            if (originalFileName) dirtyFiles.push(originalFileName);
            index += 1;
        }
    }

    return { dirtyFiles, untrackedFiles };
}

function normalizeExtensionRecoveryLane(lane) {
    if (!REQUIRED_EXTENSION_RECOVERY_LANES.includes(lane?.laneId)) {
        throw new Error('Unknown extension recovery lane');
    }
    if (!LANE_STATUSES.has(lane.status)) throw new Error('Invalid extension recovery lane status');
    if (lane.evidence !== undefined && (!lane.evidence || typeof lane.evidence !== 'object' || Array.isArray(lane.evidence))) {
        throw new Error('Extension recovery lane evidence must be a structured object');
    }
    return redactEvidence({
        laneId: lane.laneId,
        status: lane.status,
        recordedAt: lane.recordedAt || new Date().toISOString(),
        evidence: sanitizeExtensionRecoveryEvidence(lane.evidence || {})
    });
}

function upsertExtensionRecoveryLane(workbook, lane) {
    const normalized = normalizeExtensionRecoveryLane(lane);
    return redactEvidence({
        ...workbook,
        schemaVersion: 1,
        lanes: { ...(workbook.lanes || {}), [normalized.laneId]: normalized }
    });
}

function evaluateExtensionRecoveryReleaseGate(workbook) {
    const failedLanes = [];
    const blockedLanes = [];
    const missingLanes = [];
    for (const laneId of REQUIRED_EXTENSION_RECOVERY_LANES) {
        const status = workbook?.lanes?.[laneId]?.status || 'not_run';
        if (status === 'failed') failedLanes.push(laneId);
        else if (status === 'blocked') blockedLanes.push(laneId);
        else if (status !== 'passed') missingLanes.push(laneId);
    }
    const verdict = failedLanes.length
        ? 'failed'
        : blockedLanes.length
            ? 'blocked'
            : missingLanes.length ? 'inconclusive' : 'verified';
    return { verdict, missingLanes, failedLanes, blockedLanes };
}

module.exports = {
    REQUIRED_EXTENSION_RECOVERY_LANES,
    normalizeExtensionRecoveryLane,
    parseExtensionRecoveryStatusFiles,
    upsertExtensionRecoveryLane,
    evaluateExtensionRecoveryReleaseGate
};
