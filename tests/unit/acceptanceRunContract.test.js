const {
    classifyVerdict,
    redactEvidence,
    validateAcceptanceManifest
} = require('../../acceptance/lib/run-contract.js');

describe('acceptance run contract', () => {
    test('validates a strict manifest without reading sensitive values', () => {
        const manifest = validateAcceptanceManifest({
            runId: 'run-20260609-001',
            laneId: 'isolated-browser',
            canaryId: 'public-image-1',
            extension: {
                id: 'abcdefghijklmnopabcdefghijklmnop',
                version: '0.2.0',
                sourcePath: '/repo',
                sourceHash: 'a'.repeat(64)
            },
            worker: {
                identityUrl: 'https://acceptance-worker.example.workers.dev/v1/acceptance/identity',
                version: '2026-06-09.1'
            },
            cloud: {
                r2Bucket: 'grok-powertools-acceptance',
                d1Database: 'grok-powertools-acceptance-db',
                d1DatabaseId: '11111111-2222-4333-8444-555555555555',
                keyPrefix: 'acceptance/run-20260609-001',
                apiKeyFingerprint: 'sha256:abc123'
            },
            browser: {
                profileMode: 'isolated',
                downloadRoot: '/tmp/grok-acceptance-downloads'
            },
            restorePlan: {
                storageKeys: ['cloudConfig', 'cloudSyncQueue'],
                sentinelRequired: true
            }
        });

        expect(manifest.cloud.keyPrefix).toBe('acceptance/run-20260609-001');
        expect(manifest.cloud).not.toHaveProperty('apiKey');
    });

    test('rejects production prefixes and missing identity fields', () => {
        expect(() => validateAcceptanceManifest({
            runId: 'run-1',
            laneId: 'existing-chrome',
            canaryId: 'image-1',
            extension: {
                id: 'abcdefghijklmnopabcdefghijklmnop',
                version: '0.2.0',
                sourcePath: '/repo',
                sourceHash: 'b'.repeat(64)
            },
            worker: {
                identityUrl: 'https://acceptance-worker.example.workers.dev/v1/acceptance/identity',
                version: '2026-06-09.1'
            },
            cloud: {
                r2Bucket: 'grok-gallery-001',
                d1Database: 'grok-powertools-db',
                d1DatabaseId: 'ad89e4bb-0b68-4c72-93d9-b90e6eb45aa6',
                keyPrefix: 'grok-powertools/v1',
                apiKeyFingerprint: 'sha256:def456'
            },
            browser: {
                profileMode: 'existing',
                downloadRoot: '/tmp/grok-acceptance-downloads'
            },
            restorePlan: {
                storageKeys: ['cloudConfig'],
                sentinelRequired: true
            }
        })).toThrow('production resource');
    });

    test('redacts sensitive values, signed URLs, browser headers, and prompt text recursively', () => {
        const redacted = redactEvidence({
            apiKey: 'sample-value',
            uploadUrl: 'https://bucket.example/key?Signature=sample',
            headers: {
                Cookie: 'x=y',
                Authorization: 'Bearer sample'
            },
            promptText: 'private prompt',
            safe: {
                objectKey: 'acceptance/run-1/users/u/media/by-asset/media_1.png'
            }
        });

        expect(redacted).toEqual({
            apiKey: '[REDACTED]',
            uploadUrl: '[REDACTED_URL]',
            headers: {
                Cookie: '[REDACTED]',
                Authorization: '[REDACTED]'
            },
            promptText: '[REDACTED]',
            safe: {
                objectKey: 'acceptance/run-1/users/u/media/by-asset/media_1.png'
            }
        });
    });

    test('classifies verdicts with contamination taking precedence', () => {
        expect(classifyVerdict({
            mutated: true,
            preflightOk: true,
            assertionsOk: true,
            safetyClean: false,
            evidenceComplete: true,
            sentinelClean: true
        })).toBe('contaminated');

        expect(classifyVerdict({
            mutated: false,
            preflightOk: false,
            assertionsOk: false,
            safetyClean: true,
            evidenceComplete: false,
            sentinelClean: false
        })).toBe('blocked');

        expect(classifyVerdict({
            mutated: true,
            preflightOk: true,
            assertionsOk: true,
            safetyClean: true,
            evidenceComplete: true,
            sentinelClean: true
        })).toBe('verified');
    });
});
