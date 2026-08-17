const {
    REQUIRED_EXTENSION_RECOVERY_LANES,
    upsertExtensionRecoveryLane,
    evaluateExtensionRecoveryReleaseGate
} = require('../../acceptance/lib/extension-recovery-evidence.js');

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
