"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { getSyncEngine, type SyncStatus } from "@/lib/sync-engine";

interface SyncContextValue {
  user: { name?: string | null; email?: string | null; image?: string | null } | null;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  syncNow: () => void;
  signIn: (provider: string) => void;
  signOut: () => void;
  isInitialSync: boolean;
  initialSyncProgress: { done: number; total: number } | null;
}

const SyncContext = createContext<SyncContextValue>({
  user: null,
  syncStatus: "synced",
  lastSyncAt: null,
  syncNow: () => {},
  signIn: () => {},
  signOut: () => {},
  isInitialSync: false,
  initialSyncProgress: null,
});

export function useSyncContext() {
  return useContext(SyncContext);
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SyncContextValue["user"]>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("synced");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [isInitialSync, setIsInitialSync] = useState(false);
  const [initialSyncProgress, setInitialSyncProgress] = useState<{ done: number; total: number } | null>(null);

  // Fetch session on mount
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((session: { user?: { name?: string; email?: string; image?: string } }) => {
        if (session?.user) {
          setUser(session.user);
        }
      })
      .catch(() => {});
  }, []);

  // Start sync engine when user is signed in
  useEffect(() => {
    if (!user) return;
    let aborted = false;

    const engine = getSyncEngine();
    const unsubscribe = engine.onStatusChange((status, syncAt) => {
      if (aborted) return;
      setSyncStatus(status);
      setLastSyncAt(syncAt);
    });

    // Check if this is first sign-in (no lastSyncAt means never synced)
    import("@/lib/local-storage").then(async ({ getSyncMeta }) => {
      if (aborted) return;
      const meta = await getSyncMeta();
      if (aborted) return;
      if (!meta?.lastSyncAt || meta.lastSyncAt === new Date(0).toISOString()) {
        // First sign-in — do initial push
        setIsInitialSync(true);
        try {
          await engine.initialPush((done, total) => {
            if (!aborted) setInitialSyncProgress({ done, total });
          });
        } finally {
          if (!aborted) {
            setIsInitialSync(false);
            setInitialSyncProgress(null);
          }
        }
      } else {
        if (!aborted) engine.start();
      }
    });

    return () => {
      aborted = true;
      unsubscribe();
      engine.stop();
    };
  }, [user]);

  const signIn = useCallback((provider: string) => {
    window.location.href = `/api/auth/signin?provider=${provider}`;
  }, []);

  const signOut = useCallback(() => {
    window.location.href = "/api/auth/signout";
  }, []);

  const syncNow = useCallback(() => {
    getSyncEngine().fullSync();
  }, []);

  return (
    <SyncContext value={{
      user,
      syncStatus,
      lastSyncAt,
      syncNow,
      signIn,
      signOut,
      isInitialSync,
      initialSyncProgress,
    }}>
      {children}
    </SyncContext>
  );
}
