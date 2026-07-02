"use client";

export interface MediaDetailsPatch {
  title?: string;
  tags?: string[];
  notes?: string;
}

interface MediaDetailsFormProps {
  idPrefix: string;
  title: string;
  titlePlaceholder: string;
  tags: string[];
  notes: string;
  onChange: (patch: MediaDetailsPatch) => void;
  variant?: "overlay" | "panel";
}

function tagsToInput(tags: string[]): string {
  return tags.join(", ");
}

function inputToTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export default function MediaDetailsForm({
  idPrefix,
  title,
  titlePlaceholder,
  tags,
  notes,
  onChange,
  variant = "panel",
}: MediaDetailsFormProps) {
  const overlay = variant === "overlay";
  const labelClass = overlay
    ? "block text-[length:var(--text-12)] font-medium text-white/70"
    : "block text-[length:var(--text-12)] font-medium text-(--color-surface-400)";
  const inputClass = overlay
    ? "mt-1 h-8 w-full rounded-(--radius) border border-white/15 bg-white/5 px-[var(--space-2)] text-[length:var(--text-13)] outline-none focus:border-(--state-accent)"
    : "mt-1 h-8 w-full rounded-(--radius) border border-(--hairline) bg-(--color-surface-950) px-[var(--space-2)] text-[length:var(--text-13)] text-(--color-surface-100) outline-none focus:border-(--state-accent)";
  const textareaClass = overlay
    ? "mt-1 w-full resize-none rounded-(--radius) border border-white/15 bg-white/5 px-[var(--space-2)] py-[var(--space-2)] text-[length:var(--text-13)] leading-[var(--leading-ui)] outline-none focus:border-(--state-accent)"
    : "mt-1 w-full resize-none rounded-(--radius) border border-(--hairline) bg-(--color-surface-950) px-[var(--space-2)] py-[var(--space-2)] text-[length:var(--text-13)] leading-[var(--leading-ui)] text-(--color-surface-100) outline-none focus:border-(--state-accent)";

  return (
    <div className="space-y-[var(--space-3)]">
      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-title`}>
          Title
        </label>
        <input
          id={`${idPrefix}-title`}
          aria-label={`Title for ${idPrefix}`}
          value={title}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder={titlePlaceholder}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-tags`}>
          Tags
        </label>
        <input
          id={`${idPrefix}-tags`}
          aria-label={`Tags for ${idPrefix}`}
          value={tagsToInput(tags)}
          onChange={(event) => onChange({ tags: inputToTags(event.target.value) })}
          placeholder="Add comma-separated tags"
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-notes`}>
          Notes
        </label>
        <textarea
          id={`${idPrefix}-notes`}
          aria-label={`Notes for ${idPrefix}`}
          value={notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          rows={5}
          placeholder="Add review notes"
          className={textareaClass}
        />
      </div>
    </div>
  );
}
