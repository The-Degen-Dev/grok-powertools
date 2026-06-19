"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { getDB } from "@/lib/local-storage";
import { getVaultGaps } from "@/lib/vault-storage";

export default function VaultGapPanel() {
  const [gapCount, setGapCount] = useState(0);

  useEffect(() => {
    getDB().then(getVaultGaps).then((gaps) => setGapCount(gaps.length)).catch(() => setGapCount(0));
  }, []);

  return (
    <section className="mt-6 rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-4 dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
      <h2 className="text-sm font-semibold">Gap Fill</h2>
      <p className="mt-2 text-sm text-(--color-surface-500)">{gapCount} gaps currently need review.</p>
      <Button variant="secondary" disabled className="mt-3">Gap Fill Requires Approval</Button>
    </section>
  );
}
