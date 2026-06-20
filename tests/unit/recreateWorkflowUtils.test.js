const {
    ALLOWED_RECREATE_MIME_TYPES,
    buildRecreateChatInstruction,
    buildRecreateFailure,
    chooseBestGeneratedImageCandidate,
    extractFinalImaginePrompt,
    isTrustedGrokMediaUrl,
    MAX_REFERENCE_BYTES,
    normalizeRecreateReference,
    parseRecreateDataUrl
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
