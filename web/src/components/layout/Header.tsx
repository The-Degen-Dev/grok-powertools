"use client";

import Link from "next/link";
import {
  Scissors,
  Film,
  Settings,
  User,
  Sparkles,
  FolderOpen,
  HelpCircle,
} from "lucide-react";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-4">
        {/* Left: Logo + Breadcrumb */}
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100"
          >
            <Sparkles className="h-5 w-5 text-orange-500" />
            GrokPowerTools
          </Link>
          <span className="text-neutral-300 dark:text-neutral-600">/</span>
          <span className="text-sm text-neutral-500">Collections Hub</span>
        </div>

        {/* Right: Nav */}
        <nav className="flex items-center gap-1">
          <NavButton href="/edit" icon={Scissors} label="Clip Editor" />
          <NavButton href="/movie" icon={Film} label="Movie Maker" />
          <NavButton href="/collections" icon={FolderOpen} label="Collections" />
          <div className="mx-2 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
          <IconButton icon={HelpCircle} label="Help" onClick={() => {}} />
          <IconButton icon={Settings} label="Settings" onClick={() => {}} />
          <IconButton icon={User} label="Account" onClick={() => {}} />
        </nav>
      </div>
    </header>
  );
}

function NavButton({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function IconButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md p-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
      title={label}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
