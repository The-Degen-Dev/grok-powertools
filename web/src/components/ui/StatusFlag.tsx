"use client";

import type { ElementType } from "react";
import { AlertTriangle, Check, Circle, EyeOff, Sparkles, X } from "lucide-react";

export type StatusFlagTone = "accent" | "kept" | "rejected" | "attention" | "director" | "muted";

const defaultIcons: Record<StatusFlagTone, ElementType> = {
  accent: Circle,
  kept: Check,
  rejected: X,
  attention: AlertTriangle,
  director: Sparkles,
  muted: EyeOff,
};

interface StatusFlagProps {
  tone: StatusFlagTone;
  label: string;
  icon?: ElementType;
  title?: string;
  compact?: boolean;
  variant?: "subtle" | "solid" | "outline" | "hollow";
  attentionDot?: boolean;
  className?: string;
}

export default function StatusFlag({
  tone,
  label,
  icon,
  title,
  compact = false,
  variant = "subtle",
  attentionDot = false,
  className = "",
}: StatusFlagProps) {
  const Icon = icon || defaultIcons[tone];
  const style =
    variant === "solid"
      ? {
          color: "#fff",
          backgroundColor: `var(--state-${tone})`,
          borderColor: `var(--state-${tone})`,
        }
      : variant === "outline" || variant === "hollow"
        ? {
            color: `var(--state-${tone}-fg)`,
            backgroundColor: "transparent",
            borderColor: `var(--state-${tone}-border)`,
          }
        : {
            color: `var(--state-${tone}-fg)`,
            backgroundColor: `var(--state-${tone}-bg-subtle)`,
            borderColor: `var(--state-${tone}-border)`,
          };
  return (
    <span
      title={title || label}
      aria-label={label}
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-(--radius-sm) border px-1.5 py-0.5 text-[length:var(--text-11)] font-medium leading-none ${variant === "hollow" ? "opacity-80" : ""} ${className}`}
      style={style}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {attentionDot && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: "var(--state-attention)" }}
          aria-hidden="true"
        />
      )}
      {!compact && <span className="truncate">{label}</span>}
    </span>
  );
}
