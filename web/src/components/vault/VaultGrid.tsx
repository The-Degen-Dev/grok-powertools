"use client";

import type { VaultAsset } from "@/lib/vault-types";
import VaultMediaCard from "./VaultMediaCard";

export default function VaultGrid({
  assets,
  onOpen,
  onAddToCollection,
}: {
  assets: VaultAsset[];
  onOpen: (asset: VaultAsset) => void;
  onAddToCollection: (asset: VaultAsset) => void;
}) {
  if (assets.length === 0) {
    return <p className="py-10 text-center text-sm text-(--color-surface-500)">No Vault assets committed locally.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      {assets.map((asset) => (
        <VaultMediaCard key={asset.assetId} asset={asset} onOpen={onOpen} onAddToCollection={onAddToCollection} />
      ))}
    </div>
  );
}
