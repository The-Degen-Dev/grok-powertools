const { createHash } = require('node:crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const V2_PREFIX = 'grok-powertools/v2';

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
        if (value[key] !== undefined) result[key] = stableValue(value[key]);
        return result;
    }, {});
}

function stableStringify(value) {
    return JSON.stringify(stableValue(value));
}

function sha256Text(value) {
    return createHash('sha256').update(value).digest('hex');
}

function normalizeSha256(value) {
    const normalized = String(value || '').toLowerCase();
    return SHA256_RE.test(normalized) ? normalized : null;
}

function normalizeGrokAssetId(value) {
    const candidate = String(value || '').replace(/^media_/i, '').toLowerCase();
    return UUID_RE.test(candidate) ? candidate : null;
}

function destinationBlobKey(sha256) {
    const normalized = normalizeSha256(sha256);
    if (!normalized) throw new Error('invalid_blob_sha256');
    return `${V2_PREFIX}/blobs/sha256/${normalized.slice(0, 2)}/${normalized}`;
}

function destinationEvidenceKey(sha256) {
    const normalized = normalizeSha256(sha256);
    if (!normalized) throw new Error('invalid_evidence_sha256');
    return `${V2_PREFIX}/evidence/sha256/${normalized.slice(0, 2)}/${normalized}`;
}

function destinationAssetKey(userId, assetId) {
    return `${V2_PREFIX}/users/${encodeURIComponent(userId)}/assets/${assetId}.json`;
}

function destinationQuarantineKey(reason, recordId) {
    return `${V2_PREFIX}/quarantine/${reason}/${recordId}.json`;
}

function sortStrings(values) {
    return [...new Set(values.filter(Boolean).map(String))].sort();
}

function mapBy(items, keyFn) {
    const result = new Map();
    for (const item of items) {
        const key = keyFn(item);
        if (!result.has(key)) result.set(key, []);
        result.get(key).push(item);
    }
    return result;
}

function sourcePreference(source) {
    const pathRank = source.pathClass === 'canonical-media'
        ? 0
        : (source.pathClass === 'legacy-date-media' ? 1 : 2);
    return `${pathRank}:${String(source.key || '')}`;
}

function choosePreferredSource(sources) {
    return [...sources].sort((first, second) => (
        sourcePreference(first).localeCompare(sourcePreference(second))
    ))[0] || null;
}

