"use client";

import { useEffect } from "react";
import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject } from "@/lib/movie-review-types";
import type { MovieReviewProjectUpdate } from "./useMovieReviewProject";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable;
}

function rejectSelectedCandidate(project: MovieReviewProject): MovieReviewProject {
  const target = project.selectedTarget;
  if (target?.type !== "candidate") return project;
  const activeIndex = project.candidates.findIndex((clip) => clip.id === target.clipId);
  if (activeIndex < 0) return project;
  return applyReviewCommand({ ...project, activeIndex }, { type: "reject-current" });
}

export function useMovieKeyboard(project: MovieReviewProject | null, setProject: (project: MovieReviewProjectUpdate) => void) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!project || isTypingTarget(event.target)) return;
      if (event.code === "KeyK" || event.code === "Enter") {
        event.preventDefault();
        setProject((current) => applyReviewCommand(current, { type: "keep-current" }));
      }
      if (event.code === "KeyX" || event.code === "Backspace") {
        event.preventDefault();
        setProject(rejectSelectedCandidate);
      }
      if (event.code === "Digit1") {
        event.preventDefault();
        setProject((current) => applyReviewCommand(current, { type: "set-mode", mode: "review" }));
      }
      if (event.code === "Digit2") {
        event.preventDefault();
        setProject((current) => applyReviewCommand(current, { type: "set-mode", mode: "focus" }));
      }
      if (event.code === "Digit3") {
        event.preventDefault();
        setProject((current) => applyReviewCommand(current, { type: "set-mode", mode: "assemble" }));
      }
      if ((event.code === "ArrowLeft" || event.code === "ArrowRight") && project.selectedTarget?.type === "clip") {
        event.preventDefault();
        const clipId = project.selectedTarget.clipId;
        setProject(
          (current) => applyReviewCommand(current, {
            type: "move-committed",
            clipId,
            direction: event.code === "ArrowLeft" ? -1 : 1,
          }),
        );
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [project, setProject]);
}
