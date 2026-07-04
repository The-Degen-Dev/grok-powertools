"use client";

import { Check, CircleDashed, FileText, Image as ImageIcon, Inbox, Play, X } from "lucide-react";
import Card from "@/components/ui/Card";
import IconButton from "@/components/ui/IconButton";
import StatusFlag from "@/components/ui/StatusFlag";
import { applyReviewCommand } from "@/lib/movie-review-reducer";
import type { MovieReviewProject, ReviewClip } from "@/lib/movie-review-types";
import { clipDisplayTitle, clipDurationLabel, clipMediaUrl, clipMetaLabel } from "./movieReviewPresentation";

function candidateStatusFlag(clip: ReviewClip) {
  if (clip.lifecycle === "kept") return <StatusFlag tone="kept" icon={Check} label="Kept" compact />;
  if (clip.lifecycle === "rejected") return <StatusFlag tone="rejected" icon={X} label="Rejected" compact />;
  return <StatusFlag tone="attention" icon={CircleDashed} label="Review" title="Awaiting review" />;
}

function thumbnail(clip: ReviewClip, title: string) {
  const mediaUrl = clipMediaUrl(clip);
  if (clip.mediaType === "image" && mediaUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Review Bay uses local Vault media proxy URLs.
      <img src={mediaUrl} alt={title} className="h-full w-full object-cover" loading="lazy" />
    );
  }
  if (clip.mediaType === "title") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-[var(--space-2)] bg-(--color-surface-950) text-(--color-surface-400)">
        <FileText className="h-8 w-8" aria-hidden="true" />
        <span className="max-w-[80%] truncate text-[length:var(--text-12)]">{title}</span>
      </div>
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-black text-white/75">
      {mediaUrl ? <Play className="h-9 w-9" aria-hidden="true" /> : <ImageIcon className="h-9 w-9" aria-hidden="true" />}
    </div>
  );
}

export default function MovieCandidatesGrid({
  project,
  onProjectChange,
}: {
  project: MovieReviewProject;
  onProjectChange: (project: MovieReviewProject) => void;
}) {
  return (
    <section aria-label="Candidates Grid" className="movie-review-center min-h-0 overflow-y-auto p-[var(--space-3)]">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-[var(--space-2)]">
        {project.candidates.map((clip, index) => {
          const title = clipDisplayTitle(clip, clip.position);
          const selected = project.selectedTarget?.type === "candidate" ? project.selectedTarget.clipId === clip.id : project.activeIndex === index;
          const selectClip = () =>
            onProjectChange({
              ...applyReviewCommand(project, { type: "select", target: { type: "candidate", clipId: clip.id } }),
              activeIndex: index,
            });
          return (
            <Card
              key={clip.id}
              id={clip.id}
              title={title}
              meta={clipMetaLabel(clip, clip.position)}
              thumbnail={thumbnail(clip, title)}
              theme="dark"
              selected={selected}
              focused={selected}
              selectionLabel={`Select ${title}`}
              openLabel={`Select ${title}`}
              statusFlag={candidateStatusFlag(clip)}
              durationLabel={clipDurationLabel(clip)}
              quickActions={
                <>
                  <IconButton
                    icon={Check}
                    label={`Keep ${title}`}
                    variant="active"
                    onClick={() => onProjectChange(applyReviewCommand({ ...project, activeIndex: index }, { type: "keep-current" }))}
                  />
                  <IconButton
                    icon={X}
                    label={`Reject ${title}`}
                    variant="danger"
                    onClick={() => onProjectChange(applyReviewCommand({ ...project, activeIndex: index }, { type: "reject-current" }))}
                  />
                </>
              }
              onOpen={selectClip}
              onSelectedChange={(nextSelected) => {
                if (nextSelected) selectClip();
              }}
            />
          );
        })}
      </div>
      {project.candidates.length === 0 && (
        <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 rounded-(--radius) border border-(--hairline) bg-(--surface-panel) p-4 text-center">
          <Inbox className="h-6 w-6 text-neutral-400" aria-hidden="true" />
          <div className="text-sm font-medium text-neutral-100">No candidates in review</div>
          <div className="max-w-sm text-xs text-neutral-400">Keep building from Vault or use Add Clip to bring more source media into review.</div>
        </div>
      )}
    </section>
  );
}
