"use client";

import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-neutral-50 px-4 py-4 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between text-xs text-neutral-400">
        <div className="flex gap-4">
          <Link href="/edit" className="hover:text-neutral-600 dark:hover:text-neutral-300">
            Clip Editor
          </Link>
          <Link href="/movie" className="hover:text-neutral-600 dark:hover:text-neutral-300">
            Movie Maker
          </Link>
          <Link href="/tools" className="hover:text-neutral-600 dark:hover:text-neutral-300">
            Tools
          </Link>
          <Link href="/about" className="hover:text-neutral-600 dark:hover:text-neutral-300">
            About
          </Link>
        </div>
        <div>&copy; {new Date().getFullYear()} Grok Power Tools</div>
      </div>
    </footer>
  );
}
