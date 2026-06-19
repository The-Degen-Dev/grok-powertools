"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { VaultAsset } from "@/lib/vault-types";

export default function VaultMediaViewer({
  asset,
  onClose,
}: {
  asset: VaultAsset | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!asset) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, video[controls], [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
      previousFocus?.focus();
    };
  }, [asset, onClose]);

  if (!asset) return null;
  const mediaUrl = `/api/vault/media/${encodeURIComponent(asset.assetId)}`;
  const isImage = asset.mediaType === "image";

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label="Vault media viewer"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-sm font-medium">{asset.assetId}</p>
          <p className="text-xs text-white/50">
            {asset.mediaType} / {asset.verificationStatus}
          </p>
        </div>
        <button ref={closeButtonRef} type="button" aria-label="Close" onClick={onClose} className="rounded-full bg-white/10 p-2 hover:bg-white/20">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- R2 media is served through local API proxy.
          <img src={mediaUrl} alt={asset.promptText || asset.assetId} className="max-h-full max-w-full object-contain" />
        ) : (
          <video src={mediaUrl} className="max-h-full max-w-full" controls autoPlay playsInline />
        )}
      </div>
      {asset.promptText && <p className="px-4 py-3 text-sm text-white/80">{asset.promptText}</p>}
    </div>
  );
}
