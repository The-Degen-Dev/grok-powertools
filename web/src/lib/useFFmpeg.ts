"use client";

import { useState, useRef, useCallback } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

// Use single-threaded build — multi-threaded requires COEP/SharedArrayBuffer
const FFMPEG_CORE_VERSION = "0.12.10";
const BASE_URL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

export function useFFmpeg() {
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const loadPromiseRef = useRef<Promise<void> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (loaded) return;
    if (loadPromiseRef.current) return loadPromiseRef.current;
    setLoading(true);
    setError(null);

    const loadPromise = (async () => {
      const ffmpeg = new FFmpeg();
      ffmpegRef.current = ffmpeg;

      ffmpeg.on("progress", ({ progress: p }) => {
        setProgress(Math.max(0, Math.min(1, p)));
      });

      const coreURL = await toBlobURL(`${BASE_URL}/ffmpeg-core.js`, "text/javascript");
      const wasmURL = await toBlobURL(`${BASE_URL}/ffmpeg-core.wasm`, "application/wasm");

      await ffmpeg.load({ coreURL, wasmURL });
      setLoaded(true);
    })();
    loadPromiseRef.current = loadPromise;
    try {
      await loadPromise;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load FFmpeg";
      setError(message);
      ffmpegRef.current = null;
      throw err;
    } finally {
      loadPromiseRef.current = null;
      setLoading(false);
    }
  }, [loaded]);

  const run = useCallback(
    async (args: string[]) => {
      if (!ffmpegRef.current) throw new Error("FFmpeg not loaded");
      setProgress(0);
      await ffmpegRef.current.exec(args);
    },
    []
  );

  const writeFile = useCallback(
    async (name: string, data: Uint8Array) => {
      if (!ffmpegRef.current) throw new Error("FFmpeg not loaded");
      await ffmpegRef.current.writeFile(name, data);
    },
    []
  );

  const readFile = useCallback(
    async (name: string): Promise<Uint8Array> => {
      if (!ffmpegRef.current) throw new Error("FFmpeg not loaded");
      const data = await ffmpegRef.current.readFile(name);
      return data as Uint8Array;
    },
    []
  );

  const deleteFile = useCallback(
    async (name: string) => {
      if (!ffmpegRef.current) throw new Error("FFmpeg not loaded");
      await ffmpegRef.current.deleteFile(name);
    },
    []
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
