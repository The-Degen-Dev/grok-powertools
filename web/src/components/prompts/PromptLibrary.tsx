"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Copy, Trash2, BookmarkPlus } from "lucide-react";
import SlideOver from "@/components/ui/SlideOver";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  getSavedPrompts,
  addPrompt,
  deletePrompt,
  searchPrompts,
} from "@/lib/local-storage";
import type { SavedPrompt } from "@/lib/types";

interface PromptLibraryProps {
  open: boolean;
  onClose: () => void;
}

export default function PromptLibrary({ open, onClose }: PromptLibraryProps) {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [query, setQuery] = useState("");
  const [newPromptText, setNewPromptText] = useState("");
  const { toast } = useToast();

  const loadPrompts = useCallback(async () => {
    try {
      const results = query ? await searchPrompts(query) : await getSavedPrompts();
      setPrompts(results);
    } catch (err) {
      console.error("[PromptLibrary] failed to load:", err);
      toast("Failed to load prompts", "error");
    }
  }, [query, toast]);

  useEffect(() => {
    if (open) loadPrompts();
  }, [open, loadPrompts]);

  async function handleAdd() {
    const text = newPromptText.trim();
    if (!text) return;
    await addPrompt(text);
    setNewPromptText("");
    loadPrompts();
    toast("Prompt saved", "success");
  }

  async function handleDelete(id: string) {
    await deletePrompt(id);
    loadPrompts();
    toast("Prompt deleted", "success");
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    toast("Prompt copied", "success");
  }

  return (
    <SlideOver open={open} onClose={onClose} title="Prompt Library" width="max-w-lg">
      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-surface-400)" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search prompts..."
          className="w-full rounded-(--radius-btn) border border-(--color-surface-200) bg-(--color-surface-0) py-2 pl-9 pr-3 text-sm text-(--color-surface-700) placeholder:text-(--color-surface-400) focus:border-(--color-accent) focus:outline-none dark:border-(--color-surface-700) dark:bg-(--color-surface-800) dark:text-(--color-surface-200)"
        />
      </div>

      {/* Add new prompt */}
      <div className="mb-6 flex gap-2">
        <textarea
          value={newPromptText}
          onChange={(e) => setNewPromptText(e.target.value)}
          placeholder="Add a new prompt..."
          rows={2}
          className="flex-1 rounded-(--radius-btn) border border-(--color-surface-200) bg-(--color-surface-0) px-3 py-2 text-sm text-(--color-surface-700) placeholder:text-(--color-surface-400) focus:border-(--color-accent) focus:outline-none dark:border-(--color-surface-700) dark:bg-(--color-surface-800) dark:text-(--color-surface-200)"
        />
        <Button variant="primary" size="sm" onClick={handleAdd} disabled={!newPromptText.trim()}>
          <BookmarkPlus className="h-3.5 w-3.5" />
          Save
        </Button>
      </div>

      {/* Prompt list */}
      <div className="space-y-2">
        {prompts.length === 0 ? (
          <p className="py-8 text-center text-sm text-(--color-surface-400)">
            {query ? "No prompts match your search" : "No saved prompts yet"}
          </p>
        ) : (
          prompts.map((prompt) => (
            <div
              key={prompt.id}
              className="group rounded-(--radius-card) border border-(--color-surface-200) p-3 transition-colors hover:bg-(--color-surface-50) dark:border-(--color-surface-700) dark:hover:bg-(--color-surface-800)"
            >
              <p className="text-sm leading-relaxed text-(--color-surface-700) dark:text-(--color-surface-300)">
                {prompt.text}
              </p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-(--color-surface-400)">
                  Used {prompt.usageCount} time{prompt.usageCount !== 1 ? "s" : ""}
                </span>
                <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => handleCopy(prompt.text)}
                    className="rounded-(--radius-btn) p-1 text-(--color-surface-400) hover:bg-(--color-surface-100) hover:text-(--color-surface-600) dark:hover:bg-(--color-surface-700)"
                    title="Copy"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(prompt.id)}
                    className="rounded-(--radius-btn) p-1 text-(--color-surface-400) hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </SlideOver>
  );
}
