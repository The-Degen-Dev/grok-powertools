const { normalizeGrokAssetId, stableStringify } = require('./migration-model');

const SHA256_RE = /^[0-9a-f]{64}$/i;
const EVIDENCE_PATH_CLASSES = new Set(['metadata', 'prompt-sidecar', 'asset-metadata-v2']);

function normalizeSha256(value) {
    const normalized = String(value || '').toLowerCase();
    return SHA256_RE.test(normalized) ? normalized : null;
}

function assetIdFromCanonicalKey(key) {
    const match = String(key || '').match(/\/media\/(?:by-asset|conflicts)\/media_([0-9a-f-]{36})(?:[./]|$)/i);
    return normalizeGrokAssetId(match?.[1]);
}

function array(value) {
    return Array.isArray(value) ? value : [];
}

function parsePromptRefIds(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function buildEvidenceInventory(input) {
    const sourceObjects = array(input.sourceObjects);
    const hashesByKey = new Map(array(input.nonMediaHashes).map((row) => [row.objectKey, row]));
    const priorByKey = new Map(array(input.priorMetadataObjects).map((row) => [row.objectKey, row]));
    const evidenceByKey = new Map();
    const warnings = [];

    for (const object of sourceObjects.filter((row) => EVIDENCE_PATH_CLASSES.has(row.pathClass))) {
        const hash = hashesByKey.get(object.key);
        const sha256 = normalizeSha256(hash?.sha256);
        if (!sha256 || hash?.status !== 'ok' || Number(hash.bytesRead) !== Number(object.size)) {
            warnings.push({ code: 'metadata_hash_unverified', objectKey: object.key });
            continue;
        }
        const prior = priorByKey.get(object.key);
        const priorMatches = normalizeSha256(prior?.sha256) === sha256
            && Number(prior?.size) === Number(object.size);
        if (!priorMatches) warnings.push({ code: 'metadata_audit_stale', objectKey: object.key });
        evidenceByKey.set(object.key, {
            objectKey: object.key,
            sha256,
            sizeBytes: Number(object.size) || 0,
            parseStatus: priorMatches ? prior.parseStatus : 'unverified',
            evidenceType: object.pathClass
        });
    }

    const links = [];
    const addLink = (link) => {
        if (!normalizeGrokAssetId(link.assetId)) return;
        links.push({
            ...link,
            assetId: normalizeGrokAssetId(link.assetId),
            evidenceSha256: normalizeSha256(link.evidenceSha256),
            promptSha256: normalizeSha256(link.promptSha256),
            issues: [...new Set(array(link.issues).map(String))].sort()
        });
    };

    for (const reference of array(input.metadataReferences)) {
        const evidence = evidenceByKey.get(reference.objectKey);
        if (!evidence || evidence.evidenceType !== 'metadata' || evidence.parseStatus !== 'ok') continue;
        const assetIds = new Set([
            ...array(reference.assetIds).map(normalizeGrokAssetId),
            ...array(reference.objectKeys).map(assetIdFromCanonicalKey)
        ].filter(Boolean));
        for (const assetId of assetIds) {
            addLink({
                assetId,
                evidenceSha256: evidence.sha256,
                promptSha256: null,
                status: 'valid',
                source: 'metadata_snapshot'
            });
        }
    }

    const validSidecarsByTarget = new Map();
    for (const sidecar of array(input.promptSidecars)) {
        const evidence = evidenceByKey.get(sidecar.objectKey);
        const assetId = assetIdFromCanonicalKey(sidecar.targetKey);
        if (!evidence || evidence.parseStatus !== 'ok' || !assetId) continue;
        const fatalIssues = array(sidecar.issues).filter((issue) => issue !== 'asset_id_missing');
        const valid = sidecar.status === 'ok'
            && sidecar.targetExists === true
            && sidecar.promptPresent === true
            && fatalIssues.length === 0
            && normalizeSha256(sidecar.rawPromptSha256);
        addLink({
            assetId,
            evidenceSha256: evidence.sha256,
            promptSha256: sidecar.rawPromptSha256,
            status: valid ? 'valid' : 'invalid',
            issues: fatalIssues,
            source: 'prompt_sidecar'
        });
        if (valid) validSidecarsByTarget.set(sidecar.targetKey, { sidecar, assetId });
    }

    const promptById = new Map(array(input.canonicalPromptRows).map((row) => [row.prompt_ref_id, row]));
    const storageByKey = new Map(array(input.canonicalStorageRows).map((row) => [row.object_key, row]));
    for (const comparison of array(input.promptComparisons)) {
        if (comparison.sidecarPromptMatchesCanonicalEvidence !== false) continue;
        const validSidecar = validSidecarsByTarget.get(comparison.targetKey);
        if (!validSidecar) continue;
        const storage = storageByKey.get(comparison.targetKey);
        const expectedHashes = new Set(parsePromptRefIds(storage?.prompt_ref_ids_json)
            .flatMap((id) => {
                const row = promptById.get(id);
                return [row?.prompt_sha256, row?.original_prompt_sha256];
            })
            .map(normalizeSha256)
            .filter(Boolean));
        if (expectedHashes.size === 0) {
            warnings.push({ code: 'prompt_conflict_proof_missing', objectKey: comparison.targetKey });
            continue;
        }
        for (const promptSha256 of expectedHashes) {
            addLink({
                assetId: validSidecar.assetId,
                evidenceSha256: null,
                promptSha256,
                status: 'conflict',
                issues: ['d1_prompt_mismatch'],
                source: 'd1_canonical_projection'
            });
        }
    }

    for (const sidecar of array(input.assetMetadataSidecars)) {
        const evidence = evidenceByKey.get(sidecar.objectKey);
        const assetId = assetIdFromCanonicalKey(sidecar.targetKey);
        if (!evidence || evidence.parseStatus !== 'ok' || !assetId) continue;
        const issues = array(sidecar.issues);
        const valid = sidecar.status === 'ok'
            && sidecar.targetExists === true
            && issues.length === 0
            && normalizeSha256(sidecar.promptSha256);
        addLink({
            assetId,
            evidenceSha256: evidence.sha256,
            promptSha256: sidecar.promptSha256,
            status: valid ? 'valid' : 'invalid',
            issues,
            source: 'asset_metadata_v2'
        });
    }

    const sourceQuarantine = sourceObjects
        .filter((object) => !object.isMedia && !EVIDENCE_PATH_CLASSES.has(object.pathClass))
        .map((object) => ({
            reason: object.pathClass === 'system'
                ? 'system_object'
                : object.pathClass === 'out-of-prefix'
                    ? 'out_of_prefix_object'
                    : object.pathClass === 'repair'
                        ? 'repair_artifact'
                        : 'unclassified_source_object',
            sourceObjectKeys: [object.key],
            issues: [`source_path_class:${object.pathClass || 'unknown'}`]
        }));

    const deduplicatedLinks = [...new Map(links.map((link) => [stableStringify(link), link])).values()]
        .sort((first, second) => stableStringify(first).localeCompare(stableStringify(second)));
    warnings.sort((first, second) => stableStringify(first).localeCompare(stableStringify(second)));
    sourceQuarantine.sort((first, second) => first.sourceObjectKeys[0].localeCompare(second.sourceObjectKeys[0]));

    return {
        evidenceObjects: [...evidenceByKey.values()].sort((first, second) => first.sha256.localeCompare(second.sha256)),
        evidenceLinks: deduplicatedLinks,
        sourceQuarantine,
        warnings
    };
}

module.exports = {
    assetIdFromCanonicalKey,
    buildEvidenceInventory
};
