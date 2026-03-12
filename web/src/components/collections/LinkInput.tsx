"use client";

import { useState } from "react";
import { Plus, Clipboard, Sparkles, Download } from "lucide-react";
import { parseGihShareLink } from "@/lib/grok-api";
import Button from "@/components/ui/Button";

interface LinkInputProps {
  onAddLinks: (text: string) => void;
  onImportGih?: (shareId: string) => void;
  onLoadExamples: () => void;
  isLoading?: boolean;
  importProgress?: { loaded: number; total: number } | null;
}

export default function LinkInput({
  onAddLinks,
  onImportGih,
  onLoadExamples,
  isLoading = false,
  importProgress,
}: LinkInputProps) {
  const [text, setText] = useState("");

  // Check if input is a GIH share link
  const gihShareId = parseGihShareLink(text);

  function handleAdd() {
    if (!text.trim()) return;
    if (gihShareId && onImportGih) {
      onImportGih(gihShareId);
      setText("");
      return;
    }
    onAddLinks(text);
    setText("");
  }

  async function handlePaste() {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) return;
      const shareId = parseGihShareLink(clipboardText);
      if (shareId && onImportGih) {
        onImportGih(shareId);
      } else {
        onAddLinks(clipboardText);
      }
    } catch {
      // Clipboard API may not be available
    }
  }

  return (
    <div className="rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleAdd())}
        placeholder="Paste Grok Imagine links, or a GrokImagineHub share link (grokimaginehub.com/s/...)"
        className="w-full resize-none rounded-(--radius-input) border border-(--color-surface-200) bg-(--color-surface-50) p-3 font-mono text-sm text-(--color-surface-700) placeholder:text-(--color-surface-400) focus:border-(--color-accent) focus:outline-none dark:border-(--color-surface-700) dark:bg-(--color-surface-800) dark:text-(--color-surface-200)"
        rows={3}
      />

      {/* GIH detection banner */}
      {gihShareId && (
        <div className="mt-2 flex items-center gap-2 rounded-(--radius-btn) bg-(--color-accent)/10 px-3 py-2 text-sm text-(--color-accent)">
          <Download className="h-4 w-4 flex-shrink-0" />
          GrokImagineHub collection detected — click Import to fetch all videos + prompts
        </div>
      )}

      {/* Import progress */}
      {importProgress && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-xs text-(--color-surface-500)">
            <span>Importing prompts...</span>
            <span>{importProgress.loaded} / {importProgress.total}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-(--color-surface-200) dark:bg-(--color-surface-700)">
            <div
              className="h-full rounded-full bg-(--color-accent) transition-all duration-300"
              style={{ width: `${(importProgress.loaded / importProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <Button
          variant={gihShareId ? "primary" : "secondary"}
          onClick={handleAdd}
          disabled={!text.trim() || isLoading}
        >
          {gihShareId ? (
            <>
              <Download className="h-4 w-4" />
              Import Collection
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Add videos
            </>
          )}
        </Button>
        <Button variant="ghost" onClick={handlePaste} disabled={isLoading}>
          <Clipboard className="h-4 w-4" />
          Paste
        </Button>
        <Button variant="ghost" onClick={onLoadExamples}>
          <Sparkles className="h-4 w-4" />
          Load Examples
        </Button>
      </div>
    </div>
  );
}
