"use client";

import { useEffect, useState } from "react";
import { Cloud, RefreshCw } from "lucide-react";
import Button from "@/components/ui/Button";
import { fetchVaultIdentity } from "@/lib/vault-client";

export default function VaultLoadPanel({ onPreview }: { onPreview: () => void }) {
  const [identity, setIdentity] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const identityLabel = String(identity?.service || identity?.message || "Worker checked");
  const keyPrefix = typeof identity?.keyPrefix === "string" ? identity.keyPrefix : "";

  useEffect(() => {
    fetchVaultIdentity()
      .then(setIdentity)
      .catch((error) => {
        setIdentity({
          ok: false,
          message: error instanceof Error ? error.message : "Vault identity failed",
        });
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <section className="rounded-(--radius-card) border border-(--color-surface-200) bg-(--color-surface-0) p-5 shadow-(--shadow-card) dark:border-(--color-surface-800) dark:bg-(--color-surface-900)">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-(--color-surface-900) dark:text-(--color-surface-100)">
            Vault
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-(--color-surface-500)">
            Load the backed-up Grok saved gallery from R2 into local owner mode. Preview is read-only.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-(--color-surface-500)">
            <Cloud className="h-4 w-4 text-(--color-accent)" />
            <span>{loading ? "Checking Worker..." : identityLabel}</span>
            {keyPrefix && <span>Prefix {keyPrefix}</span>}
          </div>
        </div>
        <Button variant="primary" onClick={onPreview} disabled={loading || identity?.ok === false}>
          <RefreshCw className="h-4 w-4" />
          Preview Vault
        </Button>
      </div>
    </section>
  );
}
