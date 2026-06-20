"use client";

import { useState, useEffect, useCallback } from "react";
import { Save, FolderPlus, Presentation, Share2, Check } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Collection, VideoItem } from "@/lib/types";
import {
  getAllCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  addItemsToCollection,
  removeItemFromCollection,
  reorderItems,
} from "@/lib/local-storage";
import { parseGrokLinks, batchFetchMetadata } from "@/lib/grok-api";
import CollectionSidebar from "./CollectionSidebar";
import LinkInput from "./LinkInput";
import VideoCard from "@/components/video/VideoCard";
import FullscreenViewer from "@/components/video/FullscreenViewer";
import { generateShareUrl } from "@/lib/share";

// Example video items for demo (pre-loaded, no API needed)
// Uses small same-origin demo videos so canvas/movie flows work locally.
const EXAMPLE_ITEMS: VideoItem[] = [
  {
    id: "demo-id-1",
    grokPostId: "demo-1",
    sourceUrl: "https://grok.com/imagine",
    videoUrl: "/demo-videos/grok-demo-1.mp4",
    thumbnailUrl: "",
    promptText: "Calm organic movement subject, still is still and pulls out slowly. Otters slightly drifting, mostly calm.",
    position: 0,
    notes: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: "demo-id-2",
    grokPostId: "demo-2",
    sourceUrl: "https://grok.com/imagine",
    videoUrl: "/demo-videos/grok-demo-2.mp4",
    thumbnailUrl: "",
    promptText: "A cyberpunk city at night with neon reflections in rain puddles, cinematic camera movement through streets.",
    position: 1,
    notes: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: "demo-id-3",
    grokPostId: "demo-3",
    sourceUrl: "https://grok.com/imagine",
    videoUrl: "/demo-videos/grok-demo-3.mp4",
    thumbnailUrl: "",
    promptText: "Ancient forest with bioluminescent mushrooms, gentle fog rolling through massive tree trunks, fairy lights.",
    position: 2,
    notes: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: "demo-id-4",
    grokPostId: "demo-4",
    sourceUrl: "https://grok.com/imagine",
    videoUrl: "/demo-videos/grok-demo-4.mp4",
    thumbnailUrl: "",
    promptText: "Aerial shot of a volcanic island erupting with flowing lava meeting the ocean, dramatic steam clouds.",
    position: 3,
    notes: "",
    createdAt: new Date().toISOString(),
  },
  {
    id: "demo-id-5",
    grokPostId: "demo-5",
    sourceUrl: "https://grok.com/imagine",
    videoUrl: "/demo-videos/grok-demo-5.mp4",
    thumbnailUrl: "",
    promptText: "A majestic whale breaching in slow motion, sunset golden hour lighting, water droplets sparkling.",
    position: 4,
    notes: "",
    createdAt: new Date().toISOString(),
  },
];

function toNewCollectionItemInput({
  grokPostId,
  sourceUrl,
  videoUrl,
  thumbnailUrl,
  promptText,
  notes,
}: VideoItem): Omit<VideoItem, "id" | "position" | "createdAt"> {
  return { grokPostId, sourceUrl, videoUrl, thumbnailUrl, promptText, notes };
}

// Sortable wrapper for VideoCard
function SortableVideoCard({
  item,
  onDelete,
  onExpand,
}: {
  item: VideoItem;
  onDelete: (id: string) => void;
  onExpand?: (item: VideoItem) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <VideoCard
        item={item}
        onDelete={onDelete}
        onExpand={onExpand}
        dragHandleProps={listeners}
      />
    </div>
  );
}

