import { describe, expect, it } from "vitest";
import { buildFfmpegConcatArgs } from "./movie-export-args";

describe("movie export args", () => {
  it("builds MP4 concat args with AAC audio", () => {
    expect(buildFfmpegConcatArgs({ inputs: ["clip-0.mp4", "clip-1.mp4"], output: "output.mp4", format: "mp4" })).toEqual([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "inputs.txt",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "output.mp4",
    ]);
  });
});
