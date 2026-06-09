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

function classifyChromeCdp({ chromeRunning, cdpConnected, existingSessionOnly }) {
    if (!chromeRunning) return { status: 'blocked', code: 'chrome_not_running', message: 'Chrome is not running' };
    if (existingSessionOnly && !cdpConnected) {
        return { status: 'blocked', code: 'cdp_not_connected', message: 'CDP is not connected to the existing Chrome session' };
    }
    return { status: 'verified', code: 'chrome_ready', message: 'Chrome automation target is ready' };
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
    classifyCloudflareR2,
    classifyPortOwner,
    redactCommandOutput
};
