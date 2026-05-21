const CloudSyncUtils = require('../../cloudSyncUtils.js');

describe('cloudSyncUtils', () => {
    test('validates workers.dev URLs with one or more subdomain labels', () => {
        expect(CloudSyncUtils.validateWorkersDevUrl('https://grok-r2-backup-worker.greymakerxyz-grok.workers.dev')).toBe(true);
        expect(CloudSyncUtils.validateWorkersDevUrl('https://example-worker.workers.dev')).toBe(true);
        expect(CloudSyncUtils.validateWorkersDevUrl('https://api.example.com')).toBe(false);
        expect(CloudSyncUtils.validateWorkersDevUrl('https://workers.dev')).toBe(false);
        expect(CloudSyncUtils.validateWorkersDevUrl('http://not-secure.workers.dev')).toBe(false);
    });

    test('normalizes worker URLs to canonical origin', () => {
        expect(
            CloudSyncUtils.validateWorkersDevUrl(
                'https://grok-r2-backup-worker.greymakerxyz-grok.workers.dev/health'
            )
        ).toBe(true);

        const normalized = CloudSyncUtils.normalizeWorkerUrl(
            'https://grok-r2-backup-worker.greymakerxyz-grok.workers.dev/health?ping=1#anchor'
        );

        expect(normalized).toBe('https://grok-r2-backup-worker.greymakerxyz-grok.workers.dev');
        expect(CloudSyncUtils.validateWorkersDevUrl(normalized)).toBe(true);
    });

    test('normalizes cloud config defaults and explicit mode', () => {
        const normalized = CloudSyncUtils.normalizeCloudConfig({
            enabled: true,
            mode: 'local_only',
            workerUrl: 'https://example-worker.workers.dev/health',
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

    test('supports cloud_only mode normalization and local download toggle', () => {
        const normalized = CloudSyncUtils.normalizeCloudConfig({
            mode: 'cloud_only',
            enabled: false
        });

        expect(normalized.mode).toBe('cloud_only');
        expect(normalized.enabled).toBe(true);
        expect(CloudSyncUtils.isCloudEnabled(normalized)).toBe(true);
        expect(CloudSyncUtils.isLocalDownloadEnabled(normalized)).toBe(false);
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

    test('UPLOAD_STAGES has expected stage identifiers', () => {
        expect(CloudSyncUtils.UPLOAD_STAGES).toEqual({
            mediaFetch: 'media-fetch',
            presign: 'presign',
            r2Put: 'r2-put',
            healthCheck: 'health-check',
            testUpload: 'test-upload'
        });
    });

    test('isValidMediaSourceUrl accepts valid imagine-public.x.ai URLs', () => {
        expect(CloudSyncUtils.isValidMediaSourceUrl('https://imagine-public.x.ai/images/abc.png')).toBe(true);
        expect(CloudSyncUtils.isValidMediaSourceUrl('https://imagine-public.x.ai/videos/def.mp4')).toBe(true);
    });

    test('isValidMediaSourceUrl rejects HTTP, unknown domains, null/empty', () => {
        expect(CloudSyncUtils.isValidMediaSourceUrl('http://imagine-public.x.ai/images/abc.png')).toBe(false);
        expect(CloudSyncUtils.isValidMediaSourceUrl('https://example.com/image.png')).toBe(false);
        expect(CloudSyncUtils.isValidMediaSourceUrl('https://grok.com/imagine')).toBe(false);
        expect(CloudSyncUtils.isValidMediaSourceUrl(null)).toBe(false);
        expect(CloudSyncUtils.isValidMediaSourceUrl('')).toBe(false);
        expect(CloudSyncUtils.isValidMediaSourceUrl(undefined)).toBe(false);
    });

    test('buildTestUploadObjectKey returns correct users/_system/ path', () => {
        const key = CloudSyncUtils.buildTestUploadObjectKey('grok-powertools/v1');
        expect(key).toBe('grok-powertools/v1/users/_system/upload-test.txt');
    });

    test('buildTestUploadObjectKey sanitizes prefix', () => {
        expect(CloudSyncUtils.buildTestUploadObjectKey('/leading/slashes/')).toBe('leading/slashes/users/_system/upload-test.txt');
        expect(CloudSyncUtils.buildTestUploadObjectKey('')).toBe('grok-powertools/v1/users/_system/upload-test.txt');
        expect(CloudSyncUtils.buildTestUploadObjectKey(null)).toBe('grok-powertools/v1/users/_system/upload-test.txt');
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
            kind: 'backfillManifest'
        });

        expect(latestKey).toBe('grok-powertools/v1/users/user_1/metadata/saved-prompts.latest.json');
        expect(backfillKey).toBe('grok-powertools/v1/users/user_1/metadata/backfill-manifest.latest.json');
    });

    test('builds versioned backfill manifest keys by content hash only when requested', () => {
        const key = CloudSyncUtils.buildMetadataObjectKey({
            keyPrefix: 'grok-powertools/v1',
            userId: 'user_1',
            kind: 'backfillManifest',
            versionHash: 'abc123'
        });

        expect(key).toBe('grok-powertools/v1/users/user_1/metadata/backfill-manifest.abc123.json');
    });

    test('builds canonical by-asset media keys from Grok media UUIDs', () => {
        const objectKey = CloudSyncUtils.buildMediaObjectKeyForUpload({
            keyPrefix: 'grok-powertools/v1',
            userId: 'user_1',
            sourceUrl: 'https://imagine-public.x.ai/images/550e8400-e29b-41d4-a716-446655440000.png?token=secret',
            finalPath: 'GrokVault/user_1/2026-03-01_Auto/550e8400-e29b-41d4-a716-446655440000.png',
            contentType: 'image/png'
        });

        expect(objectKey).toBe('grok-powertools/v1/users/user_1/media/by-asset/media_550e8400-e29b-41d4-a716-446655440000.png');
    });

    test('uses content hash canonical identity when no stable media id exists', () => {
        const identity = CloudSyncUtils.resolveMediaAssetIdentity({
            sourceUrl: 'https://assets.grok.com/users/private/generated/generated_video.mp4?token=secret',
            finalPath: 'GrokVault/user_1/2026-03-01_Auto/generated_video.mp4',
            contentType: 'video/mp4',
            contentSha256: 'a'.repeat(64)
        });

        expect(identity.kind).toBe('content_hash');
        expect(identity.assetId).toBe(`sha256_${'a'.repeat(64)}`);
        expect(identity.sourceUrlHash).toMatch(/^url_[a-f0-9]{8}$/);
    });

    test('media dedupe key is stable across date-folder reruns for same media UUID', () => {
        const first = CloudSyncUtils.buildMediaDedupeKey({
            userId: 'user_1',
            sourceUrl: 'https://imagine-public.x.ai/images/550e8400-e29b-41d4-a716-446655440000.png',
            finalPath: 'GrokVault/user_1/2026-03-01_Auto/550e8400-e29b-41d4-a716-446655440000.png'
        });
        const second = CloudSyncUtils.buildMediaDedupeKey({
            userId: 'user_1',
            sourceUrl: 'https://imagine-public.x.ai/images/550e8400-e29b-41d4-a716-446655440000.png?cache=tomorrow',
            finalPath: 'GrokVault/user_1/2026-03-02_Auto/550e8400-e29b-41d4-a716-446655440000.png'
        });

        expect(second).toBe(first);
    });
});
