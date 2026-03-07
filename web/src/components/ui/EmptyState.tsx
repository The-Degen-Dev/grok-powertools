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
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 rounded-xl border border-dashed border-(--color-surface-300) p-4 dark:border-(--color-surface-700)">
        <Icon className="h-8 w-8 text-(--color-surface-300) dark:text-(--color-surface-600)" />
      </div>
      <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-(--color-surface-700) dark:text-(--color-surface-300)">
        {title}
      </h2>
      {description && (
        <p className="mt-2 max-w-sm text-sm text-(--color-surface-500)">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
