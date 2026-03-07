"use client";

import { useState, useEffect } from "react";
import type { AppSettings } from "@/lib/types";
import { getSettings, updateSettings } from "@/lib/local-storage";
import { useTheme } from "@/components/ui/ThemeProvider";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const { setTheme } = useTheme();

  useEffect(() => {
    if (open) {
      getSettings().then(setSettings);
    }
  }, [open]);

  async function update(partial: Partial<AppSettings>) {
    const updated = await updateSettings(partial);
    setSettings(updated);
    if (partial.theme) {
      setTheme(partial.theme);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Settings">
      {!settings ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Theme */}
          <SettingGroup label="Theme">
            <SegmentControl
              value={settings.theme}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
              ]}
              onChange={(v) => update({ theme: v as AppSettings["theme"] })}
            />
          </SettingGroup>

          {/* Video Card Size */}
          <SettingGroup label="Card Size">
            <SegmentControl
              value={settings.videoCardSize}
              options={[
                { value: "small", label: "S" },
                { value: "medium", label: "M" },
                { value: "large", label: "L" },
              ]}
              onChange={(v) => update({ videoCardSize: v as AppSettings["videoCardSize"] })}
            />
          </SettingGroup>

          {/* Aspect Ratio */}
          <SettingGroup label="Card Aspect Ratio">
            <SegmentControl
              value={settings.cardAspectRatio}
              options={[
                { value: "9:16", label: "9:16" },
                { value: "2:3", label: "2:3" },
                { value: "3:4", label: "3:4" },
                { value: "1:1", label: "1:1" },
              ]}
              onChange={(v) => update({ cardAspectRatio: v })}
            />
          </SettingGroup>

          {/* Video Fit */}
          <SettingGroup label="Video Fit">
            <SegmentControl
              value={settings.videoFitMode}
              options={[
                { value: "cover", label: "Cover" },
                { value: "contain", label: "Contain" },
              ]}
              onChange={(v) => update({ videoFitMode: v as AppSettings["videoFitMode"] })}
            />
          </SettingGroup>

          {/* Toggle settings */}
          <div className="space-y-3">
            <ToggleSetting
              label="Autoplay videos on hover"
              checked={settings.autoplayVideos}
              onChange={(v) => update({ autoplayVideos: v })}
            />
            <ToggleSetting
              label="Show video controls"
              checked={settings.showVideoControls}
              onChange={(v) => update({ showVideoControls: v })}
            />
            <ToggleSetting
              label="Add new items to top"
              checked={settings.addNewToTop}
              onChange={(v) => update({ addNewToTop: v })}
            />
            <ToggleSetting
              label="Show notes on cards"
              checked={settings.showNotes}
              onChange={(v) => update({ showNotes: v })}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-(--color-surface-500) uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}

function SegmentControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded-(--radius-btn) border border-(--color-surface-200) p-0.5 dark:border-(--color-surface-700)">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors ${
            value === opt.value
              ? "bg-(--color-accent) text-white shadow-sm"
              : "text-(--color-surface-600) hover:text-(--color-surface-800) dark:text-(--color-surface-400) dark:hover:text-(--color-surface-200)"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ToggleSetting({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between">
      <span className="text-sm text-(--color-surface-700) dark:text-(--color-surface-300)">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${
          checked
            ? "bg-(--color-accent)"
            : "bg-(--color-surface-300) dark:bg-(--color-surface-600)"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </button>
    </label>
  );
}
