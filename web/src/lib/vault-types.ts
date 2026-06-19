export type VaultMediaType = "image" | "video" | "unknown";
export type VaultSourceStatus = "verified" | "blocked" | "failed" | "unproven";
export type VaultGapSeverity = "info" | "warning" | "blocking";

export interface VaultWorkerIdentity extends Record<string, unknown> {
  ok?: boolean;
  service?: string;
  workerHost: string;
  keyPrefix: string;
  r2?: {
    bucketName?: string;
    bindingPresent?: boolean;
  };
  d1?: {
    databaseName?: string;
    bindingPresent?: boolean;
  };
  apiKeyFingerprint?: string;
}

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
  deletedAt?: string | null;
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

export interface VaultParseResult<T> {
  value: T;
  warnings: string[];
}

const mediaTypes = new Set<VaultMediaType>(["image", "video", "unknown"]);
const sourceStatuses = new Set<VaultSourceStatus>(["verified", "blocked", "failed", "unproven"]);
const gapSeverities = new Set<VaultGapSeverity>(["info", "warning", "blocking"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path}.${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function recordArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function countValue(record: Record<string, unknown>, key: string, fallback = 0): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function parseBindingInfo(value: unknown, bucketKey: "bucketName" | "databaseName") {
  if (!isRecord(value)) return undefined;
  return {
    [bucketKey]: optionalString(value, bucketKey),
    bindingPresent: optionalBoolean(value, "bindingPresent"),
  };
}

export function parseVaultWorkerIdentity(input: unknown): VaultWorkerIdentity {
  if (!isRecord(input)) {
    throw new Error("identity must be an object");
  }

  return {
    ok: optionalBoolean(input, "ok"),
    service: optionalString(input, "service"),
    workerHost: optionalString(input, "workerHost") || "unknown",
    keyPrefix: optionalString(input, "keyPrefix") || "grok-powertools/v1",
    r2: parseBindingInfo(input.r2, "bucketName"),
    d1: parseBindingInfo(input.d1, "databaseName"),
    apiKeyFingerprint: optionalString(input, "apiKeyFingerprint"),
  };
}

export function parseVaultAsset(input: unknown, path = "asset"): VaultAsset {
  if (!isRecord(input)) {
    throw new Error(`${path} must be an object`);
  }

  const mediaType = input.mediaType;
  if (typeof mediaType !== "string" || !mediaTypes.has(mediaType as VaultMediaType)) {
    throw new Error(`${path}.mediaType must be image, video, or unknown`);
  }

  const verificationStatus = input.verificationStatus;
  if (typeof verificationStatus !== "string" || !sourceStatuses.has(verificationStatus as VaultSourceStatus)) {
    throw new Error(`${path}.verificationStatus must be verified, blocked, failed, or unproven`);
  }

  return {
    assetId: requiredString(input, "assetId", path),
    mediaType: mediaType as VaultMediaType,
    canonicalObjectKey: optionalString(input, "canonicalObjectKey"),
    legacyObjectKeys: stringArray(input, "legacyObjectKeys"),
    contentType: optionalString(input, "contentType"),
    sizeBytes: optionalNumber(input, "sizeBytes"),
    etag: optionalString(input, "etag"),
    sha256: optionalString(input, "sha256"),
    sourceUrlHash: optionalString(input, "sourceUrlHash"),
    sourceUrl: optionalString(input, "sourceUrl"),
    grokPostId: optionalString(input, "grokPostId"),
    mediaUuid: optionalString(input, "mediaUuid"),
    promptId: optionalString(input, "promptId"),
    promptText: optionalString(input, "promptText"),
    width: optionalNumber(input, "width"),
    height: optionalNumber(input, "height"),
    durationSeconds: optionalNumber(input, "durationSeconds"),
    firstSeenAt: optionalString(input, "firstSeenAt"),
    lastSeenAt: optionalString(input, "lastSeenAt"),
    verificationStatus: verificationStatus as VaultSourceStatus,
    gapCodes: stringArray(input, "gapCodes"),
    createdAt: requiredString(input, "createdAt", path),
    updatedAt: requiredString(input, "updatedAt", path),
  };
}

export function parseVaultPrompt(input: unknown, path = "prompt"): VaultPrompt {
  if (!isRecord(input)) {
    throw new Error(`${path} must be an object`);
  }

  const text = requiredString(input, "text", path).trim();
  if (!normalizePromptText(text)) {
    throw new Error(`${path}.text must not be blank`);
  }

  return {
    id: requiredString(input, "id", path),
    text,
    tags: stringArray(input, "tags"),
    sourceAssetIds: stringArray(input, "sourceAssetIds"),
    usageCount: optionalNumber(input, "usageCount"),
    createdAt: optionalString(input, "createdAt"),
  };
}

export function parseVaultGap(input: unknown, path = "gap"): VaultGap {
  if (!isRecord(input)) {
    throw new Error(`${path} must be an object`);
  }

  const severity = input.severity;
  if (typeof severity !== "string" || !gapSeverities.has(severity as VaultGapSeverity)) {
    throw new Error(`${path}.severity must be info, warning, or blocking`);
  }

  return {
    id: requiredString(input, "id", path),
    assetId: optionalString(input, "assetId"),
    code: requiredString(input, "code", path),
    severity: severity as VaultGapSeverity,
    evidence: requiredString(input, "evidence", path),
    recommendedAction: requiredString(input, "recommendedAction", path),
    requiresLiveGrok: optionalBoolean(input, "requiresLiveGrok") || false,
    requiresCloudWrite: optionalBoolean(input, "requiresCloudWrite") || false,
  };
}

export function parseVaultInventory(input: unknown): VaultParseResult<{ assets: VaultAsset[]; counts: VaultImportRun["counts"] }> {
  if (!isRecord(input)) {
    throw new Error("inventory must be an object");
  }

  const warnings: string[] = [];
  const assets: VaultAsset[] = [];
  for (const [index, item] of recordArray(input, "items").entries()) {
    try {
      assets.push(parseVaultAsset(item, `inventory.items[${index}]`));
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : `inventory.items[${index}] is invalid`);
    }
  }

  const rawCounts = isRecord(input.counts) ? input.counts : {};
  const counts = parseVaultCounts(rawCounts, assets, 0);
  return { value: { assets, counts }, warnings };
}

export function parseVaultPrompts(input: unknown, path = "metadata.prompts"): VaultParseResult<VaultPrompt[]> {
  const rows = isRecord(input) ? recordArray(input, "prompts").concat(recordArray(input, "data")) : [];
  const warnings: string[] = [];
  const prompts: VaultPrompt[] = [];
  for (const [index, row] of rows.entries()) {
    try {
      prompts.push(parseVaultPrompt(row, `${path}[${index}]`));
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : `${path}[${index}] is invalid`);
    }
  }
  return { value: prompts, warnings };
}

