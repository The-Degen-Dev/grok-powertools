"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import VaultLoadPanel from "./VaultLoadPanel";
import VaultGrid from "./VaultGrid";
import VaultMediaViewer from "./VaultMediaViewer";
import { createCollection, getAllCollections, getDB, updateCollection } from "@/lib/local-storage";
import { commitVaultPreview, getVaultAssets } from "@/lib/vault-storage";
import type { VaultAsset, VaultPreview } from "@/lib/vault-types";
import { fetchVaultPreview } from "@/lib/vault-client";
import { vaultAssetToVideoItem } from "@/lib/vault-view-models";

export default function VaultPage() {
  const [preview, setPreview] = useState<VaultPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<VaultAsset[]>([]);
  const [viewerAsset, setViewerAsset] = useState<VaultAsset | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    getDB().then(getVaultAssets).then(setAssets).catch(() => setAssets([]));
  }, []);

  async function handlePreview() {
    setLoading(true);
    try {
      setPreview(await fetchVaultPreview());
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!preview) return;
    const db = await getDB();
    await commitVaultPreview(db, preview);
    setAssets(await getVaultAssets(db));
  }

  async function handleAddToCollection(asset: VaultAsset) {
    const collections = await getAllCollections();
    const existing = collections.find((collection) => collection.name === "New Collection");
    if (existing?.items.some((item) => item.assetId === asset.assetId)) {
      toast("Already in New Collection", "info");
      return;
    }
    const item = {
      ...vaultAssetToVideoItem(asset, existing?.items.length || 0),
      id: crypto.randomUUID(),
    };
    if (existing) {
      await updateCollection({ ...existing, items: [...existing.items, item] });
    } else {
      await createCollection("New Collection", [item]);
    }
    toast("Added to New Collection", "success");
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8">
      <VaultLoadPanel onPreview={handlePreview} />
      {loading && <p className="mt-4 text-sm text-(--color-surface-500)">Loading Vault preview...</p>}
      {preview && (
        <section className="mt-6 rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
          <h2 className="text-sm font-semibold">Preview</h2>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-(--color-surface-500)">
              {preview.counts.assets} assets, {preview.counts.images} images, {preview.counts.videos} videos, {preview.counts.prompts} prompts.
            </p>
            <Button variant="primary" onClick={handleCommit}>
              Commit Vault
            </Button>
          </div>
        </section>
      )}
      <section className="mt-6">
        <VaultGrid assets={assets} onOpen={setViewerAsset} onAddToCollection={handleAddToCollection} />
      </section>
      <VaultMediaViewer asset={viewerAsset} onClose={() => setViewerAsset(null)} />
    </div>
  );
}
