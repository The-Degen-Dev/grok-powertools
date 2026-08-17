const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const MEDIA_TYPE_BY_EXTENSION = Object.freeze({
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    mp4: 'video/mp4',
    png: 'image/png',
    webm: 'video/webm',
    webp: 'image/webp'
});
const VERIFICATION_STATUSES = new Set(['blocked', 'failed', 'unproven', 'verified']);

function normalizeSavedAssetIdentity(value) {
    const match = String(value || '').match(UUID_RE);
    return match ? match[0].toLowerCase() : null;
}

function sorted(values) {
    return [...values].sort();
}

function reconcileSavedVaultInventory({ savedIdentities = [], inventoryItems = [] }) {
    const saved = new Set(savedIdentities.map(normalizeSavedAssetIdentity).filter(Boolean));
    const byIdentity = new Map();
    for (const item of inventoryItems) {
        const identity = normalizeSavedAssetIdentity(item.assetId)
            || normalizeSavedAssetIdentity(item.canonicalObjectKey);
        if (!identity) continue;
        const rows = byIdentity.get(identity) || [];
        rows.push(item);
        byIdentity.set(identity, rows);
    }

    const missing = [];
    const duplicateCanonical = [];
    const unverified = [];
    const verified = [];
    const legacyDuplicates = [];
    for (const identity of saved) {
        const rows = byIdentity.get(identity) || [];
        const canonicalRows = rows.filter((row) => row.canonicalObjectKey);
        if (!rows.length) missing.push(identity);
        else if (canonicalRows.length !== 1) duplicateCanonical.push(identity);
        else if (canonicalRows[0].verificationStatus !== 'verified') unverified.push(identity);
        else {
            verified.push(identity);
            if ((canonicalRows[0].legacyObjectKeys || []).length > 0) legacyDuplicates.push(identity);
        }
    }

    return {
        savedCount: saved.size,
        inventoryCount: inventoryItems.length,
        verified: sorted(verified),
        missing: sorted(missing),
        duplicateCanonical: sorted(duplicateCanonical),
        unverified: sorted(unverified),
        legacyDuplicates: sorted(legacyDuplicates),
        extra: sorted(Array.from(byIdentity.keys()).filter((identity) => !saved.has(identity)))
    };
}

function redactIdentity(value) {
    const identity = normalizeSavedAssetIdentity(value);
    return identity ? `...${identity.slice(-8)}` : null;
}

function redactObjectKey(value) {
    if (typeof value !== 'string') return null;
    const extension = value.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
    const mediaType = extension && MEDIA_TYPE_BY_EXTENSION[extension];
    return mediaType ? { mediaType } : null;
}

function redactVerificationStatus(value) {
    return VERIFICATION_STATUSES.has(value) ? value : 'unknown';
}

function redactInventoryItem(item) {
    return {
        identity: redactIdentity(item.assetId || item.canonicalObjectKey),
        verificationStatus: redactVerificationStatus(item.verificationStatus),
        canonicalObjectKey: redactObjectKey(item.canonicalObjectKey),
        legacyObjectKeys: Array.isArray(item.legacyObjectKeys) ? item.legacyObjectKeys.map(redactObjectKey) : []
    };
}

function sortRedactedInventory(items) {
    return [...items].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function redactReconciliationOutput(value, key = '') {
    if (Array.isArray(value)) return value.map((entry) => redactReconciliationOutput(entry, key));
    if (!value || typeof value !== 'object') {
        if (/identit(y|ies)|verified|missing|duplicate|unverified|extra/i.test(key)) return redactIdentity(value);
        return value;
    }

    return Object.fromEntries(Object.entries(value).flatMap(([entryKey, entryValue]) => {
        if (/source.?url|url|authorization|api.?key|token|secret|cookie/i.test(entryKey)) return [];
        if (/object.?key/i.test(entryKey)) {
            if (Array.isArray(entryValue)) return [[entryKey, entryValue.map(redactObjectKey)]];
            return [[entryKey, redactObjectKey(entryValue)]];
        }
        return [[entryKey, redactReconciliationOutput(entryValue, entryKey)]];
    }));
}

module.exports = {
    normalizeSavedAssetIdentity,
    reconcileSavedVaultInventory,
    redactIdentity,
    redactObjectKey,
    redactInventoryItem,
    sortRedactedInventory,
    redactReconciliationOutput
};
