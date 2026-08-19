#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import snapshotModel from './snapshot-model.js';
import retryModel from './retry.js';

const {
    classifyMediaSignature,
    classifySourceObjectKey,
    contentTypeForMedia,
    listingFingerprint,
    objectFingerprint,
    selectPrimaryMediaStream,
    selectBlobRepresentatives,
    stableListingsMatch
} = snapshotModel;

const execFileAsync = promisify(execFile);
const { withRetries } = retryModel;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const require = createRequire(path.join(repoRoot, 'cloud', 'package.json'));
const {
    GetObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    S3Client
} = require('@aws-sdk/client-s3');

const EXPECTED_ACCOUNT_ID = 'ba5339fd86e87c226bdc306347636042';
const EXPECTED_BUCKET = 'grok-gallery-001';
const EXPECTED_PREFIX = 'grok-powertools/v1';

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) throw new Error(`unexpected_argument:${token}`);
        const name = token.slice(2);
        if (name === 'allow-heavy-read') {
            args[name] = true;
            continue;
        }
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) throw new Error(`missing_argument_value:${name}`);
        args[name] = value;
        index += 1;
    }
    return args;
}

function positiveInteger(value, fallback) {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('positive_integer_required');
    return parsed;
}

function requireReadCredentials() {
    const names = ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
    const missing = names.filter((name) => !process.env[name]);
    if (missing.length) throw new Error(`missing_read_credentials:${missing.join(',')}`);
    if (process.env.CLOUDFLARE_ACCOUNT_ID !== EXPECTED_ACCOUNT_ID) {
        throw new Error('cloudflare_account_mismatch');
    }
}

function createReadClient() {
    requireReadCredentials();
    return new S3Client({
        region: 'auto',
        maxAttempts: 5,
        endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
        }
    });
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

