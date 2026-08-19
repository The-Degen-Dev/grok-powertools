const { validateMigrationPlan } = require('../../tools/r2-v2/validation-model');

function fixture() {
    const blobSha256 = 'a'.repeat(64);
    const evidenceSha256 = 'b'.repeat(64);
    return {
        plan: {
            blobs: [{ sha256: blobSha256 }],
            assets: [{ blobSha256, evidenceHashes: [evidenceSha256] }],
            evidence: [{ sha256: evidenceSha256 }],
            quarantine: [],
            counts: { quarantineRecords: 0, destinationObjects: 3 }
        },
        snapshot: {
            status: 'verified',
            finalListingStable: true,
            objectCount: 2,
            mediaObjectCount: 1,
            uniqueMediaHashCount: 1
        },
        sourceObjects: [{ isMedia: true }, { isMedia: false }],
        mediaHashes: [{}],
        mediaProofs: [{}]
    };
}

describe('Grok Gallery v2 migration validation', () => {
    test('passes an exactly reconciled dry-run plan', () => {
        const value = fixture();
        expect(validateMigrationPlan(value)).toEqual({
            status: 'passed',
            checks: expect.objectContaining({
                noDanglingAssetBlobReferences: true,
                noDanglingAssetEvidenceReferences: true,
                noUnreferencedBlobs: true
            })
        });
    });

    test('fails dangling evidence and unreferenced blobs independently', () => {
        const value = fixture();
        value.plan.assets = [{ blobSha256: 'c'.repeat(64), evidenceHashes: ['d'.repeat(64)] }];

        const result = validateMigrationPlan(value);

        expect(result.status).toBe('failed');
        expect(result.checks.noDanglingAssetBlobReferences).toBe(false);
        expect(result.checks.noDanglingAssetEvidenceReferences).toBe(false);
        expect(result.checks.noUnreferencedBlobs).toBe(false);
    });
});
