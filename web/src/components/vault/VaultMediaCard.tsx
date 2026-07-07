"use client";

import { useEffect, useRef, useState, type ElementType, type KeyboardEventHandler } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Copy,
  ExternalLink,
  EyeOff,
  Film,
  FolderPlus,
  MoreVertical,
  Play,
  Star,
} from "lucide-react";
import Card from "@/components/ui/Card";
import IconButton from "@/components/ui/IconButton";
import StatusFlag from "@/components/ui/StatusFlag";
import type { VaultAsset, VaultOverlay, VaultSourceStatus } from "@/lib/vault-types";
import { isVaultImageAsset } from "@/lib/vault-media";
import { vaultMediaUrl } from "@/lib/vault-media-url";

type OverlayPatch = Partial<Pick<VaultOverlay, "favorite" | "hidden" | "notes" | "tags" | "title">>;

const videoVisibilityCallbacks = new WeakMap<Element, () => void>();
let sharedVideoObserver: IntersectionObserver | null = null;

function getSharedVideoObserver() {
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) return null;
  if (!sharedVideoObserver) {
    sharedVideoObserver = new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting && entry.intersectionRatio <= 0) continue;
          videoVisibilityCallbacks.get(entry.target)?.();
          videoVisibilityCallbacks.delete(entry.target);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "720px 0px" },
    );
  }
  return sharedVideoObserver;
}

function formatDuration(seconds?: number): string | undefined {
  if (!seconds || !Number.isFinite(seconds)) return undefined;
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

function formatDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

function mediaLabel(asset: VaultAsset) {
  if (asset.mediaType === "image") return "Image";
  if (asset.mediaType === "video") return "Video";
  return "Media";
}

export function vaultAssetDisplayTitle(asset: VaultAsset, overlay?: VaultOverlay, index = 0): string {
  const localTitle = overlay?.title?.trim();
  if (localTitle) return localTitle;
  const promptTitle = asset.promptText?.trim().replace(/\s+/g, " ");
  if (promptTitle) return promptTitle;
  const date = formatDate(asset.firstSeenAt || asset.createdAt);
  return date ? `${mediaLabel(asset)} · ${date}` : `${mediaLabel(asset)} ${index + 1}`;
}

function statusFlag(asset: VaultAsset, overlay?: VaultOverlay) {
  if (overlay?.hidden) {
    return <StatusFlag tone="muted" icon={EyeOff} label="Hidden" compact />;
  }
  if (overlay?.favorite) {
    return <StatusFlag tone="kept" icon={Star} label="Favorite" compact />;
  }

  const status: Record<VaultSourceStatus, { tone: "kept" | "rejected" | "attention" | "muted"; label: string; icon: ElementType }> = {
    verified: { tone: "kept", label: "Verified", icon: CheckCircle2 },
    blocked: { tone: "rejected", label: "Blocked", icon: Ban },
    failed: { tone: "rejected", label: "Failed", icon: AlertTriangle },
    unproven: { tone: "attention", label: "Unproven", icon: AlertTriangle },
  };
  const config = status[asset.verificationStatus];
  return <StatusFlag tone={config.tone} icon={config.icon} label={config.label} compact />;
}

function SourceAction({ asset }: { asset: VaultAsset }) {
  if (!asset.sourceUrl) {
    return (
      <span
        aria-label={`No source for ${asset.assetId}`}
        title={`No source for ${asset.assetId}`}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-sm) border border-(--hairline) bg-black/35 text-white/35"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }

  return (
    <a
      href={asset.sourceUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open source for ${asset.assetId}`}
      title={`Open source for ${asset.assetId}`}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-sm) border border-(--hairline) bg-black/55 text-white/85 transition-colors hover:bg-black/75 hover:text-white"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}

function VideoThumbnail({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pendingSeekRef = useRef(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [frameState, setFrameState] = useState<"idle" | "loading" | "ready" | "failed">("idle");

  useEffect(() => {
    const node = containerRef.current;
    if (!node || shouldLoad) return undefined;

    const observer = getSharedVideoObserver();
    if (!observer) {
      const frame = window.requestAnimationFrame(() => {
        setShouldLoad(true);
        setFrameState((current) => (current === "idle" ? "loading" : current));
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const load = () => {
      setShouldLoad(true);
      setFrameState((current) => (current === "idle" ? "loading" : current));
    };
    videoVisibilityCallbacks.set(node, load);
    observer.observe(node);

    return () => {
      observer.unobserve(node);
      videoVisibilityCallbacks.delete(node);
    };
  }, [shouldLoad]);

  function markReady() {
    setFrameState((current) => (current === "failed" ? current : "ready"));
  }

  function handleLoadedFrame() {
    if (!pendingSeekRef.current) markReady();
  }

  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    const targetTime = Number.isFinite(video.duration) && video.duration > 0.5 ? Math.min(0.75, Math.max(0.25, video.duration * 0.1)) : 0;
    if (targetTime > 0 && Math.abs(video.currentTime - targetTime) > 0.05) {
      try {
        pendingSeekRef.current = true;
        video.currentTime = targetTime;
      } catch {
        pendingSeekRef.current = false;
        markReady();
      }
    } else {
      pendingSeekRef.current = false;
    }
  }

  function handleSeeked() {
    pendingSeekRef.current = false;
    markReady();
  }

  const loaded = frameState === "ready";
  const failed = frameState === "failed";

  return (
    <div
      ref={containerRef}
      data-vault-video-thumbnail={frameState}
      className="relative h-full w-full overflow-hidden bg-[linear-gradient(135deg,#171717,#2a2a2a_48%,#111)]"
    >
      {shouldLoad && !failed && (
        <video
          ref={videoRef}
          src={src}
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
          className={`h-full w-full object-cover transition-opacity duration-(--duration-normal) ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoadedMetadata={handleLoadedMetadata}
          onLoadedData={handleLoadedFrame}
          onCanPlay={handleLoadedFrame}
          onSeeked={handleSeeked}
          onError={() => setFrameState("failed")}
        />
      )}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.18),rgba(255,255,255,0.04)_34%,rgba(0,0,0,0.35)_72%)] text-white/75">
          <span className="sr-only">{failed ? "Video preview unavailable" : "Loading video preview"}</span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-black/0 to-black/10" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/55 bg-black/20 text-white/85 shadow-(--shadow-overlay)">
          <Play className="ml-0.5 h-6 w-6" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

