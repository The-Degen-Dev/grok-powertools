"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: string;
}

export default function SlideOver({
  open,
  onClose,
  title,
  children,
  width = "max-w-md",
}: SlideOverProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        className={`${width} flex h-full w-full flex-col bg-(--color-surface-0) shadow-(--shadow-overlay) animate-slide-in-right dark:bg-(--color-surface-900)`}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-(--color-surface-200) px-5 py-4 dark:border-(--color-surface-800)">
            <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-(--color-surface-900) dark:text-(--color-surface-100)">
              {title}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-(--radius-btn) p-1.5 text-(--color-surface-400) hover:bg-(--color-surface-100) dark:hover:bg-(--color-surface-800)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
