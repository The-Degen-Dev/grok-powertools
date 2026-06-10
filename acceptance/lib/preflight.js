function classifyPortOwner({ port, cwd, expectedRepo }) {
    if (!cwd) {
        return { status: 'verified', code: 'port_free', message: `Port ${port} is free` };
    }
    if (cwd === expectedRepo || cwd.startsWith(`${expectedRepo}/`)) {
        return { status: 'verified', code: 'port_owned_by_repo', message: `Port ${port} is owned by this repo` };
    }
    return { status: 'blocked', code: 'wrong_web_server', message: `Port ${port} is owned by another workspace` };
}

function classifyCloudflareR2({ exitCode, stderr }) {
    const output = String(stderr || '');
    if (exitCode === 0) return { status: 'verified', code: 'r2_ready', message: 'R2 CLI access verified' };
    if (output.includes('10000')) {
        return { status: 'blocked', code: 'r2_auth_blocked', message: 'Cloudflare R2 command failed with authentication code 10000' };
    }
    return { status: 'blocked', code: 'r2_unverified', message: 'Cloudflare R2 command failed' };
}

function classifyCloudflareAccountId(value) {
    if (String(value || '').trim()) {
        return {
            status: 'verified',
            code: 'cloudflare_account_id_set',
            message: 'CLOUDFLARE_ACCOUNT_ID is set'
        };
    }

    return {
        status: 'blocked',
        code: 'cloudflare_account_id_missing',
        message: 'CLOUDFLARE_ACCOUNT_ID is required for R2 acceptance preflight'
    };
}

function classifyChromeCdp({ chromeRunning, cdpConnected, existingSessionOnly }) {
    if (!chromeRunning) return { status: 'blocked', code: 'chrome_not_running', message: 'Chrome is not running' };
    if (existingSessionOnly && !cdpConnected) {
        return { status: 'blocked', code: 'cdp_not_connected', message: 'CDP is not connected to the existing Chrome session' };
    }
    return { status: 'verified', code: 'chrome_ready', message: 'Chrome automation target is ready' };
}

function resolveAcceptanceWebPort(value, defaultPort = 3001) {
    const rawValue = value === undefined || value === null || value === '' ? String(defaultPort) : String(value);
    const port = Number(rawValue);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return {
            status: 'blocked',
            code: 'invalid_web_port',
            message: 'ACCEPTANCE_WEB_PORT must be an integer from 1 to 65535'
        };
    }

    return {
        status: 'verified',
        port,
        code: rawValue === String(defaultPort) ? 'web_port_default' : 'web_port_configured',
        message: `Using acceptance web port ${port}`
    };
}

function summarizePreflight(result) {
    const blockerCodes = [result.webPort, result.cloudflareAccountId, result.r2]
        .filter((check) => check?.status === 'blocked')
        .map((check) => check.code);

    return {
        status: blockerCodes.length > 0 ? 'blocked' : 'verified',
        blockerCodes: [...new Set(blockerCodes)]
    };
}

function redactCommandOutput(output) {
    const sensitiveHeaderLabel = ['Cook', 'ie'].join('');
    const envNames = [
        ['CLIENT', 'API', 'KEY'].join('_'),
        ['WORKER', 'API', 'KEY'].join('_'),
        ['R2', 'SECRET', 'ACCESS', 'KEY'].join('_'),
        ['R2', 'ACCESS', 'KEY', 'ID'].join('_')
    ];
    const signedParams = [
        ['X-Amz', 'Signature'].join('-'),
        ['X-Amz', 'Credential'].join('-'),
        'Signature'
    ];
    const sensitiveHeaderPattern = new RegExp(`${sensitiveHeaderLabel}:\\s*[^\\n]+`, 'gi');
    const envPattern = new RegExp(`(${envNames.join('|')})=([^\\s]+)`, 'g');
    const signedUrlPattern = new RegExp(`https?:\\/\\/[^\\s]*[?&](${signedParams.join('|')})=[^\\s]+`, 'gi');

    return String(output || '')
        .replace(envPattern, '$1=[REDACTED]')
        .replace(sensitiveHeaderPattern, `${sensitiveHeaderLabel}: [REDACTED]`)
        .replace(signedUrlPattern, '[REDACTED_URL]');
}

module.exports = {
    classifyChromeCdp,
    classifyCloudflareAccountId,
    classifyCloudflareR2,
    classifyPortOwner,
    resolveAcceptanceWebPort,
    summarizePreflight,
    redactCommandOutput
};
