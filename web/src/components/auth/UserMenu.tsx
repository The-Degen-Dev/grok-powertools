"use client";

import { useState, useRef, useEffect } from "react";
import { LogOut, RefreshCw, Wifi, WifiOff } from "lucide-react";
import SignInModal from "./SignInModal";
import Button from "@/components/ui/Button";

interface UserMenuProps {
  user: { name?: string | null; email?: string | null; image?: string | null } | null;
  onSignIn: (provider: string) => void;
  onSignOut: () => void;
  syncStatus?: "synced" | "syncing" | "offline" | "error";
  lastSyncAt?: string | null;
  onSyncNow?: () => void;
}

export default function UserMenu({
  user,
  onSignIn,
  onSignOut,
  syncStatus = "synced",
  lastSyncAt,
  onSyncNow,
}: UserMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const syncIndicator = {
    synced: "bg-green-500",
    syncing: "bg-yellow-500 animate-pulse",
    offline: "bg-(--color-surface-400)",
    error: "bg-red-500",
  }[syncStatus];

  const syncLabel = {
    synced: "Synced",
    syncing: "Syncing...",
    offline: "Offline",
    error: "Sync error",
  }[syncStatus];

  if (!user) {
    return (
      <>
        <Button variant="primary" size="sm" onClick={() => setSignInOpen(true)}>
          Sign in
        </Button>
        <SignInModal
          open={signInOpen}
          onClose={() => setSignInOpen(false)}
          onSignIn={(provider) => {
            setSignInOpen(false);
            onSignIn(provider);
          }}
        />
      </>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className="relative flex items-center gap-2 rounded-(--radius-btn) p-1 transition-colors hover:bg-(--color-surface-100) dark:hover:bg-(--color-surface-800)"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- Provider avatar URLs are already optimized and not controlled by the app.
          <img
            src={user.image}
            alt=""
            className="h-7 w-7 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-(--color-accent) text-xs font-medium text-white">
            {(user.name?.[0] || user.email?.[0] || "U").toUpperCase()}
          </div>
        )}
        <div className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-(--color-surface-0) dark:border-(--color-surface-950) ${syncIndicator}`} />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-(--radius-card) bg-(--color-surface-0) py-2 shadow-(--shadow-overlay) dark:bg-(--color-surface-800)">
          {/* User info */}
          <div className="border-b border-(--color-surface-200) px-4 py-2 dark:border-(--color-surface-700)">
            <p className="text-sm font-medium text-(--color-surface-900) dark:text-(--color-surface-100)">
              {user.name}
            </p>
            <p className="text-xs text-(--color-surface-400)">{user.email}</p>
          </div>

          {/* Sync status */}
          <div className="border-b border-(--color-surface-200) px-4 py-2 dark:border-(--color-surface-700)">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {syncStatus === "offline" ? (
                  <WifiOff className="h-3.5 w-3.5 text-(--color-surface-400)" />
                ) : (
                  <Wifi className="h-3.5 w-3.5 text-(--color-surface-500)" />
                )}
                <span className="text-xs text-(--color-surface-500)">{syncLabel}</span>
              </div>
              {onSyncNow && syncStatus !== "syncing" && (
                <button
                  type="button"
                  onClick={() => { onSyncNow(); setMenuOpen(false); }}
                  className="rounded-(--radius-btn) p-1 text-(--color-surface-400) hover:bg-(--color-surface-100) hover:text-(--color-surface-600) dark:hover:bg-(--color-surface-700)"
                  title="Sync now"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {lastSyncAt && (
              <p className="mt-1 text-[10px] text-(--color-surface-400)">
                Last synced: {new Date(lastSyncAt).toLocaleString()}
              </p>
            )}
          </div>

          {/* Actions */}
          <button
            type="button"
            onClick={() => { onSignOut(); setMenuOpen(false); }}
            className="flex w-full items-center gap-2 px-4 py-2 text-sm text-(--color-surface-600) hover:bg-(--color-surface-50) dark:text-(--color-surface-400) dark:hover:bg-(--color-surface-700)"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
