"use client";

import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";

interface MasonryGridProps {
  children: ReactNode[];
  gap?: number;
  itemHeight?: number;
}

function getColumnCount(width: number): number {
  if (width < 640) return 2;
  if (width < 1024) return 3;
  if (width < 1440) return 4;
  return 5;
}

export default function MasonryGrid({
  children,
  gap = 16,
  itemHeight = 400,
}: MasonryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(3);
  const [containerWidth, setContainerWidth] = useState(0);

  const updateColumns = useCallback(() => {
    if (!containerRef.current) return;
    const w = containerRef.current.offsetWidth;
    setContainerWidth(w);
    setColumns(getColumnCount(w));
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(updateColumns);
    ro.observe(containerRef.current);
    updateColumns();
    return () => ro.disconnect();
  }, [updateColumns]);

  const colWidth = containerWidth > 0
    ? (containerWidth - gap * (columns - 1)) / columns
    : 0;

  // Place items in shortest column
  const colHeights = new Array(columns).fill(0);
  const positions = children.map((_, i) => {
    const shortestCol = colHeights.indexOf(Math.min(...colHeights));
    const left = shortestCol * (colWidth + gap);
    const top = colHeights[shortestCol];
    colHeights[shortestCol] += itemHeight + gap;
    return { left, top, col: shortestCol, index: i };
  });

  const totalHeight = Math.max(...colHeights, 0);

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ height: totalHeight > 0 ? totalHeight : undefined }}
    >
      {containerWidth > 0 &&
        children.map((child, i) => {
          const pos = positions[i];
          return (
            <div
              key={i}
              className="masonry-item absolute"
              style={
                {
                  left: pos.left,
                  top: pos.top,
                  width: colWidth,
                  "--i": i,
                } as React.CSSProperties
              }
            >
              {child}
            </div>
          );
        })}
    </div>
  );
}
