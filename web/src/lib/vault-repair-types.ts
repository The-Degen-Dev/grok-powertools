export type RepairRiskTier = "T0" | "T1" | "T2" | "T3" | "T4";
export type RepairIssueType =
  | "index_drift"
  | "metadata_drift"
  | "duplicate_canonical_mismatch"
  | "missing_media_object"
  | "corrupt_media_object"
  | "live_grok_required"
  | "scan_warning";
export type RepairWriteClass = "none" | "d1_index" | "r2_metadata" | "r2_media" | "live_grok_runbook";
export type SourceProofKind =
  | "r2_object"
  | "d1_index"
  | "metadata_snapshot"
  | "local_verified_object"
  | "live_grok_existing_chrome"
  | "worker_gap"
  | "scan_warning";

export interface SourceProof {
  kind: SourceProofKind;
  label: string;
  observedAt: string;
  contentSha256?: string;
  objectKey?: string;
  sizeBytes?: number;
}

export interface RepairIssue {
  issueId: string;
  assetId?: string;
  blockedReason?: string;
  issueType: RepairIssueType;
  riskTier: RepairRiskTier;
  sourceProof: SourceProof[];
  writeClass: RepairWriteClass;
}

export interface RepairAction {
  actionId: string;
  idempotencyKey: string;
  writeClass: RepairWriteClass;
  target: string;
  expectedProof: SourceProof[];
}

export interface RepairIdentityScope {
  workerHost: string;
  keyPrefix: string;
  bucketName?: string;
  apiKeyFingerprint?: string;
}

export interface RepairPlan {
  planId: string;
  planHash: string;
  createdAt: string;
  identityScope: RepairIdentityScope;
  issueIds: string[];
  targetCount: number;
  writeClasses: RepairWriteClass[];
  riskTierMax: RepairRiskTier;
  objectKeys: string[];
  actions: RepairAction[];
}

interface ParsedRepairPlanRequest {
  identityScope: RepairIdentityScope;
  issues: RepairIssue[];
  selectedIssueIds: string[];
}

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

const repairRiskTiers = new Set<RepairRiskTier>(["T0", "T1", "T2", "T3", "T4"]);
const repairIssueTypes = new Set<RepairIssueType>([
  "index_drift",
  "metadata_drift",
  "duplicate_canonical_mismatch",
  "missing_media_object",
  "corrupt_media_object",
  "live_grok_required",
  "scan_warning",
]);
const repairWriteClasses = new Set<RepairWriteClass>([
  "none",
  "d1_index",
  "r2_metadata",
  "r2_media",
  "live_grok_runbook",
]);
const sourceProofKinds = new Set<SourceProofKind>([
  "r2_object",
  "d1_index",
  "metadata_snapshot",
  "local_verified_object",
  "live_grok_existing_chrome",
  "worker_gap",
  "scan_warning",
]);
const riskTierRank: Record<RepairRiskTier, number> = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
  T4: 4,
};

function proofWithoutObservedAt(proof: SourceProof): Omit<SourceProof, "observedAt"> {
  const { observedAt, ...stableProof } = proof;
  void observedAt;
  return stableProof;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value));
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function parseRepairIssue(input: unknown, path = "issue"): RepairIssue {
  if (!isRecord(input)) {
    throw new Error(`${path} must be an object`);
  }

  const issueType = requiredEnum(input, "issueType", repairIssueTypes, path);
  const riskTier = requiredEnum(input, "riskTier", repairRiskTiers, path);
  const writeClass = requiredEnum(input, "writeClass", repairWriteClasses, path);
  const sourceProofInput = input.sourceProof;
  if (!Array.isArray(sourceProofInput) || sourceProofInput.length === 0) {
    throw new Error(`${path}.sourceProof must be a non-empty array`);
  }

  return {
    issueId: requiredString(input, "issueId", path),
    assetId: optionalString(input, "assetId", path),
    blockedReason: optionalString(input, "blockedReason", path),
    issueType,
    riskTier,
    sourceProof: sourceProofInput.map((proof, index) => parseSourceProof(proof, `${path}.sourceProof[${index}]`)),
    writeClass,
  };
}

export function parseRepairIdentityScope(input: unknown): RepairIdentityScope {
  if (!isRecord(input)) {
    throw new Error("identityScope must be an object");
  }

  return {
    workerHost: requiredString(input, "workerHost", "identityScope"),
    keyPrefix: requiredString(input, "keyPrefix", "identityScope"),
    bucketName: optionalString(input, "bucketName", "identityScope"),
    apiKeyFingerprint: optionalString(input, "apiKeyFingerprint", "identityScope"),
  };
}

