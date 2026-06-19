"use client";

import { useEffect, useState } from "react";
import { getDB } from "@/lib/local-storage";
import { getVaultAssets } from "@/lib/vault-storage";

export default function VaultOpsSummary() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    getDB().then(getVaultAssets).then((assets) => setCount(assets.length)).catch(() => setCount(0));
  }, []);

  return (
    <section className="mt-6 rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
      <h2 className="text-sm font-semibold">Vault Import</h2>
      <p className="mt-2 text-sm text-(--color-surface-500)">{count} assets committed locally.</p>
      <p className="mt-2 text-xs text-(--color-surface-500)">Worker health is not object proof. Vault proof comes from inventory rows and media routes.</p>
    </section>
  );
}
