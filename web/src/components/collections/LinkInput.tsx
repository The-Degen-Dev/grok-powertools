"use client";

import { useState } from "react";
import { Plus, Clipboard, Sparkles } from "lucide-react";

interface LinkInputProps {
  onAddLinks: (text: string) => void;
  onLoadExamples: () => void;
  isLoading?: boolean;
}

export default function LinkInput({
  onAddLinks,
  onLoadExamples,
  isLoading = false,
}: LinkInputProps) {
  const [text, setText] = useState("");

  function handleAdd() {
    if (!text.trim()) return;
    onAddLinks(text);
    setText("");
  }

  async function handlePaste() {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText.trim()) {
        onAddLinks(clipboardText);
      }
    } catch {
      // Clipboard API may not be available
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste Grok Imagine links (one per line). Non-link text and duplicates are ignored."
        className="w-full resize-none rounded-md border border-neutral-200 bg-neutral-50 p-3 font-mono text-sm text-neutral-700 placeholder:text-neutral-400 focus:border-orange-300 focus:outline-none focus:ring-1 focus:ring-orange-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:placeholder:text-neutral-500"
        rows={3}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={handleAdd}
          disabled={!text.trim() || isLoading}
          className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          <Plus className="h-4 w-4" />
          Add videos
        </button>
        <button
          type="button"
          onClick={handlePaste}
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <Clipboard className="h-4 w-4" />
          Paste
        </button>
        <button
          type="button"
          onClick={onLoadExamples}
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          <Sparkles className="h-4 w-4" />
          Load Examples
        </button>
      </div>
    </div>
  );
}
