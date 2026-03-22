import {
  getAllCollectionsIncludingDeleted,
  getAllMoviesIncludingDeleted,
  getCollection,
  updateCollection,
  getMovie,
  updateMovie,
  getSyncMeta,
  updateSyncMeta,
  createCollection,
  createMovie,
} from "./local-storage";
import type { Collection, Movie } from "./types";

export type SyncStatus = "synced" | "syncing" | "offline" | "error";

type StatusListener = (status: SyncStatus, lastSyncAt: string | null) => void;

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class SyncEngine {
  private listeners: Set<StatusListener> = new Set();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private status: SyncStatus = "synced";
  private lastSyncAt: string | null = null;
  private syncing = false;
  private retryCount = 0;
  private retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAYS = [30_000, 60_000, 120_000];

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status, this.lastSyncAt);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.status, this.lastSyncAt);
    }
  }

  private setStatus(status: SyncStatus) {
    this.status = status;
    this.emit();
  }

  async start(): Promise<void> {
    // Load last sync timestamp
    const meta = await getSyncMeta();
    if (meta) this.lastSyncAt = meta.lastSyncAt;

    // Online/offline events
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
    document.addEventListener("visibilitychange", this.handleVisibility);

    // Initial check
    if (!navigator.onLine) {
      this.setStatus("offline");
    } else {
      await this.fullSync();
    }

    // Periodic sync
    this.intervalId = setInterval(() => {
      if (navigator.onLine && !this.syncing) {
        this.fullSync();
      }
    }, SYNC_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = null;
    }
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    document.removeEventListener("visibilitychange", this.handleVisibility);
  }

  private handleOnline = () => {
    this.fullSync();
  };

  private handleOffline = () => {
    this.setStatus("offline");
  };

  private handleVisibility = () => {
    if (document.visibilityState === "visible" && navigator.onLine && !this.syncing) {
      this.fullSync();
    }
  };

  async fullSync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    this.setStatus("syncing");

    try {
      await this.pull();
      await this.push();
      const now = new Date().toISOString();
      this.lastSyncAt = now;
      await updateSyncMeta({ lastSyncAt: now });
      this.retryCount = 0;
      this.setStatus("synced");
    } catch (err) {
      console.error("[SyncEngine] sync failed:", err);
      this.setStatus("error");
      this.scheduleRetry();
    } finally {
      this.syncing = false;
    }
  }

  private scheduleRetry(): void {
    if (this.retryCount >= SyncEngine.MAX_RETRIES) return;
    const delay = SyncEngine.RETRY_DELAYS[this.retryCount] ?? 120_000;
    this.retryCount++;
    console.log(`[SyncEngine] retry ${this.retryCount}/${SyncEngine.MAX_RETRIES} in ${delay / 1000}s`);
    this.retryTimeoutId = setTimeout(() => {
      if (navigator.onLine && !this.syncing) {
        this.fullSync();
      }
    }, delay);
  }

  private async pull(): Promise<void> {
    const since = this.lastSyncAt || new Date(0).toISOString();
    const res = await fetch(`/api/sync/pull?since=${encodeURIComponent(since)}`);
    if (!res.ok) throw new Error(`Pull failed: ${res.status}`);

    const data = await res.json() as {
      collections: Array<{ id: string; data: string; updatedAt: string; deletedAt: string | null }>;
      movies: Array<{ id: string; data: string; updatedAt: string; deletedAt: string | null }>;
    };

    // Merge collections (server wins if newer)
    for (const remote of data.collections) {
      const local = await getCollection(remote.id);
      const remoteData = JSON.parse(remote.data) as Collection;

      if (!local) {
        // New from server — create locally
        await createCollection(remoteData.name, remoteData.items);
        // Overwrite with correct id and metadata
        const created: Collection = {
          ...remoteData,
          id: remote.id,
          updatedAt: remote.updatedAt,
          deletedAt: remote.deletedAt ?? undefined,
        };
        await updateCollection(created);
      } else if (new Date(remote.updatedAt) > new Date(local.updatedAt)) {
        // Server is newer — update local
        const merged: Collection = {
          ...remoteData,
          id: remote.id,
          updatedAt: remote.updatedAt,
          deletedAt: remote.deletedAt ?? undefined,
        };
        await updateCollection(merged);
      }
    }

    // Merge movies
    for (const remote of data.movies) {
      const local = await getMovie(remote.id);
      const remoteData = JSON.parse(remote.data) as Movie;

      if (!local) {
        const created: Movie = {
          ...remoteData,
          id: remote.id,
          updatedAt: remote.updatedAt,
          deletedAt: remote.deletedAt ?? undefined,
        };
        await createMovie(created.name);
        await updateMovie(created);
      } else if (new Date(remote.updatedAt) > new Date(local.updatedAt)) {
        const merged: Movie = {
          ...remoteData,
          id: remote.id,
          updatedAt: remote.updatedAt,
          deletedAt: remote.deletedAt ?? undefined,
        };
        await updateMovie(merged);
      }
    }
  }

  private async push(): Promise<void> {
    const since = this.lastSyncAt || new Date(0).toISOString();
    const sinceDate = new Date(since).getTime();

    const allCollections = await getAllCollectionsIncludingDeleted();
    const allMovies = await getAllMoviesIncludingDeleted();

    const changedCollections = allCollections.filter(
      (c) => new Date(c.updatedAt).getTime() > sinceDate
    );
    const changedMovies = allMovies.filter(
      (m) => new Date(m.updatedAt).getTime() > sinceDate
    );

    if (changedCollections.length === 0 && changedMovies.length === 0) return;

    const body = {
      collections: changedCollections.map((c) => ({
        id: c.id,
        data: JSON.stringify(c),
        updatedAt: c.updatedAt,
        deletedAt: c.deletedAt ?? null,
      })),
      movies: changedMovies.map((m) => ({
        id: m.id,
        data: JSON.stringify(m),
        updatedAt: m.updatedAt,
        deletedAt: m.deletedAt ?? null,
      })),
    };

    const res = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Push failed: ${res.status}`);

    const result = await res.json() as { syncedAt: string };
    await updateSyncMeta({ lastPushAt: result.syncedAt });
  }

  // --- First sign-in migration ---

  async initialPush(onProgress?: (done: number, total: number) => void): Promise<void> {
    const allCollections = await getAllCollectionsIncludingDeleted();
    const allMovies = await getAllMoviesIncludingDeleted();
    const total = allCollections.length + allMovies.length;
    let done = 0;

    // Push collections in batches of 10
    for (let i = 0; i < allCollections.length; i += 10) {
      const batch = allCollections.slice(i, i + 10);
      const body = {
        collections: batch.map((c) => ({
          id: c.id,
          data: JSON.stringify(c),
          updatedAt: c.updatedAt,
          deletedAt: c.deletedAt ?? null,
        })),
      };

      const res = await fetch("/api/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Initial push failed: ${res.status}`);

      done += batch.length;
      onProgress?.(done, total);
    }

    // Push movies in batches of 10
    for (let i = 0; i < allMovies.length; i += 10) {
      const batch = allMovies.slice(i, i + 10);
      const body = {
        movies: batch.map((m) => ({
          id: m.id,
          data: JSON.stringify(m),
          updatedAt: m.updatedAt,
          deletedAt: m.deletedAt ?? null,
        })),
      };

      const res = await fetch("/api/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Initial push failed: ${res.status}`);

      done += batch.length;
      onProgress?.(done, total);
    }

    const now = new Date().toISOString();
    await updateSyncMeta({ lastSyncAt: now, lastPushAt: now });
    this.lastSyncAt = now;
    this.setStatus("synced");
  }
}

// Singleton
let engine: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  if (!engine) engine = new SyncEngine();
  return engine;
}
