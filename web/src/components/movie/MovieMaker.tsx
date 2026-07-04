"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMovie } from "@/lib/local-storage";
import type { Movie } from "@/lib/types";
import MovieReviewBay from "./review/MovieReviewBay";

interface MovieMakerProps {
  movieId: string;
}

export default function MovieMaker({ movieId }: MovieMakerProps) {
  const router = useRouter();
  const [movie, setMovie] = useState<Movie | null>(null);

  useEffect(() => {
    getMovie(movieId).then((record) => {
      if (record) setMovie(record);
      else router.push("/movie");
    });
  }, [movieId, router]);

  if (!movie) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-orange-500" />
      </div>
    );
  }

  return <MovieReviewBay movie={movie} />;
}
