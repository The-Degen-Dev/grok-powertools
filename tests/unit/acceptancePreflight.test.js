const {
    classifyChromeCdp,
    classifyCloudflareAccountId,
    classifyCloudflareR2,
    classifyPortOwner,
    resolveAcceptanceWebPort,
    summarizePreflight,
    redactCommandOutput
} = require('../../acceptance/lib/preflight.js');

describe('acceptance preflight classifiers', () => {
    test('blocks when a web port is owned by another workspace', () => {
        const result = classifyPortOwner({
            port: 3001,
            cwd: '/Users/philipbankier/Development/MailAI/1st-run/CORE/worktrees/local-companion-20260519/website',
            expectedRepo: '/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools'
        });

        expect(result).toEqual({
            status: 'blocked',
            code: 'wrong_web_server',
            message: 'Port 3001 is owned by another workspace'
        });
    });

    test('blocks R2 acceptance setup on Cloudflare authentication code 10000', () => {
        const result = classifyCloudflareR2({
            exitCode: 1,
            stderr: 'Authentication error [code: 10000]'
        });

        expect(result.status).toBe('blocked');
        expect(result.code).toBe('r2_auth_blocked');
    });

    test('blocks R2 preflight when Cloudflare account ID is missing', () => {
        expect(classifyCloudflareAccountId('')).toEqual({
            status: 'blocked',
            code: 'cloudflare_account_id_missing',
            message: 'CLOUDFLARE_ACCOUNT_ID is required for R2 acceptance preflight'
        });
    });

    test('supports an alternate acceptance web port', () => {
        expect(resolveAcceptanceWebPort('3011')).toEqual({
            status: 'verified',
            port: 3011,
            code: 'web_port_configured',
            message: 'Using acceptance web port 3011'
        });
    });

    test('blocks invalid acceptance web ports', () => {
        expect(resolveAcceptanceWebPort('not-a-port')).toMatchObject({
            status: 'blocked',
            code: 'invalid_web_port'
        });
    });

    test('summarizes any preflight blocker as blocked', () => {
        const result = summarizePreflight({
            webPort: { status: 'blocked', code: 'wrong_web_server' },
            cloudflareAccountId: { status: 'verified', code: 'cloudflare_account_id_set' },
            r2: { status: 'verified', code: 'r2_ready' }
        });

        expect(result).toEqual({
            status: 'blocked',
            blockerCodes: ['wrong_web_server']
        });
    });

    test('blocks CDP unless it is connected to the existing Chrome session', () => {
        expect(classifyChromeCdp({
            chromeRunning: true,
            cdpConnected: false,
            existingSessionOnly: true
        })).toMatchObject({
            status: 'blocked',
            code: 'cdp_not_connected'
        });
    });

    test('redacts sensitive command output', () => {
        const envName = ['CLIENT', 'API', 'KEY'].join('_');
        const headerName = ['Cook', 'ie'].join('');
        const signedParam = ['X-Amz', 'Signature'].join('-');

        expect(redactCommandOutput(`${envName}=abc\n${headerName}: xyz\nhttps://x?${signedParam}=sig-sample`)).toBe(
            `${envName}=[REDACTED]\n${headerName}: [REDACTED]\n[REDACTED_URL]`
        );
    });
});
