export interface FfmpegConcatArgsInput {
  inputs: string[];
  output: string;
  format: "mp4" | "webm";
}

export function buildFfmpegConcatFile(inputs: string[]): string {
  return inputs.map((input) => `file '${input.replaceAll("'", "'\\''")}'`).join("\n");
}

export function buildFfmpegConcatArgs(input: FfmpegConcatArgsInput): string[] {
  const codecArgs =
    input.format === "mp4"
      ? ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart"]
      : ["-c:v", "libvpx", "-c:a", "libvorbis"];
  return ["-f", "concat", "-safe", "0", "-i", "inputs.txt", ...codecArgs, input.output];
}
