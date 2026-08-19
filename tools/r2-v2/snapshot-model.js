const { createHash } = require('node:crypto');

const SHA256_RE = /^[0-9a-f]{64}$/i;
const DEFAULT_SOURCE_PREFIX = 'grok-powertools/v1';
const IMAGE_EXT_RE = /\.(?:avif|gif|heic|jpeg|jpg|png|webp)$/i;
const VIDEO_EXT_RE = /\.(?:m4v|mov|mp4|webm)$/i;

function normalizeListedObject(object) {
    return {
        key: String(object.key || ''),
        size: Number(object.size ?? object.listedSize) || 0,
        etag: String(object.etag ?? object.listedEtag ?? '').replaceAll('"', ''),
        uploadedAt: String(object.uploadedAt ?? object.listedLastModified ?? '')
    };
}

function listingFingerprint(objects) {
    const hash = createHash('sha256');
    const normalized = objects.map(normalizeListedObject).sort((first, second) => (
        first.key.localeCompare(second.key)
    ));
    for (const object of normalized) {
        hash.update(object.key);
        hash.update('\0');
        hash.update(String(object.size));
        hash.update('\0');
        hash.update(object.etag);
        hash.update('\0');
        hash.update(object.uploadedAt);
        hash.update('\n');
    }
    return hash.digest('hex');
}

function stableListingsMatch(first, second) {
    return first.length === second.length && listingFingerprint(first) === listingFingerprint(second);
}

function objectFingerprint(object) {
    const normalized = normalizeListedObject(object);
    return createHash('sha256')
        .update([
            normalized.key,
            normalized.size,
            normalized.etag,
            normalized.uploadedAt
        ].join('|'))
        .digest('hex');
}

function classifyMediaSignature(value) {
    const bytes = Buffer.from(value || []);
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return { mediaType: 'image', format: 'jpeg' };
    }
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'binary'))) {
        return { mediaType: 'image', format: 'png' };
    }
    if (bytes.length >= 6) {
        const gifHeader = bytes.subarray(0, 6).toString('ascii');
        if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
            return { mediaType: 'image', format: 'gif' };
        }
    }
    if (
        bytes.length >= 12
        && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
        && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        return { mediaType: 'image', format: 'webp' };
    }
    if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
        const brand = bytes.subarray(8, 12).toString('ascii').toLowerCase();
        if (['avif', 'avis', 'heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(brand)) {
            return { mediaType: 'image', format: brand.startsWith('avi') ? 'avif' : 'heif' };
        }
        return { mediaType: 'video', format: 'iso-bmff' };
    }
    if (
        bytes.length >= 4
        && bytes[0] === 0x1a
        && bytes[1] === 0x45
        && bytes[2] === 0xdf
        && bytes[3] === 0xa3
    ) {
        return { mediaType: 'video', format: 'matroska' };
    }
    return { mediaType: 'unknown', format: 'unknown' };
}

function selectPrimaryMediaStream(streams, mediaType) {
    const videoStreams = (streams || []).filter((stream) => stream.codec_type === 'video');
    if (mediaType === 'video') {
        return videoStreams.find((stream) => Number(stream.disposition?.attached_pic || 0) !== 1) || null;
    }
    return videoStreams[0] || null;
}

function contentTypeForMedia(format, mediaType) {
    const known = {
        avif: 'image/avif',
        gif: 'image/gif',
        heif: 'image/heif',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        matroska: 'video/webm',
        'iso-bmff': 'video/mp4'
    };
    return known[format] || (mediaType === 'image' ? 'image/*' : 'video/*');
}

function classifySourceObjectKey(key, contentType = '', sourcePrefix = DEFAULT_SOURCE_PREFIX) {
    const parts = key.split('/');
    const usersIndex = parts.indexOf('users');
    const userId = usersIndex >= 0 ? parts[usersIndex + 1] || null : null;
    const byAsset = key.match(/\/media\/by-asset\/([^/.?#/]+)/);
    const conflict = key.match(/\/media\/conflicts\/([^/.?#/]+)/);
    const assetId = byAsset?.[1] || conflict?.[1] || null;
    const lower = key.toLowerCase();
    let pathClass = 'unknown';
    if (!key.startsWith(`${sourcePrefix}/`)) pathClass = 'out-of-prefix';
    else if (key.includes('/metadata/')) pathClass = 'metadata';
    else if (/\.metadata\.v2\.[0-9a-f]{24}\.json$/i.test(key)) pathClass = 'asset-metadata-v2';
    else if (key.endsWith('.prompt.json')) pathClass = 'prompt-sidecar';
    else if (key.includes('/media/by-asset/')) pathClass = 'canonical-media';
    else if (key.includes('/media/conflicts/')) pathClass = 'conflict-media';
    else if (/\/media\/\d{4}[-/]\d{2}[-/]\d{2}/.test(key)) pathClass = 'legacy-date-media';
    else if (key.includes('/_system/') || key.includes('/upload-test')) pathClass = 'system';
    else if (key.includes('/repair/')) pathClass = 'repair';

    const content = String(contentType || '').toLowerCase();
    let mediaType = 'non-media';
    if (content.startsWith('image/') || IMAGE_EXT_RE.test(lower)) mediaType = 'image';
    else if (content.startsWith('video/') || VIDEO_EXT_RE.test(lower)) mediaType = 'video';

    const explicitlyNonMedia = pathClass === 'metadata'
        || pathClass === 'asset-metadata-v2'
        || pathClass === 'prompt-sidecar'
        || pathClass === 'system';
    const canonicalMediaPath = pathClass === 'canonical-media' || pathClass === 'conflict-media';
    const declaredMedia = mediaType === 'image' || mediaType === 'video';
    const isMedia = !explicitlyNonMedia && (canonicalMediaPath || (key.includes('/media/') && declaredMedia));
    if (isMedia && mediaType === 'non-media') mediaType = 'unknown-media';
    const malformed = !key.startsWith(`${sourcePrefix}/users/`) && pathClass !== 'out-of-prefix';
    return { userId, pathClass, assetId, mediaType, isMedia, malformed };
}

function sourceRank(source) {
    const pathRank = source.pathClass === 'canonical-media'
        ? 0
        : (source.pathClass === 'legacy-date-media' ? 1 : 2);
    return `${pathRank}:${String(source.key || '')}`;
}

function selectBlobRepresentatives(rows) {
    const byHash = new Map();
    for (const row of rows) {
        const sha256 = String(row.sha256 || '').toLowerCase();
        if (!SHA256_RE.test(sha256)) continue;
        const candidate = { ...row, sha256 };
        const current = byHash.get(sha256);
        if (!current || sourceRank(candidate).localeCompare(sourceRank(current)) < 0) {
            byHash.set(sha256, candidate);
        }
    }
    return [...byHash.values()].sort((first, second) => first.sha256.localeCompare(second.sha256));
}

module.exports = {
    classifyMediaSignature,
    classifySourceObjectKey,
    contentTypeForMedia,
    listingFingerprint,
    normalizeListedObject,
    objectFingerprint,
    selectPrimaryMediaStream,
    selectBlobRepresentatives,
    stableListingsMatch
};
