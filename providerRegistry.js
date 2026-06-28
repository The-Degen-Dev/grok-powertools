(function (root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.GrokPowerToolsProviderRegistry = api;
    }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const PROVIDER_IDS = {
        GROK_IMAGINE: 'grok-imagine',
        CHATGPT_IMAGES: 'chatgpt-images',
        UNKNOWN: 'unknown'
    };

    const EMPTY_CAPABILITIES = Object.freeze({
        canRunTextPrompt: false,
        canUseReferenceImage: false,
        canUseReferenceVideo: false,
        canUseProviderSearch: false,
        canUseCurrentProviderMedia: false,
        canRunBatch: false,
        canRunVideoGoals: false,
        canCaptureGeneratedImages: false,
        canDownloadGeneratedImages: false
    });

    const PROVIDERS = Object.freeze({
        [PROVIDER_IDS.GROK_IMAGINE]: Object.freeze({
            id: PROVIDER_IDS.GROK_IMAGINE,
            label: 'Grok Imagine',
            capabilities: Object.freeze({
                ...EMPTY_CAPABILITIES,
                canRunTextPrompt: true,
                canUseReferenceImage: true,
                canUseReferenceVideo: true,
                canUseProviderSearch: true,
                canUseCurrentProviderMedia: true,
                canRunBatch: true,
                canRunVideoGoals: true,
                canCaptureGeneratedImages: true,
                canDownloadGeneratedImages: true
            })
        }),
        [PROVIDER_IDS.CHATGPT_IMAGES]: Object.freeze({
            id: PROVIDER_IDS.CHATGPT_IMAGES,
            label: 'ChatGPT Images',
            capabilities: Object.freeze({
                ...EMPTY_CAPABILITIES,
                canRunTextPrompt: true,
                canCaptureGeneratedImages: true
            })
        }),
        [PROVIDER_IDS.UNKNOWN]: Object.freeze({
            id: PROVIDER_IDS.UNKNOWN,
            label: 'Unsupported page',
            capabilities: EMPTY_CAPABILITIES
        })
    });

    function copyProvider(provider) {
        return {
            id: provider.id,
            label: provider.label,
            capabilities: { ...provider.capabilities }
        };
    }

    function getProvider(providerId) {
        return copyProvider(PROVIDERS[providerId] || PROVIDERS[PROVIDER_IDS.UNKNOWN]);
    }

    function normalizeUrl(value) {
        if (value && typeof value.href === 'string') return new URL(value.href);
        if (typeof value === 'string') return new URL(value);
        if (typeof location !== 'undefined' && location.href) return new URL(location.href);
        return new URL('https://unsupported.invalid/');
    }

    function isGrokHost(hostname) {
        return (
            hostname === 'grok.com' ||
            hostname.endsWith('.grok.com') ||
            hostname.endsWith('.x.com') ||
            hostname.endsWith('.grok.x.ai') ||
            hostname === 'imagine-public.x.ai'
        );
    }

    function detectProvider(value) {
        let url;
        try {
            url = normalizeUrl(value);
        } catch {
            return getProvider(PROVIDER_IDS.UNKNOWN);
        }

        if ((url.protocol === 'https:' || url.protocol === 'http:') && isGrokHost(url.hostname)) {
            return getProvider(PROVIDER_IDS.GROK_IMAGINE);
        }

        if (
            url.protocol === 'https:' &&
            url.hostname === 'chatgpt.com' &&
            (url.pathname === '/images' || url.pathname.startsWith('/images/'))
        ) {
            return getProvider(PROVIDER_IDS.CHATGPT_IMAGES);
        }

        return getProvider(PROVIDER_IDS.UNKNOWN);
    }

    function hasProviderCapability(providerOrId, capabilityName) {
        const provider = typeof providerOrId === 'string' ? getProvider(providerOrId) : providerOrId;
        return !!(provider && provider.capabilities && provider.capabilities[capabilityName]);
    }

    return {
        PROVIDER_IDS,
        detectProvider,
        getProvider,
        hasProviderCapability
    };
});
