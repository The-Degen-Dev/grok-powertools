export type CropPreset = "9:16" | "16:9" | "1:1" | "4:5" | "2:3" | "free";

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TrimRange {
  start: number;
  end: number;
}

export function buildExportArgs(
  trim: TrimRange | null,
  crop: CropRect | null,
  format: "mp4" | "gif"
): string[] {
  if (format === "gif") {
    return buildGifArgs(trim, crop);
  }
  return buildMp4Args(trim, crop);
}

function buildMp4Args(trim: TrimRange | null, crop: CropRect | null): string[] {
  const args: string[] = [];

  // -ss before -i for fast keyframe seek
  if (trim) {
    args.push("-ss", trim.start.toFixed(3));
  }

  args.push("-i", "input.mp4");

  // -t (duration) instead of -to, since -to is absolute when -ss is before -i
  if (trim) {
    args.push("-t", (trim.end - trim.start).toFixed(3));
  }

  if (crop) {
    args.push("-vf", `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
  }

  args.push("-c:v", "libx264", "-c:a", "aac", "output.mp4");
  return args;
}

function buildGifArgs(trim: TrimRange | null, crop: CropRect | null): string[] {
  const args: string[] = [];

  if (trim) {
    args.push("-ss", trim.start.toFixed(3));
  }

  args.push("-i", "input.mp4");

  if (trim) {
    args.push("-t", (trim.end - trim.start).toFixed(3));
  }

  const filters: string[] = [];
  if (crop) {
    filters.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
  }
  filters.push("scale=480:-1:flags=lanczos");

  const filterChain = filters.join(",");
  args.push(
    "-vf",
    `${filterChain},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
    "-r",
    "15",
    "-loop",
    "0",
    "output.gif"
  );

  return args;
}

/** Calculate crop rect for a preset ratio, centered on the video */
export function cropRectForPreset(
  preset: CropPreset,
  videoWidth: number,
  videoHeight: number
): CropRect {
  if (preset === "free") {
    return { x: 0, y: 0, w: videoWidth, h: videoHeight };
  }

  const [rw, rh] = preset.split(":").map(Number);
  const targetRatio = rw / rh;
  const videoRatio = videoWidth / videoHeight;

  let w: number;
  let h: number;

  if (targetRatio > videoRatio) {
    // Target is wider than video — fit width, crop height
    w = videoWidth;
    h = Math.round(videoWidth / targetRatio);
  } else {
    // Target is taller — fit height, crop width
    h = videoHeight;
    w = Math.round(videoHeight * targetRatio);
  }

  // Ensure even dimensions (required by libx264)
  w = w - (w % 2);
  h = h - (h % 2);

  const x = Math.round((videoWidth - w) / 2);
  const y = Math.round((videoHeight - h) / 2);

  return { x, y, w, h };
}
