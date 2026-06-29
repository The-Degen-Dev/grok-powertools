"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createReviewProjectFromMovie, updateReviewProject } from "@/lib/movie-review-storage";
import type { MovieReviewProject } from "@/lib/movie-review-types";

export function useMovieReviewProject(movieId: string) {
  const [project, setProjectState] = useState<MovieReviewProject | null>(null);
  const [status, setStatus] = useState("Loading Review Bay...");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    createReviewProjectFromMovie(movieId)
      .then((record) => {
        if (cancelled) return;
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

  const setProject = useCallback((next: MovieReviewProject) => {
    setProjectState(next);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      updateReviewProject(next).catch(() => {});
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  return { project, setProject, status };
}
