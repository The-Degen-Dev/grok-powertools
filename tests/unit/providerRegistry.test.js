const {
    PROVIDER_IDS,
    detectProvider,
    getProvider,
    hasProviderCapability
} = require('../../providerRegistry.js');

describe('provider registry', () => {
    test('detects Grok Imagine provider on current Grok routes', () => {
        const direct = detectProvider('https://grok.com/imagine');
        const subdomain = detectProvider('https://foo.grok.com/imagine');
        const legacyX = detectProvider('https://foo.x.com/i/grok');
        const legacyGrokX = detectProvider('https://foo.grok.x.ai/imagine');
        const publicImagine = detectProvider('https://imagine-public.x.ai/imagine-public/images/sample.jpg');

        expect(direct.id).toBe(PROVIDER_IDS.GROK_IMAGINE);
        expect(subdomain.id).toBe(PROVIDER_IDS.GROK_IMAGINE);
        expect(legacyX.id).toBe(PROVIDER_IDS.GROK_IMAGINE);
        expect(legacyGrokX.id).toBe(PROVIDER_IDS.GROK_IMAGINE);
        expect(publicImagine.id).toBe(PROVIDER_IDS.GROK_IMAGINE);
        expect(direct.capabilities.canUseProviderSearch).toBe(true);
        expect(direct.capabilities.canRunVideoGoals).toBe(true);
    });

    test('detects ChatGPT Images provider only on the Images route', () => {
        const provider = detectProvider('https://chatgpt.com/images/');

        expect(provider.id).toBe(PROVIDER_IDS.CHATGPT_IMAGES);
        expect(provider.label).toBe('ChatGPT Images');
        expect(provider.capabilities.canRunTextPrompt).toBe(true);
        expect(provider.capabilities.canCaptureGeneratedImages).toBe(true);
        expect(provider.capabilities.canUseProviderSearch).toBe(false);
        expect(provider.capabilities.canRunVideoGoals).toBe(false);
    });

    test('does not enable ChatGPT controls on unrelated ChatGPT routes', () => {
        const provider = detectProvider('https://chatgpt.com/c/abc123');

        expect(provider.id).toBe(PROVIDER_IDS.UNKNOWN);
        expect(provider.capabilities.canRunTextPrompt).toBe(false);
        expect(provider.capabilities.canCaptureGeneratedImages).toBe(false);
    });

    test('returns defensive copies of provider definitions', () => {
        const provider = getProvider(PROVIDER_IDS.CHATGPT_IMAGES);
        provider.capabilities.canRunVideoGoals = true;

        expect(getProvider(PROVIDER_IDS.CHATGPT_IMAGES).capabilities.canRunVideoGoals).toBe(false);
        expect(hasProviderCapability(PROVIDER_IDS.CHATGPT_IMAGES, 'canRunTextPrompt')).toBe(true);
        expect(hasProviderCapability(PROVIDER_IDS.CHATGPT_IMAGES, 'canUseReferenceVideo')).toBe(false);
    });
});
