"use client";

import { useEffect, useState } from "react";
import { Check, CircleDashed, Sparkles, SquareSlash } from "lucide-react";
import StatusFlag from "@/components/ui/StatusFlag";
import { applyDirectorChanges, createRuleBasedDirectorProposal } from "@/lib/movie-director";
import {
  createMovieVersionFromProject,
  listDirectorProposals,
  saveDirectorProposal,
  updateReviewProject,
} from "@/lib/movie-review-storage";
import type { DirectorProposal, MovieReviewProject } from "@/lib/movie-review-types";
import type { MovieReviewProjectUpdate } from "./useMovieReviewProject";
import { clipDisplayTitle } from "./movieReviewPresentation";

interface DirectorConfigState {
  configured: boolean;
  model: string | null;
  loading: boolean;
  error: string;
}

function changeLabel(change: DirectorProposal["changes"][number], project: MovieReviewProject): string {
  const clips = [...project.candidates, ...project.committedClips];
  if (change.type === "reorder") return `Reorder ${change.clipIds.length} clips`;
  const clip = clips.find((item) => item.id === change.clipId);
  return `${change.type} ${clip ? clipDisplayTitle(clip, clip.position) : "clip"}`;
}

function DirectorProposalFlag({ proposal }: { proposal: DirectorProposal }) {
  if (proposal.status === "pending") {
    return <StatusFlag tone="director" icon={Sparkles} label="Pending" variant="solid" />;
  }
  if (proposal.status === "applied") {
    return <StatusFlag tone="director" icon={Check} label="Applied" variant="outline" />;
  }
  if (proposal.status === "partially-applied") {
    return <StatusFlag tone="director" icon={CircleDashed} label="Partial" title="Partially applied" variant="outline" attentionDot />;
  }
  return <StatusFlag tone="director" icon={SquareSlash} label="Invalid / no-op" variant="hollow" />;
}

export default function MovieDirectorPanel({
  project,
  onProjectChange,
}: {
  project: MovieReviewProject;
  onProjectChange: (project: MovieReviewProjectUpdate) => void;
}) {
  const [proposals, setProposals] = useState<DirectorProposal[]>([]);
  const [selectedChanges, setSelectedChanges] = useState<Record<string, Set<string>>>({});
  const [config, setConfig] = useState<DirectorConfigState>({ configured: false, model: null, loading: true, error: "" });

  useEffect(() => {
    let cancelled = false;
    listDirectorProposals(project.id).then((rows) => {
      if (!cancelled) setProposals(rows);
    });
    fetch("/api/movie/director")
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setConfig({ configured: Boolean(data.configured), model: data.model ?? null, loading: false, error: "" });
      })
      .catch(() => {
        if (!cancelled) setConfig({ configured: false, model: null, loading: false, error: "Director config unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  async function saveProposal(proposal: DirectorProposal) {
    const saved = await saveDirectorProposal(proposal);
    setProposals((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
  }

  async function runRuleDirector() {
    await saveProposal(createRuleBasedDirectorProposal(project));
  }

  async function runProviderDirector() {
    const response = await fetch("/api/movie/director", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project }),
    });
    if (!response.ok) {
      setConfig((current) => ({ ...current, error: "Provider Director failed" }));
      return;
    }
    const data = await response.json();
    if (data.proposal) await saveProposal(data.proposal);
  }

  function toggleChange(proposalId: string, changeId: string, checked: boolean) {
    setSelectedChanges((current) => {
      const next = new Set(current[proposalId] ?? []);
      if (checked) next.add(changeId);
      else next.delete(changeId);
      return { ...current, [proposalId]: next };
    });
  }

  async function applySelectedChanges(proposal: DirectorProposal) {
    const selected = [...(selectedChanges[proposal.id] ?? new Set<string>())];
    if (selected.length === 0) return;
    if (project.committedClips.length > 0) {
      await createMovieVersionFromProject(project, `Before ${proposal.title}`, "Automatic snapshot before applying Director changes.");
    }
    const nextProject = applyDirectorChanges(project, proposal, selected);
    await updateReviewProject(nextProject);
    onProjectChange(nextProject);
    const selectedCount = proposal.changes.filter((change) => change.id && selected.includes(change.id)).length;
    const status = selectedCount >= proposal.changes.length ? "applied" : "partially-applied";
    const updatedProposal: DirectorProposal = { ...proposal, status, updatedAt: new Date().toISOString() };
    await saveProposal(updatedProposal);
    setSelectedChanges((current) => ({ ...current, [proposal.id]: new Set() }));
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => {
          void runRuleDirector();
        }}
        className="w-full rounded-(--radius) bg-(--state-accent) px-3 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        Run rule-based Director
      </button>
      <button
        type="button"
        disabled={!config.configured || config.loading}
        onClick={() => {
          void runProviderDirector();
        }}
        className="w-full rounded-(--radius) border border-(--hairline) bg-(--surface-panel) px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-(--surface-panel)"
      >
        Run provider Director{config.model ? ` (${config.model})` : ""}
      </button>
      {config.error && <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">{config.error}</div>}
      <div className="space-y-2">
        {proposals.map((proposal) => {
          const selectedCount = selectedChanges[proposal.id]?.size ?? 0;
          const canApply = proposal.status === "pending" && proposal.changes.length > 0 && selectedCount > 0;
          return (
            <article
              key={proposal.id}
              aria-label={`Director proposal ${proposal.title}`}
              className="rounded-(--radius) border border-(--hairline) bg-(--surface-panel) p-[var(--space-3)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-neutral-100">{proposal.title}</h3>
                  <p className="mt-1 text-xs text-neutral-400">{proposal.rationale}</p>
                  {proposal.validationError && <p className="mt-2 text-xs text-amber-200">{proposal.validationError}</p>}
                </div>
                <DirectorProposalFlag proposal={proposal} />
              </div>
              <div className="mt-3 space-y-2">
                {proposal.changes.map((change, index) => {
                  const changeId = change.id ?? `${proposal.id}-${index}`;
                  return (
                    <label key={changeId} className="flex gap-2 rounded-(--radius-sm) bg-(--surface-raised) p-2 text-xs text-neutral-300">
                      <input
                        type="checkbox"
                        aria-label={`Select Director change ${index + 1}`}
                        checked={selectedChanges[proposal.id]?.has(changeId) ?? false}
                        onChange={(event) => toggleChange(proposal.id, changeId, event.target.checked)}
                        className="mt-0.5 accent-(--state-accent)"
                      />
                      <span>
                        <span className="block font-medium text-neutral-100">{changeLabel(change, project)}</span>
                        <span className="block text-neutral-400">{change.rationale || "No rationale provided."}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={!canApply}
                onClick={() => {
                  void applySelectedChanges(proposal);
                }}
                className="mt-3 w-full rounded-(--radius) border border-(--hairline) bg-(--surface-raised) px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-(--surface-raised)"
              >
                Apply selected changes
              </button>
            </article>
          );
        })}
        {proposals.length === 0 && (
          <div className="rounded-(--radius) border border-(--hairline) bg-(--surface-panel) p-3 text-sm text-neutral-400">
            No Director proposals yet. Run the rule-based Director to create a local changeset without changing the cut.
          </div>
        )}
      </div>
    </div>
  );
}
