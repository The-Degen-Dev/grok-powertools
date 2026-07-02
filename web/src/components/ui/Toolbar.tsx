"use client";

import type { ReactNode } from "react";

export function Toolbar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-(--radius) border border-(--hairline) bg-(--surface-raised) p-[var(--space-3)] dark:bg-(--surface-panel) ${className}`}
    >
      {children}
    </div>
  );
}

export function ToolbarGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex min-w-0 flex-wrap items-center gap-[var(--space-2)] ${className}`}>{children}</div>;
}