function sourceDeclaredMediaType(source) {
    if (source.mediaType === 'image' || source.mediaType === 'video') return source.mediaType;
    const pathname = String(source.key || '').split(/[?#]/, 1)[0].toLowerCase();
    if (/\.(?:avif|gif|heic|jpe?g|png|webp)$/.test(pathname)) return 'image';
    if (/\.(?:m4v|mov|mp4|webm)$/.test(pathname)) return 'video';
    return null;
}

function recordId(value) {
    return sha256Text(stableStringify(value)).slice(0, 24);
}

function quarantineRecord(reason, fields) {
    const identity = {
        reason,
        assetId: fields.assetId || null,
        blobSha256: fields.blobSha256 || null,
        evidenceSha256: fields.evidenceSha256 || null,
        sourceObjectKeys: sortStrings(fields.sourceObjectKeys || [])
    };
    const id = recordId(identity);
    return {
        recordId: id,
        reason,
        key: destinationQuarantineKey(reason, id),
        ...fields,
        sourceObjectKeys: identity.sourceObjectKeys
    };
}

function buildEvidence(evidenceObjects, quarantine) {
    const validObjects = [];
    for (const object of evidenceObjects || []) {
        const sha256 = normalizeSha256(object.sha256);
        if (!sha256) {
            quarantine.push(quarantineRecord('evidence_hash_invalid', {
                sourceObjectKeys: [object.objectKey]
            }));
            continue;
        }
        validObjects.push({
            ...object,
            sha256,
            sizeBytes: Number(object.sizeBytes ?? object.size) || 0
        });
    }

    return [...mapBy(validObjects, (item) => item.sha256).entries()]
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([sha256, sources]) => {
            const sizes = [...new Set(sources.map((source) => source.sizeBytes))];
            const parseStatuses = sortStrings(sources.map((source) => source.parseStatus || 'unknown'));
            if (sizes.length !== 1) {
                quarantine.push(quarantineRecord('evidence_size_conflict', {
                    evidenceSha256: sha256,
                    sourceObjectKeys: sources.map((source) => source.objectKey)
                }));
            }
            return {
                sha256,
                key: destinationEvidenceKey(sha256),
                sizeBytes: sizes.length === 1 ? sizes[0] : Math.max(...sizes, 0),
                parseStatuses,
                sourceObjectKeys: sortStrings(sources.map((source) => source.objectKey)),
                verificationStatus: sizes.length === 1 && parseStatuses.every((status) => status === 'ok')
                    ? 'verified'
                    : 'quarantined'
            };
        });
}

function buildMigrationPlan(input) {
    const mediaObjects = (input.mediaObjects || []).filter((object) => object?.isMedia !== false);
    const mediaHashesByKey = new Map((input.mediaHashes || []).map((row) => [row.objectKey, row]));
    const proofRowsByHash = mapBy(
        (input.mediaProofs || []).map((row) => ({ ...row, sha256: normalizeSha256(row.sha256) })),
        (row) => row.sha256
    );
    const quarantine = [];
    const warnings = [...(input.warnings || [])];
    const validHashedObjects = [];

    for (const record of input.sourceQuarantine || []) {
        quarantine.push(quarantineRecord(record.reason || 'unclassified_source_object', {
            sourceObjectKeys: record.sourceObjectKeys || [],
            issues: sortStrings(record.issues || [])
        }));
    }

    for (const object of mediaObjects) {
        const hashRow = mediaHashesByKey.get(object.key);
        const sha256 = normalizeSha256(hashRow?.sha256);
        const size = Number(object.size) || 0;
        if (!hashRow || hashRow.status !== 'ok' || !sha256 || Number(hashRow.bytesRead) !== size) {
            quarantine.push(quarantineRecord('media_hash_unverified', {
                sourceObjectKeys: [object.key]
            }));
            continue;
        }
        validHashedObjects.push({ ...object, sha256, size });
    }

    const objectsByHash = mapBy(validHashedObjects, (object) => object.sha256);
    const blobStatusByHash = new Map();
    const blobs = [...objectsByHash.entries()]
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([sha256, sources]) => {
            const proofRows = proofRowsByHash.get(sha256) || [];
            const proofTypes = sortStrings(proofRows.map((row) => row.mediaType));
            const sourceSizes = [...new Set(sources.map((source) => source.size))];
            const proofSizes = [...new Set(proofRows.map((row) => Number(row.sizeBytes) || 0))];
            let reason = null;
            if (proofRows.length === 0) reason = 'media_proof_missing';
            else if (proofTypes.length !== 1 || !['image', 'video'].includes(proofTypes[0])) {
                reason = 'media_type_conflict';
            } else if (proofRows.some((row) => row.signatureStatus !== 'verified')) {
                reason = 'media_signature_failed';
            } else if (proofRows.some((row) => row.decoderStatus !== 'verified')) {
                reason = 'media_decoder_failed';
            } else if (sourceSizes.length !== 1 || proofSizes.length !== 1 || sourceSizes[0] !== proofSizes[0]) {
                reason = 'media_size_conflict';
            }

            const mediaType = proofTypes.length === 1 ? proofTypes[0] : 'unknown';
            const proof = proofRows[0] || {};
            const mediaFacts = stableValue({
                format: proof.format || 'unknown',
                contentType: proof.contentType || null,
                width: Number(proof.width) || null,
                height: Number(proof.height) || null,
                durationSeconds: Number(proof.durationSeconds) || null,
                videoCodec: proof.videoCodec || null,
                hasAudio: proof.hasAudio === true,
                audioCodecs: sortStrings(proof.audioCodecs || [])
            });
            const sourceObjectKeys = sortStrings(sources.map((source) => source.key));
            if (reason) {
                quarantine.push(quarantineRecord(reason, { blobSha256: sha256, sourceObjectKeys }));
            } else {
                for (const source of sources) {
                    const declared = sourceDeclaredMediaType(source);
                    if (declared && declared !== mediaType) {
                        warnings.push({
                            code: 'source_media_type_mismatch',
                            blobSha256: sha256,
                            sourceObjectKey: source.key,
                            declaredMediaType: declared,
                            verifiedMediaType: mediaType
                        });
                    }
                }
            }
            blobStatusByHash.set(sha256, reason ? 'quarantined' : 'verified');
            return {
                sha256,
                key: destinationBlobKey(sha256),
                sizeBytes: sourceSizes.length === 1 ? sourceSizes[0] : Math.max(...sourceSizes, 0),
                mediaType,
                mediaFacts,
                verificationStatus: reason ? 'quarantined' : 'verified',
                preferredSourceObjectKey: choosePreferredSource(sources)?.key || null,
                sourceObjectKeys
            };
        });

    const evidence = buildEvidence(input.evidenceObjects || [], quarantine);
    const evidenceByHash = new Map(evidence.map((item) => [item.sha256, item]));
    const linksByAssetId = mapBy(
        (input.evidenceLinks || []).map((link) => ({
            ...link,
            normalizedAssetId: normalizeGrokAssetId(link.assetId),
            evidenceSha256: normalizeSha256(link.evidenceSha256),
            promptSha256: normalizeSha256(link.promptSha256)
        })).filter((link) => link.normalizedAssetId),
        (link) => link.normalizedAssetId
    );

    for (const [sha256, sources] of objectsByHash.entries()) {
        const validAssetIds = sortStrings(sources.map((source) => normalizeGrokAssetId(source.assetId)));
        if (validAssetIds.length === 0) {
            quarantine.push(quarantineRecord('asset_identity_missing', {
                blobSha256: sha256,
                sourceObjectKeys: sources.map((source) => source.key)
            }));
        }
        for (const source of sources) {
            if (source.assetId && !normalizeGrokAssetId(source.assetId)) {
                quarantine.push(quarantineRecord('asset_identity_invalid', {
                    blobSha256: sha256,
                    sourceObjectKeys: [source.key]
                }));
            }
        }
    }

    const identifiedObjects = validHashedObjects.filter((object) => normalizeGrokAssetId(object.assetId));
    const objectsByAssetId = mapBy(identifiedObjects, (object) => normalizeGrokAssetId(object.assetId));
    const assets = [];
    for (const [assetId, sources] of [...objectsByAssetId.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const hashes = sortStrings(sources.map((source) => source.sha256));
        if (hashes.length !== 1) {
            for (const blobSha256 of hashes) {
                quarantine.push(quarantineRecord('asset_payload_conflict', {
                    assetId,
                    blobSha256,
                    sourceObjectKeys: sources
                        .filter((source) => source.sha256 === blobSha256)
                        .map((source) => source.key)
                }));
            }
            continue;
        }

        const blobSha256 = hashes[0];
        if (blobStatusByHash.get(blobSha256) !== 'verified') continue;
        const userIds = sortStrings(sources.map((source) => source.userId));
        if (userIds.length !== 1) {
            quarantine.push(quarantineRecord('asset_user_conflict', {
                assetId,
                blobSha256,
                sourceObjectKeys: sources.map((source) => source.key),
                userIds
            }));
            continue;
        }

        const links = linksByAssetId.get(assetId) || [];
        const validLinks = links.filter((link) => (
            link.status === 'valid'
            && link.evidenceSha256
            && evidenceByHash.get(link.evidenceSha256)?.verificationStatus === 'verified'
        ));
        const invalidLinks = links.filter((link) => !validLinks.includes(link));
        for (const link of invalidLinks) {
            quarantine.push(quarantineRecord('metadata_evidence_invalid', {
                assetId,
                blobSha256,
                evidenceSha256: link.evidenceSha256,
                sourceObjectKeys: sources.map((source) => source.key),
                issues: sortStrings(link.issues || [])
            }));
        }
        const promptHashes = sortStrings(links.map((link) => link.promptSha256));
        if (promptHashes.length > 1) {
            quarantine.push(quarantineRecord('prompt_evidence_conflict', {
                assetId,
                blobSha256,
                sourceObjectKeys: sources.map((source) => source.key),
                evidenceHashes: sortStrings(validLinks.map((link) => link.evidenceSha256))
            }));
            continue;
        }

        const evidenceHashes = sortStrings(validLinks.map((link) => link.evidenceSha256));
        let gapCodes = [];
        if (evidenceHashes.length === 0) {
            gapCodes = links.length === 0 ? ['metadata_missing'] : ['metadata_invalid'];
        } else if (promptHashes.length === 0) {
            gapCodes = ['prompt_missing'];
        }
        const blob = blobs.find((item) => item.sha256 === blobSha256);
        assets.push({
            assetId,
            userId: userIds[0],
            key: destinationAssetKey(userIds[0], assetId),
            blobSha256,
            blobKey: destinationBlobKey(blobSha256),
            mediaType: blob.mediaType,
            mediaFacts: blob.mediaFacts,
            sizeBytes: blob.sizeBytes,
            sourceObjectKeys: sortStrings(sources.map((source) => source.key)),
            evidenceHashes,
            verificationStatus: gapCodes.length ? 'metadata_gap' : 'verified',
            gapCodes
        });
    }

    warnings.sort((first, second) => stableStringify(first).localeCompare(stableStringify(second)));
    const finalizedQuarantine = [...new Map(quarantine.map((item) => [item.key, item])).values()];
    finalizedQuarantine.sort((first, second) => (
        `${first.reason}:${first.assetId || ''}:${first.blobSha256 || ''}:${first.recordId}`
            .localeCompare(`${second.reason}:${second.assetId || ''}:${second.blobSha256 || ''}:${second.recordId}`)
    ));

    const sourceMediaBytes = mediaObjects.reduce((sum, object) => sum + (Number(object.size) || 0), 0);
    const blobBytes = blobs.reduce((sum, blob) => sum + blob.sizeBytes, 0);
    const evidenceBytes = evidence.reduce((sum, item) => sum + item.sizeBytes, 0);
    const assetManifestBytes = assets.reduce((sum, item) => sum + Buffer.byteLength(`${stableStringify(item)}\n`), 0);
    const quarantineManifestBytes = finalizedQuarantine.reduce(
        (sum, item) => sum + Buffer.byteLength(`${stableStringify(item)}\n`),
        0
    );
    const plan = {
        schemaVersion: 1,
        source: stableValue(input.source || {}),
        destination: {
            bucket: 'grok-gallery-002',
            prefix: V2_PREFIX,
            d1Database: 'grok-powertools-vault-v2',
            worker: 'grok-r2-vault-v2-shadow'
        },
        blobs,
        assets,
        evidence,
        quarantine: finalizedQuarantine,
        warnings,
        counts: {
            sourceMediaObjects: mediaObjects.length,
            sourceMediaBytes,
            sourceRows: validHashedObjects.length,
            blobObjects: blobs.length,
            blobBytes,
            assetManifests: assets.length,
            assetManifestBytes,
            evidenceObjects: evidence.length,
            evidenceBytes,
            quarantineRecords: finalizedQuarantine.length,
            quarantineManifestBytes,
            metadataGaps: assets.filter((asset) => asset.gapCodes.includes('metadata_missing')).length,
            warnings: warnings.length,
            destinationObjects: blobs.length + assets.length + evidence.length + finalizedQuarantine.length,
            destinationBytes: blobBytes + assetManifestBytes + evidenceBytes + quarantineManifestBytes,
            duplicateMediaBytesRemoved: Math.max(0, sourceMediaBytes - blobBytes)
        }
    };
    return { ...plan, planSha256: sha256Text(stableStringify(plan)) };
}

module.exports = {
    buildMigrationPlan,
    choosePreferredSource,
    destinationAssetKey,
    destinationBlobKey,
    destinationEvidenceKey,
    destinationQuarantineKey,
    normalizeGrokAssetId,
    stableStringify
};
