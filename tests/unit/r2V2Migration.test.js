const {
    buildMigrationPlan,
    destinationBlobKey,
    normalizeGrokAssetId
} = require('../../tools/r2-v2/migration-model');

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function mediaObject(overrides = {}) {
    return {
        key: `grok-powertools/v1/users/greymaker/media/by-asset/media_${UUID_A}.png`,
        size: 128,
        etag: 'etag-a',
        uploadedAt: '2026-08-19T00:00:00.000Z',
        isMedia: true,
        mediaType: 'image',
        pathClass: 'canonical-media',
        assetId: `media_${UUID_A}`,
        userId: 'greymaker',
        ...overrides
    };
}

function proof(sha256, overrides = {}) {
    return {
        sha256,
        sizeBytes: 128,
        mediaType: 'image',
        signatureStatus: 'verified',
        decoderStatus: 'verified',
        ...overrides
    };
}

function buildInput(mediaObjects, hashByKey, mediaProofs, overrides = {}) {
    return {
        source: {
            bucket: 'grok-gallery-001',
            prefix: 'grok-powertools/v1',
            listingFingerprintSha256: 'f'.repeat(64)
        },
        mediaObjects,
        mediaHashes: mediaObjects.map((object) => ({
            objectKey: object.key,
            sha256: hashByKey[object.key],
            bytesRead: object.size,
            status: 'ok'
        })),
        mediaProofs,
        evidenceObjects: [],
        evidenceLinks: [],
        ...overrides
    };
}

