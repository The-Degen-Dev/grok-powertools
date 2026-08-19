const {
    classifyMediaSignature,
    classifySourceObjectKey,
    listingFingerprint,
    objectFingerprint,
    selectPrimaryMediaStream,
    selectBlobRepresentatives,
    stableListingsMatch
} = require('../../tools/r2-v2/snapshot-model');

function listed(overrides = {}) {
    return {
        key: 'grok-powertools/v1/users/greymaker/media/by-asset/media_a.mp4',
        size: 100,
        etag: 'etag-a',
        uploadedAt: '2026-08-19T00:00:00.000Z',
        pathClass: 'canonical-media',
        ...overrides
    };
}

describe('Grok Gallery v2 source snapshot model', () => {
    test('listing fingerprints are order independent and bind key, size, ETag, and timestamp', () => {
        const first = listed();
        const second = listed({ key: 'other', etag: 'etag-b' });

        expect(listingFingerprint([first, second])).toBe(listingFingerprint([second, first]));
        expect(listingFingerprint([first])).not.toBe(listingFingerprint([
            { ...first, etag: 'stale-etag' }
        ]));
        expect(listingFingerprint([first])).not.toBe(listingFingerprint([
            { ...first, size: first.size + 1 }
        ]));
    });

    test('stable listing proof rejects drift even when object counts match', () => {
        const first = [listed()];
        const second = [listed({ etag: 'new-etag' })];

        expect(stableListingsMatch(first, first)).toBe(true);
        expect(stableListingsMatch(first, second)).toBe(false);
    });

    test('object fingerprint rejects stale ETag-bound hash reuse', () => {
        const current = listed();
        const priorHash = { objectFingerprint: objectFingerprint(current), sha256: 'a'.repeat(64) };

        expect(priorHash.objectFingerprint).toBe(objectFingerprint(current));
        expect(priorHash.objectFingerprint).not.toBe(objectFingerprint({
            ...current,
            etag: 'replacement-etag'
        }));
    });

    test('classifies bytes by signature instead of the legacy filename extension', () => {
        const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
        const png = Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), Buffer.alloc(16)]);
        const mp4 = Buffer.concat([
            Buffer.from([0x00, 0x00, 0x00, 0x18]),
            Buffer.from('ftypisom'),
            Buffer.alloc(16)
        ]);
        const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);

        expect(classifyMediaSignature(jpeg)).toEqual({ mediaType: 'image', format: 'jpeg' });
        expect(classifyMediaSignature(png)).toEqual({ mediaType: 'image', format: 'png' });
        expect(classifyMediaSignature(mp4)).toEqual({ mediaType: 'video', format: 'iso-bmff' });
        expect(classifyMediaSignature(webm)).toEqual({ mediaType: 'video', format: 'matroska' });
    });

    test('keeps extensionless and misleading media paths in the decoder queue', () => {
        const extensionless = classifySourceObjectKey(
            'grok-powertools/v1/users/greymaker/media/by-asset/media_11111111-1111-4111-8111-111111111111',
            'application/octet-stream'
        );
        const misleading = classifySourceObjectKey(
            'grok-powertools/v1/users/greymaker/media/by-asset/media_11111111-1111-4111-8111-111111111111.json',
            'application/json'
        );

        expect(extensionless).toMatchObject({
            pathClass: 'canonical-media',
            isMedia: true,
            mediaType: 'unknown-media'
        });
        expect(misleading).toMatchObject({
            pathClass: 'canonical-media',
            isMedia: true,
            mediaType: 'unknown-media'
        });
    });

    test('does not treat prompt sidecars under media paths as media', () => {
        expect(classifySourceObjectKey(
            'grok-powertools/v1/users/greymaker/media/by-asset/media_11111111-1111-4111-8111-111111111111.prompt.json',
            'application/json'
        )).toMatchObject({ pathClass: 'prompt-sidecar', isMedia: false });
    });

    test('keeps explicit text test artifacts out of the media decoder queue', () => {
        expect(classifySourceObjectKey(
            'grok-powertools/v1/users/test/media/2026-03-31_Auto/test_upload_verify.txt',
            'text/plain'
        )).toMatchObject({ pathClass: 'legacy-date-media', isMedia: false, mediaType: 'non-media' });
    });

    test('selects one canonical representative per hash deterministically', () => {
        const rows = [
            { ...listed({ key: 'legacy-b', pathClass: 'legacy-date-media' }), sha256: 'b'.repeat(64) },
            { ...listed({ key: 'canonical-b', pathClass: 'canonical-media' }), sha256: 'b'.repeat(64) },
            { ...listed({ key: 'canonical-a', pathClass: 'canonical-media' }), sha256: 'a'.repeat(64) }
        ];

        expect(selectBlobRepresentatives(rows)).toEqual([
            expect.objectContaining({ key: 'canonical-a', sha256: 'a'.repeat(64) }),
            expect.objectContaining({ key: 'canonical-b', sha256: 'b'.repeat(64) })
        ]);
    });

    test('selects the motion stream instead of an attached video poster', () => {
        const streams = [
            { index: 1, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
            { index: 0, codec_type: 'video', codec_name: 'h264', disposition: { attached_pic: 0 } }
        ];

        expect(selectPrimaryMediaStream(streams, 'video')).toMatchObject({ index: 0, codec_name: 'h264' });
        expect(selectPrimaryMediaStream(streams, 'image')).toMatchObject({ index: 1, codec_name: 'mjpeg' });
        expect(selectPrimaryMediaStream([streams[0]], 'video')).toBeNull();
    });
});
