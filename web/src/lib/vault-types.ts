export type VaultMediaType = "image" | "video" | "unknown";
export type VaultSourceStatus = "verified" | "blocked" | "failed" | "unproven";

export interface VaultAsset {
  assetId: string;
  mediaType: VaultMediaType;
  canonicalObjectKey?: string;
  legacyObjectKeys: string[];
  contentType?: string;
  sizeBytes?: number;
  etag?: string;
  sha256?: string;
  sourceUrlHash?: string;
  sourceUrl?: string;
  grokPostId?: string;
  mediaUuid?: string;
  promptId?: string;
  promptText?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  verificationStatus: VaultSourceStatus;
  gapCodes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VaultOverlay {
  assetId: string;
  title?: string;
  notes?: string;
  tags: string[];
  rating?: number;
  hidden: boolean;
  favorite: boolean;
  updatedAt: string;
  syncVersion?: number;
}

export interface VaultImportRun {
  id: string;
  source: "production-r2" | "acceptance-r2" | "fixture";
  workerHost: string;
  keyPrefix: string;
  importedAt: string;
  status: "previewed" | "committed" | "blocked" | "failed";
  counts: {
    assets: number;
    images: number;
    videos: number;
    prompts: number;
    verified: number;
    blocked: number;
    failed: number;
    unproven: number;
  };
  warnings: string[];
}

export interface VaultGap {
  id: string;
  assetId?: string;
  code: string;
  severity: "info" | "warning" | "blocking";
  evidence: string;
  recommendedAction: string;
  requiresLiveGrok: boolean;
  requiresCloudWrite: boolean;
}

export interface VaultPrompt {
  id: string;
  text: string;
  tags?: string[];
  sourceAssetIds?: string[];
  usageCount?: number;
  createdAt?: string;
}

export interface VaultPreview {
  ok: boolean;
  identity: Record<string, unknown>;
  assets: VaultAsset[];
  prompts: VaultPrompt[];
  gaps: VaultGap[];
  counts: VaultImportRun["counts"];
  warnings: string[];
}

export function normalizePromptText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}
