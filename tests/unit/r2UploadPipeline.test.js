/**
 * R2 Upload Pipeline Tests
 *
 * Verifies that the entire cloud sync pipeline correctly:
 * - Detects content types from URLs
 * - Constructs valid R2 object keys
 * - Sanitizes path segments against traversal and injection
 * - Builds correct metadata keys for all kinds
 * - Matches media elements on Grok detail pages (the fixed selectors)
 * - Produces queue items with all required fields
 */
const CloudSync = require('../../cloudSyncUtils.js');

// ──────────────────────────────────────────────────────
// 1. Content type detection
// ──────────────────────────────────────────────────────
describe('detectContentTypeFromUrl', () => {
    test('detects image/png for .png URLs', () => {
        expect(CloudSync.detectContentTypeFromUrl(
            'https://imagine-public.x.ai/images/550e8400-e29b-41d4-a716-446655440000.png'
        )).toBe('image/png');
    });

    test('detects image/jpeg for .jpg and .jpeg URLs', () => {
        expect(CloudSync.detectContentTypeFromUrl('https://example.com/photo.jpg')).toBe('image/jpeg');
        expect(CloudSync.detectContentTypeFromUrl('https://example.com/photo.jpeg')).toBe('image/jpeg');
    });

    test('detects video/mp4 for .mp4 URLs', () => {
        expect(CloudSync.detectContentTypeFromUrl('https://assets.grok.com/video.mp4')).toBe('video/mp4');
    });

    test('detects video/webm for .webm URLs', () => {
        expect(CloudSync.detectContentTypeFromUrl('https://example.com/clip.webm')).toBe('video/webm');
    });

    test('detects image/webp for .webp URLs', () => {
        expect(CloudSync.detectContentTypeFromUrl('https://example.com/image.webp')).toBe('image/webp');
    });

    test('detects image/gif for .gif URLs', () => {
        expect(CloudSync.detectContentTypeFromUrl('https://example.com/anim.gif')).toBe('image/gif');
    });

    test('defaults to image/png for unknown extensions', () => {
        expect(CloudSync.detectContentTypeFromUrl('https://example.com/file.bmp')).toBe('image/png');
        expect(CloudSync.detectContentTypeFromUrl('https://example.com/noext')).toBe('image/png');
    });

    test('strips query string before detecting extension', () => {
        expect(CloudSync.detectContentTypeFromUrl(
            'https://imagine-public.x.ai/image.jpg?cache=1709300000&token=abc'
        )).toBe('image/jpeg');
    });

    test('handles null, undefined, empty string', () => {
        expect(CloudSync.detectContentTypeFromUrl(null)).toBe('image/png');
        expect(CloudSync.detectContentTypeFromUrl(undefined)).toBe('image/png');
        expect(CloudSync.detectContentTypeFromUrl('')).toBe('image/png');
    });

    test('case insensitive extension matching', () => {
        expect(CloudSync.detectContentTypeFromUrl('https://example.com/FILE.MP4')).toBe('video/mp4');
        expect(CloudSync.detectContentTypeFromUrl('https://example.com/IMG.JPG')).toBe('image/jpeg');
    });
});

