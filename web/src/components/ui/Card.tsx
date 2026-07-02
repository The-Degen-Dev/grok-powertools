"use client";

import { useRef, type KeyboardEventHandler, type ReactNode } from "react";

interface CardProps {
  id: string;
  title: string;
  meta?: ReactNode;
  thumbnail?: ReactNode;
  statusFlag?: ReactNode;
  durationLabel?: string;
  selected: boolean;
  focused?: boolean;
  selectionLabel: string;
  openLabel: string;
  quickActions?: ReactNode;
  touchActions?: ReactNode;
  tabIndex?: number;
  onOpen: () => void;
  onSelectedChange: (selected: boolean) => void;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onFocus?: () => void;
  cardRef?: (node: HTMLElement | null) => void;
  theme?: "default" | "dark";
  className?: string;
}

export default function Card({
  id,
  title,
  meta,
  thumbnail,
  statusFlag,
  durationLabel,
  selected,
  focused = false,
  selectionLabel,
  openLabel,
  quickActions,
  touchActions,
  tabIndex = 0,
  onOpen,
  onSelectedChange,
  onKeyDown,
  onFocus,
  cardRef,
  theme = "default",
  className = "",
}: CardProps) {
  const localCardRef = useRef<HTMLElement | null>(null);

  function setCardNode(node: HTMLElement | null) {
    localCardRef.current = node;
    cardRef?.(node);
  }

  function handleOpen() {
    localCardRef.current?.focus({ preventScroll: true });
    onOpen();
  }

  const darkCard = theme === "dark";
  const surfaceClass = darkCard
    ? "bg-(--color-surface-900)"
    : "bg-(--surface-raised) dark:bg-(--surface-panel)";
  const titleClass = darkCard
    ? "text-(--color-surface-100)"
    : "text-(--color-surface-800) dark:text-(--color-surface-100)";
  const metaClass = darkCard
    ? "text-(--color-surface-400)"
    : "text-(--color-surface-500)";

  return (
    <article
      ref={setCardNode}
      data-asset-id={id}
      data-focused={focused ? "true" : "false"}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      aria-label={title}
      className={`vault-card group overflow-hidden rounded-(--radius) border ${surfaceClass} text-left outline-none transition-colors duration-(--duration-fast) focus-visible:border-(--state-accent) focus-visible:ring-2 focus-visible:ring-(--state-accent) ${
        selected
          ? "border-(--state-accent) ring-1 ring-(--state-accent)"
          : focused
            ? "border-(--state-accent-border)"
            : "border-(--hairline)"
      } ${className}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-black">
        <button
          type="button"
          aria-label={openLabel}
          onClick={handleOpen}
          className="absolute inset-0 block h-full w-full text-left"
        >
          {thumbnail || (
            <div className="flex h-full w-full items-center justify-center bg-(--color-surface-900) text-[length:var(--text-12)] text-(--color-surface-500)">
              No preview
            </div>
          )}
        </button>

        <label
          className="absolute left-[var(--space-2)] top-[var(--space-2)] z-10 inline-flex h-5 w-5 cursor-pointer items-center"
          onClick={(event) => event.stopPropagation()}
        >
          <input
            type="checkbox"
            aria-label={selectionLabel}
            checked={selected}
            onChange={(event) => onSelectedChange(event.target.checked)}
            className="peer absolute inset-0 h-5 w-5 cursor-pointer opacity-0"
          />
          <span className="pointer-events-none flex h-5 w-5 items-center justify-center rounded-(--radius-sm) border border-white/70 bg-black/55 text-white transition-colors peer-checked:border-(--state-accent) peer-checked:bg-(--state-accent)">
            <span className={selected ? "block h-2 w-2 rounded-sm bg-white" : "hidden"} />
          </span>
        </label>

        {statusFlag && <div className="absolute right-[var(--space-2)] top-[var(--space-2)] z-10 max-w-[68%]">{statusFlag}</div>}
        {durationLabel && (
          <div className="absolute bottom-[var(--space-2)] right-[var(--space-2)] z-10 rounded-(--radius-sm) bg-black/70 px-1.5 py-0.5 text-[length:var(--text-11)] font-medium leading-none text-white">
            {durationLabel}
          </div>
        )}
        {quickActions && (
          <div className="vault-card-hover-actions absolute inset-x-[var(--space-2)] bottom-[var(--space-2)] z-20 flex items-center gap-[var(--space-1)]">
            {quickActions}
          </div>
        )}
        {touchActions && <div className="vault-card-touch-actions absolute bottom-[var(--space-2)] left-[var(--space-2)] z-20">{touchActions}</div>}
      </div>

      <button
        type="button"
        aria-label={openLabel}
        onClick={handleOpen}
        className="block w-full px-[var(--space-2)] py-[var(--space-2)] text-left"
      >
        <span className={`block truncate text-[length:var(--text-13)] font-medium leading-[var(--leading-tight-ui)] ${titleClass}`}>
          {title}
        </span>
        {meta && <span className={`mt-1 block truncate text-[length:var(--text-12)] leading-[var(--leading-tight-ui)] ${metaClass}`}>{meta}</span>}
      </button>
    </article>
  );
}
