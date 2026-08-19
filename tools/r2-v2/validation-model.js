function validateMigrationPlan({ plan, snapshot, sourceObjects, mediaHashes, mediaProofs }) {
    const mediaObjects = sourceObjects.filter((object) => object.isMedia);
    const blobHashes = new Set(plan.blobs.map((blob) => blob.sha256));
    const evidenceHashes = new Set(plan.evidence.map((evidence) => evidence.sha256));
    const referencedBlobHashes = new Set([
        ...plan.assets.map((asset) => asset.blobSha256),
        ...plan.quarantine.map((record) => record.blobSha256).filter(Boolean)
    ]);
    const checks = {
        snapshotVerified: snapshot.status === 'verified',
        finalListingStable: snapshot.finalListingStable === true,
        sourceObjectCountMatches: sourceObjects.length === snapshot.objectCount,
        mediaObjectCountMatches: mediaObjects.length === snapshot.mediaObjectCount,
        mediaHashCountMatches: mediaHashes.length === mediaObjects.length,
        mediaProofCountMatches: mediaProofs.length === snapshot.uniqueMediaHashCount,
        noDuplicateBlobHashes: blobHashes.size === plan.blobs.length,
        noDanglingAssetBlobReferences: plan.assets.every((asset) => blobHashes.has(asset.blobSha256)),
        noDanglingAssetEvidenceReferences: plan.assets.every((asset) => (
            asset.evidenceHashes.every((sha256) => evidenceHashes.has(sha256))
        )),
        noUnreferencedBlobs: plan.blobs.every((blob) => referencedBlobHashes.has(blob.sha256)),
        quarantineCountMatches: plan.quarantine.length === plan.counts.quarantineRecords,
        destinationObjectCountMatches: plan.counts.destinationObjects === (
            plan.blobs.length + plan.assets.length + plan.evidence.length + plan.quarantine.length
        )
    };
    return {
        status: Object.values(checks).every(Boolean) ? 'passed' : 'failed',
        checks
    };
}

module.exports = { validateMigrationPlan };
