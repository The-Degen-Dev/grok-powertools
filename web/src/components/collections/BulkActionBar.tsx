"use client";

import { Trash2, Download, ClipboardCopy, XCircle, Play } from "lucide-react";
import Button from "@/components/ui/Button";

interface BulkActionBarProps {
  selectedCount: number;
  onWatchSelected: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onCopyLinks: () => void;
  onDeselectAll: () => void;
}

export default function BulkActionBar({
  selectedCount,
  onWatchSelected,
  onDelete,
  onDownload,
  onCopyLinks,
  onDeselectAll,
}: BulkActionBarProps) {
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-fade-in-up">
      <div className="flex items-center gap-3 rounded-(--radius-card) bg-(--color-surface-0) px-5 py-3 shadow-(--shadow-overlay) dark:bg-(--color-surface-800)">
        <span className="text-sm font-medium text-(--color-surface-700) dark:text-(--color-surface-200)">
          {selectedCount} selected
        </span>
        <div className="h-5 w-px bg-(--color-surface-200) dark:bg-(--color-surface-700)" />
        <Button variant="ghost" size="sm" onClick={onWatchSelected}>
          <Play className="h-3.5 w-3.5" />
          Watch Selected
        </Button>
        <Button variant="ghost" size="sm" onClick={onCopyLinks}>
          <ClipboardCopy className="h-3.5 w-3.5" />
          Copy Links
        </Button>
        <Button variant="ghost" size="sm" onClick={onDownload}>
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
        <Button variant="danger" size="sm" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
        <div className="h-5 w-px bg-(--color-surface-200) dark:bg-(--color-surface-700)" />
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
