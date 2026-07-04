"use client";

import { useEffect, useRef } from "react";
import type { ReviewClip } from "@/lib/movie-review-types";

export function useMovieAudioPreview(
  clips: ReviewClip[],
  videos: Map<string, HTMLVideoElement>,
  masterVolume: number,
  masterMuted: boolean,
) {
  const contextRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef(new Map<string, { source: MediaElementAudioSourceNode; gain: GainNode }>());

  useEffect(() => {
    if (typeof AudioContext === "undefined") return;
    const context = contextRef.current || new AudioContext();
    contextRef.current = context;
    const nodes = nodesRef.current;
    const anySolo = clips.some((clip) => clip.solo);
    for (const clip of clips) {
      const video = videos.get(clip.id);
      if (!video || nodes.has(clip.id)) continue;
      try {
        const source = context.createMediaElementSource(video);
        const gain = context.createGain();
        source.connect(gain).connect(context.destination);
        nodes.set(clip.id, { source, gain });
      } catch {
        // A media element can only have one MediaElementAudioSourceNode.
      }
    }
    for (const clip of clips) {
      const node = nodes.get(clip.id);
      if (!node) continue;
      const audibleBySolo = !anySolo || clip.solo;
      node.gain.gain.value = masterMuted || clip.muted || !audibleBySolo ? 0 : clip.volume * masterVolume;
    }
    return () => {
      for (const [clipId, node] of nodes) {
        if (!clips.some((clip) => clip.id === clipId)) {
          node.source.disconnect();
          node.gain.disconnect();
          nodes.delete(clipId);
        }
      }
    };
  }, [clips, masterMuted, masterVolume, videos]);

  useEffect(
    () => () => {
      for (const node of nodesRef.current.values()) {
        node.source.disconnect();
        node.gain.disconnect();
      }
      nodesRef.current.clear();
      void contextRef.current?.close();
      contextRef.current = null;
    },
    [],
  );
}
