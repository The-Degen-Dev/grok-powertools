import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description?: string;
  action?: ReactNode;
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-(--radius) border border-dashed border-(--hairline) bg-(--surface-panel) px-[var(--space-4)] py-14 text-center">
      <div className="mb-[var(--space-3)] rounded-(--radius) border border-(--hairline) p-[var(--space-3)]">
        <Icon className="h-6 w-6 text-(--state-muted-fg)" />
      </div>
      <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-16)] font-semibold leading-[var(--leading-ui)] text-(--color-surface-700) dark:text-(--color-surface-200)">
        {title}
      </h2>
      {description && (
        <p className="mt-[var(--space-1)] max-w-sm text-[length:var(--text-13)] leading-[var(--leading-ui)] text-(--color-surface-500)">
          {description}
        </p>
      )}
      {action && <div className="mt-[var(--space-3)]">{action}</div>}
    </div>
  );
}
