"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import IconButton from "./IconButton";

interface BulkActionBarProps {
  selectedCount: number;
  selectedInViewCount: number;
  children: ReactNode;
  onClear: () => void;
}

export default function BulkActionBar({
  selectedCount,
  selectedInViewCount,
  children,
  onClear,
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(var(--space-3)+env(safe-area-inset-bottom))] z-40 flex justify-center">
      <div className="pointer-events-auto flex max-w-full items-center gap-[var(--space-2)] rounded-(--radius-lg) border border-(--state-accent-border) bg-(--surface-raised)/95 px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-13)] shadow-(--shadow-overlay) backdrop-blur dark:bg-(--color-surface-900)/95">
        <span className="whitespace-nowrap font-medium text-(--color-surface-800) dark:text-(--color-surface-100)">
          {selectedCount} selected, {selectedInViewCount} in view
        </span>
        <div className="flex max-w-[60vw] items-center gap-[var(--space-1)] overflow-x-auto scrollbar-thin">
          {children}
        </div>
        <IconButton icon={X} label="Clear Vault selection" variant="ghost" onClick={onClear} />
      </div>
    </div>
  );
}
