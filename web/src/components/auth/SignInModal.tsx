"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import Button from "@/components/ui/Button";

interface SignInModalProps {
  open: boolean;
  onClose: () => void;
  onSignIn: (provider: string) => void;
}

export default function SignInModal({ open, onClose, onSignIn }: SignInModalProps) {
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-(--radius-card) bg-(--color-surface-0) p-6 shadow-(--shadow-overlay) animate-fade-in-up dark:bg-(--color-surface-900)">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-(--color-surface-900) dark:text-(--color-surface-100)">
            Sign in
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-(--radius-btn) p-1.5 text-(--color-surface-400) hover:bg-(--color-surface-100) dark:hover:bg-(--color-surface-800)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-6 text-sm text-(--color-surface-500)">
          Sign in to sync your collections and prompts across devices.
        </p>

        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={() => onSignIn("google")}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </Button>

        <p className="mt-4 text-center text-xs text-(--color-surface-400)">
          Your local data stays on this device even without signing in.
        </p>
      </div>
    </div>
  );
}
