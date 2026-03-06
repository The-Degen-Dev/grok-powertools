"use client";

import { useState, useEffect } from "react";
import { X, FolderOpen, Link2, Type } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type { Collection, MovieClip, Transition } from "@/lib/types";
import { getAllCollections } from "@/lib/local-storage";

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

  // URL tab
  const [pasteUrl, setPasteUrl] = useState("");

  // Title tab
  const [titleText, setTitleText] = useState("");
  const [titleSubtext, setTitleSubtext] = useState("");
  const [titleDuration, setTitleDuration] = useState(3);

  useEffect(() => {
    getAllCollections().then(setCollections);
  }, []);

  function addVideoClip(videoUrl: string, collectionId?: string) {
    const clip: MovieClip = {
      id: uuidv4(),
      type: "video",
      videoUrl,
      sourceCollectionId: collectionId,
      transition: DEFAULT_TRANSITION,
      position: 0,
    };
    onAddClips([clip]);
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
    addVideoClip(pasteUrl.trim());
    setPasteUrl("");
  }

  const TABS: { id: Tab; icon: React.ElementType; label: string }[] = [
    { id: "collections", icon: FolderOpen, label: "Collections" },
    { id: "url", icon: Link2, label: "Paste URL" },
    { id: "title", icon: Type, label: "Title Card" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h3 className="text-sm font-medium text-neutral-200">Add Clip</h3>
          <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-neutral-800">
          {TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition ${
                tab === id
                  ? "border-b-2 border-orange-500 text-orange-400"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="max-h-80 overflow-y-auto p-4">
          {tab === "collections" && (
            <div className="space-y-2">
              {collections.length === 0 ? (
                <p className="py-4 text-center text-xs text-neutral-500">No collections saved yet.</p>
              ) : (
                collections.map((col) => (
                  <div key={col.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === col.id ? null : col.id)}
                      className="w-full rounded-lg border border-neutral-800 px-3 py-2 text-left text-xs transition hover:border-neutral-600"
                    >
                      <span className="font-medium text-neutral-200">{col.name}</span>
                      <span className="ml-2 text-neutral-500">{col.items.length} items</span>
                    </button>
                    {expandedId === col.id && (
                      <div className="mt-1 ml-2 space-y-1">
                        {col.items.filter((item) => item.videoUrl).map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => addVideoClip(item.videoUrl, col.id)}
                            className="w-full rounded bg-neutral-800 px-3 py-1.5 text-left text-xs text-neutral-300 transition hover:bg-neutral-700"
                          >
                            {item.promptText?.slice(0, 60) || item.videoUrl.slice(-30)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
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
                className="w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600"
              />
              <button
                type="button"
                onClick={handlePasteUrl}
                disabled={!pasteUrl.trim()}
                className="rounded-lg bg-orange-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-orange-500 disabled:opacity-40"
              >
                Add Video
              </button>
            </div>
          )}

          {tab === "title" && (
            <div className="space-y-3">
              <input
                value={titleText}
                onChange={(e) => setTitleText(e.target.value)}
                placeholder="Title text..."
                className="w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600"
              />
              <input
                value={titleSubtext}
                onChange={(e) => setTitleSubtext(e.target.value)}
                placeholder="Subtitle (optional)..."
                className="w-full rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600"
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-neutral-400">Duration:</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={titleDuration}
                  onChange={(e) => setTitleDuration(Number(e.target.value))}
                  className="w-16 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
                />
                <span className="text-xs text-neutral-500">seconds</span>
              </div>
              <button
                type="button"
                onClick={addTitleCard}
                disabled={!titleText.trim()}
                className="rounded-lg bg-orange-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-orange-500 disabled:opacity-40"
              >
                Add Title Card
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
