"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, FolderOpen, Film, Sparkles, ArrowRight } from "lucide-react";
import type { Collection, Movie } from "@/lib/types";
import { getAllCollections, getAllMovies, createCollection, createMovie } from "@/lib/local-storage";
import CollectionCard from "./CollectionCard";
import MovieCard from "./MovieCard";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import WelcomeModal from "@/components/onboarding/WelcomeModal";

const EXAMPLE_ITEMS = [
  {
    grokPostId: "demo-1",
    sourceUrl: "https://grok.com/imagine",
    videoUrl: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
    thumbnailUrl: "",
    promptText: "Calm organic movement, otters drifting gently.",
    notes: "",
  },
  {
    grokPostId: "demo-2",
    sourceUrl: "https://grok.com/imagine",
    videoUrl: "https://test-videos.co.uk/vids/jellyfish/mp4/h264/360/Jellyfish_360_10s_1MB.mp4",
    thumbnailUrl: "",
    promptText: "Cyberpunk city at night with neon reflections.",
    notes: "",
  },
  {
    grokPostId: "demo-3",
    sourceUrl: "https://grok.com/imagine",
    videoUrl: "https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4",
    thumbnailUrl: "",
    promptText: "Ancient forest with bioluminescent mushrooms.",
    notes: "",
  },
];

export default function Dashboard() {
  const router = useRouter();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([getAllCollections(), getAllMovies()])
      .then(([cols, movs]) => {
        setCollections(cols);
        setMovies(movs);
      })
      .catch((err) => {
        console.error("[Dashboard] failed to load:", err);
      })
      .finally(() => {
        setLoaded(true);
      });
  }, []);

  async function handleNewCollection() {
    const col = await createCollection("New Collection");
    router.push(`/collections/${col.id}`);
  }

  async function handleNewMovie() {
    const movie = await createMovie("Untitled Movie");
    router.push(`/movie?id=${movie.id}`);
  }

  async function handleLoadExamples() {
    const col = await createCollection("Example Videos", EXAMPLE_ITEMS.map((item, i) => ({
      ...item,
      id: crypto.randomUUID(),
      position: i,
      createdAt: new Date().toISOString(),
    })));
    setCollections((prev) => [col, ...prev]);
    router.push(`/collections/${col.id}`);
  }

  const isEmpty = collections.length === 0 && movies.length === 0;

  if (!loaded) {
    return (
      <div className="mx-auto max-w-screen-xl px-6 py-12">
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-48 rounded-(--radius-card)" />
          ))}
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-6">
        <WelcomeModal onLoadExamples={handleLoadExamples} />
        <div className="max-w-lg text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-(--color-accent)/10">
            <Sparkles className="h-8 w-8 text-(--color-accent)" />
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-(--color-surface-900) dark:text-(--color-surface-100)">
            Welcome to GrokPowerTools
          </h1>
          <p className="mt-3 text-(--color-surface-500) leading-relaxed">
            Organize your Grok Imagine videos into collections, edit clips, and create movies — all in one place.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button variant="primary" size="lg" onClick={handleNewCollection}>
              <FolderPlus className="h-4 w-4" />
              New Collection
            </Button>
            <Button variant="secondary" size="lg" onClick={handleLoadExamples}>
              <Sparkles className="h-4 w-4" />
              Load Examples
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8">
      <WelcomeModal onLoadExamples={handleLoadExamples} />
      {/* Quick actions */}
      <div className="mb-10 flex items-center gap-3">
        <Button variant="primary" onClick={handleNewCollection}>
          <FolderPlus className="h-4 w-4" />
          New Collection
        </Button>
        <Button variant="secondary" onClick={handleNewMovie}>
          <Film className="h-4 w-4" />
          New Movie
        </Button>
      </div>

      {/* Recent Collections */}
      {collections.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-(--color-surface-800) dark:text-(--color-surface-200)">
              Recent Collections
            </h2>
            {collections.length > 5 && (
              <button
                type="button"
                onClick={() => {}}
                className="flex items-center gap-1 text-sm text-(--color-accent) hover:underline"
              >
                View all <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
            {collections.slice(0, 8).map((col, i) => (
              <div key={col.id} className="dashboard-card" style={{ "--i": i } as React.CSSProperties}>
                <CollectionCard collection={col} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Movies in Progress */}
      {movies.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-(--color-surface-800) dark:text-(--color-surface-200)">
              Movies in Progress
            </h2>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
            {movies.slice(0, 8).map((movie, i) => (
              <div key={movie.id} className="dashboard-card" style={{ "--i": i } as React.CSSProperties}>
                <MovieCard movie={movie} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty sections */}
      {collections.length === 0 && (
        <EmptyState
          icon={FolderOpen}
          title="No collections yet"
          description="Create a collection to start organizing your Grok videos."
          action={
            <Button variant="primary" onClick={handleNewCollection}>
              <FolderPlus className="h-4 w-4" />
              New Collection
            </Button>
          }
        />
      )}
    </div>
  );
}
