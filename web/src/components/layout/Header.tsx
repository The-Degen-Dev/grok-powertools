"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Scissors, Film, Sparkles, Settings, BookOpen } from "lucide-react";
import ThemeToggle from "@/components/ui/ThemeToggle";
import SettingsPanel from "@/components/settings/SettingsPanel";
import PromptLibrary from "@/components/prompts/PromptLibrary";
import UserMenu from "@/components/auth/UserMenu";
import { useSyncContext } from "@/components/auth/SyncProvider";

const NAV_ITEMS = [
  { href: "/edit", icon: Scissors, label: "Clip Editor" },
  { href: "/movie", icon: Film, label: "Movie Maker" },
];

function useBreadcrumb() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  if (pathname.startsWith("/collections/"))
    return { label: "Collection", href: pathname };
  if (pathname === "/edit") return { label: "Clip Editor", href: "/edit" };
  if (pathname.startsWith("/movie"))
    return { label: "Movie Maker", href: "/movie" };
  if (pathname === "/share") return { label: "Shared View", href: "/share" };
  return null;
}

export default function Header() {
  const pathname = usePathname();
  const breadcrumb = useBreadcrumb();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptLibOpen, setPromptLibOpen] = useState(false);
  const { user, syncStatus, lastSyncAt, syncNow, signIn, signOut } = useSyncContext();

  return (
    <header className="sticky top-0 z-50 border-b border-(--color-surface-200) bg-(--color-surface-0)/80 backdrop-blur-lg dark:border-(--color-surface-800) dark:bg-(--color-surface-950)/80">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between gap-2 px-3 sm:px-4">
        {/* Left: Logo + Breadcrumb */}
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            className="flex items-center gap-2 font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-(--color-surface-900) dark:text-(--color-surface-100)"
          >
            <Sparkles className="h-5 w-5 shrink-0 text-(--color-accent)" />
            <span className="hidden sm:inline">GrokPowerTools</span>
          </Link>
          {breadcrumb && (
            <>
              <span className="hidden text-(--color-surface-300) dark:text-(--color-surface-600) sm:inline">
                /
              </span>
              <span className="hidden truncate text-sm text-(--color-surface-500) sm:inline">
                {breadcrumb.label}
              </span>
            </>
          )}
        </div>

        {/* Right: Nav */}
        <nav className="flex shrink-0 items-center gap-1">
          {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
            const isActive = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                title={label}
                className={`flex items-center gap-1.5 rounded-(--radius-btn) px-2 py-1.5 text-sm transition-colors duration-(--duration-fast) sm:px-3 ${
                  isActive
                    ? "bg-(--color-accent-light) font-medium text-(--color-accent) dark:bg-(--color-accent)/10"
                    : "text-(--color-surface-600) hover:bg-(--color-surface-100) dark:text-(--color-surface-400) dark:hover:bg-(--color-surface-800)"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden md:inline">{label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setPromptLibOpen(true)}
            className="flex items-center gap-1.5 rounded-(--radius-btn) px-2 py-1.5 text-sm text-(--color-surface-600) transition-colors duration-(--duration-fast) hover:bg-(--color-surface-100) dark:text-(--color-surface-400) dark:hover:bg-(--color-surface-800) sm:px-3"
            title="Prompts"
          >
            <BookOpen className="h-4 w-4 shrink-0" />
            <span className="hidden md:inline">Prompts</span>
          </button>
          <div className="mx-1 hidden h-5 w-px bg-(--color-surface-200) dark:bg-(--color-surface-700) sm:block" />
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-(--radius-btn) p-2 text-(--color-surface-500) transition-colors duration-(--duration-fast) hover:bg-(--color-surface-100) hover:text-(--color-surface-700) dark:hover:bg-(--color-surface-800) dark:hover:text-(--color-surface-300)"
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
          <div className="mx-1 hidden h-5 w-px bg-(--color-surface-200) dark:bg-(--color-surface-700) sm:block" />
          <UserMenu
            user={user}
            onSignIn={signIn}
            onSignOut={signOut}
            syncStatus={syncStatus}
            lastSyncAt={lastSyncAt}
            onSyncNow={syncNow}
          />
        </nav>
        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <PromptLibrary open={promptLibOpen} onClose={() => setPromptLibOpen(false)} />
      </div>
    </header>
  );
}
