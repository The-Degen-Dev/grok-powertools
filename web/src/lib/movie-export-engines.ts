import type { ReviewClip } from "./movie-review-types";

export interface MovieExportInput {
  clips: ReviewClip[];
  format: "mp4" | "webm";
}

export interface MovieExportResult {
  blob: Blob;
  format: "mp4" | "webm";
  audioProof: {
    expectedAudio: boolean;
    hasAudioStream: boolean;
    codec?: string;
  };
}

export type MovieExportEngine = {
  load(): Promise<void>;
  exportMovie(input: MovieExportInput): Promise<MovieExportResult>;
  terminate(): void;
};
