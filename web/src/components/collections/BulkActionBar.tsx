"use client";

import { Trash2, Download, ClipboardCopy, XCircle, Play } from "lucide-react";
import Button from "@/components/ui/Button";

interface BulkActionBarProps {
  selectedCount: number;
  onWatchSelected: () => void;
  watchSelectedDisabled?: boolean;
  onDelete: () => void;
  onDownload: () => void;
  onCopyLinks: () => void;
  onDeselectAll: () => void;
}

export default function BulkActionBar({
  selectedCount,
  onWatchSelected,
  watchSelectedDisabled = false,
  onDelete,
  onDownload,
  onCopyLinks,
  onDeselectAll,
}: BulkActionBarProps) {
  return (
    <div className="fixed inset-x-3 bottom-4 z-50 flex justify-center animate-fade-in-up sm:bottom-6">
      <div className="flex max-w-full flex-wrap items-center justify-center gap-2 rounded-(--radius-card) bg-(--color-surface-0) px-3 py-3 shadow-(--shadow-overlay) dark:bg-(--color-surface-800) sm:gap-3 sm:px-5">
        <span className="shrink-0 text-sm font-medium text-(--color-surface-700) dark:text-(--color-surface-200)">
          {selectedCount} selected
        </span>
        <div className="hidden h-5 w-px bg-(--color-surface-200) dark:bg-(--color-surface-700) sm:block" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onWatchSelected}
          disabled={watchSelectedDisabled}
          className="shrink-0 whitespace-nowrap"
        >
          <Play className="h-3.5 w-3.5" />
          Watch Selected
        </Button>
        <Button variant="ghost" size="sm" onClick={onCopyLinks} className="shrink-0 whitespace-nowrap">
          <ClipboardCopy className="h-3.5 w-3.5" />
          Copy Links
        </Button>
        <Button variant="ghost" size="sm" onClick={onDownload} className="shrink-0 whitespace-nowrap">
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
        <Button variant="danger" size="sm" onClick={onDelete} className="shrink-0 whitespace-nowrap">
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
        <div className="hidden h-5 w-px bg-(--color-surface-200) dark:bg-(--color-surface-700) sm:block" />
        <button
          type="button"
          onClick={onDeselectAll}
          className="p-1 text-(--color-surface-400) hover:text-(--color-surface-600) dark:hover:text-(--color-surface-300)"
          title="Deselect all"
        >
          <XCircle className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