export default function Workspace() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [unsavedItems, setUnsavedItems] = useState<VideoItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [collectionName, setCollectionName] = useState("Unsaved Collection");
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  const activeCollection = collections.find((c) => c.id === activeCollectionId);
  const displayItems = activeCollection?.items ?? unsavedItems;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Load collections from IndexedDB on mount
  useEffect(() => {
    getAllCollections().then(setCollections);
  }, []);

  // Handle drag end — reorder items
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = displayItems.findIndex((i) => i.id === active.id);
      const newIndex = displayItems.findIndex((i) => i.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      // Create reordered array
      const reordered = [...displayItems];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);
      const withPositions = reordered.map((item, i) => ({ ...item, position: i }));

      if (activeCollection) {
        // Persist to IndexedDB
        const updated = await reorderItems(
          activeCollection.id,
          withPositions.map((i) => i.id)
        );
        if (updated) {
          setCollections((prev) =>
            prev.map((c) => (c.id === updated.id ? updated : c))
          );
        }
      } else {
        setUnsavedItems(withPositions);
      }
    },
    [displayItems, activeCollection]
  );

  // Add videos from pasted links
  const handleAddLinks = useCallback(
    async (text: string) => {
      const postIds = parseGrokLinks(text);
      if (postIds.length === 0) return;

      setIsLoading(true);

      const existingIds = new Set(displayItems.map((i) => i.grokPostId));
      const newIds = postIds.filter((id) => !existingIds.has(id));

      if (newIds.length === 0) {
        setIsLoading(false);
        return;
      }

      const metadata = await batchFetchMetadata(newIds);

      const newItems: VideoItem[] = newIds.map((id, index) => {
        const meta = metadata.get(id) || {};
        return {
          id: crypto.randomUUID(),
          grokPostId: id,
          sourceUrl: meta.sourceUrl || `https://x.com/i/grok/share/${id}`,
          videoUrl: meta.videoUrl || "",
          thumbnailUrl: meta.thumbnailUrl || "",
          promptText: meta.promptText || "",
          position: displayItems.length + index,
          notes: "",
          createdAt: new Date().toISOString(),
        };
      });

      if (activeCollection) {
        const updated = await addItemsToCollection(
          activeCollection.id,
          newItems.map(toNewCollectionItemInput)
        );
        if (updated) {
          setCollections((prev) =>
            prev.map((c) => (c.id === updated.id ? updated : c))
          );
        }
      } else {
        setUnsavedItems((prev) => [...prev, ...newItems]);
      }

      setIsLoading(false);
    },
    [displayItems, activeCollection]
  );

  // Load example videos
  const handleLoadExamples = useCallback(() => {
    const existingIds = new Set(displayItems.map((i) => i.grokPostId));
    const newExamples = EXAMPLE_ITEMS
      .filter((item) => !existingIds.has(item.grokPostId))
      .map((item, index) => ({
        ...item,
        id: crypto.randomUUID(),
        position: displayItems.length + index,
      }));

    if (newExamples.length === 0) return;

    if (activeCollection) {
      addItemsToCollection(
        activeCollection.id,
        newExamples.map(toNewCollectionItemInput)
      ).then((updated) => {
        if (updated) {
          setCollections((prev) =>
            prev.map((c) => (c.id === updated.id ? updated : c))
          );
        }
      });
    } else {
      setUnsavedItems((prev) => [...prev, ...newExamples]);
    }
  }, [displayItems, activeCollection]);

  // Delete a video item
  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      if (activeCollection) {
        const updated = await removeItemFromCollection(
          activeCollection.id,
          itemId
        );
        if (updated) {
          setCollections((prev) =>
            prev.map((c) => (c.id === updated.id ? updated : c))
          );
        }
      } else {
        setUnsavedItems((prev) => prev.filter((i) => i.id !== itemId));
      }
    },
    [activeCollection]
  );

  // Save current workspace as a new collection
  const handleSaveCollection = useCallback(async () => {
    if (activeCollection) {
      const updated = await updateCollection({
        ...activeCollection,
        name: collectionName,
      });
      setCollections((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
    } else if (unsavedItems.length > 0) {
      const newCol = await createCollection(collectionName, unsavedItems);
      setCollections((prev) => [newCol, ...prev]);
      setActiveCollectionId(newCol.id);
      setUnsavedItems([]);
    }
  }, [activeCollection, collectionName, unsavedItems]);

  // Create a new empty workspace
  const handleNewWorkspace = useCallback(() => {
    setActiveCollectionId(null);
    setUnsavedItems([]);
    setCollectionName("Unsaved Collection");
  }, []);

  // Select a saved collection
  const handleSelectCollection = useCallback((id: string) => {
    setActiveCollectionId(id);
    getAllCollections().then((cols) => {
      const col = cols.find((c) => c.id === id);
      if (col) setCollectionName(col.name);
    });
  }, []);

  // Delete a saved collection
  const handleDeleteCollection = useCallback(
    async (id: string) => {
      await deleteCollection(id);
      setCollections((prev) => prev.filter((c) => c.id !== id));
      if (activeCollectionId === id) {
        setActiveCollectionId(null);
        setCollectionName("Unsaved Collection");
      }
    },
    [activeCollectionId]
  );

  const isSaved = !!activeCollection;
  const itemCount = displayItems.length;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Sidebar */}
      <CollectionSidebar
        collections={collections}
        activeId={activeCollectionId}
        onSelect={handleSelectCollection}
        onNew={handleNewWorkspace}
        onDelete={handleDeleteCollection}
      />

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Collection header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
              className="bg-transparent text-lg font-semibold text-neutral-900 focus:outline-none dark:text-neutral-100"
            />
            <span className="text-sm text-neutral-400">
              {itemCount} video{itemCount !== 1 ? "s" : ""}
            </span>
            {!isSaved && itemCount > 0 && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-600 dark:bg-orange-950 dark:text-orange-400">
                Unsaved
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const col: import("@/lib/types").Collection = {
                  id: activeCollection?.id ?? "temp",
                  name: collectionName,
                  description: "",
                  status: "active",
                  aspectRatioOverride: null,
                  items: displayItems,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                };
                const url = generateShareUrl(col);
                navigator.clipboard.writeText(url);
                setShareCopied(true);
                setTimeout(() => setShareCopied(false), 2000);
              }}
              disabled={itemCount === 0}
              className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              {shareCopied ? <Check className="h-4 w-4 text-green-500" /> : <Share2 className="h-4 w-4" />}
              {shareCopied ? "Copied!" : "Share"}
            </button>
            <button
              type="button"
              onClick={handleNewWorkspace}
              className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <FolderPlus className="h-4 w-4" />
              New Collection
            </button>
            <button
              type="button"
              onClick={handleSaveCollection}
              disabled={itemCount === 0}
              className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              <Save className="h-4 w-4" />
              Save Collection
            </button>
          </div>
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Link input */}
          <LinkInput
            onAddLinks={handleAddLinks}
            onLoadExamples={handleLoadExamples}
            isLoading={isLoading}
          />

          {/* Slideshow button */}
          {itemCount > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setViewerIndex(0)}
                className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                <Presentation className="h-4 w-4" />
                Slideshow
              </button>
            </div>
          )}

          {/* Video grid with drag-and-drop */}
          {itemCount > 0 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={displayItems.map((i) => i.id)}
                strategy={rectSortingStrategy}
              >
                <div className="mt-6 flex flex-wrap gap-4">
                  {displayItems.map((item, index) => (
                    <SortableVideoCard
                      key={item.id}
                      item={item}
                      onDelete={handleDeleteItem}
                      onExpand={() => setViewerIndex(index)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="mt-16 flex flex-col items-center justify-center text-center">
              <div className="mb-4 rounded-xl border border-dashed border-neutral-300 p-4 dark:border-neutral-700">
                <FolderPlus className="h-8 w-8 text-neutral-300 dark:text-neutral-600" />
              </div>
              <h2 className="text-xl font-semibold text-neutral-700 dark:text-neutral-300">
                Start a collection
              </h2>
              <p className="mt-2 max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
                Paste <strong>public Grok Imagine links</strong> above (one per
                line), then click <strong>Add videos</strong>.
              </p>
              <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
                Tip: click <strong>Load Examples</strong> to see how it works.
              </p>
            </div>
          )}
        </div>
      </main>

      {/* Fullscreen viewer */}
      {viewerIndex !== null && (
        <FullscreenViewer
          items={displayItems}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </div>
  );
}
