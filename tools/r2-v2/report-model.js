function countBy(rows, key) {
    const counts = {};
    for (const row of rows || []) {
        const value = typeof key === 'function' ? key(row) : row[key];
        const label = String(value || 'unknown');
        counts[label] = (counts[label] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(counts).sort(([first], [second]) => first.localeCompare(second)));
}

function buildPublicManifest(plan, snapshot, generatedAt = new Date().toISOString()) {
    const counts = plan.counts;
    const sourceFingerprint = snapshot.listingPasses?.at(-1)?.fingerprintSha256 || null;
    return {
        schemaVersion: 1,
        generatedAt,
        status: snapshot.status === 'verified'
            && snapshot.finalListingStable === true
            && snapshot.failedMediaProofCount === 0
            ? 'awaiting_cloud_resource_approval'
            : 'blocked',
        source: {
            bucket: snapshot.source?.bucket || 'grok-gallery-001',
            prefix: snapshot.source?.prefix || 'grok-powertools/v1',
            listingFingerprintSha256: sourceFingerprint,
            listingPasses: (snapshot.listingPasses || []).map((pass) => ({
                fingerprintSha256: pass.fingerprintSha256,
                objectCount: pass.objectCount,
                pageCount: pass.pageCount
            })),
            objectCount: snapshot.objectCount,
            totalBytes: snapshot.totalBytes,
            mediaObjectCount: counts.sourceMediaObjects,
            mediaBytes: counts.sourceMediaBytes,
            decoderProofs: snapshot.mediaProofCount,
            failedDecoderProofs: snapshot.failedMediaProofCount
        },
        destination: {
            bucket: 'grok-gallery-002',
            prefix: 'grok-powertools/v2',
            d1Database: 'grok-powertools-vault-v2',
            worker: 'grok-r2-vault-v2-shadow',
            predictedObjects: counts.destinationObjects,
            predictedBytes: counts.destinationBytes,
            blobObjects: counts.blobObjects,
            blobBytes: counts.blobBytes,
            assetManifests: counts.assetManifests,
            evidenceObjects: counts.evidenceObjects,
            quarantineRecords: counts.quarantineRecords,
            duplicateMediaBytesRemoved: counts.duplicateMediaBytesRemoved
        },
        classification: {
            blobsByStatus: countBy(plan.blobs, 'verificationStatus'),
            blobsByMediaType: countBy(plan.blobs, 'mediaType'),
            assetGapsByCode: countBy(
                (plan.assets || []).flatMap((asset) => asset.gapCodes || []).map((code) => ({ code })),
                'code'
            ),
            warningsByCode: countBy(plan.warnings, 'code')
        },
        quarantine: {
            total: counts.quarantineRecords,
            byReason: countBy(plan.quarantine, 'reason')
        },
        d1ProjectedRows: {
            blobs: counts.blobObjects,
            assets: counts.assetManifests,
            sources: counts.sourceRows,
            evidence: counts.evidenceObjects,
            quarantine: counts.quarantineRecords,
            migrationActions: counts.destinationObjects
        },
        planSha256: plan.planSha256,
        safety: {
            sourceWrites: 0,
            destinationWrites: 0,
            cloudResourcesCreated: 0,
            nextGate: 'Approve bucket, D1, and shadow Worker creation before any cloud mutation.'
        },
        rollback: [
            'Keep grok-gallery-001 unchanged and active during snapshot migration.',
            'Discard unused v2 resources before cutover if destination validation fails.',
            'After cutover failure, replay v2-only assets into 001 from the migration ledger and restore the prior Worker deployment.'
        ]
    };
}

function formatBytes(value) {
    const bytes = Number(value) || 0;
    return `${bytes.toLocaleString('en-US')} bytes (${(bytes / (1024 ** 3)).toFixed(3)} GiB)`;
}

function formatCount(value) {
    return (Number(value) || 0).toLocaleString('en-US');
}

function rowsForMap(map) {
    const entries = Object.entries(map || {});
    return entries.length
        ? entries.map(([key, value]) => `| ${key} | ${formatCount(value)} |`).join('\n')
        : '| none | 0 |';
}

function renderPublicReport(manifest) {
    return `# Grok Gallery v2 migration manifest\n\n`
        + `Generated: ${manifest.generatedAt}\n\n`
        + `Status: ${manifest.status}\n\n`
        + `## Stable source proof\n\n`
        + `- Bucket: \`${manifest.source.bucket}\`\n`
        + `- Listing fingerprint: \`${manifest.source.listingFingerprintSha256}\`\n`
        + `- Objects: ${formatCount(manifest.source.objectCount)}\n`
        + `- Bytes: ${formatBytes(manifest.source.totalBytes)}\n`
        + `- Unique decoder proofs: ${formatCount(manifest.source.decoderProofs)}\n`
        + `- Failed decoder proofs: ${formatCount(manifest.source.failedDecoderProofs)}\n\n`
        + `## Predicted destination\n\n`
        + `| Measure | Count |\n| ------- | ----: |\n`
        + `| Blob objects | ${formatCount(manifest.destination.blobObjects)} |\n`
        + `| Asset manifests | ${formatCount(manifest.destination.assetManifests)} |\n`
        + `| Evidence objects | ${formatCount(manifest.destination.evidenceObjects)} |\n`
        + `| Quarantine records | ${formatCount(manifest.destination.quarantineRecords)} |\n`
        + `| Total objects | ${formatCount(manifest.destination.predictedObjects)} |\n\n`
        + `Predicted bytes: ${formatBytes(manifest.destination.predictedBytes)}. Duplicate source media bytes removed: ${formatBytes(manifest.destination.duplicateMediaBytesRemoved)}.\n\n`
        + `## Quarantine\n\n| Reason | Records |\n| ------ | ------: |\n`
        + `${rowsForMap(manifest.quarantine.byReason)}\n\n`
        + `## D1 projection\n\n| Table | Rows |\n| ----- | ---: |\n`
        + `${rowsForMap(manifest.d1ProjectedRows)}\n\n`
        + `## Rollback\n\n`
        + manifest.rollback.map((step, index) => `${index + 1}. ${step}`).join('\n')
        + `\n\n## Approval gate\n\n${manifest.safety.nextGate}\n`;
}

module.exports = {
    buildPublicManifest,
    renderPublicReport
};