function TouchMenu({
  asset,
  overlay,
  onCopyPrompt,
  onAddToCollection,
  onAddToMovie,
  onOverlayChange,
}: {
  asset: VaultAsset;
  overlay?: VaultOverlay;
  onCopyPrompt: (asset: VaultAsset) => void;
  onAddToCollection: (asset: VaultAsset) => void;
  onAddToMovie: (asset: VaultAsset) => void;
  onOverlayChange: (assetId: string, patch: OverlayPatch) => void;
}) {
  const [open, setOpen] = useState(false);

  const actionClass =
    "flex w-full items-center gap-[var(--space-2)] rounded-(--radius-sm) px-[var(--space-2)] py-[var(--space-1)] text-left text-[length:var(--text-12)] text-(--color-surface-100) hover:bg-white/10";

  function handleAction(action: () => void) {
    action();
    setOpen(false);
  }

  return (
    <div className="relative">
      <IconButton icon={MoreVertical} label={`More actions for ${asset.assetId}`} onClick={() => setOpen((current) => !current)} />
      {open && (
        <div className="absolute bottom-8 left-0 z-40 w-44 rounded-(--radius) border border-white/15 bg-black/90 p-1 shadow-(--shadow-overlay)">
          <button className={actionClass} type="button" onClick={() => handleAction(() => onOverlayChange(asset.assetId, { favorite: !overlay?.favorite }))}>
            <Star className="h-3.5 w-3.5" aria-hidden="true" />
            {overlay?.favorite ? "Unfavorite" : "Favorite"}
          </button>
          <button className={actionClass} type="button" onClick={() => handleAction(() => onAddToMovie(asset))}>
            <Film className="h-3.5 w-3.5" aria-hidden="true" />
            Add to movie
          </button>
          <button className={actionClass} type="button" onClick={() => handleAction(() => onAddToCollection(asset))}>
            <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
            Add to collection
          </button>
          <button className={actionClass} type="button" onClick={() => handleAction(() => onOverlayChange(asset.assetId, { hidden: !overlay?.hidden }))}>
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            {overlay?.hidden ? "Unhide" : "Hide"}
          </button>
          <button className={actionClass} type="button" disabled={!asset.promptText} onClick={() => handleAction(() => onCopyPrompt(asset))}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            Copy prompt
          </button>
          {asset.sourceUrl && (
            <a className={actionClass} href={asset.sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Source
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function VaultMediaCard({
  asset,
  overlay,
  selected,
  focused,
  displayIndex,
  cardRef,
  tabIndex,
  onKeyDown,
  onFocus,
  onSelectedChange,
  onOpen,
  onCopyPrompt,
  onAddToCollection,
  onAddToMovie,
  onOverlayChange,
}: {
  asset: VaultAsset;
  overlay?: VaultOverlay;
  selected: boolean;
  focused?: boolean;
  displayIndex: number;
  cardRef?: (node: HTMLElement | null) => void;
  tabIndex?: number;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onFocus?: () => void;
  onSelectedChange: (assetId: string, selected: boolean) => void;
  onOpen: (asset: VaultAsset) => void;
  onCopyPrompt: (asset: VaultAsset) => void;
  onAddToCollection: (asset: VaultAsset) => void;
  onAddToMovie: (asset: VaultAsset) => void;
  onOverlayChange: (assetId: string, patch: OverlayPatch) => void;
}) {
  const mediaUrl = vaultMediaUrl(asset);
  const isImage = isVaultImageAsset(asset);
  const title = vaultAssetDisplayTitle(asset, overlay, displayIndex);
  const meta = `${mediaLabel(asset)} ${displayIndex + 1}${asset.firstSeenAt ? ` · ${formatDate(asset.firstSeenAt)}` : ""}`;
  const thumbnail = isImage ? (
    // eslint-disable-next-line @next/next/no-img-element -- R2 media is served through the local API proxy.
    <img src={mediaUrl} alt={title} className="h-full w-full object-cover" loading="lazy" />
  ) : (
    <VideoThumbnail src={mediaUrl} />
  );

  const quickActions = (
    <>
      <IconButton
        icon={Star}
        label={`Favorite ${asset.assetId}`}
        variant={overlay?.favorite ? "active" : "default"}
        onClick={() => onOverlayChange(asset.assetId, { favorite: !overlay?.favorite })}
      />
      <IconButton icon={Film} label={`Add ${asset.assetId} to movie`} onClick={() => onAddToMovie(asset)} />
      <IconButton icon={FolderPlus} label={`Add ${asset.assetId} to collection`} onClick={() => onAddToCollection(asset)} />
      <IconButton
        icon={EyeOff}
        label={`Hide ${asset.assetId}`}
        variant={overlay?.hidden ? "active" : "default"}
        onClick={() => onOverlayChange(asset.assetId, { hidden: !overlay?.hidden })}
      />
      <IconButton icon={Copy} label={`Copy prompt for ${asset.assetId}`} disabled={!asset.promptText} onClick={() => onCopyPrompt(asset)} />
      <SourceAction asset={asset} />
    </>
  );

  return (
    <Card
      id={asset.assetId}
      title={title}
      meta={meta}
      thumbnail={thumbnail}
      selected={selected}
      focused={focused}
      selectionLabel={`Select ${asset.assetId}`}
      openLabel={`Open ${asset.assetId} details`}
      statusFlag={statusFlag(asset, overlay)}
      durationLabel={formatDuration(asset.durationSeconds)}
      quickActions={quickActions}
      touchActions={
        <TouchMenu
          asset={asset}
          overlay={overlay}
          onCopyPrompt={onCopyPrompt}
          onAddToCollection={onAddToCollection}
          onAddToMovie={onAddToMovie}
          onOverlayChange={onOverlayChange}
        />
      }
      tabIndex={tabIndex}
      onOpen={() => onOpen(asset)}
      onSelectedChange={(nextSelected) => onSelectedChange(asset.assetId, nextSelected)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      cardRef={cardRef}
    />
  );
}
