"use client";

import { useState, useEffect } from "react";
import { X, FolderOpen, Link2, Type, Check, ChevronRight } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type { Collection, MovieClip, Transition, VideoItem } from "@/lib/types";
import { getAllCollections } from "@/lib/local-storage";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

interface ClipSourcePickerProps {
  onAddClips: (clips: MovieClip[]) => void;
  onClose: () => void;
}

const DEFAULT_TRANSITION: Transition = { type: "cut", duration: 0 };

type Tab = "collections" | "url" | "title";

export default function ClipSourcePicker({ onAddClips, onClose }: ClipSourcePickerProps) {
  const [tab, setTab] = useState<Tab>("collections");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Map<string, { videoUrl: string; collectionId: string }>>(new Map());

  // URL tab
  const [pasteUrl, setPasteUrl] = useState("");

  // Title tab
  const [titleText, setTitleText] = useState("");
  const [titleSubtext, setTitleSubtext] = useState("");
  const [titleDuration, setTitleDuration] = useState(3);

  useEffect(() => {
    getAllCollections().then(setCollections);
  }, []);

  function toggleItem(item: VideoItem, collectionId: string) {
    setSelectedItems((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.set(item.id, { videoUrl: item.videoUrl, collectionId });
      }
      return next;
    });
  }

  function addSelectedClips() {
    if (selectedItems.size === 0) return;
    const clips: MovieClip[] = Array.from(selectedItems.values()).map((item) => ({
      id: uuidv4(),
      type: "video" as const,
      videoUrl: item.videoUrl,
      sourceCollectionId: item.collectionId,
      transition: DEFAULT_TRANSITION,
      position: 0,
    }));
    onAddClips(clips);
    setSelectedItems(new Map());
  }

  function addTitleCard() {
    if (!titleText.trim()) return;
    const clip: MovieClip = {
      id: uuidv4(),
      type: "title",
      titleText: titleText.trim(),
      titleSubtext: titleSubtext.trim() || undefined,
      titleDuration,
      titleBgColor: "#000000",
      titleTextColor: "#ffffff",
      transition: DEFAULT_TRANSITION,
      position: 0,
    };
    onAddClips([clip]);
    setTitleText("");
    setTitleSubtext("");
  }

  function handlePasteUrl() {
    if (!pasteUrl.trim()) return;
    const clip: MovieClip = {
      id: uuidv4(),
      type: "video",
      videoUrl: pasteUrl.trim(),
      transition: DEFAULT_TRANSITION,
      position: 0,
    };
    onAddClips([clip]);
    setPasteUrl("");
  }

  const TABS: { id: Tab; icon: React.ElementType; label: string }[] = [
    { id: "collections", icon: FolderOpen, label: "Collections" },
    { id: "url", icon: Link2, label: "Paste URL" },
    { id: "title", icon: Type, label: "Title Card" },
  ];

  return (
    <Modal open={true} onClose={onClose} title="Add Clips" className="max-w-xl">
      {/* Tabs */}
      <div className="-mx-6 flex border-b border-(--color-surface-200) dark:border-(--color-surface-800)">
        {TABS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition ${
              tab === id
                ? "border-b-2 border-(--color-accent) text-(--color-accent)"
                : "text-(--color-surface-500) hover:text-(--color-surface-700) dark:hover:text-(--color-surface-300)"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="max-h-80 overflow-y-auto pt-4">
        {tab === "collections" && (
          <div className="space-y-2">
            {collections.length === 0 ? (
              <p className="py-4 text-center text-xs text-(--color-surface-500)">No collections saved yet.</p>
            ) : (
              collections.map((col) => (
                <div key={col.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === col.id ? null : col.id)}
                    className="flex w-full items-center gap-2 rounded-(--radius-btn) border border-(--color-surface-200) px-3 py-2 text-left text-xs transition hover:border-(--color-surface-400) dark:border-(--color-surface-700) dark:hover:border-(--color-surface-600)"
                  >
                    <ChevronRight className={`h-3 w-3 text-(--color-surface-400) transition-transform ${expandedId === col.id ? "rotate-90" : ""}`} />
                    <span className="font-medium text-(--color-surface-800) dark:text-(--color-surface-200)">{col.name}</span>
                    <span className="ml-auto text-(--color-surface-400)">{col.items.filter((i) => i.videoUrl).length} videos</span>
                  </button>
                  {expandedId === col.id && (
                    <div className="mt-1 ml-5 space-y-1">
                      {col.items.filter((item) => item.videoUrl).map((item) => {
                        const isSelected = selectedItems.has(item.id);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => toggleItem(item, col.id)}
                            className={`flex w-full items-center gap-2 rounded-(--radius-btn) px-3 py-2 text-left text-xs transition ${
                              isSelected
                                ? "bg-(--color-accent)/10 text-(--color-accent)"
                                : "bg-(--color-surface-50) text-(--color-surface-600) hover:bg-(--color-surface-100) dark:bg-(--color-surface-800) dark:text-(--color-surface-300) dark:hover:bg-(--color-surface-700)"
                            }`}
                          >
                            {/* Thumbnail */}
                            <div className="h-10 w-7 flex-shrink-0 overflow-hidden rounded bg-(--color-surface-200) dark:bg-(--color-surface-700)">
                              {item.thumbnailUrl ? (
                                <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <video src={item.videoUrl} className="h-full w-full object-cover" muted preload="metadata" />
                              )}
                            </div>
                            {/* Text */}
                            <span className="flex-1 truncate">
                              {item.promptText?.slice(0, 60) || item.videoUrl.slice(-30)}
                            </span>
                            {/* Checkbox */}
                            <div className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition ${
                              isSelected
                                ? "border-(--color-accent) bg-(--color-accent) text-white"
                                : "border-(--color-surface-300) dark:border-(--color-surface-600)"
                            }`}>
                              {isSelected && <Check className="h-3 w-3" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Add Selected button */}
            {selectedItems.size > 0 && (
              <div className="sticky bottom-0 border-t border-(--color-surface-200) bg-(--color-surface-0) pt-3 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
                <Button variant="primary" onClick={addSelectedClips} className="w-full">
                  Add {selectedItems.size} clip{selectedItems.size !== 1 ? "s" : ""}
                </Button>
              </div>
            )}
          </div>
        )}

        {tab === "url" && (
          <div className="space-y-3">
            <input
              type="url"
              value={pasteUrl}
              onChange={(e) => setPasteUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handlePasteUrl()}
              placeholder="Paste Grok video URL..."
              className="w-full rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm text-(--color-surface-800) outline-none focus:border-(--color-accent) dark:border-(--color-surface-700) dark:text-(--color-surface-200)"
            />
            <Button variant="primary" onClick={handlePasteUrl} disabled={!pasteUrl.trim()}>
              Add Video
            </Button>
          </div>
        )}

        {tab === "title" && (
          <div className="space-y-3">
            <input
              value={titleText}
              onChange={(e) => setTitleText(e.target.value)}
              placeholder="Title text..."
              className="w-full rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm text-(--color-surface-800) outline-none focus:border-(--color-accent) dark:border-(--color-surface-700) dark:text-(--color-surface-200)"
            />
            <input
              value={titleSubtext}
              onChange={(e) => setTitleSubtext(e.target.value)}
              placeholder="Subtitle (optional)..."
              className="w-full rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-3 py-2 text-sm text-(--color-surface-800) outline-none focus:border-(--color-accent) dark:border-(--color-surface-700) dark:text-(--color-surface-200)"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-(--color-surface-500)">Duration:</label>
              <input
                type="number"
                min={1}
                max={30}
                value={titleDuration}
                onChange={(e) => setTitleDuration(Number(e.target.value))}
                className="w-16 rounded-(--radius-input) border border-(--color-surface-200) bg-transparent px-2 py-1 text-xs text-(--color-surface-800) dark:border-(--color-surface-700) dark:text-(--color-surface-200)"
              />
              <span className="text-xs text-(--color-surface-500)">seconds</span>
            </div>
            <Button variant="primary" onClick={addTitleCard} disabled={!titleText.trim()}>
              Add Title Card
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
