export interface VideoItem {
  id: string;
  grokPostId: string;
  sourceUrl: string;
  videoUrl: string;
  thumbnailUrl: string;
  promptText: string;
  position: number;
  notes: string;
  createdAt: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived" | "favorite";
  aspectRatioOverride: string | null;
  items: VideoItem[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  syncVersion?: number;
}

export interface ShareLink {
  id: string;
  collectionId: string;
  code: string;
  mode: "live" | "snapshot";
  snapshotData: Collection | null;
  viewCount: number;
  createdAt: string;
}

export interface AppSettings {
  videoCardSize: "small" | "medium" | "large";
  cardAspectRatio: string;
  videoFitMode: "cover" | "contain";
  showNotes: boolean;
  addNewToTop: boolean;
  autoplayVideos: boolean;
  showVideoControls: boolean;
  gifStartTrimMs: number;
  theme: "system" | "light" | "dark";
  onboardingComplete: boolean;
  sidebarCollapsed: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  videoCardSize: "medium",
  cardAspectRatio: "2:3",
  videoFitMode: "cover",
  showNotes: false,
  addNewToTop: false,
  autoplayVideos: false,
  showVideoControls: false,
  gifStartTrimMs: 1000,
  theme: "system",
  onboardingComplete: false,
  sidebarCollapsed: false,
};

export interface Transition {
  type: "cut" | "fade" | "crossfade";
  duration: number; // seconds — 0 for cut, 0.3-2.0 for fade/crossfade
}

export interface MovieClip {
  id: string;
  type: "video" | "title";
  // Video clips
  videoUrl?: string;
  sourceCollectionId?: string;
  trimStart?: number;
  trimEnd?: number;
  // Title cards
  titleText?: string;
  titleSubtext?: string;
  titleDuration?: number;   // seconds, default 3
  titleBgColor?: string;    // default "#000000"
  titleTextColor?: string;  // default "#ffffff"
  // Shared
  transition: Transition;
  position: number;
}

export interface Movie {
  id: string;
  name: string;
  resolution: { w: number; h: number };
  clips: MovieClip[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  syncVersion?: number;
}

export interface SavedPrompt {
  id: string;
  text: string;
  tags: string[];
  sourceVideoId?: string;
  usageCount: number;
  createdAt: string;
}

export interface SyncMeta {
  lastSyncAt: string;
  lastPushAt: string;
  deviceId: string;
}

export type OpsStatus = "verified" | "degraded" | "blocked" | "unproven";

export interface WorkerDiagnostics {
  status: OpsStatus;
  workerUrlConfigured: boolean;
  workerReachable: boolean;
  workerService?: string;
  checkedAt: string;
  message?: string;
}

export interface R2DedupeMetrics {
  bytesVerifiedExisting: number;
  bytesUploadedNew: number;
  duplicateUploadsSkipped: number;
  metadataSnapshotsSkippedUnchanged: number;
  conflictsDetected: number;
}

export interface ReconciliationRow {
  id: string;
  status: OpsStatus;
  assetId: string;
  mediaType: "image" | "video" | "unknown";
  sourceUrlHash?: string;
  vaultPath?: string;
  r2ObjectKey?: string;
  sha256?: string;
  sizeBytes?: number;
  lastVerifiedAt?: string;
  blockerCode?: string;
}

export interface DiagnosticEvent {
  id: string;
  level: "info" | "warning" | "error";
  code: string;
  message: string;
  at: string;
}

export interface OpsSnapshot {
  schemaVersion: 1;
  importedAt: string;
  worker: WorkerDiagnostics;
  r2: R2DedupeMetrics;
  rows: ReconciliationRow[];
  events: DiagnosticEvent[];
}
