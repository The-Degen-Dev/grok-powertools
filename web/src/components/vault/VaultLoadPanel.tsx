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
    <section className="rounded-(--radius) border border-(--hairline) bg-(--surface-raised) p-[var(--space-3)] dark:bg-(--surface-panel)">
      <div className="flex flex-col gap-[var(--space-3)] sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-20)] font-semibold leading-[var(--leading-tight-ui)] text-(--color-surface-900) dark:text-(--color-surface-100)">
            Vault
          </h1>
          <p className="mt-1 max-w-2xl truncate text-[length:var(--text-13)] text-(--color-surface-500)">
            Load the backed-up Grok saved gallery from R2 into local owner mode. Preview is read-only.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-[var(--space-2)] text-[length:var(--text-12)] text-(--color-surface-500)">
            <Cloud className="h-3.5 w-3.5 text-(--color-accent)" />
            <span>{loading ? "Checking Worker..." : identityLabel}</span>
            {keyPrefix && <span>Prefix {keyPrefix}</span>}
          </div>
        </div>
        <Button size="sm" variant="primary" onClick={onPreview} disabled={loading || identity?.ok === false}>
          <RefreshCw className="h-3.5 w-3.5" />
          Preview Vault
        </Button>
      </div>
    </section>
  );
}
