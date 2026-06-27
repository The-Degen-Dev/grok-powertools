const manifest = require('../../manifest.json');
const { EXTENSION_PACKAGE_FILES } = require('../../tools/package-extension.js');

describe('provider manifest coverage', () => {
    test('loads provider helpers before Grok helpers and main content script', () => {
        const scripts = manifest.content_scripts[0].js;

        expect(scripts.indexOf('providerRegistry.js')).toBeGreaterThanOrEqual(0);
        expect(scripts.indexOf('providerRunLedger.js')).toBeGreaterThan(scripts.indexOf('providerRegistry.js'));
        expect(scripts.indexOf('chatgptImagesContent.js')).toBeGreaterThan(scripts.indexOf('providerRunLedger.js'));
        expect(scripts.indexOf('recreateWorkflowUtils.js')).toBeGreaterThan(scripts.indexOf('chatgptImagesContent.js'));
        expect(scripts.indexOf('content.js')).toBeGreaterThan(scripts.indexOf('recreateWorkflowContent.js'));
    });

    test('injects content scripts on ChatGPT Images without dropping existing Grok matches', () => {
        const matches = manifest.content_scripts[0].matches;

        expect(matches).toContain('https://chatgpt.com/images*');
        expect(matches).toContain('*://grok.com/*');
        expect(matches).toContain('*://*.grok.com/*');
        expect(matches).toContain('*://*.x.com/*');
        expect(matches).toContain('*://*.grok.x.ai/*');
        expect(matches).toContain('*://imagine-public.x.ai/*');
    });

    test('does not add a broader ChatGPT host permission or web-accessible resource in V1', () => {
        const hostPermissions = manifest.host_permissions || [];
        const webAccessibleMatches = manifest.web_accessible_resources.flatMap((entry) => entry.matches || []);

        expect(hostPermissions).not.toContain('https://*.chatgpt.com/*');
        expect(hostPermissions).not.toContain('*://*.chatgpt.com/*');
        expect(webAccessibleMatches.some((match) => match.includes('chatgpt.com'))).toBe(false);
    });

    test('packages every provider helper referenced by the manifest', () => {
        expect(EXTENSION_PACKAGE_FILES).toContain('providerRegistry.js');
        expect(EXTENSION_PACKAGE_FILES).toContain('providerRunLedger.js');
        expect(EXTENSION_PACKAGE_FILES).toContain('chatgptImagesContent.js');
    });
});