export function parseVaultGaps(input: unknown): VaultParseResult<VaultGap[]> {
  const rows = isRecord(input) ? recordArray(input, "gaps") : [];
  const warnings: string[] = [];
  const gaps: VaultGap[] = [];
  for (const [index, row] of rows.entries()) {
    try {
      gaps.push(parseVaultGap(row, `gaps[${index}]`));
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : `gaps[${index}] is invalid`);
    }
  }
  return { value: gaps, warnings };
}

export function parseVaultCounts(
  input: unknown,
  assets: VaultAsset[] = [],
  promptsCount = 0,
): VaultImportRun["counts"] {
  const record = isRecord(input) ? input : {};
  return {
    assets: assets.length || countValue(record, "assets"),
    images: assets.filter((asset) => asset.mediaType === "image").length || countValue(record, "images"),
    videos: assets.filter((asset) => asset.mediaType === "video").length || countValue(record, "videos"),
    prompts: promptsCount || countValue(record, "prompts"),
    verified:
      assets.filter((asset) => asset.verificationStatus === "verified").length || countValue(record, "verified"),
    blocked:
      assets.filter((asset) => asset.verificationStatus === "blocked").length || countValue(record, "blocked"),
    failed: assets.filter((asset) => asset.verificationStatus === "failed").length || countValue(record, "failed"),
    unproven:
      assets.filter((asset) => asset.verificationStatus === "unproven").length || countValue(record, "unproven"),
  };
}

export function parseVaultPreview(input: unknown): VaultParseResult<VaultPreview> {
  if (!isRecord(input)) {
    throw new Error("preview must be an object");
  }

  const identity = parseVaultWorkerIdentity(input.identity);
  const assets = recordArray(input, "assets").map((asset, index) => parseVaultAsset(asset, `preview.assets[${index}]`));
  const prompts = recordArray(input, "prompts").map((prompt, index) =>
    parseVaultPrompt(prompt, `preview.prompts[${index}]`),
  );
  const gaps = recordArray(input, "gaps").map((gap, index) => parseVaultGap(gap, `preview.gaps[${index}]`));
  const warnings = stringArray(input, "warnings");

  return {
    value: {
      ok: optionalBoolean(input, "ok") ?? true,
      identity,
      assets,
      prompts,
      gaps,
      counts: parseVaultCounts(input.counts, assets, prompts.length),
      warnings,
    },
    warnings,
  };
}
