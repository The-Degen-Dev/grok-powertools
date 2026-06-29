"use client";

import { useEffect } from "react";
import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject } from "@/lib/movie-review-types";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable;
}

export function useMovieKeyboard(project: MovieReviewProject | null, setProject: (project: MovieReviewProject) => void) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!project || isTypingTarget(event.target)) return;
      if (event.code === "KeyK" || event.code === "Enter") {
        event.preventDefault();
        setProject(applyReviewCommand(project, { type: "keep-current" }));
      }
      if (event.code === "KeyX" || event.code === "Backspace") {
        event.preventDefault();
        setProject(applyReviewCommand(project, { type: "reject-current" }));
      }
      if (event.code === "Digit1") {
        event.preventDefault();
        setProject(applyReviewCommand(project, { type: "set-mode", mode: "review" }));
      }
      if (event.code === "Digit2") {
        event.preventDefault();
        setProject(applyReviewCommand(project, { type: "set-mode", mode: "focus" }));
      }
      if (event.code === "Digit3") {
        event.preventDefault();
        setProject(applyReviewCommand(project, { type: "set-mode", mode: "assemble" }));
      }
      if ((event.code === "ArrowLeft" || event.code === "ArrowRight") && project.selectedTarget?.type === "clip") {
        event.preventDefault();
        setProject(
          applyReviewCommand(project, {
            type: "move-committed",
            clipId: project.selectedTarget.clipId,
            direction: event.code === "ArrowLeft" ? -1 : 1,
          }),
        );
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [project, setProject]);
}
