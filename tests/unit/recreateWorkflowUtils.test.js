const {
    ALLOWED_RECREATE_MIME_TYPES,
    ALLOWED_RECREATE_VIDEO_MIME_TYPES,
    buildRecreateChatInstruction,
    buildRecreateFailure,
    buildVideoRecreateChatInstruction,
    chooseBestGeneratedImageCandidate,
    extractFinalImagineVideoPrompt,
    extractFinalImaginePrompt,
    isTrustedGrokVideoUrl,
    isTrustedGrokMediaUrl,
    MAX_VIDEO_REFERENCE_BYTES,
    MAX_REFERENCE_BYTES,
    normalizeRecreateReference,
    parseRecreateDataUrl,
    parseRecreateMediaDataUrl
} = require('../../recreateWorkflowUtils.js');

describe('recreate workflow utils', () => {
    const tinyPng = 'data:image/png;base64,aGVsbG8=';

    test('parses valid image data URLs', () => {
        const parsed = parseRecreateDataUrl(tinyPng);

        expect(parsed).toEqual({
            mimeType: 'image/png',
            base64: 'aGVsbG8=',
            byteLength: 5
        });
    });

    test('rejects invalid or unsupported data URLs', () => {
        expect(() => parseRecreateDataUrl('')).toThrow('reference_invalid');
        expect(() => parseRecreateDataUrl('not-a-data-url')).toThrow('reference_invalid');
        expect(() => parseRecreateDataUrl('data:text/plain;base64,aGVsbG8=')).toThrow('reference_invalid');
        expect(() => parseRecreateDataUrl('data:image/svg+xml;base64,aGVsbG8=')).toThrow('reference_invalid');
        expect(() => parseRecreateDataUrl('data:image/png;base64,====')).toThrow('reference_invalid');
        expect(ALLOWED_RECREATE_MIME_TYPES).toContain('image/webp');
    });

    test('rejects oversized base64 before decoding', () => {
        const oversizedBase64 = 'A'.repeat((Math.floor(MAX_REFERENCE_BYTES / 3) + 1) * 4);
        const originalAtob = global.atob;
        global.atob = jest.fn(() => {
            throw new Error('atob should not run for oversized references');
        });

        try {
            expect(() => parseRecreateDataUrl(`data:image/png;base64,${oversizedBase64}`)).toThrow(
                'reference_invalid'
            );
            expect(global.atob).not.toHaveBeenCalled();
        } finally {
            global.atob = originalAtob;
        }
    });

    test('normalizes local reference payloads', () => {
        expect(
            normalizeRecreateReference({
                name: '  sample.png  ',
                mimeType: 'image/png',
                dataUrl: tinyPng,
                source: 'drop'
            })
        ).toEqual({
            name: 'sample.png',
            mimeType: 'image/png',
            dataUrl: tinyPng,
            source: 'drop',
            byteLength: 5
        });
    });

    test('normalizes video and gif references as video media', () => {
        const tinyMp4 = 'data:video/mp4;base64,aGVsbG8=';
        const tinyGif = 'data:image/gif;base64,aGVsbG8=';

        expect(parseRecreateMediaDataUrl(tinyMp4)).toEqual({
            kind: 'video',
            mimeType: 'video/mp4',
            base64: 'aGVsbG8=',
            byteLength: 5
        });
        expect(normalizeRecreateReference({
            name: 'clip.mp4',
            kind: 'video',
            mimeType: 'video/mp4',
            dataUrl: tinyMp4,
            source: 'drop'
        })).toEqual({
            name: 'clip.mp4',
            kind: 'video',
            mimeType: 'video/mp4',
            dataUrl: tinyMp4,
            source: 'drop',
            byteLength: 5
        });
        expect(normalizeRecreateReference({
            name: 'motion.gif',
            mimeType: 'image/gif',
            dataUrl: tinyGif,
            source: 'local'
        })).toEqual(expect.objectContaining({
            kind: 'video',
            mimeType: 'image/gif',
            byteLength: 5
        }));
        expect(ALLOWED_RECREATE_VIDEO_MIME_TYPES).toContain('video/mp4');
        expect(MAX_VIDEO_REFERENCE_BYTES).toBeGreaterThan(MAX_REFERENCE_BYTES);
    });

    test('normalizes trusted Grok video URL references without a data URL', () => {
        const url = 'https://imagine-public.x.ai/imagine-public/share-videos/abc_1080_hd.mp4';

        expect(normalizeRecreateReference({
            kind: 'video',
            url,
            source: 'grok-video-url'
        })).toEqual(expect.objectContaining({
            kind: 'video',
            name: 'reference-video',
            mimeType: '',
            url,
            source: 'grok-video-url'
        }));
    });

    test('extracts only prompt text after the strict marker', () => {
        expect(extractFinalImaginePrompt('Notes\nFINAL_IMAGINE_PROMPT:\nA cinematic red cabin in snow.')).toBe(
            'A cinematic red cabin in snow.'
        );
    });

    test('strips Grok sources and agent chatter after the final prompt marker', () => {
        expect(
            extractFinalImaginePrompt(
                [
                    'FINAL_IMAGINE_PROMPT: Minimalist geometric abstract painting with red circle and green triangle.',
                    '',
                    '5 sources',
                    'Explore Constructivist geometry'
                ].join('\n')
            )
        ).toBe('Minimalist geometric abstract painting with red circle and green triangle.');

        expect(
            extractFinalImaginePrompt(
                'FINAL_IMAGINE_PROMPT: minimalist geometric abstract painting with red circle, purple diagonal stripe, green triangle, blue square, yellow circle, flat vector style Agent 8 Refinements: Ensure the purple is a long thin rotated rectangle.'
            )
        ).toBe(
            'minimalist geometric abstract painting with red circle, purple diagonal stripe, green triangle, blue square, yellow circle, flat vector style'
        );
    });

    test('fails when final prompt marker is absent', () => {
        expect(() => extractFinalImaginePrompt('A cinematic red cabin in snow.')).toThrow('chat_prompt_marker_missing');
    });

    test('builds chat instruction with and without Grok search wording', () => {
        const withSearch = buildRecreateChatInstruction({ bestPracticesEnabled: true });
        const withoutSearch = buildRecreateChatInstruction({ bestPracticesEnabled: false });

        expect(withSearch).toContain('use Grok search');
        expect(withSearch).toContain('FINAL_IMAGINE_PROMPT:');
        expect(withoutSearch).not.toContain('use Grok search');
        expect(withoutSearch).toContain('FINAL_IMAGINE_PROMPT:');
    });

    test('builds and extracts Grok Imagine video prompts', () => {
        const instruction = buildVideoRecreateChatInstruction({
            bestPracticesEnabled: false,
            metadata: {
                durationSec: 10.042,
                width: 464,
                height: 688,
                sourcePrompt: 'he catches up with her and embraces her slowly'
            }
        });

        expect(instruction).toContain('Grok Imagine Video');
        expect(instruction).toContain('Reference duration: 10.042s.');
        expect(instruction).toContain('Known source prompt context');
        expect(instruction).toContain('FINAL_IMAGINE_VIDEO_PROMPT:');
        expect(extractFinalImagineVideoPrompt(
            'Notes\nFINAL_IMAGINE_VIDEO_PROMPT:\nA handheld 10-second clip of two people embracing slowly.'
        )).toBe('A handheld 10-second clip of two people embracing slowly.');
    });

    test('chooses visible generated image nearest viewport center', () => {
        const best = chooseBestGeneratedImageCandidate(
            [
                {
                    src: 'data:image/png;base64,aaa=',
                    alt: 'Generated image',
                    naturalWidth: 720,
                    naturalHeight: 720,
                    rect: { left: 10, top: 10, width: 100, height: 100 }
                },
                {
                    src: 'data:image/png;base64,bbb=',
                    alt: 'Generated image',
                    naturalWidth: 720,
                    naturalHeight: 720,
                    rect: { left: 450, top: 300, width: 100, height: 100 }
                },
                {
                    src: 'data:image/png;base64,ccc=',
                    alt: 'avatar',
                    naturalWidth: 720,
                    naturalHeight: 720,
                    rect: { left: 500, top: 300, width: 100, height: 100 }
                },
                {
                    src: 'data:image/png;base64,ddd=',
                    alt: 'Generated image',
                    naturalWidth: 720,
                    naturalHeight: 720,
                    rect: { left: 450, top: 300, width: 0, height: 100 }
                }
            ],
            { width: 1000, height: 700 }
        );

        expect(best.src).toBe('data:image/png;base64,bbb=');
    });

    test('trusts current Grok image result hosts', () => {
        expect(isTrustedGrokMediaUrl('https://imagine-public.x.ai/imagine-public/images/sample.jpg')).toBe(true);
        expect(isTrustedGrokMediaUrl('https://images-public.x.ai/xai-images-public/mj/images/sample.png')).toBe(true);
        expect(isTrustedGrokMediaUrl('https://assets.grok.com/users/sample/content')).toBe(true);
        expect(isTrustedGrokMediaUrl('https://example.com/sample.png')).toBe(false);
    });

    test('trusts Grok Imagine shared video URLs only on the public video path', () => {
        expect(isTrustedGrokVideoUrl('https://imagine-public.x.ai/imagine-public/share-videos/sample_1080_hd.mp4')).toBe(true);
        expect(isTrustedGrokVideoUrl('https://assets.grok.com/users/test/generated/post-id/generated_video.mp4?cache=1')).toBe(true);
        expect(isTrustedGrokVideoUrl('https://imagine-public.x.ai/imagine-public/images/sample.jpg')).toBe(false);
        expect(isTrustedGrokVideoUrl('https://assets.grok.com/users/test/generated/post-id/preview.jpg')).toBe(false);
        expect(isTrustedGrokVideoUrl('https://example.com/imagine-public/share-videos/sample.mp4')).toBe(false);
    });

    test('ignores generated image candidates outside the viewport', () => {
        const best = chooseBestGeneratedImageCandidate(
            [
                {
                    src: 'data:image/png;base64,offscreen=',
                    alt: 'Generated image',
                    naturalWidth: 720,
                    naturalHeight: 720,
                    rect: { left: 450, top: 900, width: 100, height: 100 }
                },
                {
                    src: 'data:image/png;base64,visible=',
                    alt: 'Generated image',
                    naturalWidth: 720,
                    naturalHeight: 720,
                    rect: { left: 20, top: 20, width: 100, height: 100 }
                }
            ],
            { width: 800, height: 600 }
        );

        expect(best.src).toBe('data:image/png;base64,visible=');
    });

    test('builds safe failure responses without payloads', () => {
        const failure = buildRecreateFailure({
            runId: 'recreate_1',
            phase: 'chat',
            error: 'chat_submit_missing',
            diagnostics: {
                url: 'https://grok.com/',
                dataUrl: 'data:image/png;base64,secret',
                videoDataUrl: 'data:video/mp4;base64,secret',
                reference: { dataUrl: 'data:image/png;base64,secret' },
                cookie: 'session=secret',
                cookies: ['session=secret'],
                cookieHeader: 'session=secret',
                setCookie: 'session=secret',
                authHeader: 'Bearer secret',
                authHeaders: { authorization: 'Bearer secret' },
                authorization: 'Bearer secret',
                token: 'secret',
                apiKey: 'secret',
                password: 'secret',
                secretHeader: 'secret',
                bearerToken: 'secret',
                accessToken: 'secret',
                sessionCookie: 'session=secret',
                xApiKey: 'secret',
                preview: 'data:image/png;base64,secret'
            }
        });

        expect(failure).toEqual({
            ok: false,
            runId: 'recreate_1',
            phase: 'chat',
            error: 'chat_submit_missing',
            diagnostics: { url: 'https://grok.com/' }
        });
    });

    test('scrubs compound and nested sensitive diagnostic keys', () => {
        const failure = buildRecreateFailure({
            runId: 'recreate_2',
            phase: 'imagine',
            error: 'reference_invalid',
            diagnostics: {
                url: 'https://grok.com/imagine',
                AccessToken: 'secret',
                SESSION_COOKIE: 'session=secret',
                'x-api-key': 'secret',
                bearerToken: 'secret',
                nested: {
                    safeStatus: 200,
                    cookieHeader: 'session=secret',
                    passwordSecret: 'secret'
                },
                nestedList: [
                    {
                        safeLabel: 'kept',
                        authHeaders: { authorization: 'Bearer secret' }
                    }
                ]
            }
        });

        expect(failure.diagnostics).toEqual({
            url: 'https://grok.com/imagine',
            nested: {
                safeStatus: 200
            },
            nestedList: [
                {
                    safeLabel: 'kept'
                }
            ]
        });
    });
});
