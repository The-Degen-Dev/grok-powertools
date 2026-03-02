"use client";

import { Suspense } from "react";
import ClipEditor from "@/components/editor/ClipEditor";

export default function ClipEditorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center bg-neutral-950">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-600 border-t-orange-500" />
        </div>
      }
    >
      <ClipEditor />
    </Suspense>
  );
}
