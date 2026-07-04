"use client";

import { useEffect, useState } from "react";
import { updateMovie } from "@/lib/local-storage";
import { reviewClipFromMovieClip } from "@/lib/movie-review-storage";
import type { Movie, MovieClip } from "@/lib/types";
import ClipSourcePicker from "../ClipSourcePicker";
import MovieAssembleView from "./MovieAssembleView";
import MovieCandidatesGrid from "./MovieCandidatesGrid";
import MovieClipStrip from "./MovieClipStrip";
import MovieFocusLoupe from "./MovieFocusLoupe";
import MovieInspector from "./MovieInspector";
import MovieLeftRail from "./MovieLeftRail";
import MovieReviewHeader from "./MovieReviewHeader";
import { useMovieKeyboard } from "./useMovieKeyboard";
import { useMovieReviewProject } from "./useMovieReviewProject";

export default function MovieReviewBay({ movie }: { movie: Movie }) {
  const { project, setProject, status } = useMovieReviewProject(movie.id);
  const [movieRecord, setMovieRecord] = useState(movie);
  const [showClipPicker, setShowClipPicker] = useState(false);
  useMovieKeyboard(project, setProject);

  useEffect(() => {
    if (!project || project.title === movie.name) return;
    setProject({ ...project, title: movie.name });
  }, [movie.name, project, setProject]);

  useEffect(() => {
    setMovieRecord(movie);
  }, [movie]);

  async function handleAddClips(clips: MovieClip[]) {
    if (!project || clips.length === 0) return;
    const timestamp = new Date().toISOString();
    const positionedClips = clips.map((clip, index) => ({
      ...clip,
      position: movieRecord.clips.length + index,
    }));
    const savedMovie = await updateMovie({
      ...movieRecord,
      clips: [...movieRecord.clips, ...positionedClips],
    });
    setMovieRecord(savedMovie);
    setProject((current) => {
      const nextCandidates = positionedClips.map((clip, index) =>
        reviewClipFromMovieClip(clip, current.candidates.length + current.committedClips.length + index, timestamp),
      );
      const firstAdded = nextCandidates[0];
      return {
        ...current,
        candidates: [...current.candidates, ...nextCandidates],
        activeIndex: current.candidates.length === 0 && firstAdded ? 0 : current.activeIndex,
        selectedTarget:
          current.candidates.length === 0 && firstAdded ? { type: "candidate", clipId: firstAdded.id } : current.selectedTarget,
        updatedAt: timestamp,
      };
    });
    setShowClipPicker(false);
  }

  if (!project) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center bg-neutral-950 text-sm text-neutral-400" role="status">
        {status}
      </div>
    );
  }

  return (
    <div className="movie-review-grid h-[calc(100vh-3.5rem)] overflow-hidden bg-neutral-950 text-neutral-100">
      <div className="movie-review-header">
        <MovieReviewHeader project={project} onProjectChange={setProject} onAddClipClick={() => setShowClipPicker(true)} />
      </div>
      <MovieLeftRail project={project} onProjectChange={setProject} />
      {project.mode === "focus" ? (
        <MovieFocusLoupe project={project} onProjectChange={setProject} />
      ) : project.mode === "assemble" ? (
        <MovieAssembleView project={project} onProjectChange={setProject} />
      ) : (
        <MovieCandidatesGrid project={project} onProjectChange={setProject} />
      )}
      <MovieInspector project={project} onProjectChange={setProject} />
      <div className="movie-review-strip">
        <MovieClipStrip project={project} onProjectChange={setProject} />
      </div>
      {showClipPicker && <ClipSourcePicker onAddClips={handleAddClips} onClose={() => setShowClipPicker(false)} />}
    </div>
  );
}
