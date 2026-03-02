"use client";

import { useState } from "react";
import { FolderOpen, Plus, Search, Trash2 } from "lucide-react";
import type { Collection } from "@/lib/types";

interface CollectionSidebarProps {
  collections: Collection[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export default function CollectionSidebar({
  collections,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: CollectionSidebarProps) {
  const [search, setSearch] = useState("");

  const filtered = collections.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <aside className="flex h-full w-64 flex-shrink-0 flex-col border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
      {/* Search */}
      <div className="border-b border-neutral-200 p-3 dark:border-neutral-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Search collections..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-neutral-200 bg-white py-1.5 pl-8 pr-3 text-sm text-neutral-700 placeholder:text-neutral-400 focus:border-orange-300 focus:outline-none focus:ring-1 focus:ring-orange-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          />
        </div>
      </div>

      {/* Collection list */}
      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="mb-2 h-10 w-10 text-neutral-300 dark:text-neutral-600" />
            <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
              No collections saved yet
            </p>
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              Add videos and save your collection.
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((col) => (
              <li key={col.id}>
                <button
                  type="button"
                  onClick={() => onSelect(col.id)}
                  className={`group flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition ${
                    activeId === col.id
                      ? "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{col.name}</span>
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">
                      {col.items.length} video{col.items.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(col.id);
                    }}
                    className="hidden rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-500 group-hover:block dark:hover:bg-red-950"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* New collection button */}
      <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-neutral-300 py-2 text-sm text-neutral-500 transition hover:border-orange-300 hover:text-orange-600 dark:border-neutral-700 dark:hover:border-orange-700 dark:hover:text-orange-400"
        >
          <Plus className="h-4 w-4" />
          New Collection
        </button>
      </div>
    </aside>
  );
}
