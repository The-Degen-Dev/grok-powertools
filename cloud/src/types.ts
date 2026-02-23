export type MetadataKind =
    | 'savedPrompts'
    | 'promptHistory'
    | 'processedIds'
    | 'backfillManifest';

export interface Env {
    R2_BUCKET: R2Bucket;
    CLIENT_API_KEY: string;
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    R2_ACCOUNT_ID: string;
    R2_BUCKET_NAME: string;
    KEY_PREFIX?: string;
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
