const { buildPublicManifest, renderPublicReport } = require('../../tools/r2-v2/report-model');

describe('Grok Gallery v2 public migration report', () => {
    test('contains aggregate proof without private keys, identities, or prompts', () => {
        const plan = {
            planSha256: 'f'.repeat(64),
            counts: {
                sourceMediaObjects: 2,
                sourceMediaBytes: 300,
                sourceRows: 2,
                blobObjects: 1,
                blobBytes: 150,
                assetManifests: 1,
                assetManifestBytes: 90,
                evidenceObjects: 1,
                evidenceBytes: 20,
                quarantineRecords: 1,
                quarantineManifestBytes: 40,
                metadataGaps: 1,
                warnings: 0,
                destinationObjects: 4,
                destinationBytes: 300,
                duplicateMediaBytesRemoved: 150
            },
            blobs: [{ verificationStatus: 'verified', mediaType: 'video', preferredSourceObjectKey: 'private-source-key' }],
            assets: [{ gapCodes: ['metadata_missing'], assetId: '11111111-1111-4111-8111-111111111111' }],
            evidence: [{}],
            quarantine: [{ reason: 'asset_identity_missing', sourceObjectKeys: ['private-source-key'] }],
            warnings: []
        };
        const snapshot = {
            status: 'verified',
            source: { bucket: 'grok-gallery-001', prefix: 'grok-powertools/v1' },
            objectCount: 10,
            totalBytes: 500,
            listingPasses: [
                { fingerprintSha256: 'a'.repeat(64), objectCount: 10, pageCount: 1 },
                { fingerprintSha256: 'a'.repeat(64), objectCount: 10, pageCount: 1 }
            ],
            finalListingStable: true,
            failedMediaProofCount: 0
        };

        const manifest = buildPublicManifest(plan, snapshot, '2026-08-19T00:00:00.000Z');
        const output = `${JSON.stringify(manifest)}\n${renderPublicReport(manifest)}`;

        expect(manifest.status).toBe('awaiting_cloud_resource_approval');
        expect(manifest.quarantine.byReason).toEqual({ asset_identity_missing: 1 });
        expect(output).not.toContain('private-source-key');
        expect(output).not.toContain('11111111-1111-4111-8111-111111111111');
        expect(output).not.toContain('prompt text');
    });
});
