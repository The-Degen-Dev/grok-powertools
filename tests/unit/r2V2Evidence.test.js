const { buildEvidenceInventory } = require('../../tools/r2-v2/evidence-model');

const UUID = '11111111-1111-4111-8111-111111111111';
const TARGET = `grok-powertools/v1/users/greymaker/media/by-asset/media_${UUID}.mp4`;
const SIDECAR = `${TARGET}.prompt.json`;
const EVIDENCE_SHA = 'a'.repeat(64);
const SIDECAR_PROMPT_SHA = 'b'.repeat(64);
const INDEX_PROMPT_SHA = 'c'.repeat(64);

function input(overrides = {}) {
    return {
        sourceObjects: [
            { key: SIDECAR, size: 80, pathClass: 'prompt-sidecar', isMedia: false }
        ],
        nonMediaHashes: [
            { objectKey: SIDECAR, sha256: EVIDENCE_SHA, bytesRead: 80, status: 'ok' }
        ],
        priorMetadataObjects: [
            { objectKey: SIDECAR, sha256: EVIDENCE_SHA, size: 80, parseStatus: 'ok' }
        ],
        metadataReferences: [],
        promptSidecars: [{
            objectKey: SIDECAR,
            targetKey: TARGET,
            targetExists: true,
            promptPresent: true,
            rawPromptSha256: SIDECAR_PROMPT_SHA,
            issues: ['asset_id_missing'],
            status: 'ok'
        }],
        promptComparisons: [],
        assetMetadataSidecars: [],
        canonicalStorageRows: [],
        canonicalPromptRows: [],
        ...overrides
    };
}

describe('Grok Gallery v2 evidence adapter', () => {
    test('links a sidecar only through its exact canonical target key', () => {
        const result = buildEvidenceInventory(input());

        expect(result.evidenceObjects).toEqual([
            expect.objectContaining({
                objectKey: SIDECAR,
                sha256: EVIDENCE_SHA,
                parseStatus: 'ok'
            })
        ]);
        expect(result.evidenceLinks).toEqual([
            expect.objectContaining({
                assetId: UUID,
                evidenceSha256: EVIDENCE_SHA,
                promptSha256: SIDECAR_PROMPT_SHA,
                status: 'valid'
            })
        ]);
    });

    test('turns a canonical D1 prompt disagreement into conflict evidence', () => {
        const result = buildEvidenceInventory(input({
            promptComparisons: [{
                targetKey: TARGET,
                sidecarPromptMatchesCanonicalEvidence: false,
                expectedPromptHashes: 1
            }],
            canonicalStorageRows: [{
                object_key: TARGET,
                prompt_ref_ids_json: '["prompt-1"]'
            }],
            canonicalPromptRows: [{
                prompt_ref_id: 'prompt-1',
                prompt_sha256: INDEX_PROMPT_SHA,
                original_prompt_sha256: null
            }]
        }));

        expect(result.evidenceLinks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                assetId: UUID,
                promptSha256: SIDECAR_PROMPT_SHA,
                status: 'valid'
            }),
            expect.objectContaining({
                assetId: UUID,
                evidenceSha256: null,
                promptSha256: INDEX_PROMPT_SHA,
                status: 'conflict',
                issues: ['d1_prompt_mismatch']
            })
        ]));
    });

    test('does not trust prior parsing when fresh evidence bytes changed', () => {
        const changedSha = 'd'.repeat(64);
        const result = buildEvidenceInventory(input({
            nonMediaHashes: [
                { objectKey: SIDECAR, sha256: changedSha, bytesRead: 80, status: 'ok' }
            ]
        }));

        expect(result.evidenceObjects[0]).toMatchObject({
            sha256: changedSha,
            parseStatus: 'unverified'
        });
        expect(result.evidenceLinks).toHaveLength(0);
        expect(result.warnings).toEqual([
            expect.objectContaining({ code: 'metadata_audit_stale' })
        ]);
    });

    test('quarantines system and out-of-prefix source objects logically', () => {
        const result = buildEvidenceInventory(input({
            sourceObjects: [
                ...input().sourceObjects,
                { key: 'grok-powertools/v1/users/greymaker/_system/upload-test.bin', pathClass: 'system', isMedia: false },
                { key: 'unexpected-object', pathClass: 'out-of-prefix', isMedia: false }
            ]
        }));

        expect(result.sourceQuarantine).toEqual([
            expect.objectContaining({ reason: 'system_object' }),
            expect.objectContaining({ reason: 'out_of_prefix_object' })
        ]);
    });
});