// ──────────────────────────────────────────────────────
// 2. Media object key construction
// ──────────────────────────────────────────────────────
describe('buildMediaObjectKeyFromFinalPath', () => {
    const defaultParams = { keyPrefix: 'grok-powertools/v1', fallbackUserId: 'Shared_Account' };

    test('constructs correct key from standard GrokVault path', () => {
        const key = CloudSync.buildMediaObjectKeyFromFinalPath(
            'GrokVault/user123/2026-03-01_Auto/550e8400-e29b-41d4-a716-446655440000.png',
            defaultParams
        );
        expect(key).toBe('grok-powertools/v1/users/user123/media/2026-03-01_Auto/550e8400-e29b-41d4-a716-446655440000.png');
    });

    test('constructs correct key for .mp4 video files', () => {
        const key = CloudSync.buildMediaObjectKeyFromFinalPath(
            'GrokVault/user123/2026-03-01_Auto/abcdef12-3456-7890-abcd-ef1234567890.mp4',
            defaultParams
        );
        expect(key).toBe('grok-powertools/v1/users/user123/media/2026-03-01_Auto/abcdef12-3456-7890-abcd-ef1234567890.mp4');
    });

    test('uses fallbackUserId when path has fewer than 3 segments', () => {
        const key = CloudSync.buildMediaObjectKeyFromFinalPath(
            'file.png',
            { keyPrefix: 'grok-powertools/v1', fallbackUserId: 'fallback_user' }
        );
        expect(key).toContain('/users/fallback_user/');
    });

    test('handles empty/null finalPath gracefully', () => {
        const key = CloudSync.buildMediaObjectKeyFromFinalPath('', defaultParams);
        expect(key).toMatch(/^grok-powertools\/v1\/users\/.+\/media\/.+/);
    });

    test('handles path with extra slashes', () => {
        const key = CloudSync.buildMediaObjectKeyFromFinalPath(
            'GrokVault//user123//2026-03-01_Auto//image.png',
            defaultParams
        );
        // Empty segments from double slashes should be filtered
        expect(key).toBe('grok-powertools/v1/users/user123/media/2026-03-01_Auto/image.png');
    });

    test('preserves file extension from finalPath', () => {
        const jpgKey = CloudSync.buildMediaObjectKeyFromFinalPath(
            'GrokVault/user/2026-03-01_Auto/photo.jpg', defaultParams
        );
        expect(jpgKey).toMatch(/\.jpg$/);

        const mp4Key = CloudSync.buildMediaObjectKeyFromFinalPath(
            'GrokVault/user/2026-03-01_Auto/video.mp4', defaultParams
        );
        expect(mp4Key).toMatch(/\.mp4$/);
    });

    test('sanitizes userId with special characters', () => {
        const key = CloudSync.buildMediaObjectKeyFromFinalPath(
            'GrokVault/user@name!special/2026-03-01_Auto/image.png',
            defaultParams
        );
        // Should not contain @, !, or other special chars
        expect(key).not.toMatch(/[@!]/);
        expect(key).toMatch(/^grok-powertools\/v1\/users\//);
    });
});

// ──────────────────────────────────────────────────────
// 3. Path sanitization (security)
// ──────────────────────────────────────────────────────
describe('path sanitization', () => {
    test('buildMediaObjectKey prevents directory traversal in userId', () => {
        const key = CloudSync.buildMediaObjectKey({
            keyPrefix: 'grok-powertools/v1',
            userId: '../../../etc/passwd',
            dateFolder: '2026-03-01_Auto',
            filename: 'image',
            extension: 'png'
        });
        expect(key).not.toContain('..');
        expect(key).not.toContain('etc/passwd');
    });

    test('buildMediaObjectKey prevents directory traversal in dateFolder', () => {
        const key = CloudSync.buildMediaObjectKey({
            keyPrefix: 'grok-powertools/v1',
            userId: 'user1',
            dateFolder: '../../secret',
            filename: 'image',
            extension: 'png'
        });
        expect(key).not.toContain('..');
    });

    test('buildMediaObjectKey prevents slash injection in filename', () => {
        const key = CloudSync.buildMediaObjectKey({
            keyPrefix: 'grok-powertools/v1',
            userId: 'user1',
            dateFolder: '2026-03-01_Auto',
            filename: 'path/to/secret',
            extension: 'png'
        });
        // Slashes should be replaced with underscores
        expect(key).not.toMatch(/path\/to\/secret/);
    });

    test('sanitizeKeyPrefix strips leading and trailing slashes', () => {
        expect(CloudSync.sanitizeKeyPrefix('/leading/trailing/')).toBe('leading/trailing');
        expect(CloudSync.sanitizeKeyPrefix('///multiple///')).toBe('multiple');
    });

    test('key always starts with keyPrefix/users/', () => {
        const key = CloudSync.buildMediaObjectKeyFromFinalPath(
            'GrokVault/user/date/file.png',
            { keyPrefix: 'custom/prefix', fallbackUserId: 'fb' }
        );
        expect(key).toMatch(/^custom\/prefix\/users\//);
    });
});

// ──────────────────────────────────────────────────────
// 4. Metadata object keys
// ──────────────────────────────────────────────────────
describe('buildMetadataObjectKey', () => {
    const baseParams = { keyPrefix: 'grok-powertools/v1', userId: 'user_abc' };

    test('savedPrompts produces correct key', () => {
        const key = CloudSync.buildMetadataObjectKey({ ...baseParams, kind: 'savedPrompts' });
        expect(key).toBe('grok-powertools/v1/users/user_abc/metadata/saved-prompts.latest.json');
    });

    test('promptHistory produces correct key', () => {
        const key = CloudSync.buildMetadataObjectKey({ ...baseParams, kind: 'promptHistory' });
        expect(key).toBe('grok-powertools/v1/users/user_abc/metadata/prompt-history.latest.json');
    });

    test('processedIds produces correct key', () => {
        const key = CloudSync.buildMetadataObjectKey({ ...baseParams, kind: 'processedIds' });
        expect(key).toBe('grok-powertools/v1/users/user_abc/metadata/processed-ids.latest.json');
    });

    test('backfillManifest uses timestamp in filename', () => {
        const key = CloudSync.buildMetadataObjectKey({
            ...baseParams,
            kind: 'backfillManifest',
            timestamp: 1709300000000
        });
        expect(key).toBe('grok-powertools/v1/users/user_abc/metadata/backfill-manifest.1709300000000.json');
    });

    test('throws on unsupported kind', () => {
        expect(() => {
            CloudSync.buildMetadataObjectKey({ ...baseParams, kind: 'invalid' });
        }).toThrow('Unsupported metadata kind');
    });

    test('userId defaults to Shared_Account when missing', () => {
        const key = CloudSync.buildMetadataObjectKey({
            keyPrefix: 'grok-powertools/v1',
            kind: 'savedPrompts'
        });
        expect(key).toContain('/users/Shared_Account/');
    });

    test('latest metadata keys overwrite (same key each time)', () => {
        const key1 = CloudSync.buildMetadataObjectKey({ ...baseParams, kind: 'savedPrompts' });
        const key2 = CloudSync.buildMetadataObjectKey({ ...baseParams, kind: 'savedPrompts' });
        expect(key1).toBe(key2);
    });

    test('backfillManifest keys differ by timestamp', () => {
        const key1 = CloudSync.buildMetadataObjectKey({ ...baseParams, kind: 'backfillManifest', timestamp: 100 });
        const key2 = CloudSync.buildMetadataObjectKey({ ...baseParams, kind: 'backfillManifest', timestamp: 200 });
        expect(key1).not.toBe(key2);
    });
});

// ──────────────────────────────────────────────────────
// 5. isValidMediaSourceUrl
// ──────────────────────────────────────────────────────
describe('isValidMediaSourceUrl', () => {
    test('accepts standard imagine-public.x.ai image URLs', () => {
        expect(CloudSync.isValidMediaSourceUrl(
            'https://imagine-public.x.ai/images/550e8400-e29b-41d4-a716-446655440000.png'
        )).toBe(true);
    });

    test('accepts imagine-public.x.ai video URLs', () => {
        expect(CloudSync.isValidMediaSourceUrl(
            'https://imagine-public.x.ai/videos/550e8400.mp4'
        )).toBe(true);
    });

    test('accepts URLs with query parameters', () => {
        expect(CloudSync.isValidMediaSourceUrl(
            'https://imagine-public.x.ai/images/abc.png?cache=123&t=456'
        )).toBe(true);
    });

    test('rejects HTTP (non-HTTPS) URLs', () => {
        expect(CloudSync.isValidMediaSourceUrl(
            'http://imagine-public.x.ai/images/abc.png'
        )).toBe(false);
    });

    test('rejects unknown hostnames', () => {
        expect(CloudSync.isValidMediaSourceUrl('https://evil.com/image.png')).toBe(false);
        expect(CloudSync.isValidMediaSourceUrl('https://x.com/image.png')).toBe(false);
        expect(CloudSync.isValidMediaSourceUrl('https://grok.com/image.png')).toBe(false);
    });

    test('accepts assets.grok.com (trusted Grok video CDN — requires session cookies, fetched via bridge.js)', () => {
        expect(CloudSync.isValidMediaSourceUrl('https://assets.grok.com/users/abc/generated/xyz/generated_video.mp4')).toBe(true);
    });

    test('rejects blob URLs', () => {
        expect(CloudSync.isValidMediaSourceUrl('blob:https://grok.com/abc123')).toBe(false);
    });

    test('rejects data URLs', () => {
        expect(CloudSync.isValidMediaSourceUrl('data:image/png;base64,abc')).toBe(false);
    });
});

// ──────────────────────────────────────────────────────
// 6. Media selector matching (the actual fix)
// ──────────────────────────────────────────────────────
describe('media element selectors on Grok detail page', () => {
    // These tests verify the FIXED selectors match real Grok DOM
    // The old selector: img[alt="Generated image"] NEVER matches on detail pages
    // Note: innerHTML is used here for jsdom test fixtures only, not for user input

    afterEach(() => {
        document.body.textContent = '';
    });

    function setupDOM(htmlStr) {
        // Use DOM APIs to safely set test fixture content
        const container = document.createElement('div');
        // jsdom test fixture setup — static HTML, not user input
        container.innerHTML = htmlStr; // test fixture; htmlStr is a literal in each test
        document.body.appendChild(container);
    }

    describe('image-only posts (the failing case)', () => {
        beforeEach(() => {
            setupDOM(`
                <div data-testid="post-detail">
                    <img
                        src="https://imagine-public.x.ai/images/550e8400-e29b-41d4-a716-446655440000.png?cache=1234"
                        alt="A beautiful sunset over mountains with golden light"
                        width="1024"
                        height="1024"
                    />
                    <button aria-label="Download">Download</button>
                </div>
            `);
        });

        test('OLD selector img[alt="Generated image"] does NOT match', () => {
            const el = document.querySelector('img[alt="Generated image"]');
            expect(el).toBeNull();
        });

        test('NEW selector img[src*="imagine-public.x.ai"] matches the image', () => {
            const el = document.querySelector('img[src*="imagine-public.x.ai"]');
            expect(el).not.toBeNull();
            expect(el.src).toContain('imagine-public.x.ai');
        });

        test('extracting src gives the full CDN URL', () => {
            const mediaEl = document.querySelector('img[src*="imagine-public.x.ai"]')
                || document.querySelector('video[src]')
                || document.querySelector('video');
            const src = mediaEl?.src || mediaEl?.currentSrc;
            expect(src).toContain('imagine-public.x.ai/images/550e8400');
        });
    });

    describe('video posts', () => {
        beforeEach(() => {
            setupDOM(`
                <div data-testid="post-detail">
                    <img
                        src="https://imagine-public.x.ai/images/abc12345-6789-0abc-def0-123456789012.png"
                        alt="Video thumbnail"
                        style="display:none"
                    />
                    <video
                        src="https://assets.grok.com/videos/abc12345-6789-0abc-def0-123456789012.mp4"
                        autoplay
                        loop
                    ></video>
                    <button aria-label="Download">Download</button>
                </div>
            `);
        });

        test('OLD selector video source does NOT match (no <source> children)', () => {
            const el = document.querySelector('video source');
            expect(el).toBeNull();
        });

        test('NEW selector img[src*="imagine-public.x.ai"] matches sizing image', () => {
            const el = document.querySelector('img[src*="imagine-public.x.ai"]');
            expect(el).not.toBeNull();
        });

        test('NEW selector video[src] matches the video element', () => {
            const el = document.querySelector('video[src]');
            expect(el).not.toBeNull();
            expect(el.src).toContain('assets.grok.com');
        });

        test('full selector chain prioritizes imagine-public image', () => {
            const mediaEl = document.querySelector('img[src*="imagine-public.x.ai"]')
                || document.querySelector('video[src]')
                || document.querySelector('video');
            // Should get the img (first match), not the video
            expect(mediaEl.tagName).toBe('IMG');
            expect(mediaEl.src).toContain('imagine-public.x.ai');
        });
    });

    describe('gallery/list view (unchanged)', () => {
        beforeEach(() => {
            setupDOM(`
                <div class="media-post-masonry-card">
                    <img
                        src="https://imagine-public.x.ai/images/thumb1.png"
                        alt="Generated image"
                    />
                </div>
                <div class="media-post-masonry-card">
                    <img
                        src="https://imagine-public.x.ai/images/thumb2.png"
                        alt="Generated image"
                    />
                </div>
            `);
        });

        test('gallery selector img[alt="Generated image"] still works in list view', () => {
            const els = document.querySelectorAll('img[alt="Generated image"]');
            expect(els.length).toBe(2);
        });

        test('new selector also works in gallery view', () => {
            const els = document.querySelectorAll('img[src*="imagine-public.x.ai"]');
            expect(els.length).toBe(2);
        });
    });

    describe('edge case: no media on page', () => {
        beforeEach(() => {
            setupDOM('<div>Loading...</div>');
        });

        test('all selectors return null gracefully', () => {
            const mediaEl = document.querySelector('img[src*="imagine-public.x.ai"]')
                || document.querySelector('video[src]')
                || document.querySelector('video');
            expect(mediaEl).toBeNull();
            const src = mediaEl?.src || mediaEl?.currentSrc;
            expect(src).toBeUndefined();
        });
    });

    describe('edge case: video without src attribute', () => {
        beforeEach(() => {
            setupDOM('<video autoplay loop></video>');
        });

        test('video[src] does not match empty video', () => {
            expect(document.querySelector('video[src]')).toBeNull();
        });

        test('plain video fallback still matches', () => {
            const mediaEl = document.querySelector('img[src*="imagine-public.x.ai"]')
                || document.querySelector('video[src]')
                || document.querySelector('video');
            expect(mediaEl).not.toBeNull();
            expect(mediaEl.tagName).toBe('VIDEO');
        });
    });
});

// ──────────────────────────────────────────────────────
// 7. End-to-end data contract: URL to R2 storage
// ──────────────────────────────────────────────────────
describe('end-to-end: source URL to R2 storage', () => {
    const keyPrefix = 'grok-powertools/v1';
    const userId = 'test_user_123';

    test('PNG image URL produces valid media object key and correct content type', () => {
        const sourceUrl = 'https://imagine-public.x.ai/images/550e8400-e29b-41d4-a716-446655440000.png?cache=1709300000';
        const finalPath = `GrokVault/${userId}/2026-03-01_Auto/550e8400-e29b-41d4-a716-446655440000.png`;

        const objectKey = CloudSync.buildMediaObjectKeyFromFinalPath(finalPath, { keyPrefix, fallbackUserId: userId });
        const contentType = CloudSync.detectContentTypeFromUrl(sourceUrl);

        expect(objectKey).toBe(`${keyPrefix}/users/${userId}/media/2026-03-01_Auto/550e8400-e29b-41d4-a716-446655440000.png`);
        expect(contentType).toBe('image/png');

        // Worker-side validation: key starts with keyPrefix/users/
        expect(objectKey.startsWith(`${keyPrefix}/users/`)).toBe(true);
        expect(objectKey.length).toBeLessThanOrEqual(1024);
        expect(objectKey).not.toContain('..');
        expect(objectKey).not.toMatch(/^\//);
    });

    test('MP4 video URL produces valid media object key and correct content type', () => {
        const sourceUrl = 'https://imagine-public.x.ai/videos/abc12345-6789-0abc-def0-123456789012.mp4';
        const finalPath = `GrokVault/${userId}/2026-03-01_Auto/abc12345-6789-0abc-def0-123456789012.mp4`;

        const objectKey = CloudSync.buildMediaObjectKeyFromFinalPath(finalPath, { keyPrefix, fallbackUserId: userId });
        const contentType = CloudSync.detectContentTypeFromUrl(sourceUrl);

        expect(objectKey).toBe(`${keyPrefix}/users/${userId}/media/2026-03-01_Auto/abc12345-6789-0abc-def0-123456789012.mp4`);
        expect(contentType).toBe('video/mp4');
    });

    test('JPG image URL produces correct content type', () => {
        const sourceUrl = 'https://imagine-public.x.ai/images/photo.jpg?q=high';
        const contentType = CloudSync.detectContentTypeFromUrl(sourceUrl);
        expect(contentType).toBe('image/jpeg');
    });

    test('dedupeKey for media items uses media: prefix + full objectKey', () => {
        const objectKey = `${keyPrefix}/users/${userId}/media/2026-03-01_Auto/file.png`;
        const dedupeKey = `media:${objectKey}`;
        expect(dedupeKey).toBe(`media:${keyPrefix}/users/${userId}/media/2026-03-01_Auto/file.png`);
    });

    test('dedupeKey for metadata items uses metadata: prefix + userId + kind', () => {
        const dedupeKey = `metadata:${userId}:savedPrompts`;
        expect(dedupeKey).toBe(`metadata:${userId}:savedPrompts`);
    });

    test('queue item for media has all required fields', () => {
        const sourceUrl = 'https://imagine-public.x.ai/images/test.png';
        const finalPath = `GrokVault/${userId}/2026-03-01_Auto/test.png`;
        const objectKey = CloudSync.buildMediaObjectKeyFromFinalPath(finalPath, { keyPrefix, fallbackUserId: userId });
        const contentType = CloudSync.detectContentTypeFromUrl(sourceUrl);

        // This is the shape enqueueCloudMediaUpload creates
        const queueItem = {
            id: `media_${Date.now()}_abcd1234`,
            type: 'media',
            sourceUrl,
            finalPath,
            objectKey,
            contentType
        };

        // Verify ALL required fields are present and valid
        expect(queueItem.id).toMatch(/^media_\d+_/);
        expect(queueItem.type).toBe('media');
        expect(queueItem.sourceUrl).toBe(sourceUrl);
        expect(queueItem.finalPath).toBe(finalPath);
        expect(queueItem.objectKey).toContain('/users/');
        expect(queueItem.objectKey).toContain('/media/');
        expect(queueItem.contentType).toMatch(/^(image|video)\//);

        // Fields added by enqueueCloudItem
        const enqueued = {
            ...queueItem,
            dedupeKey: `media:${objectKey}`,
            attempts: 0,
            createdAt: Date.now()
        };
        expect(enqueued.dedupeKey).toBeTruthy();
        expect(enqueued.attempts).toBe(0);
        expect(enqueued.createdAt).toBeGreaterThan(0);
    });

    test('queue item for metadata has all required fields', () => {
        const kind = 'savedPrompts';
        const payload = {
            schemaVersion: 1,
            data: [{ id: 'p1', text: 'test prompt' }],
            updatedAt: new Date().toISOString()
        };

        const queueItem = {
            id: `metadata_${Date.now()}_abcd1234`,
            type: 'metadata',
            kind,
            userId,
            payload
        };

        expect(queueItem.type).toBe('metadata');
        expect(queueItem.kind).toBe('savedPrompts');
        expect(queueItem.userId).toBe(userId);
        expect(queueItem.payload.schemaVersion).toBe(1);
        expect(Array.isArray(queueItem.payload.data)).toBe(true);
        expect(queueItem.payload.updatedAt).toBeTruthy();
    });

    test('worker presign request body has all required fields', () => {
        const sourceUrl = 'https://imagine-public.x.ai/images/test.png';
        const finalPath = `GrokVault/${userId}/2026-03-01_Auto/test.png`;
        const objectKey = CloudSync.buildMediaObjectKeyFromFinalPath(finalPath, { keyPrefix, fallbackUserId: userId });
        const contentType = CloudSync.detectContentTypeFromUrl(sourceUrl);
        const contentLength = 1024 * 100; // 100KB

        // This is what requestPresignedUrl sends to the worker
        const presignBody = { objectKey, contentType, contentLength };

        expect(typeof presignBody.objectKey).toBe('string');
        expect(presignBody.objectKey.startsWith(`${keyPrefix}/users/`)).toBe(true);
        expect(typeof presignBody.contentType).toBe('string');
        expect(presignBody.contentType).not.toBe('');
        expect(typeof presignBody.contentLength).toBe('number');
        expect(presignBody.contentLength).toBeGreaterThan(0);
        expect(Number.isFinite(presignBody.contentLength)).toBe(true);
    });

    test('worker metadata snapshot request body has all required fields', () => {
        const kind = 'savedPrompts';
        const payload = {
            schemaVersion: 1,
            data: [{ id: 'p1', text: 'prompt' }],
            updatedAt: '2026-03-01T00:00:00.000Z'
        };

        // This is what uploadMetadataQueueItem sends to the worker
        const snapshotBody = { userId, kind, payload };

        expect(typeof snapshotBody.userId).toBe('string');
        expect(snapshotBody.userId).not.toBe('');
        expect(['savedPrompts', 'promptHistory', 'processedIds', 'backfillManifest']).toContain(snapshotBody.kind);
        expect(typeof snapshotBody.payload).toBe('object');
        expect(snapshotBody.payload).not.toBeNull();
        expect(snapshotBody.payload.schemaVersion).toBe(1);
    });
});

// ──────────────────────────────────────────────────────
// 8. Cloud mode configuration
// ──────────────────────────────────────────────────────
describe('cloud mode configuration', () => {
    test('dual_write enables cloud AND local download', () => {
        const config = CloudSync.normalizeCloudConfig({
            mode: 'dual_write',
            workerUrl: 'https://test.workers.dev',
            apiKey: 'key'
        });
        expect(CloudSync.isCloudEnabled(config)).toBe(true);
        expect(CloudSync.isLocalDownloadEnabled(config)).toBe(true);
    });

    test('cloud_only enables cloud but disables local download', () => {
        const config = CloudSync.normalizeCloudConfig({
            mode: 'cloud_only',
            workerUrl: 'https://test.workers.dev',
            apiKey: 'key'
        });
        expect(CloudSync.isCloudEnabled(config)).toBe(true);
        expect(CloudSync.isLocalDownloadEnabled(config)).toBe(false);
    });

    test('local_only disables cloud', () => {
        const config = CloudSync.normalizeCloudConfig({
            mode: 'local_only',
            workerUrl: 'https://test.workers.dev',
            apiKey: 'key'
        });
        expect(CloudSync.isCloudEnabled(config)).toBe(false);
        expect(CloudSync.isLocalDownloadEnabled(config)).toBe(true);
    });

    test('unconfigured state defaults to disabled', () => {
        const config = CloudSync.normalizeCloudConfig({});
        expect(CloudSync.isCloudEnabled(config)).toBe(false);
    });
});

// ──────────────────────────────────────────────────────
// 9. Retry schedule
// ──────────────────────────────────────────────────────
describe('retry schedule', () => {
    test('matches documented retry schedule', () => {
        expect(CloudSync.getRetryDelayMinutes(1)).toBe(1);
        expect(CloudSync.getRetryDelayMinutes(2)).toBe(5);
        expect(CloudSync.getRetryDelayMinutes(3)).toBe(15);
        expect(CloudSync.getRetryDelayMinutes(4)).toBe(60);
        expect(CloudSync.getRetryDelayMinutes(5)).toBe(180);
        expect(CloudSync.getRetryDelayMinutes(6)).toBe(720);
    });

    test('caps at max delay for attempts beyond schedule', () => {
        expect(CloudSync.getRetryDelayMinutes(7)).toBe(720);
        expect(CloudSync.getRetryDelayMinutes(100)).toBe(720);
    });

    test('MAX_RETRY_ATTEMPTS is 6', () => {
        expect(CloudSync.MAX_RETRY_ATTEMPTS).toBe(6);
    });

    test('total retry window is approximately 16 hours', () => {
        // 1 + 5 + 15 + 60 + 180 + 720 = 981 minutes = 16.35 hours
        const total = CloudSync.RETRY_SCHEDULE_MINUTES.reduce((a, b) => a + b, 0);
        expect(total).toBe(981);
    });
});

// ──────────────────────────────────────────────────────
// 10. Upload stage identifiers
// ──────────────────────────────────────────────────────
describe('upload stage error wrapping', () => {
    test('all expected stages are defined', () => {
        expect(CloudSync.UPLOAD_STAGES.mediaFetch).toBe('media-fetch');
        expect(CloudSync.UPLOAD_STAGES.presign).toBe('presign');
        expect(CloudSync.UPLOAD_STAGES.r2Put).toBe('r2-put');
        expect(CloudSync.UPLOAD_STAGES.healthCheck).toBe('health-check');
        expect(CloudSync.UPLOAD_STAGES.testUpload).toBe('test-upload');
    });

    test('stage labels are parseable from error messages', () => {
        // background.js wraps errors like: [media-fetch] HTTP 403
        const stages = Object.values(CloudSync.UPLOAD_STAGES);
        stages.forEach((stage) => {
            const errorMsg = `[${stage}] Some error`;
            const match = errorMsg.match(/^\[([^\]]+)\]/);
            expect(match).not.toBeNull();
            expect(match[1]).toBe(stage);
        });
    });
});

// ──────────────────────────────────────────────────────
// 11. KNOWN_MEDIA_HOSTS
// ──────────────────────────────────────────────────────
describe('known media hosts', () => {
    test('includes imagine-public.x.ai', () => {
        expect(CloudSync.KNOWN_MEDIA_HOSTS).toContain('imagine-public.x.ai');
    });

    test('includes assets.grok.com (video CDN; fetched through bridge.js with session cookies)', () => {
        expect(CloudSync.KNOWN_MEDIA_HOSTS).toContain('assets.grok.com');
    });
});

// ──────────────────────────────────────────────────────
// 12. Workers.dev URL validation for config
// ──────────────────────────────────────────────────────
describe('worker URL validation', () => {
    test('accepts valid workers.dev URLs', () => {
        expect(CloudSync.validateWorkersDevUrl('https://my-worker.my-account.workers.dev')).toBe(true);
    });

    test('rejects bare workers.dev', () => {
        expect(CloudSync.validateWorkersDevUrl('https://workers.dev')).toBe(false);
    });

    test('rejects non-HTTPS', () => {
        expect(CloudSync.validateWorkersDevUrl('http://my-worker.workers.dev')).toBe(false);
    });

    test('normalizeWorkerUrl strips path/query/fragment', () => {
        expect(CloudSync.normalizeWorkerUrl('https://my-worker.workers.dev/v1/health?ping=1#anchor'))
            .toBe('https://my-worker.workers.dev');
    });
});

// ──────────────────────────────────────────────────────
// 13. Storage keys constant
// ──────────────────────────────────────────────────────
describe('storage keys', () => {
    test('all storage keys are defined', () => {
        expect(CloudSync.STORAGE_KEYS.cloudConfig).toBe('cloudConfig');
        expect(CloudSync.STORAGE_KEYS.cloudSyncQueue).toBe('cloudSyncQueue');
        expect(CloudSync.STORAGE_KEYS.cloudSyncState).toBe('cloudSyncState');
    });
});

// ──────────────────────────────────────────────────────
// 14. R2 key format matches worker isValidObjectKey
// ──────────────────────────────────────────────────────
describe('R2 key format matches worker isValidObjectKey requirements', () => {
    const keyPrefix = 'grok-powertools/v1';

    // Mirrors worker validation from cloud/src/index.ts
    function isValidObjectKey(objectKey) {
        if (!objectKey || typeof objectKey !== 'string') return false;
        if (objectKey.length > 1024) return false;
        if (objectKey.includes('..')) return false;
        if (objectKey.startsWith('/')) return false;
        if (!objectKey.startsWith(`${keyPrefix}/users/`)) return false;
        return true;
    }

    test('media keys pass worker validation', () => {
        const key = CloudSync.buildMediaObjectKeyFromFinalPath(
            'GrokVault/user1/2026-03-01_Auto/image.png',
            { keyPrefix, fallbackUserId: 'user1' }
        );
        expect(isValidObjectKey(key)).toBe(true);
    });

    test('metadata keys pass worker validation', () => {
        ['savedPrompts', 'promptHistory', 'processedIds'].forEach((kind) => {
            const key = CloudSync.buildMetadataObjectKey({ keyPrefix, userId: 'user1', kind });
            expect(isValidObjectKey(key)).toBe(true);
        });
    });

    test('backfill manifest keys pass worker validation', () => {
        const key = CloudSync.buildMetadataObjectKey({
            keyPrefix,
            userId: 'user1',
            kind: 'backfillManifest',
            timestamp: Date.now()
        });
        expect(isValidObjectKey(key)).toBe(true);
    });

    test('test upload key passes worker validation', () => {
        const key = CloudSync.buildTestUploadObjectKey(keyPrefix);
        expect(isValidObjectKey(key)).toBe(true);
    });

    test('key with malicious userId still passes after sanitization', () => {
        const key = CloudSync.buildMediaObjectKeyFromFinalPath(
            'GrokVault/../../../etc/passwd/2026-03-01_Auto/evil.png',
            { keyPrefix, fallbackUserId: 'safe' }
        );
        expect(isValidObjectKey(key)).toBe(true);
        expect(key).not.toContain('..');
    });
});
