"use client";

import type { ButtonHTMLAttributes, ElementType } from "react";

type IconButtonVariant = "default" | "active" | "danger" | "ghost";

const variantClasses: Record<IconButtonVariant, string> = {
  default:
    "border-(--hairline) bg-black/55 text-white/85 hover:bg-black/75 hover:text-white",
  active:
    "border-(--state-kept-border) bg-(--state-kept-bg-subtle) text-(--state-kept-fg) hover:border-(--state-kept) dark:bg-black/65 dark:text-(--state-kept-fg)",
  danger:
    "border-(--state-rejected-border) bg-(--state-rejected-bg-subtle) text-(--state-rejected-fg) hover:border-(--state-rejected) dark:bg-black/65 dark:text-(--state-rejected-fg)",
  ghost:
    "border-(--hairline) bg-(--surface-raised) text-(--color-surface-600) hover:bg-(--surface-panel) dark:text-(--color-surface-300)",
};

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ElementType;
  label: string;
  variant?: IconButtonVariant;
}

export default function IconButton({
  icon: Icon,
  label,
  variant = "default",
  className = "",
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-sm) border text-[length:var(--text-12)] transition-colors duration-(--duration-fast) disabled:cursor-not-allowed disabled:opacity-45 ${variantClasses[variant]} ${className}`}
      {...props}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}
