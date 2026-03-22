"use client";

import { useState, useRef, useCallback } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

// Use single-threaded build — multi-threaded requires COEP/SharedArrayBuffer
const BASE_URL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

export function useFFmpeg() {
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (loaded || loading) return;
    setLoading(true);
    setError(null);

    try {
      const ffmpeg = new FFmpeg();
      ffmpegRef.current = ffmpeg;

      ffmpeg.on("progress", ({ progress: p }) => {
        setProgress(Math.max(0, Math.min(1, p)));
      });

      const coreURL = await toBlobURL(`${BASE_URL}/ffmpeg-core.js`, "text/javascript");
      const wasmURL = await toBlobURL(`${BASE_URL}/ffmpeg-core.wasm`, "application/wasm");

      await ffmpeg.load({ coreURL, wasmURL });
      setLoaded(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load FFmpeg";
      setError(message);
      ffmpegRef.current = null;
    } finally {
      setLoading(false);
    }
  }, [loaded, loading]);

  const run = useCallback(
    async (args: string[]) => {
      if (!ffmpegRef.current || !loaded) throw new Error("FFmpeg not loaded");
      setProgress(0);
      await ffmpegRef.current.exec(args);
    },
    [loaded]
  );

  const writeFile = useCallback(
    async (name: string, data: Uint8Array) => {
      if (!ffmpegRef.current || !loaded) throw new Error("FFmpeg not loaded");
      await ffmpegRef.current.writeFile(name, data);
    },
    [loaded]
  );

  const readFile = useCallback(
    async (name: string): Promise<Uint8Array> => {
      if (!ffmpegRef.current || !loaded) throw new Error("FFmpeg not loaded");
      const data = await ffmpegRef.current.readFile(name);
      return data as Uint8Array;
    },
    [loaded]
  );

  const deleteFile = useCallback(
    async (name: string) => {
      if (!ffmpegRef.current || !loaded) throw new Error("FFmpeg not loaded");
      await ffmpegRef.current.deleteFile(name);
    },
    [loaded]
  );

  const terminate = useCallback(() => {
    ffmpegRef.current?.terminate();
    ffmpegRef.current = null;
    setLoaded(false);
    setProgress(0);
    setError(null);
  }, []);

  return { loaded, loading, progress, error, load, run, writeFile, readFile, deleteFile, terminate };
}
