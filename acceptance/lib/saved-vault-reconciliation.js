const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function normalizeSavedAssetIdentity(value) {
    const match = String(value || '').match(UUID_RE);
    return match ? match[0].toLowerCase() : null;
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
        verified,
        missing,
        duplicateCanonical,
        unverified,
        legacyDuplicates,
        extra: Array.from(byIdentity.keys()).filter((identity) => !saved.has(identity))
    };
}

function redactIdentity(value) {
    const identity = normalizeSavedAssetIdentity(value);
    return identity ? `...${identity.slice(-8)}` : null;
}

function redactObjectKey(value) {
    if (typeof value !== 'string') return null;
    const finalSegment = value.split('/').pop() || '';
    const extension = finalSegment.includes('.') ? finalSegment.slice(finalSegment.lastIndexOf('.')) : '';
    return { suffix: extension || '[redacted]' };
}

function redactInventoryItem(item) {
    return {
        identity: redactIdentity(item.assetId || item.canonicalObjectKey),
        verificationStatus: typeof item.verificationStatus === 'string' ? item.verificationStatus : 'unknown',
        canonicalObjectKey: redactObjectKey(item.canonicalObjectKey),
        legacyObjectKeys: Array.isArray(item.legacyObjectKeys) ? item.legacyObjectKeys.map(redactObjectKey) : []
    };
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
    redactReconciliationOutput
};
