"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import MovieList from "@/components/movie/MovieList";
import MovieMaker from "@/components/movie/MovieMaker";

function MoviePageContent() {
  const searchParams = useSearchParams();
  const movieId = searchParams.get("id");

  if (movieId) {
    return <MovieMaker movieId={movieId} />;
  }
  return <MovieList />;
}

export default function MovieMakerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-orange-500" />
        </div>
      }
    >
      <MoviePageContent />
    </Suspense>
  );
}
