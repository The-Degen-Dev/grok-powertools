"use client";

import { useState, useEffect } from "react";
import { FolderPlus, Scissors, Film, Share2, ChevronRight, ChevronLeft, Sparkles } from "lucide-react";
import { getSettings, updateSettings } from "@/lib/local-storage";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";

const STEPS = [
  {
    icon: FolderPlus,
    title: "Import & Organize",
    description:
      "Paste Grok Imagine links to build video collections. Drag to reorder, browse in a Pinterest-style masonry grid.",
  },
  {
    icon: Scissors,
    title: "Quick Trim & Edit",
    description:
      "Hover any video card and click the scissors icon to open the trim editor. For full crop and export, open the Clip Editor.",
  },
  {
    icon: Film,
    title: "Make Movies",
    description:
      "Combine clips from your collections into sequences with transitions, title cards, and export to WebM.",
  },
  {
    icon: Share2,
    title: "Share Your Work",
    description:
      "Generate share links for any collection. Recipients see a read-only gallery view — no account needed.",
  },
];

interface WelcomeModalProps {
  onLoadExamples?: () => void;
}

export default function WelcomeModal({ onLoadExamples }: WelcomeModalProps) {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    getSettings().then((s) => {
      if (!s.onboardingComplete) setShow(true);
    });
  }, []);

  async function handleComplete() {
    await updateSettings({ onboardingComplete: true });
    setShow(false);
  }

  function handleLoadExamples() {
    onLoadExamples?.();
    handleComplete();
  }

  if (!show) return null;

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <Modal open={show} onClose={handleComplete}>
      <div className="text-center">
        {/* Step indicator */}
        <div className="mb-6 flex items-center justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-(--duration-normal) ${
                i === step
                  ? "w-6 bg-(--color-accent)"
                  : "w-1.5 bg-(--color-surface-200) dark:bg-(--color-surface-700)"
              }`}
            />
          ))}
        </div>

        {/* Icon */}
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-(--color-accent)/10">
          <Icon className="h-7 w-7 text-(--color-accent)" />
        </div>

        {/* Content */}
        <h3 className="font-[family-name:var(--font-display)] text-xl font-bold text-(--color-surface-900) dark:text-(--color-surface-100)">
          {current.title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-(--color-surface-500)">
          {current.description}
        </p>

        {/* Actions */}
        <div className="mt-8 flex items-center justify-between">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={handleComplete}>
              Skip
            </Button>
          )}

          {isLast ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleLoadExamples}>
                <Sparkles className="h-4 w-4" />
                Load Examples
              </Button>
              <Button variant="primary" onClick={handleComplete}>
                Get Started
              </Button>
            </div>
          ) : (
            <Button variant="primary" onClick={() => setStep(step + 1)}>
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
