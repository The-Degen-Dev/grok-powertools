#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import evidenceModel from './evidence-model.js';
import migrationModel from './migration-model.js';
import reportModel from './report-model.js';
import validationModel from './validation-model.js';

const { buildEvidenceInventory } = evidenceModel;
const { buildMigrationPlan } = migrationModel;
const { buildPublicManifest, renderPublicReport } = reportModel;
const { validateMigrationPlan } = validationModel;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 2) {
        const token = argv[index];
        const value = argv[index + 1];
        if (!token?.startsWith('--') || !value || value.startsWith('--')) {
            throw new Error(`invalid_argument:${token || 'missing'}`);
        }
        args[token.slice(2)] = value;
    }
    return args;
}

async function readJson(filePath) {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readJsonl(filePath) {
    const contents = await fs.readFile(filePath, 'utf8');
    return contents.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function atomicWrite(filePath, contents) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp-${process.pid}`;
    await fs.writeFile(temporary, contents);
    await fs.rename(temporary, filePath);
}

async function writeJson(filePath, value) {
    await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args['snapshot-root']) throw new Error('snapshot_root_required');
    if (!args['audit-root']) throw new Error('audit_root_required');
    const snapshotRoot = path.resolve(args['snapshot-root']);
    const auditRoot = path.resolve(args['audit-root']);
    const outputRoot = path.resolve(args['output-root'] || path.join(
        repoRoot,
        'docs/audits/2026-08-19-grok-gallery-v2-migration'
    ));
    const privateRoot = path.join(outputRoot, 'private');

    const [
        snapshot,
        sourceObjects,
        mediaHashes,
        nonMediaHashes,
        mediaProofs,
        metadataObjectInventory,
        metadataReferenceInventory,
        promptSidecars,
        promptComparisons,
        assetMetadataSidecars,
        canonicalStorageRows,
        canonicalPromptRows
    ] = await Promise.all([
        readJson(path.join(snapshotRoot, 'source-snapshot.json')),
        readJsonl(path.join(snapshotRoot, 'r2-objects.jsonl')),
        readJsonl(path.join(snapshotRoot, 'media-hashes.jsonl')),
        readJsonl(path.join(snapshotRoot, 'nonmedia-hashes.jsonl')),
        readJsonl(path.join(snapshotRoot, 'media-proofs.jsonl')),
        readJson(path.join(auditRoot, 'inventory/metadata-objects.json')),
        readJson(path.join(auditRoot, 'inventory/metadata-references.json')),
        readJsonl(path.join(auditRoot, 'private/prompt-sidecar-audit.jsonl')),
        readJsonl(path.join(auditRoot, 'private/prompt-sidecar-canonical-comparison.jsonl')),
        readJsonl(path.join(auditRoot, 'private/asset-metadata-v2-audit.jsonl')),
        readJsonl(path.join(auditRoot, 'inventory/d1-canonical-storage-object-projection.jsonl')),
        readJsonl(path.join(auditRoot, 'inventory/d1-canonical-prompt-ref-projection.jsonl'))
    ]);

    if (snapshot.source?.bucket !== 'grok-gallery-001') throw new Error('source_bucket_mismatch');
    if (snapshot.source?.prefix !== 'grok-powertools/v1') throw new Error('source_prefix_mismatch');

    const evidence = buildEvidenceInventory({
        sourceObjects,
        nonMediaHashes,
        priorMetadataObjects: metadataObjectInventory.objects,
        metadataReferences: metadataReferenceInventory.references,
        promptSidecars,
        promptComparisons,
        assetMetadataSidecars,
        canonicalStorageRows,
        canonicalPromptRows
    });
    const mediaObjects = sourceObjects.filter((object) => object.isMedia);
    const plan = buildMigrationPlan({
        source: {
            bucket: snapshot.source.bucket,
            prefix: snapshot.source.prefix,
            listingFingerprintSha256: snapshot.listingPasses.at(-1)?.fingerprintSha256,
            objectCount: snapshot.objectCount,
            totalBytes: snapshot.totalBytes
        },
        mediaObjects,
        mediaHashes,
        mediaProofs,
        evidenceObjects: evidence.evidenceObjects,
        evidenceLinks: evidence.evidenceLinks,
        sourceQuarantine: evidence.sourceQuarantine,
        warnings: evidence.warnings
    });
    const validation = validateMigrationPlan({
        plan,
        snapshot,
        sourceObjects,
        mediaHashes,
        mediaProofs
    });
    const generatedAt = new Date().toISOString();
    const publicManifest = buildPublicManifest(plan, snapshot, generatedAt);
    if (validation.status !== 'passed') publicManifest.status = 'blocked';

    await writeJson(path.join(privateRoot, 'migration-plan.json'), plan);
    await writeJson(path.join(privateRoot, 'migration-validation.json'), validation);
    await writeJson(path.join(outputRoot, 'manifest.json'), publicManifest);
    await atomicWrite(path.join(outputRoot, 'REPORT.md'), renderPublicReport(publicManifest));

    console.log(JSON.stringify({
        status: publicManifest.status,
        sourceFingerprintSha256: publicManifest.source.listingFingerprintSha256,
        destinationObjects: publicManifest.destination.predictedObjects,
        destinationBytes: publicManifest.destination.predictedBytes,
        quarantineRecords: publicManifest.quarantine.total,
        planSha256: publicManifest.planSha256,
        validation: validation.status
    }));
    if (publicManifest.status === 'blocked') process.exitCode = 2;
}

main().catch((error) => {
    console.error(JSON.stringify({ status: 'error', code: String(error?.message || 'manifest_failed') }));
    process.exitCode = 1;
});
