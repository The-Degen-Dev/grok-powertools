"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-(--color-accent) text-white hover:bg-(--color-accent-hover) shadow-sm",
  secondary:
    "border border-(--color-surface-200) text-(--color-surface-700) hover:bg-(--color-surface-50) dark:border-(--color-surface-700) dark:text-(--color-surface-300) dark:hover:bg-(--color-surface-800)",
  ghost:
    "text-(--color-surface-600) hover:bg-(--color-surface-100) dark:text-(--color-surface-400) dark:hover:bg-(--color-surface-800)",
  danger:
    "bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800",
};

const sizeStyles: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs gap-1",
  md: "px-3 py-1.5 text-sm gap-1.5",
  lg: "px-4 py-2 text-sm gap-2",
};

export default function Button({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-(--radius-btn) font-medium transition-colors duration-(--duration-fast) disabled:cursor-not-allowed disabled:border-(--state-muted-border) disabled:bg-(--state-muted-bg-subtle) disabled:text-(--state-muted-fg) disabled:shadow-none ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
