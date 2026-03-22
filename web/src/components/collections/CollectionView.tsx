"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Save, FolderPlus, Presentation, Share2, Check, ClipboardCopy, CheckSquare, X } from "lucide-react";
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
  getCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  addItemsToCollection,
  removeItemFromCollection,
  reorderItems,
} from "@/lib/local-storage";
import { parseGrokLinks, batchFetchMetadata, importFromGih } from "@/lib/grok-api";
import CollectionSidebar from "./CollectionSidebar";
import LinkInput from "./LinkInput";
import VideoCard from "@/components/video/VideoCard";
import FullscreenViewer from "@/components/video/FullscreenViewer";
import SlideOverEditor from "@/components/editor/SlideOverEditor";
import AddToMoviePopover from "@/components/video/AddToMoviePopover";
import { generateShareUrl } from "@/lib/share";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import BulkActionBar from "./BulkActionBar";

const EXAMPLE_ITEMS: Omit<VideoItem, "id" | "position" | "createdAt">[] = [
  {
    grokPostId: "demo-1",
    sourceUrl: "https://grok.com/imagine",
    videoUrl: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
    thumbnailUrl: "",
    promptText: "Calm organic movement subject, still is still and pulls out slowly. Otters slightly drifting, mostly calm.",
    notes: "",
  },
  {
    grokPostId: "demo-2",
    sourceUrl: "https://grok.com/imagine",
    videoUrl: "https://test-videos.co.uk/vids/jellyfish/mp4/h264/360/Jellyfish_360_10s_1MB.mp4",
    thumbnailUrl: "",
    promptText: "A cyberpunk city at night with neon reflections in rain puddles, cinematic camera movement through streets.",
    notes: "",
  },
  {
    grokPostId: "demo-3",
    sourceUrl: "https://grok.com/imagine",
    videoUrl: "https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4",
    thumbnailUrl: "",
    promptText: "Ancient forest with bioluminescent mushrooms, gentle fog rolling through massive tree trunks, fairy lights.",
    notes: "",
  },
  {
    grokPostId: "demo-4",
    sourceUrl: "https://grok.com/imagine",
    videoUrl: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_2MB.mp4",
    thumbnailUrl: "",
    promptText: "Aerial shot of a volcanic island erupting with flowing lava meeting the ocean, dramatic steam clouds.",
    notes: "",
  },
  {
    grokPostId: "demo-5",
    sourceUrl: "https://grok.com/imagine",
    videoUrl: "https://test-videos.co.uk/vids/jellyfish/mp4/h264/360/Jellyfish_360_10s_2MB.mp4",
    thumbnailUrl: "",
    promptText: "A majestic whale breaching in slow motion, sunset golden hour lighting, water droplets sparkling.",
    notes: "",
  },
];

function SortableVideoCard({
  item,
  onDelete,
  onExpand,
  onEdit,
  onAddToMovie,
  onSavePrompt,
  isMultiSelectMode,
  isSelected,
  onSelect,
}: {
  item: VideoItem;
  onDelete: (id: string) => void;
  onExpand?: (item: VideoItem) => void;
  onEdit?: (item: VideoItem) => void;
  onAddToMovie?: (item: VideoItem) => void;
  onSavePrompt?: (item: VideoItem) => void;
  isMultiSelectMode?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
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
    <div ref={setNodeRef} style={style} className="w-48" {...attributes}>
      <VideoCard
        item={item}
        onDelete={onDelete}
        onExpand={onExpand}
        onEdit={onEdit}
        onAddToMovie={onAddToMovie}
        onSavePrompt={onSavePrompt}
        dragHandleProps={listeners}
        isMultiSelectMode={isMultiSelectMode}
        isSelected={isSelected}
        onSelect={onSelect}
      />
    </div>
  );
}

interface CollectionViewProps {
  collectionId?: string;
}

