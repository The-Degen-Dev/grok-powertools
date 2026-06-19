"use client";

import { useState } from "react";
import VaultLoadPanel from "./VaultLoadPanel";
import type { VaultPreview } from "@/lib/vault-types";
import { fetchVaultPreview } from "@/lib/vault-client";

export default function VaultPage() {
  const [preview, setPreview] = useState<VaultPreview | null>(null);
  const [loading, setLoading] = useState(false);

  async function handlePreview() {
    setLoading(true);
    try {
      setPreview(await fetchVaultPreview());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8">
      <VaultLoadPanel onPreview={handlePreview} />
      {loading && <p className="mt-4 text-sm text-(--color-surface-500)">Loading Vault preview...</p>}
      {preview && (
        <section className="mt-6 rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
          <h2 className="text-sm font-semibold">Preview</h2>
          <p className="mt-2 text-sm text-(--color-surface-500)">
            {preview.counts.assets} assets, {preview.counts.images} images, {preview.counts.videos} videos, {preview.counts.prompts} prompts.
          </p>
        </section>
      )}
    </div>
  );
}
