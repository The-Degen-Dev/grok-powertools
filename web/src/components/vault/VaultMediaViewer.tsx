"use client";

import { useEffect, useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import MediaDetailsForm from "@/components/ui/MediaDetailsForm";
import type { VaultAsset, VaultOverlay } from "@/lib/vault-types";
import { isVaultImageAsset } from "@/lib/vault-media";
import { vaultMediaUrl } from "@/lib/vault-media-url";
import { vaultAssetDisplayTitle } from "./VaultMediaCard";

type OverlayPatch = Partial<Pick<VaultOverlay, "favorite" | "hidden" | "notes" | "tags" | "title">>;

export default function VaultMediaViewer({
  asset,
  overlay,
  onOverlayChange,
  onClose,
}: {
  asset: VaultAsset | null;
  overlay?: VaultOverlay;
  onOverlayChange: (assetId: string, patch: OverlayPatch) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!asset) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, video[controls], [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [asset, onClose]);

  if (!asset) return null;
  const mediaUrl = vaultMediaUrl(asset);
  const isImage = isVaultImageAsset(asset);
  const title = vaultAssetDisplayTitle(asset, overlay);
  const tags = overlay?.tags || [];
  const objectKey = asset.canonicalObjectKey || asset.legacyObjectKeys[0] || "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 text-white backdrop-blur-sm sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="Vault media viewer"
        aria-modal="true"
        data-vault-media-viewer="lightbox"
        className="grid h-[min(92vh,920px)] w-[min(96vw,1440px)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-(--radius-overlay) border border-white/15 bg-(--color-surface-950) shadow-(--shadow-overlay) lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-none"
      >
        <div className="flex min-h-0 flex-col bg-black">
          <header className="flex items-center justify-between gap-[var(--space-3)] border-b border-white/10 px-[var(--space-3)] py-[var(--space-2)] sm:px-[var(--space-4)]">
            <div className="min-w-0">
              <p className="truncate text-[length:var(--text-14)] font-medium">{title}</p>
              <p className="mt-0.5 text-[length:var(--text-12)] capitalize text-white/55">
                {asset.mediaType} / {asset.verificationStatus}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-[var(--space-1)]">
              {asset.sourceUrl && (
                <a
                  href={asset.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open Grok source"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-(--radius) border border-white/10 bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              )}
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="rounded-(--radius) border border-white/10 bg-white/10 p-2 hover:bg-white/20"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 items-center justify-center p-[var(--space-2)] sm:p-[var(--space-3)]">
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- R2 media is served through local API proxy.
              <img src={mediaUrl} alt={title} className="max-h-full max-w-full rounded-(--radius-sm) object-contain shadow-(--shadow-overlay)" />
            ) : (
              <video src={mediaUrl} className="max-h-full max-w-full rounded-(--radius-sm) shadow-(--shadow-overlay)" controls autoPlay playsInline />
            )}
          </div>
        </div>

        <aside className="max-h-[36vh] min-h-0 overflow-y-auto border-t border-white/10 bg-(--color-surface-950) p-[var(--space-3)] sm:p-[var(--space-4)] lg:max-h-none lg:border-l lg:border-t-0">
          <div className="space-y-[var(--space-4)]">
            <MediaDetailsForm
              idPrefix={asset.assetId}
              title={overlay?.title || ""}
              titlePlaceholder={title}
              tags={tags}
              notes={overlay?.notes || ""}
              onChange={(patch) => onOverlayChange(asset.assetId, patch)}
              variant="overlay"
            />

            {asset.promptText && (
              <section aria-label="Prompt" className="rounded-(--radius) border border-white/10 bg-white/5 p-[var(--space-3)]">
                <h2 className="text-[length:var(--text-12)] font-medium text-white/70">Prompt</h2>
                <p className="mt-1 text-[length:var(--text-13)] leading-[var(--leading-ui)] text-white/80">{asset.promptText}</p>
              </section>
            )}

            <details className="rounded-(--radius) border border-white/10 bg-white/5 p-[var(--space-3)] text-[length:var(--text-12)] text-white/60">
              <summary className="cursor-pointer text-white/75">Details</summary>
              <dl className="mt-[var(--space-2)] space-y-[var(--space-2)] break-all">
                <div>
                  <dt className="text-white/45">Asset ID</dt>
                  <dd>{asset.assetId}</dd>
                </div>
                {objectKey && (
                  <div>
                    <dt className="text-white/45">Object key</dt>
                    <dd>{objectKey}</dd>
                  </div>
                )}
                {asset.sourceUrl && (
                  <div>
                    <dt className="text-white/45">Source</dt>
                    <dd>
                      <a href={asset.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-(--state-accent-fg)">
                        Open Grok source
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </details>
          </div>
        </aside>
      </div>
    </div>
  );
}
