"use client";

import { useState } from "react";
import { FolderOpen, Plus, Search, Trash2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const filtered = collections.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const compactSidebar = (className: string, action: "expand" | "open-mobile") => (
    <aside className={className}>
      {action === "expand" ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="rounded-(--radius-btn) p-2 text-(--color-surface-400) hover:bg-(--color-surface-100) dark:hover:bg-(--color-surface-800)"
          title="Expand sidebar"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="rounded-(--radius-btn) p-2 text-(--color-surface-400) hover:bg-(--color-surface-100) dark:hover:bg-(--color-surface-800)"
          aria-label="Open collections"
          title="Open collections"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      )}
      <div className="mt-4 flex flex-col gap-1">
        {collections.slice(0, 8).map((col) => (
          <button
            key={col.id}
            type="button"
            onClick={() => onSelect(col.id)}
            className={`flex h-8 w-8 items-center justify-center rounded-(--radius-btn) text-xs font-medium transition-colors ${
              activeId === col.id
                ? "bg-(--color-accent)/10 text-(--color-accent)"
                : "text-(--color-surface-400) hover:bg-(--color-surface-100) dark:hover:bg-(--color-surface-800)"
            }`}
            title={col.name}
          >
            {col.name[0]?.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="mt-auto">
        <button
          type="button"
          onClick={onNew}
          className="rounded-(--radius-btn) p-2 text-(--color-surface-400) hover:text-(--color-accent) hover:bg-(--color-surface-100) dark:hover:bg-(--color-surface-800)"
          title="New collection"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );

  const expandedSidebar = ({
    className,
    onClose,
    onSelectCollection = onSelect,
    onNewCollection = onNew,
  }: {
    className: string;
    onClose?: () => void;
    onSelectCollection?: (id: string) => void;
    onNewCollection?: () => void;
  }) => (
    <aside
      className={className}
      onClick={(event) => {
        if (onClose) event.stopPropagation();
      }}
    >
      {/* Header with collapse toggle */}
      <div className="flex items-center justify-between border-b border-(--color-surface-200) px-3 py-2 dark:border-(--color-surface-800)">
        <span className="text-xs font-semibold uppercase tracking-wider text-(--color-surface-400)">
          Collections
        </span>
        <button
          type="button"
          onClick={onClose ?? (() => setCollapsed(true))}
          className="rounded-(--radius-btn) p-1 text-(--color-surface-400) hover:bg-(--color-surface-100) dark:hover:bg-(--color-surface-800)"
          title={onClose ? "Close collections" : "Collapse sidebar"}
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Search */}
      <div className="border-b border-(--color-surface-200) p-3 dark:border-(--color-surface-800)">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--color-surface-400)" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-(--radius-input) border border-(--color-surface-200) bg-(--color-surface-0) py-1.5 pl-8 pr-3 text-sm text-(--color-surface-700) placeholder:text-(--color-surface-400) focus:border-(--color-accent-muted) focus:outline-none focus:ring-1 focus:ring-(--color-accent-muted) dark:border-(--color-surface-700) dark:bg-(--color-surface-900) dark:text-(--color-surface-200)"
          />
        </div>
      </div>

      {/* Collection list */}
      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="mb-2 h-10 w-10 text-(--color-surface-300) dark:text-(--color-surface-600)" />
            <p className="text-sm font-medium text-(--color-surface-500)">
              No collections yet
            </p>
            <p className="mt-1 text-xs text-(--color-surface-400)">
              Create one to get started.
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((col) => {
              const isActive = activeId === col.id;
              return (
                <li key={col.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectCollection(col.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectCollection(col.id); } }}
                    className={`group flex w-full cursor-pointer items-center justify-between rounded-(--radius-btn) px-3 py-2 text-left text-sm transition-colors ${
                      isActive
                        ? "border-l-2 border-l-(--color-accent) bg-(--color-accent)/5 pl-2.5 text-(--color-accent) dark:bg-(--color-accent)/10"
                        : "text-(--color-surface-600) hover:bg-(--color-surface-100) dark:text-(--color-surface-400) dark:hover:bg-(--color-surface-800)"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{col.name}</span>
                      <span className="text-xs text-(--color-surface-400)">
                        {col.items.length} video{col.items.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(col.id);
                      }}
                      className="hidden rounded p-1 text-(--color-surface-400) hover:bg-red-50 hover:text-red-500 group-hover:block dark:hover:bg-red-950"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* New collection button */}
      <div className="border-t border-(--color-surface-200) p-3 dark:border-(--color-surface-800)">
        <button
          type="button"
          onClick={onNewCollection}
          className="flex w-full items-center justify-center gap-1.5 rounded-(--radius-btn) border border-dashed border-(--color-surface-300) py-2 text-sm text-(--color-surface-500) transition-colors hover:border-(--color-accent-muted) hover:text-(--color-accent) dark:border-(--color-surface-700)"
        >
          <Plus className="h-4 w-4" />
          New Collection
        </button>
      </div>
    </aside>
  );

  if (collapsed) {
    return compactSidebar(
      "flex h-full w-12 flex-shrink-0 flex-col items-center border-r border-(--color-surface-200) bg-(--color-surface-50) py-3 dark:border-(--color-surface-800) dark:bg-(--color-surface-950)",
      "expand"
    );
  }

  return (
    <>
      {compactSidebar(
        "flex h-full w-12 flex-shrink-0 flex-col items-center border-r border-(--color-surface-200) bg-(--color-surface-50) py-3 dark:border-(--color-surface-800) dark:bg-(--color-surface-950) sm:hidden",
        "open-mobile"
      )}
      {expandedSidebar({
        className: "hidden h-full w-64 flex-shrink-0 flex-col border-r border-(--color-surface-200) bg-(--color-surface-50) dark:border-(--color-surface-800) dark:bg-(--color-surface-950) sm:flex",
      })}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/30 sm:hidden"
          onClick={() => setMobileOpen(false)}
        >
          {expandedSidebar({
            className: "flex h-full w-[min(20rem,calc(100vw-3rem))] flex-col border-r border-(--color-surface-200) bg-(--color-surface-50) shadow-(--shadow-overlay) dark:border-(--color-surface-800) dark:bg-(--color-surface-950)",
            onClose: () => setMobileOpen(false),
            onSelectCollection: (id) => {
              onSelect(id);
              setMobileOpen(false);
            },
            onNewCollection: () => {
              onNew();
              setMobileOpen(false);
            },
          })}
        </div>
      )}
    </>
  );
}
