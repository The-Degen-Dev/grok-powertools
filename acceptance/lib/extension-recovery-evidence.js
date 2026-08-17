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

function normalizeExtensionRecoveryLane(lane) {
    if (!REQUIRED_EXTENSION_RECOVERY_LANES.includes(lane?.laneId)) {
        throw new Error('Unknown extension recovery lane');
    }
    if (!LANE_STATUSES.has(lane.status)) throw new Error('Invalid extension recovery lane status');
    return redactEvidence({
        laneId: lane.laneId,
        status: lane.status,
        recordedAt: lane.recordedAt || new Date().toISOString(),
        evidence: lane.evidence || {}
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
    upsertExtensionRecoveryLane,
    evaluateExtensionRecoveryReleaseGate
};
