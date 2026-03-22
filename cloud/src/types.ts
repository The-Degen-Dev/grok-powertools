export type MetadataKind =
    | 'savedPrompts'
    | 'promptHistory'
    | 'processedIds'
    | 'backfillManifest';

export interface Env {
    DB: D1Database;
    R2_BUCKET: R2Bucket;
    CLIENT_API_KEY: string;
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    R2_ACCOUNT_ID: string;
    R2_BUCKET_NAME: string;
    KEY_PREFIX?: string;
    SYNC_SECRET?: string;
}

export interface SyncPushRequest {
    collections?: Array<{
        id: string;
        data: string;
        updatedAt: string;
        deletedAt?: string | null;
    }>;
    movies?: Array<{
        id: string;
        data: string;
        updatedAt: string;
        deletedAt?: string | null;
    }>;
}

export interface SyncPullResponse {
    collections: Array<{
        id: string;
        data: string;
        updatedAt: string;
        deletedAt: string | null;
    }>;
    movies: Array<{
        id: string;
        data: string;
        updatedAt: string;
        deletedAt: string | null;
    }>;
    syncedAt: string;
}

export interface PresignRequest {
    objectKey: string;
    contentType: string;
    contentLength: number;
}

export interface PresignResponse {
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresAt: string;
}

export interface MetadataSnapshotRequest {
    userId: string;
    kind: MetadataKind;
    payload: {
        schemaVersion: number;
        data: unknown;
        updatedAt?: string;
    };
}
