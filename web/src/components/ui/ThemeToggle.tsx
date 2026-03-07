"use client";

import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "./ThemeProvider";

const CYCLE: Array<"light" | "dark" | "system"> = ["light", "dark", "system"];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  function handleClick() {
    const idx = CYCLE.indexOf(theme);
    setTheme(CYCLE[(idx + 1) % CYCLE.length]);
  }

  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded-(--radius-btn) p-2 text-(--color-surface-500) transition-colors duration-(--duration-fast) hover:bg-(--color-surface-100) hover:text-(--color-surface-700) dark:hover:bg-(--color-surface-800) dark:hover:text-(--color-surface-300)"
      title={`Theme: ${theme}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
