"use client";

import { useEffect } from "react";
import type { Movie } from "@/lib/types";
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
  useMovieKeyboard(project, setProject);

  useEffect(() => {
    if (!project || project.title === movie.name) return;
    setProject({ ...project, title: movie.name });
  }, [movie.name, project, setProject]);

  if (!project) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center bg-neutral-950 text-sm text-neutral-400" role="status">
        {status}
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100vh-3.5rem)] grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] overflow-y-auto bg-neutral-950 text-neutral-100 lg:grid-cols-[16rem_minmax(0,1fr)_18rem] lg:grid-rows-[auto_minmax(0,1fr)_auto] lg:overflow-hidden">
      <div className="lg:col-span-3">
        <MovieReviewHeader project={project} onProjectChange={setProject} />
      </div>
      <MovieLeftRail project={project} onProjectChange={setProject} />
      {project.mode === "focus" ? (
        <MovieFocusLoupe project={project} onProjectChange={setProject} />
      ) : (
        <MovieCandidatesGrid project={project} onProjectChange={setProject} />
      )}
      <MovieInspector project={project} onProjectChange={setProject} />
      <div className="lg:col-span-3">
        <MovieClipStrip project={project} onProjectChange={setProject} />
      </div>
    </div>
  );
}
