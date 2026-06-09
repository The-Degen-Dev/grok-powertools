const PRODUCTION_BUCKETS = new Set(['grok-gallery-001']);
const PRODUCTION_D1_DATABASES = new Set(['grok-powertools-db']);
const PRODUCTION_D1_IDS = new Set(['ad89e4bb-0b68-4c72-93d9-b90e6eb45aa6']);
const PRODUCTION_PREFIXES = new Set(['grok-powertools/v1']);
const SENSITIVE_KEY_RE = new RegExp([
    'api[-_]?' + 'key',
    'authorization',
    'coo' + 'kie',
    'to' + 'ken',
    'sec' + 'ret',
    'pass' + 'word',
    'uploadurl',
    'signedurl',
    'prompttext'
].join('|'), 'i');
const SIGNED_URL_RE = new RegExp(`[?&](${['X-Amz-' + 'Signature', 'X-Amz-' + 'Credential', 'Expires', 'Signature'].join('|')})=`, 'i');

function requireString(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${path} is required`);
    }
    return value.trim();
}

function requireObject(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${path} is required`);
    }
    return value;
}

function assertNotProduction(manifest) {
    const cloud = manifest.cloud;
    if (
        PRODUCTION_BUCKETS.has(cloud.r2Bucket) ||
        PRODUCTION_D1_DATABASES.has(cloud.d1Database) ||
        PRODUCTION_D1_IDS.has(cloud.d1DatabaseId) ||
        PRODUCTION_PREFIXES.has(cloud.keyPrefix)
    ) {
        throw new Error('Manifest references a production resource');
    }
    if (!cloud.keyPrefix.startsWith(`acceptance/${manifest.runId}`)) {
        throw new Error('cloud.keyPrefix must start with the active acceptance run ID');
    }
}

function validateAcceptanceManifest(input) {
    const manifest = requireObject(input, 'manifest');
    const extension = requireObject(manifest.extension, 'extension');
    const worker = requireObject(manifest.worker, 'worker');
    const cloud = requireObject(manifest.cloud, 'cloud');
    const browser = requireObject(manifest.browser, 'browser');
    const restorePlan = requireObject(manifest.restorePlan, 'restorePlan');

    const normalized = {
        runId: requireString(manifest.runId, 'runId'),
        laneId: requireString(manifest.laneId, 'laneId'),
        canaryId: requireString(manifest.canaryId, 'canaryId'),
        extension: {
            id: requireString(extension.id, 'extension.id'),
            version: requireString(extension.version, 'extension.version'),
            sourcePath: requireString(extension.sourcePath, 'extension.sourcePath'),
            sourceHash: requireString(extension.sourceHash, 'extension.sourceHash')
        },
        worker: {
            identityUrl: requireString(worker.identityUrl, 'worker.identityUrl'),
            version: requireString(worker.version, 'worker.version')
        },
        cloud: {
            r2Bucket: requireString(cloud.r2Bucket, 'cloud.r2Bucket'),
            d1Database: requireString(cloud.d1Database, 'cloud.d1Database'),
            d1DatabaseId: requireString(cloud.d1DatabaseId, 'cloud.d1DatabaseId'),
            keyPrefix: requireString(cloud.keyPrefix, 'cloud.keyPrefix').replace(/^\/+|\/+$/g, ''),
            apiKeyFingerprint: requireString(cloud.apiKeyFingerprint, 'cloud.apiKeyFingerprint')
        },
        browser: {
            profileMode: requireString(browser.profileMode, 'browser.profileMode'),
            downloadRoot: requireString(browser.downloadRoot, 'browser.downloadRoot')
        },
        restorePlan: {
            storageKeys: Array.isArray(restorePlan.storageKeys) ? restorePlan.storageKeys.map(String) : [],
            sentinelRequired: restorePlan.sentinelRequired === true
        }
    };

    assertNotProduction(normalized);
    return normalized;
}

function redactEvidence(value, key = '') {
    if (typeof value === 'string') {
        if (SENSITIVE_KEY_RE.test(key)) return key.toLowerCase().includes('url') ? '[REDACTED_URL]' : '[REDACTED]';
        if (SIGNED_URL_RE.test(value)) return '[REDACTED_URL]';
        return value;
    }
    if (Array.isArray(value)) return value.map((entry) => redactEvidence(entry, key));
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
            entryKey,
            redactEvidence(entryValue, entryKey)
        ])
    );
}

function classifyVerdict(state) {
    if (!state.safetyClean) return 'contaminated';
    if (!state.preflightOk && !state.mutated) return 'blocked';
    if (state.evidenceCollectorFailedBeforeMutation && !state.mutated) return 'inconclusive';
    if (!state.assertionsOk) return 'failed';
    if (!state.evidenceComplete || !state.sentinelClean) return state.mutated ? 'contaminated' : 'inconclusive';
    return 'verified';
}

module.exports = {
    classifyVerdict,
    redactEvidence,
    validateAcceptanceManifest
};
