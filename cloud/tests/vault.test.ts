import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildVaultIdentity,
  mediaTypeFromContentType,
  normalizeVaultObject,
  redactedApiKeyFingerprint,
} from '../src/vault';

test('redactedApiKeyFingerprint returns a stable non-secret fingerprint', async () => {
  const fingerprint = await redactedApiKeyFingerprint('client-sample');
  assert.ok(fingerprint);
  assert.match(fingerprint, /^fp_[a-f0-9]{12}$/);
  assert.equal(fingerprint.includes('client-sample'), false);
});

test('mediaTypeFromContentType classifies images and videos', () => {
  assert.equal(mediaTypeFromContentType('image/png'), 'image');
  assert.equal(mediaTypeFromContentType('video/mp4'), 'video');
  assert.equal(mediaTypeFromContentType('application/octet-stream'), 'unknown');
});

test('normalizeVaultObject falls back to object key extension when content type is missing', () => {
  const asset = normalizeVaultObject(
    {
      key: 'grok-powertools/v1/users/greymaker/media/c196e1e7-ee4d-4f6e-a6b8-c325ff12a800.jpg',
      size: 2048,
      uploaded: new Date('2026-06-18T00:00:00.000Z'),
    },
    'grok-powertools/v1'
  );

  assert.equal(asset.mediaType, 'image');
});

test('normalizeVaultObject creates stable asset records from R2 object metadata', () => {
  const asset = normalizeVaultObject(
    {
      key: 'grok-powertools/v1/users/greymaker/media/by-asset/asset-video-1.mp4',
      size: 2048,
      etag: 'etag-1',
      uploaded: new Date('2026-06-18T00:00:00.000Z'),
      httpMetadata: { contentType: 'video/mp4' },
      customMetadata: {
        assetId: 'asset-video-1',
        contentSha256: 'sha-1',
        sourceUrlHash: 'source-hash-1',
      },
    },
    'grok-powertools/v1'
  );

  assert.equal(asset.assetId, 'asset-video-1');
  assert.equal(asset.mediaType, 'video');
  assert.equal(asset.canonicalObjectKey, 'grok-powertools/v1/users/greymaker/media/by-asset/asset-video-1.mp4');
  assert.deepEqual(asset.gapCodes, []);
  assert.equal(asset.verificationStatus, 'verified');
});

test('buildVaultIdentity redacts secrets', async () => {
  const identity = await buildVaultIdentity({
    CLIENT_API_KEY: 'client-sample',
    R2_BUCKET_NAME: 'grok-gallery-001',
    KEY_PREFIX: 'grok-powertools/v1',
    R2_BUCKET: {},
    DB: {},
  } as never);

  assert.equal(identity.ok, true);
  assert.equal(identity.keyPrefix, 'grok-powertools/v1');
  assert.equal(identity.r2.bucketName, 'grok-gallery-001');
  assert.equal(JSON.stringify(identity).includes('client-sample'), false);
});
