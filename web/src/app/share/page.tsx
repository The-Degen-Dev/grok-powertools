"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Play, ExternalLink, Download, Info, Copy, X } from "lucide-react";
import { decodeShareData } from "@/lib/share";
import type { VideoItem } from "@/lib/types";
import FullscreenViewer from "@/components/video/FullscreenViewer";

function SharePageContent() {
  const searchParams = useSearchParams();
  const [name, setName] = useState<string>("");
  const [items, setItems] = useState<VideoItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    const data = searchParams.get("d");
    if (!data) {
      setError("No share data found in URL.");
      return;
    }
    const decoded = decodeShareData(data);
    if (!decoded) {
      setError("Invalid or corrupted share link.");
      return;
    }
    setName(decoded.name);
    setItems(decoded.items);
  }, [searchParams]);

  if (error) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            Invalid Share Link
          </h1>
          <p className="mt-2 text-neutral-500">{error}</p>
          <a
            href="/"
            className="mt-4 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Go to Collections
          </a>
        </div>
      </div>
    );
  }

  if (items.length === 0 && !error) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            {name}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Shared collection &middot; {items.length} video
            {items.length !== 1 ? "s" : ""}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setViewerIndex(0)}
              className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              <Play className="h-4 w-4" />
              Play All
            </button>
          </div>
        </div>
      </div>

      {/* Video grid */}
      <div className="mx-auto max-w-6xl p-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((item, index) => (
            <SharedVideoCard
              key={item.id}
              item={item}
              onClick={() => setViewerIndex(index)}
            />
          ))}
        </div>
      </div>

      {/* Fullscreen viewer */}
      {viewerIndex !== null && (
        <FullscreenViewer
          items={items}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </div>
  );
}

function SharedVideoCard({
  item,
  onClick,
}: {
  item: VideoItem;
  onClick: () => void;
}) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className="group relative cursor-pointer overflow-hidden rounded-lg border border-neutral-200 bg-black dark:border-neutral-700">
      <div
        className="relative"
        style={{ paddingBottom: "150%" }}
        onClick={onClick}
      >
        {/* Placeholder with prompt */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3">
          <Play className="h-8 w-8 text-neutral-400 transition group-hover:text-orange-500" />
          {item.promptText && (
            <p className="line-clamp-3 text-center text-xs leading-relaxed text-neutral-500">
              {item.promptText}
            </p>
          )}
        </div>

        {/* Info overlay */}
        {showInfo && item.promptText && (
          <div
            className="absolute inset-0 z-10 flex flex-col justify-start bg-black/80 p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <p className="flex-1 text-xs leading-relaxed text-white/90">
                {item.promptText}
              </p>
              <button
                type="button"
                onClick={() => setShowInfo(false)}
                className="ml-2 rounded p-1 text-white/70 hover:bg-white/10 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(item.promptText)}
              className="mt-2 flex items-center gap-1 text-xs text-white/60 hover:text-white"
            >
              <Copy className="h-3 w-3" />
              Copy prompt
            </button>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between bg-white px-2 py-1.5 dark:bg-neutral-900">
        <div className="flex gap-0.5">
          <SmallButton
            icon={Info}
            label="Prompt"
            onClick={() => setShowInfo(!showInfo)}
            active={showInfo}
          />
          <SmallButton
            icon={ExternalLink}
            label="Open on Grok"
            onClick={() => window.open(item.sourceUrl, "_blank")}
          />
          <SmallButton
            icon={Download}
            label="Download"
            onClick={() => {
              const a = document.createElement("a");
              a.href = item.videoUrl;
              a.download = `${item.grokPostId}.mp4`;
              a.click();
            }}
          />
        </div>
      </div>
    </div>
  );
}

function SmallButton({
  icon: Icon,
  label,
  onClick,
  active = false,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded p-1.5 transition ${
        active
          ? "bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-400"
          : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
      }`}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

export default function SharePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-orange-500" />
        </div>
      }
    >
      <SharePageContent />
    </Suspense>
  );
}
