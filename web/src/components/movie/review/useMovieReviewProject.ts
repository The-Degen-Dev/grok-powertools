"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createReviewProjectFromMovie, updateReviewProject } from "@/lib/movie-review-storage";
import type { MovieReviewProject } from "@/lib/movie-review-types";

export type MovieReviewProjectUpdate = MovieReviewProject | ((project: MovieReviewProject) => MovieReviewProject);

export function useMovieReviewProject(movieId: string) {
  const [project, setProjectState] = useState<MovieReviewProject | null>(null);
  const [status, setStatus] = useState("Loading Review Bay...");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProjectRef = useRef<MovieReviewProject | null>(null);
  const currentProjectRef = useRef<MovieReviewProject | null>(null);

  useEffect(() => {
    let cancelled = false;
    createReviewProjectFromMovie(movieId)
      .then((record) => {
        if (cancelled) return;
        currentProjectRef.current = record;
        pendingProjectRef.current = null;
        setProjectState(record);
        setStatus("Review Bay ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus(error instanceof Error ? error.message : "Review Bay failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [movieId]);

  const scheduleSave = useCallback((next: MovieReviewProject) => {
    pendingProjectRef.current = next;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      pendingProjectRef.current = null;
      updateReviewProject(next).catch((error) => {
        setStatus(error instanceof Error ? error.message : "Review Bay save failed");
      });
    }, 300);
  }, []);

  const setProject = useCallback(
    (update: MovieReviewProjectUpdate) => {
      const current = currentProjectRef.current;
      if (!current) return;
      const next = typeof update === "function" ? update(current) : update;
      currentProjectRef.current = next;
      setProjectState(next);
      scheduleSave(next);
    },
    [scheduleSave],
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      const pending = pendingProjectRef.current;
      if (pending) {
        pendingProjectRef.current = null;
        void updateReviewProject(pending);
      }
    };
  }, []);

  return { project, setProject, status };
}
