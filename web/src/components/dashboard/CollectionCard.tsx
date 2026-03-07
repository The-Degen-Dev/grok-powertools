"use client";

import Link from "next/link";
import { FolderOpen } from "lucide-react";
import type { Collection } from "@/lib/types";

interface CollectionCardProps {
  collection: Collection;
}

export default function CollectionCard({ collection }: CollectionCardProps) {
  const { id, name, items, updatedAt } = collection;
  const previewItems = items.slice(0, 4);
  const dateStr = new Date(updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <Link
      href={`/collections/${id}`}
      className="group block min-w-[220px] max-w-[280px] flex-shrink-0 rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) shadow-(--shadow-card) transition-all duration-(--duration-normal) hover:shadow-(--shadow-card-hover) hover:-translate-y-0.5 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)"
    >
      {/* Thumbnail mosaic */}
      <div className="grid grid-cols-2 gap-0.5 overflow-hidden rounded-t-(--radius-card) aspect-[4/3] bg-(--color-surface-100) dark:bg-(--color-surface-800)">
        {previewItems.length > 0
          ? previewItems.map((item, i) => (
              <div key={item.id} className="relative overflow-hidden bg-(--color-surface-200) dark:bg-(--color-surface-700)">
                {item.videoUrl ? (
                  <video
                    src={item.videoUrl}
                    muted
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-(--color-surface-400)">
                    {i + 1}
                  </div>
                )}
              </div>
            ))
          : Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-center bg-(--color-surface-100) dark:bg-(--color-surface-800)"
              >
                {i === 0 && (
                  <FolderOpen className="h-6 w-6 text-(--color-surface-300) dark:text-(--color-surface-600)" />
                )}
              </div>
            ))}
      </div>

      {/* Info */}
      <div className="px-3 py-2.5">
        <h3 className="truncate text-sm font-semibold text-(--color-surface-800) group-hover:text-(--color-accent) dark:text-(--color-surface-200)">
          {name}
        </h3>
        <p className="mt-0.5 text-xs text-(--color-surface-400)">
          {items.length} video{items.length !== 1 ? "s" : ""} · {dateStr}
        </p>
      </div>
    </Link>
  );
}