describe('Grok Gallery v2 migration model', () => {
    test('normalizes only canonical Grok media UUID identities', () => {
        expect(normalizeGrokAssetId(`media_${UUID_A.toUpperCase()}`)).toBe(UUID_A);
        expect(normalizeGrokAssetId(UUID_A)).toBe(UUID_A);
        expect(normalizeGrokAssetId('legacy-file-name')).toBeNull();
    });

    test('builds the extensionless content-addressed blob key', () => {
        const sha256 = `ab${'c'.repeat(62)}`;
        expect(destinationBlobKey(sha256)).toBe(
            `grok-powertools/v2/blobs/sha256/ab/${sha256}`
        );
    });

    test('chooses a canonical source deterministically and preserves legacy aliases', () => {
        const sha256 = 'a'.repeat(64);
        const canonical = mediaObject();
        const legacy = mediaObject({
            key: 'grok-powertools/v1/users/greymaker/2026-01-01/media.png',
            pathClass: 'legacy-date-media',
            assetId: null
        });
        const first = buildMigrationPlan(buildInput(
            [legacy, canonical],
            { [legacy.key]: sha256, [canonical.key]: sha256 },
            [proof(sha256)]
        ));
        const second = buildMigrationPlan(buildInput(
            [canonical, legacy],
            { [legacy.key]: sha256, [canonical.key]: sha256 },
            [proof(sha256)]
        ));

        expect(first).toEqual(second);
        expect(first.blobs).toHaveLength(1);
        expect(first.blobs[0].preferredSourceObjectKey).toBe(canonical.key);
        expect(first.blobs[0].sourceObjectKeys).toEqual([legacy.key, canonical.key].sort());
        expect(first.assets).toHaveLength(1);
        expect(first.assets[0]).toMatchObject({
            assetId: UUID_A,
            blobSha256: sha256,
            verificationStatus: 'metadata_gap',
            gapCodes: ['metadata_missing']
        });
        expect(first.quarantine).toHaveLength(0);
    });

    test('uses decoder proof instead of a misleading legacy extension', () => {
        const sha256 = 'b'.repeat(64);
        const misleading = mediaObject({
            key: `grok-powertools/v1/users/greymaker/media/by-asset/media_${UUID_A}.png`,
            mediaType: 'image'
        });
        const plan = buildMigrationPlan(buildInput(
            [misleading],
            { [misleading.key]: sha256 },
            [proof(sha256, {
                mediaType: 'video',
                format: 'iso-bmff',
                contentType: 'video/mp4',
                width: 400,
                height: 736,
                durationSeconds: 6.04,
                videoCodec: 'h264',
                hasAudio: true,
                audioCodecs: ['aac']
            })]
        ));

        expect(plan.blobs[0].mediaType).toBe('video');
        expect(plan.assets[0].mediaType).toBe('video');
        expect(plan.blobs[0].mediaFacts).toMatchObject({
            format: 'iso-bmff',
            contentType: 'video/mp4',
            videoCodec: 'h264',
            hasAudio: true,
            audioCodecs: ['aac']
        });
        expect(plan.assets[0].mediaFacts).toEqual(plan.blobs[0].mediaFacts);
        expect(plan.warnings).toEqual([
            expect.objectContaining({ code: 'source_media_type_mismatch' })
        ]);
        expect(plan.quarantine).toHaveLength(0);
    });

    test('preserves distinct canonical asset IDs as manifests sharing one blob', () => {
        const sha256 = 'c'.repeat(64);
        const first = mediaObject();
        const second = mediaObject({
            key: `grok-powertools/v1/users/greymaker/media/by-asset/media_${UUID_B}.png`,
            assetId: `media_${UUID_B}`,
            etag: 'etag-b'
        });
        const plan = buildMigrationPlan(buildInput(
            [first, second],
            { [first.key]: sha256, [second.key]: sha256 },
            [proof(sha256)]
        ));

        expect(plan.blobs).toHaveLength(1);
        expect(plan.assets.map((asset) => asset.assetId)).toEqual([UUID_A, UUID_B]);
        expect(new Set(plan.assets.map((asset) => asset.blobSha256))).toEqual(new Set([sha256]));
        expect(plan.quarantine).toHaveLength(0);
    });

    test('quarantines every payload variant when one logical asset maps to multiple hashes', () => {
        const shaA = 'd'.repeat(64);
        const shaB = 'e'.repeat(64);
        const first = mediaObject();
        const second = mediaObject({
            key: `grok-powertools/v1/users/greymaker/media/conflicts/media_${UUID_A}.png`,
            etag: 'etag-b'
        });
        const plan = buildMigrationPlan(buildInput(
            [first, second],
            { [first.key]: shaA, [second.key]: shaB },
            [proof(shaA), proof(shaB)]
        ));

        expect(plan.assets).toHaveLength(0);
        expect(plan.quarantine).toHaveLength(2);
        expect(plan.quarantine.map((item) => item.reason)).toEqual([
            'asset_payload_conflict',
            'asset_payload_conflict'
        ]);
        expect(plan.quarantine.map((item) => item.blobSha256)).toEqual([shaA, shaB]);
    });

    test('groups unidentified legacy sources into one blob-level quarantine record', () => {
        const sha256 = '1'.repeat(64);
        const first = mediaObject({
            key: 'grok-powertools/v1/users/greymaker/2026-01-01/first.png',
            pathClass: 'legacy-date-media',
            assetId: null
        });
        const second = mediaObject({
            key: 'grok-powertools/v1/users/greymaker/2026-01-02/second.png',
            pathClass: 'legacy-date-media',
            assetId: null,
            etag: 'etag-b'
        });
        const plan = buildMigrationPlan(buildInput(
            [first, second],
            { [first.key]: sha256, [second.key]: sha256 },
            [proof(sha256)]
        ));

        expect(plan.assets).toHaveLength(0);
        expect(plan.blobs).toHaveLength(1);
        expect(plan.quarantine).toEqual([
            expect.objectContaining({
                reason: 'asset_identity_missing',
                blobSha256: sha256,
                sourceObjectKeys: [first.key, second.key]
            })
        ]);
    });

    test('keeps missing metadata visible as a gap instead of quarantine', () => {
        const sha256 = '2'.repeat(64);
        const object = mediaObject();
        const plan = buildMigrationPlan(buildInput(
            [object],
            { [object.key]: sha256 },
            [proof(sha256)]
        ));

        expect(plan.assets[0].verificationStatus).toBe('metadata_gap');
        expect(plan.assets[0].gapCodes).toEqual(['metadata_missing']);
        expect(plan.quarantine).toHaveLength(0);
    });

    test('references immutable evidence when prompt proof is consistent', () => {
        const mediaSha = '3'.repeat(64);
        const evidenceSha = '4'.repeat(64);
        const object = mediaObject();
        const plan = buildMigrationPlan(buildInput(
            [object],
            { [object.key]: mediaSha },
            [proof(mediaSha)],
            {
                evidenceObjects: [{
                    objectKey: 'grok-powertools/v1/users/greymaker/metadata/item.json',
                    sha256: evidenceSha,
                    sizeBytes: 64,
                    parseStatus: 'ok'
                }],
                evidenceLinks: [{
                    assetId: UUID_A,
                    evidenceSha256: evidenceSha,
                    promptSha256: '5'.repeat(64),
                    status: 'valid'
                }]
            }
        ));

        expect(plan.evidence).toEqual([
            expect.objectContaining({ sha256: evidenceSha })
        ]);
        expect(plan.assets[0]).toMatchObject({
            evidenceHashes: [evidenceSha],
            verificationStatus: 'verified',
            gapCodes: []
        });
    });

    test('keeps evidence with no prompt as a visible prompt gap', () => {
        const mediaSha = 'a'.repeat(64);
        const evidenceSha = 'b'.repeat(64);
        const object = mediaObject();
        const plan = buildMigrationPlan(buildInput(
            [object],
            { [object.key]: mediaSha },
            [proof(mediaSha)],
            {
                evidenceObjects: [{
                    objectKey: 'metadata/no-prompt.json',
                    sha256: evidenceSha,
                    sizeBytes: 64,
                    parseStatus: 'ok'
                }],
                evidenceLinks: [{
                    assetId: UUID_A,
                    evidenceSha256: evidenceSha,
                    promptSha256: null,
                    status: 'valid'
                }]
            }
        ));

        expect(plan.assets[0]).toMatchObject({
            evidenceHashes: [evidenceSha],
            verificationStatus: 'metadata_gap',
            gapCodes: ['prompt_missing']
        });
        expect(plan.quarantine).toHaveLength(0);
    });

    test('quarantines invalid predecessor evidence without poisoning a valid replacement', () => {
        const mediaSha = 'c'.repeat(64);
        const invalidEvidence = 'd'.repeat(64);
        const validEvidence = 'e'.repeat(64);
        const object = mediaObject();
        const plan = buildMigrationPlan(buildInput(
            [object],
            { [object.key]: mediaSha },
            [proof(mediaSha)],
            {
                evidenceObjects: [
                    { objectKey: 'metadata/invalid.json', sha256: invalidEvidence, sizeBytes: 64, parseStatus: 'ok' },
                    { objectKey: 'metadata/valid.json', sha256: validEvidence, sizeBytes: 64, parseStatus: 'ok' }
                ],
                evidenceLinks: [
                    {
                        assetId: UUID_A,
                        evidenceSha256: invalidEvidence,
                        promptSha256: null,
                        status: 'invalid',
                        issues: ['prompt_missing']
                    },
                    {
                        assetId: UUID_A,
                        evidenceSha256: validEvidence,
                        promptSha256: 'f'.repeat(64),
                        status: 'valid'
                    }
                ]
            }
        ));

        expect(plan.assets).toEqual([
            expect.objectContaining({
                assetId: UUID_A,
                evidenceHashes: [validEvidence],
                verificationStatus: 'verified'
            })
        ]);
        expect(plan.quarantine).toEqual([
            expect.objectContaining({
                reason: 'metadata_evidence_invalid',
                assetId: UUID_A,
                evidenceSha256: invalidEvidence
            })
        ]);
    });

    test('quarantines conflicting prompt evidence instead of choosing one', () => {
        const mediaSha = '6'.repeat(64);
        const evidenceA = '7'.repeat(64);
        const evidenceB = '8'.repeat(64);
        const object = mediaObject();
        const plan = buildMigrationPlan(buildInput(
            [object],
            { [object.key]: mediaSha },
            [proof(mediaSha)],
            {
                evidenceObjects: [
                    { objectKey: 'metadata/a.json', sha256: evidenceA, sizeBytes: 64, parseStatus: 'ok' },
                    { objectKey: 'metadata/b.json', sha256: evidenceB, sizeBytes: 64, parseStatus: 'ok' }
                ],
                evidenceLinks: [
                    { assetId: UUID_A, evidenceSha256: evidenceA, promptSha256: '9'.repeat(64), status: 'valid' },
                    { assetId: UUID_A, evidenceSha256: evidenceB, promptSha256: 'a'.repeat(64), status: 'valid' }
                ]
            }
        ));

        expect(plan.assets).toHaveLength(0);
        expect(plan.quarantine).toEqual([
            expect.objectContaining({ reason: 'prompt_evidence_conflict', assetId: UUID_A })
        ]);
    });

    test('quarantines a blob when decoder proof is absent or invalid', () => {
        const sha256 = 'f'.repeat(64);
        const object = mediaObject();
        const plan = buildMigrationPlan(buildInput(
            [object],
            { [object.key]: sha256 },
            [proof(sha256, { decoderStatus: 'failed' })]
        ));

        expect(plan.assets).toHaveLength(0);
        expect(plan.blobs[0].verificationStatus).toBe('quarantined');
        expect(plan.quarantine).toEqual([
            expect.objectContaining({ reason: 'media_decoder_failed', blobSha256: sha256 })
        ]);
    });

    test('quarantines an asset when canonical sources disagree on the user namespace', () => {
        const sha256 = '0'.repeat(64);
        const first = mediaObject();
        const second = mediaObject({
            key: `grok-powertools/v1/users/other/media/by-asset/media_${UUID_A}.png`,
            userId: 'other',
            etag: 'etag-b'
        });
        const plan = buildMigrationPlan(buildInput(
            [first, second],
            { [first.key]: sha256, [second.key]: sha256 },
            [proof(sha256)]
        ));

        expect(plan.assets).toHaveLength(0);
        expect(plan.quarantine).toEqual([
            expect.objectContaining({ reason: 'asset_user_conflict', assetId: UUID_A })
        ]);
    });

    test('includes source-only quarantine records once and projects source rows', () => {
        const sha256 = '9'.repeat(64);
        const object = mediaObject();
        const sourceQuarantine = {
            reason: 'system_object',
            sourceObjectKeys: ['grok-powertools/v1/users/greymaker/_system/upload-test.bin'],
            issues: ['source_path_class:system']
        };
        const plan = buildMigrationPlan(buildInput(
            [object],
            { [object.key]: sha256 },
            [proof(sha256)],
            {
                sourceQuarantine: [sourceQuarantine, sourceQuarantine],
                warnings: [{ code: 'metadata_audit_stale' }]
            }
        ));

        expect(plan.quarantine.filter((item) => item.reason === 'system_object')).toHaveLength(1);
        expect(plan.counts.sourceRows).toBe(1);
        expect(plan.counts.quarantineRecords).toBe(plan.quarantine.length);
        expect(plan.warnings).toContainEqual({ code: 'metadata_audit_stale' });
    });
});
