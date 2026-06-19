"use client";

import { useState } from "react";
import { Plus, Trash2, Film, Type, ImageIcon } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { MovieClip } from "@/lib/types";
import ClipSourcePicker from "./ClipSourcePicker";

interface StoryboardPanelProps {
  clips: MovieClip[];
  onClipsChange: (clips: MovieClip[]) => void;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
}

function SortableClipCard({
  clip,
  isActive,
  onSelect,
  onDelete,
}: {
  clip: MovieClip;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: clip.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div
        onClick={onSelect}
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition cursor-pointer ${
          isActive
            ? "border-orange-500/50 bg-orange-500/10 text-orange-400"
            : "border-neutral-800 text-neutral-400 hover:border-neutral-700"
        }`}
      >
        {clip.type === "video" ? (
          <Film className="h-3 w-3 flex-shrink-0" />
        ) : clip.type === "image" ? (
          <ImageIcon className="h-3 w-3 flex-shrink-0" />
        ) : (
          <Type className="h-3 w-3 flex-shrink-0" />
        )}
        <span className="flex-1 truncate">
          {clip.type === "video"
            ? clip.videoUrl?.split("/").pop()?.slice(0, 25) ?? "Video"
            : clip.type === "image"
              ? clip.imageUrl?.split("/").pop()?.slice(0, 25) ?? "Image"
            : clip.titleText ?? "Title"}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded p-0.5 hover:bg-neutral-700 hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export default function StoryboardPanel({
  clips,
  onClipsChange,
  activeIndex,
  onActiveIndexChange,
}: StoryboardPanelProps) {
  const [showPicker, setShowPicker] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleAddClips(newClips: MovieClip[]) {
    const withPositions = newClips.map((c, i) => ({
      ...c,
      position: clips.length + i,
    }));
    onClipsChange([...clips, ...withPositions]);
  }

  function handleDelete(index: number) {
    const next = clips.filter((_, i) => i !== index);
    onClipsChange(next);
    if (activeIndex >= next.length) {
      onActiveIndexChange(Math.max(0, next.length - 1));
    }
  }

  function handleTransitionChange(index: number, type: MovieClip["transition"]["type"], duration: number) {
    const next = clips.map((c, i) =>
      i === index ? { ...c, transition: { type, duration } } : c
    );
    onClipsChange(next);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = clips.findIndex((c) => c.id === active.id);
    const newIndex = clips.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = [...clips];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    onClipsChange(reordered);
    onActiveIndexChange(newIndex);
  }

  return (
    <div className="flex flex-col gap-0.5 p-3">
      {clips.length === 0 ? (
        <p className="py-8 text-center text-xs text-neutral-500">
          No clips yet. Add some to start building your movie.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={clips.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {clips.map((clip, index) => (
              <div key={clip.id}>
                {/* Transition picker between clips */}
                {index > 0 && (
                  <div className="flex items-center justify-center py-1">
                    <select
                      value={clip.transition.type}
                      onChange={(e) => {
                        const t = e.target.value as "cut" | "fade" | "crossfade";
                        handleTransitionChange(index, t, t === "cut" ? 0 : clip.transition.duration || 0.5);
                      }}
                      className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400 outline-none"
                    >
                      <option value="cut">Cut</option>
                      <option value="fade">Fade</option>
                      <option value="crossfade">Crossfade</option>
                    </select>
                    {clip.transition.type !== "cut" && (
                      <input
                        type="number"
                        min={0.1}
                        max={3}
                        step={0.1}
                        value={clip.transition.duration}
                        onChange={(e) =>
                          handleTransitionChange(index, clip.transition.type, Number(e.target.value))
                        }
                        className="ml-1 w-12 rounded bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-400 outline-none"
                      />
                    )}
                  </div>
                )}

                <SortableClipCard
                  clip={clip}
                  isActive={index === activeIndex}
                  onSelect={() => onActiveIndexChange(index)}
                  onDelete={() => handleDelete(index)}
                />
              </div>
            ))}
          </SortableContext>
        </DndContext>
      )}

      <button
        type="button"
        onClick={() => setShowPicker(true)}
        className="mt-2 flex items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-700 py-2 text-xs text-neutral-500 transition hover:border-neutral-500 hover:text-neutral-300"
      >
        <Plus className="h-3 w-3" />
        Add Clip
      </button>

      {showPicker && (
        <ClipSourcePicker
          onAddClips={(clips) => {
            handleAddClips(clips);
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
