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
}
