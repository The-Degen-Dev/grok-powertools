export default function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <div
      className={`animate-spin rounded-full border-2 border-(--color-surface-300) border-t-(--color-accent) dark:border-(--color-surface-600) ${className}`}
    />
  );
}