export default function CollectionView({ collectionId }: CollectionViewProps) {
  const router = useRouter();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(collectionId ?? null);
  const [unsavedItems, setUnsavedItems] = useState<VideoItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [collectionName, setCollectionName] = useState("Unsaved Collection");
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [editingItem, setEditingItem] = useState<VideoItem | null>(null);
  const [addToMovieItem, setAddToMovieItem] = useState<VideoItem | null>(null);
  const [importProgress, setImportProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const activeCollection = collections.find((c) => c.id === activeCollectionId);
  const displayItems = activeCollection?.items ?? unsavedItems;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    getAllCollections().then((cols) => {
      setCollections(cols);
      if (collectionId) {
        const col = cols.find((c) => c.id === collectionId);
        if (col) {
          setCollectionName(col.name);
          setActiveCollectionId(col.id);
        }
      }
      setInitialLoaded(true);
    });
  }, [collectionId]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = displayItems.findIndex((i) => i.id === active.id);
      const newIndex = displayItems.findIndex((i) => i.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...displayItems];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);
      const withPositions = reordered.map((item, i) => ({ ...item, position: i }));

      if (activeCollection) {
        const updated = await reorderItems(activeCollection.id, withPositions.map((i) => i.id));
        if (updated) {
          setCollections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        }
      } else {
        setUnsavedItems(withPositions);
      }
    },
    [displayItems, activeCollection]
  );

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
          newItems.map(({ id: _id, position: _pos, createdAt: _ca, ...rest }) => rest)
        );
        if (updated) {
          setCollections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        }
      } else {
        setUnsavedItems((prev) => [...prev, ...newItems]);
      }
      setIsLoading(false);
    },
    [displayItems, activeCollection]
  );

  const handleLoadExamples = useCallback(() => {
    const existingIds = new Set(displayItems.map((i) => i.grokPostId));
    const newExamples = EXAMPLE_ITEMS
      .filter((item) => !existingIds.has(item.grokPostId))
      .map((item, index) => ({
        ...item,
        id: crypto.randomUUID(),
        position: displayItems.length + index,
        createdAt: new Date().toISOString(),
      }));

    if (newExamples.length === 0) return;

    if (activeCollection) {
      addItemsToCollection(
        activeCollection.id,
        newExamples.map(({ id: _id, position: _pos, createdAt: _ca, ...rest }) => rest)
      ).then((updated) => {
        if (updated) {
          setCollections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        }
      });
    } else {
      setUnsavedItems((prev) => [...prev, ...newExamples]);
    }
  }, [displayItems, activeCollection]);

  const handleGihImport = useCallback(
    async (shareId: string) => {
      setIsLoading(true);
      setImportProgress({ loaded: 0, total: 1 });
      try {
        const { name, items } = await importFromGih(shareId, (loaded, total) => {
          setImportProgress({ loaded, total });
        });
        const newCol = await createCollection(
          name,
          items.map((item, index) => ({
            ...item,
            id: crypto.randomUUID(),
            position: index,
            createdAt: new Date().toISOString(),
          }))
        );
        setCollections((prev) => [newCol, ...prev]);
        setActiveCollectionId(newCol.id);
        setCollectionName(newCol.name);
        setUnsavedItems([]);
        router.push(`/collections/${newCol.id}`);
      } catch (err) {
        console.error("GIH import failed:", err);
      } finally {
        setIsLoading(false);
        setImportProgress(null);
      }
    },
    [router]
  );

  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      if (activeCollection) {
        const updated = await removeItemFromCollection(activeCollection.id, itemId);
        if (updated) {
          setCollections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        }
      } else {
        setUnsavedItems((prev) => prev.filter((i) => i.id !== itemId));
      }
    },
    [activeCollection]
  );

  const handleSaveCollection = useCallback(async () => {
    if (activeCollection) {
      const updated = await updateCollection({ ...activeCollection, name: collectionName });
      setCollections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } else if (unsavedItems.length > 0) {
      const newCol = await createCollection(collectionName, unsavedItems);
      setCollections((prev) => [newCol, ...prev]);
      setActiveCollectionId(newCol.id);
      setUnsavedItems([]);
      router.push(`/collections/${newCol.id}`);
    }
  }, [activeCollection, collectionName, unsavedItems, router]);

  const handleNewWorkspace = useCallback(() => {
    setActiveCollectionId(null);
    setUnsavedItems([]);
    setCollectionName("Unsaved Collection");
    router.push("/");
  }, [router]);

  const handleSelectCollection = useCallback((id: string) => {
    setActiveCollectionId(id);
    getAllCollections().then((cols) => {
      const col = cols.find((c) => c.id === id);
      if (col) setCollectionName(col.name);
    });
    router.push(`/collections/${id}`);
  }, [router]);

  const handleDeleteCollection = useCallback(
    async (id: string) => {
      await deleteCollection(id);
      setCollections((prev) => prev.filter((c) => c.id !== id));
      if (activeCollectionId === id) {
        setActiveCollectionId(null);
        setCollectionName("Unsaved Collection");
        router.push("/");
      }
    },
    [activeCollectionId, router]
  );

  const handleCopyAllLinks = useCallback(() => {
    const links = displayItems.map((i) => i.sourceUrl).join("\n");
    navigator.clipboard.writeText(links);
    toast(`Copied ${displayItems.length} link${displayItems.length !== 1 ? "s" : ""}`, "success");
  }, [displayItems, toast]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleMultiSelect = useCallback(() => {
    setIsMultiSelectMode((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  const handleBulkDelete = useCallback(async () => {
    for (const id of selectedIds) {
      await handleDeleteItem(id);
    }
    setSelectedIds(new Set());
    setIsMultiSelectMode(false);
    toast(`Deleted ${selectedIds.size} item${selectedIds.size !== 1 ? "s" : ""}`, "success");
  }, [selectedIds, handleDeleteItem, toast]);

  const handleBulkCopyLinks = useCallback(() => {
    const selected = displayItems.filter((i) => selectedIds.has(i.id));
    const links = selected.map((i) => i.sourceUrl).join("\n");
    navigator.clipboard.writeText(links);
    toast(`Copied ${selected.length} link${selected.length !== 1 ? "s" : ""}`, "success");
  }, [displayItems, selectedIds, toast]);

  const handleBulkDownload = useCallback(() => {
    const selected = displayItems.filter((i) => selectedIds.has(i.id) && i.videoUrl);
    selected.forEach((item) => {
      const a = document.createElement("a");
      a.href = item.videoUrl;
      a.download = `${item.grokPostId}.mp4`;
      a.click();
    });
    toast(`Downloading ${selected.length} video${selected.length !== 1 ? "s" : ""}`, "success");
  }, [displayItems, selectedIds, toast]);

  if (!initialLoaded) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const isSaved = !!activeCollection;
  const itemCount = displayItems.length;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      <CollectionSidebar
        collections={collections}
        activeId={activeCollectionId}
        onSelect={handleSelectCollection}
        onNew={handleNewWorkspace}
        onDelete={handleDeleteCollection}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Collection header */}
        <div className="flex items-center justify-between border-b border-(--color-surface-200) px-6 py-3 dark:border-(--color-surface-800)">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
              className="bg-transparent font-[family-name:var(--font-display)] text-lg font-semibold text-(--color-surface-900) focus:outline-none dark:text-(--color-surface-100)"
            />
            <span className="text-sm text-(--color-surface-400)">
              {itemCount} video{itemCount !== 1 ? "s" : ""}
            </span>
            {!isSaved && itemCount > 0 && (
              <span className="rounded-full bg-(--color-accent)/10 px-2 py-0.5 text-xs font-medium text-(--color-accent)">
                Unsaved
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={handleCopyAllLinks}
              disabled={itemCount === 0}
            >
              <ClipboardCopy className="h-4 w-4" />
              Copy Links
            </Button>
            <Button
              variant={isMultiSelectMode ? "primary" : "secondary"}
              onClick={handleToggleMultiSelect}
              disabled={itemCount === 0}
            >
              {isMultiSelectMode ? <X className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
              {isMultiSelectMode ? "Cancel" : "Select"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const col: Collection = {
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
            >
              {shareCopied ? <Check className="h-4 w-4 text-green-500" /> : <Share2 className="h-4 w-4" />}
              {shareCopied ? "Copied!" : "Share"}
            </Button>
            <Button variant="secondary" onClick={handleNewWorkspace}>
              <FolderPlus className="h-4 w-4" />
              New
            </Button>
            <Button variant="primary" onClick={handleSaveCollection} disabled={itemCount === 0}>
              <Save className="h-4 w-4" />
              Save
            </Button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6">
          <LinkInput
            onAddLinks={handleAddLinks}
            onImportGih={handleGihImport}
            onLoadExamples={handleLoadExamples}
            isLoading={isLoading}
            importProgress={importProgress}
          />

          {itemCount > 0 && (
            <div className="mt-3">
              <Button variant="ghost" onClick={() => setViewerIndex(0)}>
                <Presentation className="h-4 w-4" />
                Slideshow
              </Button>
            </div>
          )}

          {itemCount > 0 ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={displayItems.map((i) => i.id)} strategy={rectSortingStrategy}>
                <div className="mt-6 flex flex-wrap gap-4">
                  {displayItems.map((item, index) => (
                    <SortableVideoCard
                      key={item.id}
                      item={item}
                      onDelete={handleDeleteItem}
                      onExpand={() => setViewerIndex(index)}
                      onEdit={setEditingItem}
                      onAddToMovie={setAddToMovieItem}
                      isMultiSelectMode={isMultiSelectMode}
                      isSelected={selectedIds.has(item.id)}
                      onSelect={handleToggleSelect}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <EmptyState
              icon={FolderPlus}
              title="Start a collection"
              description="Paste public Grok Imagine links above (one per line), then click Add videos."
              action={
                <Button variant="secondary" onClick={handleLoadExamples}>
                  Load Examples
                </Button>
              }
            />
          )}
        </div>
      </main>

      {viewerIndex !== null && (
        <FullscreenViewer
          items={displayItems}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}

      {editingItem && editingItem.videoUrl && (
        <SlideOverEditor
          open={!!editingItem}
          onClose={() => setEditingItem(null)}
          videoUrl={editingItem.videoUrl}
        />
      )}

      {addToMovieItem && (
        <AddToMoviePopover
          open={!!addToMovieItem}
          onClose={() => setAddToMovieItem(null)}
          item={addToMovieItem}
        />
      )}

      {isMultiSelectMode && selectedIds.size > 0 && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onDelete={handleBulkDelete}
          onDownload={handleBulkDownload}
          onCopyLinks={handleBulkCopyLinks}
          onDeselectAll={() => setSelectedIds(new Set())}
        />
      )}
    </div>
  );
}