export async function buildRepairPlan(input: ParsedRepairPlanRequest & { createdAt?: string }): Promise<RepairPlan> {
  assertUniqueIssueIds(input.issues);

  const knownIssueIds = new Set(input.issues.map((issue) => issue.issueId));
  for (const selectedIssueId of input.selectedIssueIds) {
    if (!knownIssueIds.has(selectedIssueId)) {
      throw new Error("REPAIR_SELECTED_ISSUE_MISSING");
    }
  }

  const selectedIds = new Set(input.selectedIssueIds);
  const selectedIssues = input.issues
    .filter((issue) => selectedIds.has(issue.issueId))
    .sort((a, b) => a.issueId.localeCompare(b.issueId));

  if (selectedIssues.length === 0) {
    throw new Error("REPAIR_PLAN_EMPTY");
  }

  const objectKeys = Array.from(
    new Set(
      selectedIssues.flatMap((issue) =>
        issue.sourceProof
          .map((proof) => proof.objectKey)
          .filter((objectKey): objectKey is string => typeof objectKey === "string" && objectKey.trim() !== ""),
      ),
    ),
  ).sort();
  const writeClasses = Array.from(new Set(selectedIssues.map((issue) => issue.writeClass))).sort();
  const riskTierMax = selectedIssues.reduce<RepairRiskTier>(
    (maxRiskTier, issue) => (riskTierRank[issue.riskTier] > riskTierRank[maxRiskTier] ? issue.riskTier : maxRiskTier),
    "T0",
  );
  const actionSeeds = selectedIssues.map((issue) => ({
    issueId: issue.issueId,
    action: {
      actionId: `action-${issue.issueId}`,
      writeClass: issue.writeClass,
      target: issue.assetId || issue.issueId,
      expectedProof: issue.sourceProof,
    },
  }));
  const issueIds = selectedIssues.map((issue) => issue.issueId);
  const planHash = await sha256Hex(
    canonicalJson({
      identityScope: input.identityScope,
      issueIds,
      objectKeys,
      writeClasses,
      riskTierMax,
      actions: actionSeeds.map((seed) => ({
        ...seed.action,
        expectedProof: seed.action.expectedProof.map(proofWithoutObservedAt),
      })),
    }),
  );
  const actions = actionSeeds.map(({ issueId, action }): RepairAction => ({
    ...action,
    idempotencyKey: `${planHash}:${issueId}`,
  }));

  return {
    planId: `repair-plan-${planHash.slice(0, 16)}`,
    planHash,
    createdAt: input.createdAt || new Date().toISOString(),
    identityScope: input.identityScope,
    issueIds,
    targetCount: selectedIssues.length,
    writeClasses,
    riskTierMax,
    objectKeys,
    actions,
  };
}

export function parseRepairPlanRequest(input: unknown): ParsedRepairPlanRequest {
  if (!isRecord(input)) {
    throw new Error("REPAIR_PLAN_INVALID");
  }

  const issuesInput = input.issues;
  const selectedIssueIdsInput = input.selectedIssueIds;
  if (!Array.isArray(issuesInput)) {
    throw new Error("issues must be an array");
  }
  if (!Array.isArray(selectedIssueIdsInput)) {
    throw new Error("selectedIssueIds must be an array");
  }

  const issues = issuesInput.map((issue, index) => parseRepairIssue(issue, `issues[${index}]`));
  assertUniqueIssueIds(issues);

  return {
    identityScope: parseRepairIdentityScope(input.identityScope),
    issues,
    selectedIssueIds: selectedIssueIdsInput.map((issueId, index) =>
      requiredArrayString(issueId, `selectedIssueIds[${index}]`),
    ),
  };
}

function assertUniqueIssueIds(issues: RepairIssue[]): void {
  const issueIds = new Set<string>();
  for (const issue of issues) {
    if (issueIds.has(issue.issueId)) {
      throw new Error("REPAIR_ISSUE_ID_DUPLICATE");
    }
    issueIds.add(issue.issueId);
  }
}

function toCanonicalValue(value: unknown): CanonicalValue {
  if (typeof value === "undefined") {
    throw new Error("canonicalJson cannot encode undefined");
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonicalJson cannot encode non-finite numbers");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toCanonicalValue(item));
  }
  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<{ [key: string]: CanonicalValue }>((canonical, key) => {
        const rawValue = value[key];
        if (typeof rawValue !== "undefined") {
          canonical[key] = toCanonicalValue(rawValue);
        }
        return canonical;
      }, {});
  }
  throw new Error("canonicalJson can only encode JSON values");
}

function parseSourceProof(input: unknown, path: string): SourceProof {
  if (!isRecord(input)) {
    throw new Error(`${path} must be an object`);
  }

  return {
    kind: requiredEnum(input, "kind", sourceProofKinds, path),
    label: requiredString(input, "label", path),
    observedAt: requiredString(input, "observedAt", path),
    contentSha256: optionalString(input, "contentSha256", path),
    objectKey: optionalString(input, "objectKey", path),
    sizeBytes: optionalNumber(input, "sizeBytes", path),
  };
}

function requiredString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path}.${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string, path: string): string | undefined {
  const value = record[key];
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path}.${key} must be a non-empty string when provided`);
  }
  return value;
}

function optionalNumber(record: Record<string, unknown>, key: string, path: string): number | undefined {
  const value = record[key];
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path}.${key} must be a finite number`);
  }
  return value;
}

function requiredArrayString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function requiredEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowedValues: Set<T>,
  path: string,
): T {
  const value = record[key];
  if (typeof value !== "string" || !allowedValues.has(value as T)) {
    throw new Error(`${path}.${key} is invalid`);
  }
  return value as T;
}
