import type { D1Database } from '@cloudflare/workers-types';

export interface SyncEntity {
  id: string;
  user_id: string;
  data: string;
  updated_at: string;
  deleted_at: string | null;
}

export async function upsertEntity(
  db: D1Database,
  table: 'collections' | 'movies',
  entity: SyncEntity
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ${table} (id, user_id, data, updated_at, deleted_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET
         data = CASE WHEN excluded.updated_at > ${table}.updated_at THEN excluded.data ELSE ${table}.data END,
         updated_at = CASE WHEN excluded.updated_at > ${table}.updated_at THEN excluded.updated_at ELSE ${table}.updated_at END,
         deleted_at = CASE WHEN excluded.updated_at > ${table}.updated_at THEN excluded.deleted_at ELSE ${table}.deleted_at END`
    )
    .bind(entity.id, entity.user_id, entity.data, entity.updated_at, entity.deleted_at)
    .run();
}

export async function getEntitiesSince(
  db: D1Database,
  table: 'collections' | 'movies',
  userId: string,
  since: string
): Promise<SyncEntity[]> {
  const result = await db
    .prepare(`SELECT * FROM ${table} WHERE user_id = ?1 AND updated_at > ?2`)
    .bind(userId, since)
    .all<SyncEntity>();
  return result.results;
}

export async function upsertSettings(
  db: D1Database,
  userId: string,
  data: string,
  updatedAt: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (user_id, data, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(user_id) DO UPDATE SET
         data = CASE WHEN excluded.updated_at > settings.updated_at THEN excluded.data ELSE settings.data END,
         updated_at = CASE WHEN excluded.updated_at > settings.updated_at THEN excluded.updated_at ELSE settings.updated_at END`
    )
    .bind(userId, data, updatedAt)
    .run();
}

export async function getSettings(
  db: D1Database,
  userId: string
): Promise<{ data: string; updated_at: string } | null> {
  return db
    .prepare(`SELECT data, updated_at FROM settings WHERE user_id = ?1`)
    .bind(userId)
    .first<{ data: string; updated_at: string }>();
}

export async function ensureUser(
  db: D1Database,
  id: string,
  email: string,
  name: string,
  image: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, email, name, image)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET email = ?2, name = ?3, image = ?4`
    )
    .bind(id, email, name, image)
    .run();
}

export async function upsertR2DedupeIndex(
  db: D1Database,
  record: {
    userId: string;
    assetId: string;
    canonicalObjectKey: string;
    sourceUrlHash?: string;
    contentSha256?: string;
    mediaType?: string;
    uploadStatus: string;
    duplicateObjectKey?: string;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO r2_dedupe_index (
         user_id, asset_id, canonical_object_key, source_url_hashes, content_sha256,
         media_type, first_seen_at, last_seen_at, upload_status, duplicate_object_keys
       )
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9)
       ON CONFLICT(user_id, asset_id) DO UPDATE SET
         canonical_object_key = excluded.canonical_object_key,
         source_url_hashes = excluded.source_url_hashes,
         content_sha256 = COALESCE(excluded.content_sha256, r2_dedupe_index.content_sha256),
         media_type = COALESCE(excluded.media_type, r2_dedupe_index.media_type),
         last_seen_at = excluded.last_seen_at,
         upload_status = excluded.upload_status,
         duplicate_object_keys = excluded.duplicate_object_keys`
    )
    .bind(
      record.userId,
      record.assetId,
      record.canonicalObjectKey,
      JSON.stringify(record.sourceUrlHash ? [record.sourceUrlHash] : []),
      record.contentSha256 ?? null,
      record.mediaType ?? null,
      now,
      record.uploadStatus,
      JSON.stringify(record.duplicateObjectKey ? [record.duplicateObjectKey] : [])
    )
    .run();
}

export async function upsertMetadataSnapshotIndex(
  db: D1Database,
  record: {
    userId: string;
    kind: string;
    contentHash: string;
    objectKey: string;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO metadata_snapshot_index (
         user_id, kind, content_hash, object_key, first_written_at, last_seen_at
       )
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(user_id, kind, content_hash) DO UPDATE SET
         object_key = excluded.object_key,
         last_seen_at = excluded.last_seen_at`
    )
    .bind(record.userId, record.kind, record.contentHash, record.objectKey, now)
    .run();
}
