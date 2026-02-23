const CloudSyncUtils = require('../../cloudSyncUtils.js');

describe('cloudSyncUtils', () => {
    test('validates workers.dev URLs', () => {
        expect(CloudSyncUtils.validateWorkersDevUrl('https://example-worker.workers.dev')).toBe(true);
        expect(CloudSyncUtils.validateWorkersDevUrl('https://api.example.com')).toBe(false);
        expect(CloudSyncUtils.validateWorkersDevUrl('http://not-secure.workers.dev')).toBe(false);
    });

    test('normalizes cloud config defaults and explicit mode', () => {
        const normalized = CloudSyncUtils.normalizeCloudConfig({
            enabled: true,
            mode: 'local_only',
            workerUrl: 'https://example-worker.workers.dev/',
            apiKey: '  token123  ',
            keyPrefix: '/custom/prefix/'
        });

        expect(normalized.enabled).toBe(false);
        expect(normalized.mode).toBe('local_only');
        expect(normalized.workerUrl).toBe('https://example-worker.workers.dev');
        expect(normalized.apiKey).toBe('token123');
        expect(normalized.keyPrefix).toBe('custom/prefix');
    });

    test('falls back to legacy enabled flag when mode is missing', () => {
        const normalized = CloudSyncUtils.normalizeCloudConfig({
            enabled: true,
            workerUrl: 'https://example-worker.workers.dev'
        });

        expect(normalized.mode).toBe('dual_write');
        expect(normalized.enabled).toBe(true);
    });

    test('returns capped retry delay schedule', () => {
        expect(CloudSyncUtils.getRetryDelayMinutes(1)).toBe(1);
        expect(CloudSyncUtils.getRetryDelayMinutes(2)).toBe(5);
        expect(CloudSyncUtils.getRetryDelayMinutes(3)).toBe(15);
        expect(CloudSyncUtils.getRetryDelayMinutes(10)).toBe(720);
    });

    test('builds media object key from local final path', () => {
        const finalPath = 'GrokVault/user-123/2026-02-20_Auto/my-file.mp4';
        const objectKey = CloudSyncUtils.buildMediaObjectKeyFromFinalPath(finalPath, {
            keyPrefix: 'grok-powertools/v1',
            fallbackUserId: 'fallback'
        });

        expect(objectKey).toBe('grok-powertools/v1/users/user-123/media/2026-02-20_Auto/my-file.mp4');
    });

    test('builds metadata object keys for latest snapshots and backfill manifests', () => {
        const latestKey = CloudSyncUtils.buildMetadataObjectKey({
            keyPrefix: 'grok-powertools/v1',
            userId: 'user_1',
            kind: 'savedPrompts'
        });

        const backfillKey = CloudSyncUtils.buildMetadataObjectKey({
            keyPrefix: 'grok-powertools/v1',
            userId: 'user_1',
            kind: 'backfillManifest',
            timestamp: 1234567890
        });

        expect(latestKey).toBe('grok-powertools/v1/users/user_1/metadata/saved-prompts.latest.json');
        expect(backfillKey).toBe('grok-powertools/v1/users/user_1/metadata/backfill-manifest.1234567890.json');
    });
});