async function writeJsonl(filePath, rows) {
    await atomicWrite(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

async function appendJsonl(filePath, row) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(row)}\n`);
}

async function readJsonl(filePath) {
    const text = await fs.readFile(filePath, 'utf8');
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function readJsonlIfPresent(filePath) {
    try {
        return await readJsonl(filePath);
    } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
    }
}

async function mapLimit(items, limit, mapper, onResult = null) {
    const results = new Array(items.length);
    let nextIndex = 0;
    async function worker() {
        for (;;) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) return;
            results[index] = await mapper(items[index], index);
            if (onResult) await onResult(results[index], index);
        }
    }
    const workerCount = Math.min(limit, Math.max(1, items.length));
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
}

async function listAllObjects(client, bucket, maxObjects) {
    const rows = [];
    const seenTokens = new Set();
    let continuationToken;
    let pageCount = 0;
    for (;;) {
        const response = await client.send(new ListObjectsV2Command({
            Bucket: bucket,
            ContinuationToken: continuationToken,
            MaxKeys: 1000
        }));
        pageCount += 1;
        for (const object of response.Contents || []) {
            if (!object.Key) continue;
            rows.push({
                key: object.Key,
                size: Number(object.Size) || 0,
                etag: String(object.ETag || '').replaceAll('"', ''),
                uploadedAt: object.LastModified?.toISOString?.() || String(object.LastModified || '')
            });
            if (rows.length > maxObjects) throw new Error('source_object_limit_exceeded');
        }
        if (!response.IsTruncated) break;
        const next = response.NextContinuationToken;
        if (!next) throw new Error('source_listing_cursor_missing');
        if (seenTokens.has(next)) throw new Error('source_listing_cursor_repeated');
        seenTokens.add(next);
        continuationToken = next;
    }
    rows.sort((first, second) => first.key.localeCompare(second.key));
    return { rows, pageCount, fingerprint: listingFingerprint(rows) };
}

async function headObject(client, bucket, listed) {
    const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: listed.key }));
    const contentType = String(response.ContentType || '');
    return {
        ...listed,
        size: Number(response.ContentLength) || listed.size,
        etag: String(response.ETag || listed.etag).replaceAll('"', ''),
        uploadedAt: response.LastModified?.toISOString?.() || listed.uploadedAt,
        contentType,
        customMetadata: response.Metadata || {},
        headStatus: 'ok',
        ...classifySourceObjectKey(listed.key, contentType, EXPECTED_PREFIX)
    };
}

async function hashBody(body, onChunk = null) {
    if (!body) throw new Error('source_body_missing');
    const hash = createHash('sha256');
    let bytesRead = 0;
    for await (const value of body) {
        const chunk = Buffer.from(value);
        hash.update(chunk);
        bytesRead += chunk.length;
        if (onChunk) await onChunk(chunk);
    }
    return { sha256: hash.digest('hex'), bytesRead };
}

async function hashObject(client, bucket, object) {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.key }));
    const hashed = await hashBody(response.Body);
    if (hashed.bytesRead !== Number(object.size)) throw new Error('source_size_mismatch');
    return {
        objectKey: object.key,
        sha256: hashed.sha256,
        bytesRead: hashed.bytesRead,
        objectFingerprint: objectFingerprint(object),
        status: 'ok'
    };
}

async function probeMediaObjectOnce(client, bucket, representative, tempRoot) {
    const temporaryPath = path.join(tempRoot, `${representative.sha256}-${process.pid}.media`);
    const file = await fs.open(temporaryPath, 'w');
    let firstBytes = Buffer.alloc(0);
    try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: representative.key }));
        const hashed = await hashBody(response.Body, async (chunk) => {
            if (firstBytes.length < 64) {
                firstBytes = Buffer.concat([firstBytes, chunk]).subarray(0, 64);
            }
            await file.write(chunk);
        });
        await file.close();
        if (hashed.bytesRead !== Number(representative.size)) throw new Error('decoder_size_mismatch');
        if (hashed.sha256 !== representative.sha256) throw new Error('decoder_hash_mismatch');

        const signature = classifyMediaSignature(firstBytes);
        if (signature.mediaType === 'unknown') throw new Error('media_signature_unknown');
        const { stdout } = await execFileAsync('/opt/homebrew/bin/ffprobe', [
            '-v', 'error',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            temporaryPath
        ], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
        const probe = JSON.parse(stdout);
        const primary = selectPrimaryMediaStream(probe.streams || [], signature.mediaType);
        if (!primary) throw new Error(signature.mediaType === 'video'
            ? 'decoder_motion_video_stream_missing'
            : 'decoder_image_stream_missing');
        await execFileAsync('/opt/homebrew/bin/ffmpeg', [
            '-v', 'error',
            '-i', temporaryPath,
            '-map', `0:${primary.index}`,
            '-frames:v', '1',
            '-f', 'null',
            '-'
        ], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });

        const audioCodecs = [...new Set((probe.streams || [])
            .filter((stream) => stream.codec_type === 'audio')
            .map((stream) => stream.codec_name)
            .filter(Boolean))].sort();
        return {
            sha256: representative.sha256,
            sizeBytes: hashed.bytesRead,
            mediaType: signature.mediaType,
            format: signature.format,
            contentType: contentTypeForMedia(signature.format, signature.mediaType),
            signatureStatus: 'verified',
            decoderStatus: 'verified',
            width: Number(primary.width) || null,
            height: Number(primary.height) || null,
            durationSeconds: Number(probe.format?.duration) || null,
            videoCodec: primary.codec_name || null,
            hasAudio: audioCodecs.length > 0,
            audioCodecs,
            representativeObjectFingerprint: objectFingerprint(representative),
            status: 'verified'
        };
    } finally {
        await file.close().catch(() => {});
        await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
}

async function probeMediaObject(client, bucket, representative, tempRoot) {
    try {
        return await withRetries(
            () => probeMediaObjectOnce(client, bucket, representative, tempRoot),
            { attempts: 3, baseDelayMs: 500 }
        );
    } catch (error) {
        return {
            sha256: representative.sha256,
            sizeBytes: Number(representative.size) || 0,
            mediaType: 'unknown',
            format: 'unknown',
            signatureStatus: 'failed',
            decoderStatus: 'failed',
            representativeObjectFingerprint: objectFingerprint(representative),
            status: 'failed',
            errorCode: String(error?.message || 'media_probe_failed').replace(/[^a-z0-9_:-]/gi, '_').slice(0, 120)
        };
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const mode = args.mode || 'list';
    if (!['list', 'full'].includes(mode)) throw new Error('unsupported_snapshot_mode');
    const bucket = args['source-bucket'] || EXPECTED_BUCKET;
    if (bucket !== EXPECTED_BUCKET) throw new Error('source_bucket_mismatch');
    const outputRoot = path.resolve(args['output-root'] || path.join(
        repoRoot,
        'docs/audits/2026-08-19-grok-gallery-v2-migration/private/source-snapshot'
    ));
    const priorRoot = args['prior-audit-root'] ? path.resolve(args['prior-audit-root']) : null;
    const stabilityWaitMs = positiveInteger(args['stability-wait-ms'], 60000);
    const maxObjects = positiveInteger(args['max-objects'], 100000);
    const headConcurrency = positiveInteger(args['head-concurrency'], 16);
    const hashConcurrency = positiveInteger(args['hash-concurrency'], 4);
    const decoderConcurrency = positiveInteger(args['decoder-concurrency'], 2);
    if (mode === 'full' && args['allow-heavy-read'] !== true) {
        throw new Error('heavy_read_not_armed');
    }
    if (mode === 'full' && !priorRoot) throw new Error('prior_audit_root_required');

    const client = createReadClient();
    await fs.mkdir(outputRoot, { recursive: true });
    const first = await listAllObjects(client, bucket, maxObjects);
    await new Promise((resolve) => setTimeout(resolve, stabilityWaitMs));
    const second = await listAllObjects(client, bucket, maxObjects);
    const stable = stableListingsMatch(first.rows, second.rows);
    const baseSummary = {
        schemaVersion: 1,
        mode,
        source: { bucket, prefix: EXPECTED_PREFIX },
        status: stable ? 'stable' : 'listing_drift',
        listingPasses: [
            { fingerprintSha256: first.fingerprint, objectCount: first.rows.length, pageCount: first.pageCount },
            { fingerprintSha256: second.fingerprint, objectCount: second.rows.length, pageCount: second.pageCount }
        ],
        objectCount: second.rows.length,
        totalBytes: second.rows.reduce((sum, object) => sum + object.size, 0),
        stabilityWaitMs
    };
    await writeJson(path.join(outputRoot, 'source-snapshot.json'), baseSummary);
    await writeJsonl(path.join(outputRoot, 'source-listing.jsonl'), second.rows);
    if (!stable) {
        process.exitCode = 2;
        console.log(JSON.stringify({ status: 'listing_drift', objectCount: second.rows.length }));
        return;
    }
    if (mode === 'list') {
        console.log(JSON.stringify({
            status: 'stable',
            objectCount: second.rows.length,
            fingerprintSha256: second.fingerprint
        }));
        return;
    }

    const priorObjects = await readJsonl(path.join(priorRoot, 'inventory/r2-objects.jsonl'));
    const priorHashes = await readJsonl(path.join(priorRoot, 'inventory/r2-media-hashes.jsonl'));
    const priorObjectsByKey = new Map(priorObjects.map((object) => [object.key, object]));
    const priorHashesByKey = new Map(priorHashes.map((row) => [row.objectKey, row]));
    const enriched = await mapLimit(second.rows, headConcurrency, async (listed) => {
        const prior = priorObjectsByKey.get(listed.key);
        if (prior && objectFingerprint(prior) === objectFingerprint(listed)) {
            return { ...prior, ...listed };
        }
        return withRetries(() => headObject(client, bucket, listed), { attempts: 3, baseDelayMs: 500 });
    });
    enriched.sort((firstObject, secondObject) => firstObject.key.localeCompare(secondObject.key));
    await writeJsonl(path.join(outputRoot, 'r2-objects.jsonl'), enriched);

    const mediaObjects = enriched.filter((object) => object.isMedia);
    const nonMediaObjects = enriched.filter((object) => !object.isMedia);
    const nonMediaHashes = await mapLimit(nonMediaObjects, hashConcurrency, (object) => (
        withRetries(() => hashObject(client, bucket, object), { attempts: 3, baseDelayMs: 500 })
    ));
    nonMediaHashes.sort((firstRow, secondRow) => firstRow.objectKey.localeCompare(secondRow.objectKey));
    await writeJsonl(path.join(outputRoot, 'nonmedia-hashes.jsonl'), nonMediaHashes);

    const mediaHashes = await mapLimit(mediaObjects, hashConcurrency, async (object) => {
        const prior = priorHashesByKey.get(object.key);
        if (
            prior?.status === 'ok'
            && prior.objectFingerprint === objectFingerprint(object)
            && Number(prior.bytesRead) === Number(object.size)
        ) {
            return { ...prior, evidenceSource: 'etag-bound-prior-proof' };
        }
        return {
            ...(await withRetries(
                () => hashObject(client, bucket, object),
                { attempts: 3, baseDelayMs: 500 }
            )),
            evidenceSource: 'fresh-source-read'
        };
    });
    mediaHashes.sort((firstRow, secondRow) => firstRow.objectKey.localeCompare(secondRow.objectKey));
    await writeJsonl(path.join(outputRoot, 'media-hashes.jsonl'), mediaHashes);

    const hashByKey = new Map(mediaHashes.map((row) => [row.objectKey, row.sha256]));
    const representatives = selectBlobRepresentatives(mediaObjects.map((object) => ({
        ...object,
        sha256: hashByKey.get(object.key)
    })));
    const proofsPath = path.join(outputRoot, 'media-proofs.jsonl');
    const priorProofs = await readJsonlIfPresent(proofsPath);
    const proofsByHash = new Map(priorProofs.map((row) => [row.sha256, row]));
    const pendingRepresentatives = representatives.filter((representative) => {
        const prior = proofsByHash.get(representative.sha256);
        return !(
            prior?.status === 'verified'
            && prior.representativeObjectFingerprint === objectFingerprint(representative)
        );
    });
    const tempRoot = path.resolve(args['temp-dir'] || os.tmpdir());
    await fs.mkdir(tempRoot, { recursive: true });
    let checkpointWrite = Promise.resolve();
    await mapLimit(
        pendingRepresentatives,
        decoderConcurrency,
        (representative) => probeMediaObject(client, bucket, representative, tempRoot),
        async (result) => {
            proofsByHash.set(result.sha256, result);
            checkpointWrite = checkpointWrite.then(() => appendJsonl(proofsPath, result));
            await checkpointWrite;
        }
    );
    const mediaProofs = [...proofsByHash.values()]
        .filter((row) => representatives.some((representative) => representative.sha256 === row.sha256))
        .sort((firstRow, secondRow) => firstRow.sha256.localeCompare(secondRow.sha256));
    await writeJsonl(proofsPath, mediaProofs);

    const finalListing = await listAllObjects(client, bucket, maxObjects);
    const finalStable = stableListingsMatch(second.rows, finalListing.rows);
    const failedProofs = mediaProofs.filter((row) => row.status !== 'verified');
    const fullSummary = {
        ...baseSummary,
        status: finalStable && failedProofs.length === 0 ? 'verified' : 'blocked',
        listingPasses: [
            ...baseSummary.listingPasses,
            {
                fingerprintSha256: finalListing.fingerprint,
                objectCount: finalListing.rows.length,
                pageCount: finalListing.pageCount
            }
        ],
        finalListingStable: finalStable,
        mediaObjectCount: mediaObjects.length,
        nonMediaObjectCount: nonMediaObjects.length,
        mediaHashCount: mediaHashes.length,
        nonMediaHashCount: nonMediaHashes.length,
        uniqueMediaHashCount: representatives.length,
        mediaProofCount: mediaProofs.length,
        failedMediaProofCount: failedProofs.length,
        uniqueMediaBytes: representatives.reduce((sum, object) => sum + Number(object.size || 0), 0)
    };
    await writeJson(path.join(outputRoot, 'source-snapshot.json'), fullSummary);
    if (fullSummary.status !== 'verified') process.exitCode = 2;
    console.log(JSON.stringify({
        status: fullSummary.status,
        objectCount: fullSummary.objectCount,
        mediaObjectCount: fullSummary.mediaObjectCount,
        uniqueMediaHashCount: fullSummary.uniqueMediaHashCount,
        failedMediaProofCount: fullSummary.failedMediaProofCount
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({ status: 'error', code: String(error?.message || 'snapshot_failed') }));
    process.exitCode = 1;
});
