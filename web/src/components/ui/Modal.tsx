"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  className = "",
}: ModalProps) {
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        className={`w-full max-w-lg rounded-(--radius-overlay) bg-(--color-surface-0) p-6 shadow-(--shadow-overlay) animate-scale-in dark:bg-(--color-surface-900) ${className}`}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between">
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
        {children}
      </div>
    </div>
  );
}
