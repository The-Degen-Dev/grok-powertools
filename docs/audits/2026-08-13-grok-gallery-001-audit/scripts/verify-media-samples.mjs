#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const sourceAuditRoot = path.resolve(path.dirname(scriptPath), '..');
const auditRoot = process.env.AUDIT_OUTPUT_ROOT
  ? path.resolve(process.cwd(), process.env.AUDIT_OUTPUT_ROOT)
  : sourceAuditRoot;
const repoRoot = path.resolve(sourceAuditRoot, '../../..');
const bucket = process.env.AUDIT_R2_BUCKET || 'grok-gallery-001';
const require = createRequire(path.join(repoRoot, 'cloud', 'package.json'));
const { GetObjectCommand, HeadObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function objectRef(key) {
  return `sha256:${sha256(key).slice(0, 20)}`;
}

async function readJsonl(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function bodyToBuffer(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function assertAuditPath(filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(`${auditRoot}${path.sep}`)) {
    throw new Error(`Refusing to write outside audit root: ${resolved}`);
  }
  return resolved;
}

function clientConfig() {
  const required = ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required read-only R2 variables: ${missing.join(', ')}`);
  return {
    region: 'auto',
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  };
}

function mediaCategory(object) {
  const type = String(object.contentType || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  return 'other';
}

function deterministicFive(rows) {
  if (rows.length <= 5) return rows;
  return [0, 0.25, 0.5, 0.75, 1].map((fraction) => rows[Math.round((rows.length - 1) * fraction)]);
}

function detectMagic(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'gif';
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'iso-bmff';
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))) return 'webm';
  return 'unknown';
}

function expectedMagicMatches(contentType, magic) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('jpeg') || type.includes('jpg')) return magic === 'jpeg';
  if (type.includes('png')) return magic === 'png';
  if (type.includes('webp')) return magic === 'webp';
  if (type.includes('gif')) return magic === 'gif';
  if (type.includes('mp4') || type.includes('quicktime')) return magic === 'iso-bmff';
  if (type.includes('webm')) return magic === 'webm';
  return magic !== 'unknown';
}

function decoderMatchesMedia(sample) {
  if (!sample.decoder?.streams?.length) return false;
  if (sample.mediaCategory === 'image') {
    return sample.decoder.streams.some((stream) =>
      stream.codecType === 'video' && Number(stream.width) > 0 && Number(stream.height) > 0);
  }
  return sample.decoder.streams.some((stream) => stream.codecType === sample.mediaCategory);
}

function sanitizeProbe(probe) {
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  return {
    formatName: probe.format?.format_name || null,
    durationSeconds: Number.isFinite(Number(probe.format?.duration)) ? Number(probe.format.duration) : null,
    streams: streams.map((stream) => ({
      codecType: stream.codec_type || null,
      codecName: stream.codec_name || null,
      width: Number(stream.width || 0) || null,
      height: Number(stream.height || 0) || null,
      durationSeconds: Number.isFinite(Number(stream.duration)) ? Number(stream.duration) : null,
      sampleRate: Number(stream.sample_rate || 0) || null,
      channels: Number(stream.channels || 0) || null
    }))
  };
}

async function probeSample(client, object, cohort) {
  const sample = {
    objectRef: objectRef(object.key),
    cohort,
    pathClass: object.pathClass,
    mediaCategory: mediaCategory(object),
    contentType: object.contentType || null,
    sizeBytes: Number(object.size || 0),
    lastModified: object.uploadedAt || null,
    head: null,
    ranges: null,
    magic: null,
    decoder: null,
    status: 'pending',
    error: null
  };
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: object.key }));
    sample.head = {
      contentLength: Number(head.ContentLength || 0),
      contentType: head.ContentType || null,
      etagPresent: Boolean(head.ETag),
      lastModified: head.LastModified?.toISOString?.() || null,
      metadataKeys: Object.keys(head.Metadata || {}).sort()
    };
    const firstEnd = Math.min(Math.max(0, sample.sizeBytes - 1), 4095);
    const first = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: object.key,
      Range: `bytes=0-${firstEnd}`
    }));
    const firstBytes = await bodyToBuffer(first.Body);
    const tailStart = Math.max(0, sample.sizeBytes - 4096);
    const tail = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: object.key,
      Range: `bytes=${tailStart}-${Math.max(0, sample.sizeBytes - 1)}`
    }));
    const tailBytes = await bodyToBuffer(tail.Body);
    sample.ranges = {
      firstStatus: first.$metadata?.httpStatusCode || null,
      firstBytes: firstBytes.length,
      firstContentRange: first.ContentRange || null,
      tailStatus: tail.$metadata?.httpStatusCode || null,
      tailBytes: tailBytes.length,
      tailContentRange: tail.ContentRange || null
    };
    const magic = detectMagic(firstBytes);
    sample.magic = { detected: magic, matchesDeclaredType: expectedMagicMatches(sample.contentType, magic) };

    const signedUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: object.key }), { expiresIn: 900 });
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,width,height,duration,sample_rate,channels',
      '-of', 'json',
      signedUrl
    ], { maxBuffer: 2 * 1024 * 1024, timeout: 120000 });
    sample.decoder = sanitizeProbe(JSON.parse(stdout));
    const expectedStream = decoderMatchesMedia(sample);
    sample.status = sample.head.contentLength === sample.sizeBytes &&
      sample.ranges.firstStatus === 206 && sample.ranges.tailStatus === 206 &&
      sample.magic.matchesDeclaredType && expectedStream ? 'pass' : 'fail';
  } catch (error) {
    sample.status = 'error';
    sample.error = String(error?.message || error).replace(/https?:\/\/\S+/g, '[redacted-url]');
  }
  return sample;
}

async function main() {
  const objects = await readJsonl(path.join(auditRoot, 'inventory', 'r2-objects.jsonl'));
  const duplicateGroups = await readJsonl(path.join(auditRoot, 'private', 'exact-duplicate-groups.jsonl'));
  const byKey = new Map(objects.map((object) => [object.key, object]));
  const cohorts = new Map();
  for (const pathClass of ['canonical-media', 'legacy-date-media']) {
    for (const category of ['image', 'video']) {
      const rows = objects
        .filter((object) => object.pathClass === pathClass && mediaCategory(object) === category)
        .sort((a, b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt)) || a.key.localeCompare(b.key));
      cohorts.set(`${pathClass}:${category}`, deterministicFive(rows));
    }
  }

  for (const classification of ['legacy_repeated_bytes', 'legacy_canonical_alias', 'canonical_same_bytes_distinct_ids']) {
    const group = duplicateGroups.find((row) => row.classification === classification);
    const object = group?.objectKeys?.map((key) => byKey.get(key)).find(Boolean);
    if (object) cohorts.set(`duplicate:${classification}`, [object]);
  }

  const selected = [];
  const seen = new Set();
  for (const [cohort, rows] of cohorts) {
    for (const object of rows) {
      if (!object || seen.has(object.key)) continue;
      seen.add(object.key);
      selected.push({ object, cohort });
    }
  }

  const client = new S3Client(clientConfig());
  const samples = [];
  for (const { object, cohort } of selected) {
    samples.push(await probeSample(client, object, cohort));
  }
  client.destroy();

  const summary = {
    generatedAt: new Date().toISOString(),
    bucket,
    readOnly: true,
    selectionMethod: 'oldest, quartiles, and newest from each canonical/legacy image/video cohort plus one representative per exact-duplicate class',
    sampleCount: samples.length,
    passed: samples.filter((sample) => sample.status === 'pass').length,
    failed: samples.filter((sample) => sample.status === 'fail').length,
    errors: samples.filter((sample) => sample.status === 'error').length,
    rangeChecksPassed: samples.filter((sample) => sample.ranges?.firstStatus === 206 && sample.ranges?.tailStatus === 206).length,
    magicChecksPassed: samples.filter((sample) => sample.magic?.matchesDeclaredType).length,
    decoderChecksPassed: samples.filter(decoderMatchesMedia).length,
    samples
  };

  const outputPath = assertAuditPath(path.join(auditRoot, 'inventory', 'media-sample-validation.json'));
  await fs.writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({
    sampleCount: summary.sampleCount,
    passed: summary.passed,
    failed: summary.failed,
    errors: summary.errors,
    rangeChecksPassed: summary.rangeChecksPassed,
    magicChecksPassed: summary.magicChecksPassed,
    decoderChecksPassed: summary.decoderChecksPassed
  }, null, 2));
  if (summary.failed || summary.errors) process.exitCode = 1;
}

await main();
