import { openDB, type IDBPDatabase } from "idb";
import { v4 as uuidv4 } from "uuid";
import type { Collection, VideoItem, AppSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const DB_NAME = "grok-power-tools";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const collectionStore = db.createObjectStore("collections", {
          keyPath: "id",
        });
        collectionStore.createIndex("by-status", "status");
        collectionStore.createIndex("by-updated", "updatedAt");

        db.createObjectStore("settings");
      },
    });
  }
  return dbPromise;
}

// --- Collections ---

export async function getAllCollections(): Promise<Collection[]> {
  const db = await getDB();
  const collections: Collection[] = await db.getAll("collections");
  return collections.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function getCollection(id: string): Promise<Collection | undefined> {
  const db = await getDB();
  return db.get("collections", id) as Promise<Collection | undefined>;
}

export async function createCollection(
  name: string,
  items: VideoItem[] = []
): Promise<Collection> {
  const db = await getDB();
  const now = new Date().toISOString();
  const collection: Collection = {
    id: uuidv4(),
    name,
    description: "",
    status: "active",
    aspectRatioOverride: null,
    items,
    createdAt: now,
    updatedAt: now,
  };
  await db.put("collections", collection);
  return collection;
}

export async function updateCollection(
  collection: Collection
): Promise<Collection> {
  const db = await getDB();
  collection.updatedAt = new Date().toISOString();
  await db.put("collections", collection);
  return collection;
}

export async function deleteCollection(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("collections", id);
}

// --- Video Items ---

export async function addItemsToCollection(
  collectionId: string,
  newItems: Omit<VideoItem, "id" | "position" | "createdAt">[],
  addToTop: boolean = false
): Promise<Collection | undefined> {
  const db = await getDB();
  const collection = await getCollection(collectionId);
  if (!collection) return undefined;

  const startPosition = addToTop ? 0 : collection.items.length;

  const items: VideoItem[] = newItems.map((item, index) => ({
    ...item,
    id: uuidv4(),
    position: startPosition + index,
    createdAt: new Date().toISOString(),
  }));

  if (addToTop) {
    collection.items = collection.items.map((existing) => ({
      ...existing,
      position: existing.position + items.length,
    }));
    collection.items = [...items, ...collection.items];
  } else {
    collection.items = [...collection.items, ...items];
  }

  collection.updatedAt = new Date().toISOString();
  await db.put("collections", collection);
  return collection;
}

export async function removeItemFromCollection(
  collectionId: string,
  itemId: string
): Promise<Collection | undefined> {
  const db = await getDB();
  const collection = await getCollection(collectionId);
  if (!collection) return undefined;

  collection.items = collection.items
    .filter((item) => item.id !== itemId)
    .map((item, index) => ({ ...item, position: index }));

  collection.updatedAt = new Date().toISOString();
  await db.put("collections", collection);
  return collection;
}

export async function reorderItems(
  collectionId: string,
  itemIds: string[]
): Promise<Collection | undefined> {
  const db = await getDB();
  const collection = await getCollection(collectionId);
  if (!collection) return undefined;

  const itemMap = new Map(collection.items.map((item) => [item.id, item]));
  collection.items = itemIds
    .map((id, index) => {
      const item = itemMap.get(id);
      if (!item) return null;
      return { ...item, position: index };
    })
    .filter((item): item is VideoItem => item !== null);

  collection.updatedAt = new Date().toISOString();
  await db.put("collections", collection);
  return collection;
}

// --- Settings ---

export async function getSettings(): Promise<AppSettings> {
  const db = await getDB();
  const settings = await db.get("settings", "app-settings");
  if (!settings) {
    return { ...DEFAULT_SETTINGS };
  }
  return settings as AppSettings;
}

export async function updateSettings(
  partial: Partial<AppSettings>
): Promise<AppSettings> {
  const db = await getDB();
  const current = await getSettings();
  const updated = { ...current, ...partial };
  await db.put("settings", updated, "app-settings");
  return updated;
}
