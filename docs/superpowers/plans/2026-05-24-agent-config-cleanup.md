# Agent Config Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire stale repo-local agent runtime/config safely and merge adapted zeke/agents.md guidance into the global Codex `AGENTS.md`.

**Architecture:** Codex global instructions live in `/Users/philipbankier/.codex/AGENTS.md`; keep this as the only global Codex target. The repo's tracked `AGENTS.md` remains the project-specific source of truth. Repo-local hook/runtime files are first classified, archived, and verified before any deletion because `.codex/hooks.json` is a real Codex project-local hook source in trusted projects.

**Tech Stack:** Codex AGENTS.md layering, Codex hooks, shell inspection, `apply_patch`, `tar`, Git status checks.

---

## File Structure

- Modify: `/Users/philipbankier/.codex/AGENTS.md`
  - Merge current global Browser/Peekaboo routing with adapted zeke/agents.md guidance.
  - Preserve upstream wording, punctuation, typos, and Markdown everywhere except the explicitly listed adaptations below.
- Do not modify without a separate approval:
  - `/Users/philipbankier/AGENTS.md`
    - This is not the Codex global target and currently contains gstack-oriented guidance.
- Delete only after archive and verification:
  - `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools/.codex/`
    - Untracked Codex hook config, not ignored runtime state.
  - `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools/.claude/`
    - Ignored Claude-local settings/hooks.
  - `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools/.agent/`
    - Ignored AgentRouter policy.
  - `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools/AGENT_STATE.md`
  - `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools/AGENT_HANDOFF.md`
  - ignored repo-local `CLAUDE.md` files.
- Do not modify:
  - `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools/AGENTS.md`
  - `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools/HACKING.md`
  - `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools/README.md`
  - `/Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools/docs/AGENT_HANDOFF_PROMPT.md`

## Adaptation Rules From zeke/agents.md

Fetch upstream at execution time from `https://raw.githubusercontent.com/zeke/agents.md/main/AGENTS.md`. If the upstream `Browser Automation`, `Working with Cloudflare`, `Running scripts and commands`, or `Self-improvement` sections have materially changed from the text below, stop and re-plan instead of applying stale guidance.

Make only these content changes:

- Preserve current `/Users/philipbankier/.codex/AGENTS.md` Browser/Peekaboo routing, but clarify browser precedence so it does not conflict with the `agent-browser` and `plwr` preference below.
- Keep `agent-browser` and `plwr`, but phrase availability truthfully: prefer them when available and verify with `command -v agent-browser plwr` before use.
- Keep the Chrome DevTools MCP rule, with this local constraint: use Chrome DevTools MCP only when explicitly requested or when existing Chrome profile/session, cookies, extensions, or authenticated state are required. When used, connect only to the existing user Chrome window/session, check for a relevant tab first, never overtake unrelated tabs, and open a new tab only inside that same existing window/session when needed.
- Change only the Cloudflare TOML/JSONC rule to: prefer JSONC for new Workers configs, but respect existing repo config formats to avoid unrelated churn.
- Add fallback script guidance: if no `script/` or `scripts/` directory exists, use documented project commands from `AGENTS.md`, `HACKING.md`, `README.md`, or `package.json`.
- Add the hook-review correction: when asked to review hooks before enabling/deleting them, provide a keep/delete recommendation per hook, not just an inventory.

## Task 1: Refresh Source Truth And Confirm Local State

**Files:**
- Read: `/Users/philipbankier/.codex/AGENTS.md`
- Read: `/Users/philipbankier/AGENTS.md`
- Read: repo-local `.codex/`, `.claude/`, `.agent/`, `AGENT_STATE.md`, `AGENT_HANDOFF.md`, and `CLAUDE.md` files.
- Read: upstream zeke/agents.md raw file.

- [ ] **Step 1: Fetch current upstream guidance**

Run:

```bash
set -euo pipefail
curl -fsSL https://raw.githubusercontent.com/zeke/agents.md/main/AGENTS.md -o /tmp/zeke-agents-current.md
shasum -a 256 /tmp/zeke-agents-current.md
wc -l /tmp/zeke-agents-current.md
```

Expected: command exits 0 and the file contains all required upstream sections. The exact hash may change over time, so record it in the final report rather than hard-coding it.

- [ ] **Step 2: Verify required upstream sections still exist**

Run:

```bash
set -euo pipefail
rg -q '^## Working with me$' /tmp/zeke-agents-current.md
rg -q '^## Running scripts and commands$' /tmp/zeke-agents-current.md
rg -q '^## Working with Cloudflare$' /tmp/zeke-agents-current.md
rg -q '^## Browser Automation$' /tmp/zeke-agents-current.md
rg -q '^## Self-improvement$' /tmp/zeke-agents-current.md
```

Expected: all commands exit 0. If any command fails, stop and re-plan from the new upstream file.

- [ ] **Step 3: Verify Codex docs assumptions before editing**

Run:

```bash
set -euo pipefail
rg -q 'Codex Agent Tool Routing' /Users/philipbankier/.codex/AGENTS.md
test -f /Users/philipbankier/.codex/hooks.json
test -f /Users/philipbankier/.codex/config.toml
```

Expected: all commands exit 0. If `/Users/philipbankier/.codex/AGENTS.md` no longer contains the Browser/Peekaboo routing section, stop and re-check current global guidance before editing.

- [ ] **Step 4: Verify cleanup targets are not tracked**

Run:

```bash
set -euo pipefail
cd /Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools
git ls-files '*CLAUDE.md' 'AGENT_STATE.md' 'AGENT_HANDOFF.md' '.claude/**' '.agent/**' '.codex/**'
```

Expected: no output. If anything prints, stop. Do not delete tracked files without a new plan.

- [ ] **Step 5: Classify cleanup targets**

Run:

```bash
set -euo pipefail
cd /Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools
git status --short --ignored -- .codex .claude .agent AGENT_STATE.md AGENT_HANDOFF.md '*CLAUDE.md'
git check-ignore -v .agent/policy.json .claude/settings.local.json AGENT_STATE.md AGENT_HANDOFF.md CLAUDE.md || true
git check-ignore -v .codex/hooks.json || true
find .codex .claude .agent -maxdepth 5 -type f -print 2>/dev/null | sort
find . -path './.git' -prune -o \( -name 'CLAUDE.md' -o -name 'AGENT_STATE.md' -o -name 'AGENT_HANDOFF.md' \) -print | sort
```

Expected:

- `.codex/` appears as untracked, not ignored.
- `.agent/`, `.claude/`, `AGENT_STATE.md`, `AGENT_HANDOFF.md`, and `CLAUDE.md` files appear as ignored or local-only state.
- The file list includes no `.env`, OAuth, token, cookie, or credential files.

If any credential file appears, stop and do not archive or delete it.

## Task 2: Archive All State Before Deleting Anything

**Files:**
- Archive source: repo-local agent runtime/config files.
- Archive source: `/Users/philipbankier/.codex/AGENTS.md`
- Archive source: `/Users/philipbankier/AGENTS.md`
- Create: `/Users/philipbankier/.codex/archives/chrome-extension-powertools-agent-config-cleanup-<timestamp>/`

- [ ] **Step 1: Create timestamped archive folder**

Run:

```bash
set -euo pipefail
ARCHIVE="/Users/philipbankier/.codex/archives/chrome-extension-powertools-agent-config-cleanup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p /Users/philipbankier/.codex/archives
test ! -e "$ARCHIVE"
mkdir "$ARCHIVE"
printf '%s\n' "$ARCHIVE" > /tmp/grok-powertools-agent-cleanup-archive-path.txt
```

Expected: command exits 0.

- [ ] **Step 2: Archive repo-local agent state**

Run:

```bash
set -euo pipefail
cd /Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools
ARCHIVE="$(cat /tmp/grok-powertools-agent-cleanup-archive-path.txt)"
cat > "$ARCHIVE/repo-local-agent-state.targets" <<'EOF'
.codex
.claude
.agent
AGENT_STATE.md
AGENT_HANDOFF.md
CLAUDE.md
cloud/CLAUDE.md
cloud/src/CLAUDE.md
docs/CLAUDE.md
tests/e2e/CLAUDE.md
tests/unit/CLAUDE.md
web/CLAUDE.md
web/src/app/CLAUDE.md
web/src/app/api/video-meta/CLAUDE.md
web/src/app/collections/CLAUDE.md
web/src/app/share/CLAUDE.md
web/src/components/CLAUDE.md
web/src/components/auth/CLAUDE.md
web/src/components/collections/CLAUDE.md
web/src/components/dashboard/CLAUDE.md
web/src/components/editor/CLAUDE.md
web/src/components/layout/CLAUDE.md
web/src/components/movie/CLAUDE.md
web/src/components/onboarding/CLAUDE.md
web/src/components/settings/CLAUDE.md
web/src/components/ui/CLAUDE.md
web/src/components/video/CLAUDE.md
web/src/lib/CLAUDE.md
EOF
while IFS= read -r target; do test -e "$target"; done < "$ARCHIVE/repo-local-agent-state.targets"
while IFS= read -r target; do
  if test -d "$target"; then
    find "$target" -type f -print
  else
    printf '%s\n' "$target"
  fi
done < "$ARCHIVE/repo-local-agent-state.targets" | sort > "$ARCHIVE/repo-local-agent-state.file-manifest"
if rg -il --hidden --no-ignore -e 'api[_ -]?key|token|secret|password|cookie|bearer|oauth|client_secret|private key|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}' $(cat "$ARCHIVE/repo-local-agent-state.targets"); then
  exit 1
fi
while IFS= read -r file; do shasum -a 256 "$file"; done < "$ARCHIVE/repo-local-agent-state.file-manifest" > "$ARCHIVE/repo-local-agent-state.files.sha256"
tar -cf "$ARCHIVE/repo-local-agent-state.tar" -T "$ARCHIVE/repo-local-agent-state.targets"
shasum -a 256 "$ARCHIVE/repo-local-agent-state.tar" > "$ARCHIVE/repo-local-agent-state.tar.sha256"
```

Expected: command exits 0. If a listed file is missing, the content secret scan matches, or the manifest is unexpected, stop and ask before archiving or deleting anything.

- [ ] **Step 3: Archive global and home AGENTS files**

Run:

```bash
set -euo pipefail
ARCHIVE="$(cat /tmp/grok-powertools-agent-cleanup-archive-path.txt)"
cp /Users/philipbankier/.codex/AGENTS.md "$ARCHIVE/codex-AGENTS.before.md"
cp /Users/philipbankier/AGENTS.md "$ARCHIVE/home-AGENTS.before.md"
shasum -a 256 "$ARCHIVE/codex-AGENTS.before.md" "$ARCHIVE/home-AGENTS.before.md" > "$ARCHIVE/global-agents-before.sha256"
```

Expected: command exits 0.

- [ ] **Step 4: Verify archive integrity before mutation**

Run:

```bash
set -euo pipefail
ARCHIVE="$(cat /tmp/grok-powertools-agent-cleanup-archive-path.txt)"
test -f "$ARCHIVE/repo-local-agent-state.tar"
test -f "$ARCHIVE/repo-local-agent-state.tar.sha256"
test -f "$ARCHIVE/repo-local-agent-state.file-manifest"
test -f "$ARCHIVE/repo-local-agent-state.files.sha256"
test -f "$ARCHIVE/codex-AGENTS.before.md"
test -f "$ARCHIVE/home-AGENTS.before.md"
shasum -a 256 -c "$ARCHIVE/repo-local-agent-state.tar.sha256"
shasum -a 256 -c "$ARCHIVE/repo-local-agent-state.files.sha256"
shasum -a 256 -c "$ARCHIVE/global-agents-before.sha256"
```

Expected: all commands exit 0. Do not delete or edit anything unless this passes.

## Task 3: Delete Archived Repo-Local Runtime State

**Files:**
- Delete: archived repo-local `.codex/`, `.claude/`, `.agent/`, `AGENT_STATE.md`, `AGENT_HANDOFF.md`, and ignored `CLAUDE.md` files only.

- [ ] **Step 0: Re-verify archived source state has not changed**

Run:

```bash
set -euo pipefail
cd /Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools
ARCHIVE="$(cat /tmp/grok-powertools-agent-cleanup-archive-path.txt)"
while IFS= read -r target; do
  if test -d "$target"; then
    find "$target" -type f -print
  else
    printf '%s\n' "$target"
  fi
done < "$ARCHIVE/repo-local-agent-state.targets" | sort > /tmp/grok-powertools-agent-state.current-files
cmp /tmp/grok-powertools-agent-state.current-files "$ARCHIVE/repo-local-agent-state.file-manifest"
shasum -a 256 -c "$ARCHIVE/repo-local-agent-state.files.sha256"
shasum -a 256 -c "$ARCHIVE/repo-local-agent-state.tar.sha256"
```

Expected: all commands exit 0. If the manifest or checksums differ, stop and ask before deleting anything.

- [ ] **Step 1: Delete archived runtime directories and top-level handoff files**

Run:

```bash
set -euo pipefail
cd /Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools
rm -rf .codex .claude .agent AGENT_STATE.md AGENT_HANDOFF.md
```

Expected: command exits 0. This intentionally retires the untracked project-local `.codex/hooks.json` after archive because the hook stack was reviewed and judged stale/broken.

- [ ] **Step 2: Delete archived ignored CLAUDE.md files**

Run:

```bash
set -euo pipefail
cd /Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools
rm -f \
  CLAUDE.md \
  cloud/CLAUDE.md \
  cloud/src/CLAUDE.md \
  docs/CLAUDE.md \
  tests/e2e/CLAUDE.md \
  tests/unit/CLAUDE.md \
  web/CLAUDE.md \
  web/src/app/CLAUDE.md \
  web/src/app/api/video-meta/CLAUDE.md \
  web/src/app/collections/CLAUDE.md \
  web/src/app/share/CLAUDE.md \
  web/src/components/CLAUDE.md \
  web/src/components/auth/CLAUDE.md \
  web/src/components/collections/CLAUDE.md \
  web/src/components/dashboard/CLAUDE.md \
  web/src/components/editor/CLAUDE.md \
  web/src/components/layout/CLAUDE.md \
  web/src/components/movie/CLAUDE.md \
  web/src/components/onboarding/CLAUDE.md \
  web/src/components/settings/CLAUDE.md \
  web/src/components/ui/CLAUDE.md \
  web/src/components/video/CLAUDE.md \
  web/src/lib/CLAUDE.md
```

Expected: command exits 0.

- [ ] **Step 3: Verify deleted files no longer appear**

Run:

```bash
set -euo pipefail
cd /Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools
find . -path './.git' -prune -o \( -path './.codex' -o -path './.claude' -o -path './.agent' -o -name 'CLAUDE.md' -o -name 'AGENT_STATE.md' -o -name 'AGENT_HANDOFF.md' \) -print | sort
```

Expected: no output.

## Task 4: Merge Adapted zeke Guidance Into Global Codex AGENTS

**Files:**
- Modify: `/Users/philipbankier/.codex/AGENTS.md`
- Leave unchanged: `/Users/philipbankier/AGENTS.md`

- [ ] **Step 1: Confirm tool availability truthfully**

Run:

```bash
set -euo pipefail
for bin in agent-browser plwr gh glab npx; do
  if command -v "$bin" >/dev/null 2>&1; then
    printf '%s %s\n' "$bin" "$(command -v "$bin")"
  else
    printf '%s MISSING\n' "$bin"
  fi
done
```

Expected: command exits 0. Missing tools do not block the AGENTS update because the rule says to prefer `agent-browser` and `plwr` when available and verify before use.

- [ ] **Step 2: Update `/Users/philipbankier/.codex/AGENTS.md` using `apply_patch`**

Use `apply_patch`, not shell redirection. Replace the file content with:

```markdown
# Codex Agent Tool Routing

## Browser And Desktop Automation

- For websites, localhost apps, file URLs, and UI that is fully inside the browser, follow the Browser Automation precedence below: prefer `agent-browser` and `plwr` when available and appropriate; otherwise use Browser/browser-use unless project or user instructions explicitly prefer another browser automation tool.
- Use Peekaboo when a task requires native macOS UI state or control that Browser/browser-use cannot reach: desktop apps, system dialogs, app windows, menu bar, Dock, Spaces, clipboard, screenshots, and direct Accessibility actions.
- Before using Peekaboo for element interactions, capture fresh state with `peekaboo see --json` and use snapshot or element IDs when practical.
- Confirm `peekaboo permissions status --json` when capture or automation fails before treating it as an application bug.

## Working with me

- Be direct. No glazing. Never write "You're absolutely right!" or similar sycophantic openers.
- Push back with specific reasons when you disagree. If it's a gut feeling, say so.
- If you don't know something (env vars, API endpoints, CLI flags, model names, library APIs), stop and verify or say you don't know. Never invent technical details.
- Your training data is stale. Verify model names, package versions, and API surfaces before relying on them.
- Don't say a task is done until typechecks, linters, and tests pass. If none are configured, say so explicitly instead of claiming success.
- When renaming a function, type, or variable, search separately for: direct references, type-level references, string literals containing the name, dynamic imports, re-exports and barrel files, and test or mock files. One grep is not enough.

## Before coding

- State assumptions explicitly before implementing. If uncertain, ask.
- If multiple interpretations of a request exist, present them, don't pick silently.
- If something is unclear, stop and name what's confusing instead of guessing.
- Write the minimum code that solves the problem. No speculative features, no abstractions for single-use code, no configurability that wasn't asked for.
- Don't add error handling for impossible scenarios.
- Touch only what the task requires. Don't "improve" adjacent code, comments, or formatting.
- Match existing style in a file, even if you'd write it differently.
- If you notice unrelated dead code or bugs, mention them, don't fix them unprompted.
- Clean up orphans your changes create (unused imports, variables). Don't remove pre-existing dead code unless asked.
- When reviewing hooks before enabling or deleting them, give a keep/delete recommendation per hook, not just an inventory.

## Running scripts and commands

- Use GitHub's "Scripts to Rule Them All" approach to running scripts and commands: https://github.com/github/scripts-to-rule-them-all
- If the project has a "scripts" or "script" directory, run those scripts for tasks like testing, linting, formatting, etc.
- If no "scripts" or "script" directory exists, use the project commands documented in AGENTS.md, HACKING.md, README.md, or package.json.
- If the project has a `script/lint` or `scripts/lint` script, run it before committing changes with Git.
- If linting fails, fix the linting errors and run the linter until all the errors are resolved.

## Working with Git

- When creating git commits, always use a semantic commit prefixes, with or without parenthetical qualifiers.
- When opening pull requests or merge requests, always use a semantic commit message as the title.
- Never bypass pre-commit hooks. Never use `--no-verify` or equivalent flags without explicit permission.

## Working with Node.js and npm

- Always use `npx` when running global npm CLIs, e.g. `npx wrangler` instead of `wrangler`

## Working with Cloudflare

- Prefer JSONC for new Workers configs, but respect existing repo config formats to avoid unrelated churn.
- Use .env files for secrets and environment variables. Don't use .dev.vars as those are Cloudflare-specific. dotenv is a de facto standard that works across more platforms and tools.
- Always use the latest verions of Wrangler and Cloudflare's npm packages.
- Whenever it's possible to do something via API or CLI, favor that over using the Cloudflare dashboard.
- Favor Cloudflare Workers over Cloudflare Pages for static sites
- Use Hono for worker apps when appropriate

## Working with GitHub and GitLab

- Use `gh` for GitHub repositories and `glab` for GitLab repositories.
- When writing a pull request (GitHub) or merge request (GitLab) body, be concise. Explain the problem and the solution succinctly.
- Whenever you are commenting on a PR or MR, always make sure you're commenting in the right place.
- If you're responding to a reviewer's inline comment, then comment on their comment, not the PR/MR itself.
- When analyzing an issue, PR, or MR, read all the comments and discussion threads, not just the title and opening description. The context and nuance is often in the conversation.
- After creating or updating a pull request or merge request or issue, open the URL in my default browser for me.
- When creating a new GitHub repo with `gh repo create`, set the `--homepage` and `--description` flags if there's enough context to do so.

## Writing a good PR body

Follow these guidelines when writing the body of the pull request:

- Be concise and descriptive
- Don't oversell the changes. It's not an advertisement.
- Don't use fancy words like "comprehensive", "utilize", "implement", "exhaustive", "simplify", "optimize", "seamlessly"
- Start the PR body with the words "This PR..."
- Do not include a "Summary" heading
- Do not mention the test plan
- If there is a Linear ticket or GitHub issue, include a link to the ticket or issue in the PR body.
- If there is a GitLab issue, include a link to the issue in the MR body.

## Style guide

Follow these style guidelines in chat, commit messages, and prose:

- Be concise and descriptive
- Don't oversell the changes. It's not an advertisement.
- Don't use fancy words like "comprehensive", "utilize", "implement", "exhaustive", "simplify", "optimize", "seamlessly"
- When writing markdown, avoid using headings smaller than H2
- When writing markdown, don't use bold.
- When writing markdown tables, pad cells with spaces so columns align. This makes tables legible in monospace contexts like terminals.
- Never use em dashes (—). Use commas, colons, or separate sentences instead.

## Types and documentation

- Prefer types over prose documentation for API contracts. Types are executable and can't drift from the implementation.
- Define schemas (e.g. Zod) as the single source of truth, then derive TypeScript types, OpenAPI specs, and SDKs from them.
- Use schema-first design: the schema defines the contract, and the implementation conforms to it. Don't generate types from runtime behavior.
- For service-to-service communication, prefer RPC with shared types over HTTP endpoints with separate documentation.
- Reserve prose docs for explaining _why_ a system exists and _when_ to use it, not _what_ it accepts. Types handle the _what_.
- If an API is too complex to type, that's a design problem worth fixing.

## Fetching data

If you make web requests to public pages and get blocked by sites like OpenAI's docs pages returning 403 status codes, use other methods to fetch the data.

## Browser Automation

Use the following tools for browser automation tasks:

- https://agent-browser.dev - use the `agent-browser` CLI tool when available. Verify with `command -v agent-browser` before relying on it.
- https://github.com/andreasjansson/plwr for browser automation. Use the `plwr` CLI tool when available. Verify with `command -v plwr` before relying on it.
- Favor these CLI tools over any available MCP servers.
- IMPORTANT: Use Chrome DevTools MCP only when explicitly requested or when existing Chrome profile/session, cookies, extensions, or authenticated state are required.
- When using the Chrome DevTools MCP, connect only to my existing Chrome window/session. Do not start a separate Chrome profile or detached debugging browser unless I explicitly ask for it.
- When using the Chrome DevTools MCP, check for an existing tab already on the relevant page before opening a new one. If no such tab exists, open a new tab in the existing Chrome window/session. Don't navigate away from or overtake unrelated existing tabs.
- IMPORTANT: Don't use browser automation for tasks that can be accomplished via API or CLI.

## Secrets and credentials

- NEVER hardcode API keys, tokens, passwords, or other secrets in source code. Always read them from environment variables.
- Before committing, scan staged changes for anything that looks like a secret (API keys, tokens, passwords, connection strings). If found, stop and flag it.
- Secrets belong in `.env` files (which must be in `.gitignore`), not in source code.
- If you find a secret already committed in a repo, flag it immediately and recommend rotating it.

## Important rules

- IMPORTANT: NEVER PUSH TO THE MAIN OR DEFAULT BRANCH. ALWAYS PUSH TO A FEATURE BRANCH.
- IMPORTANT: If your last message included HTTP or HTTPS URLs, offer to open those for me in my default browser.
- Don't push commits to branches with PRs that have already been merged.

## General advice

- Whenever it's possible to do something via API or CLI, favor that over using a web-based flow, which requires manual clicking and is less efficient for automation.
- Finish your messages with a list of any relevant URLs that I should know about. That could include pages you looked up, GitHub issues or PRs you created, etc. No need to repeat them too many times.
- Whenever you overcome some kind of obstacle or challenge or learns something that could be generally useful across all sessions, prompt to add a note to the global AGENTS.md file so that the future sessions can benefit. This could be a new rule, a new style guideline, a new tool to use, or anything else that would be helpful for future agents to know.

## Self-improvement

- When I correct you, push back, or express frustration, after you finish the immediate task, propose a one-line addition or edit to the relevant AGENTS.md so the same mistake doesn't recur.
- Decide scope explicitly. Global (your global AGENTS.md) if the rule applies across all my projects. Project (`./AGENTS.md`) if it only applies to this codebase. Neither if it's a one-off. State your scope decision and why before proposing the edit.
- Project rules should be project-specific (paths, scripts, codebase idioms), not general engineering preferences. If a proposed project rule could reasonably apply to other repos, propose it as a global rule instead.
- Before proposing, search the relevant AGENTS.md for an existing rule that covers this. If one exists, propose tightening it, not adding a new bullet.
- Show me the proposed diff. Do not edit the file until I approve.
- Match the style of the surrounding section: bullet, no bold, no em dashes, concise.
- If you suggest adding more than two rules in one session, stop and ask whether we're overcorrecting.
- When an AGENTS.md grows past about 200 lines, propose deletions or consolidations alongside additions, not just additions.
- If I ask you to "audit AGENTS.md", read the whole file and propose a list of rules to delete because they're obsolete, duplicated, or never followed in practice, with one-sentence reasoning each.
- At the start of work in a new project, check whether the project has its own `AGENTS.md`. If it doesn't, suggest creating one and offer to draft it. AGENTS.md is for agents: technical instructions about the project (stack, scripts, conventions, gotchas, paths, build and test commands). Include an instruction in the project-level AGENTS.md to make it update itself when meaningful changes are made to the project.
- Also check whether the project has a `README.md`. If it doesn't, suggest creating one. README.md is for humans: what the project is, why it exists, and how a person gets started. Don't conflate the two. If a project has only one of the two, don't duplicate content across them, link between them where useful. Link to AGENTS.md from the README.md when relevant.
```

Expected: file is updated by patch. `/Users/philipbankier/AGENTS.md` is unchanged.

Before applying the patch, run:

```bash
set -euo pipefail
ARCHIVE="$(cat /tmp/grok-powertools-agent-cleanup-archive-path.txt)"
cmp /Users/philipbankier/.codex/AGENTS.md "$ARCHIVE/codex-AGENTS.before.md"
```

Expected: `/Users/philipbankier/.codex/AGENTS.md` still matches the archived checksum. If it changed after archiving, stop and re-plan instead of clobbering newer global instructions.

- [ ] **Step 3: Verify required adapted rules**

Run:

```bash
set -euo pipefail
rg -q 'follow the Browser Automation precedence' /Users/philipbankier/.codex/AGENTS.md
rg -q 'Use Peekaboo when a task requires native macOS UI state' /Users/philipbankier/.codex/AGENTS.md
rg -q 'agent-browser' /Users/philipbankier/.codex/AGENTS.md
rg -q 'plwr' /Users/philipbankier/.codex/AGENTS.md
rg -q 'existing Chrome window/session' /Users/philipbankier/.codex/AGENTS.md
rg -q 'Prefer JSONC for new Workers configs' /Users/philipbankier/.codex/AGENTS.md
rg -q 'When reviewing hooks before enabling or deleting them' /Users/philipbankier/.codex/AGENTS.md
```

Expected: all commands exit 0.

- [ ] **Step 4: Verify home AGENTS was not changed**

Run:

```bash
set -euo pipefail
ARCHIVE="$(cat /tmp/grok-powertools-agent-cleanup-archive-path.txt)"
cmp /Users/philipbankier/AGENTS.md "$ARCHIVE/home-AGENTS.before.md"
```

Expected: command exits 0.

## Task 5: Final Verification

**Files:**
- Read: repo status
- Read: archive files
- Read: `/Users/philipbankier/.codex/AGENTS.md`
- Read: `/Users/philipbankier/AGENTS.md`

- [ ] **Step 1: Verify archive remains valid**

Run:

```bash
set -euo pipefail
ARCHIVE="$(cat /tmp/grok-powertools-agent-cleanup-archive-path.txt)"
test -f "$ARCHIVE/repo-local-agent-state.tar"
shasum -a 256 -c "$ARCHIVE/repo-local-agent-state.tar.sha256"
shasum -a 256 -c "$ARCHIVE/global-agents-before.sha256"
```

Expected: all commands exit 0.

- [ ] **Step 2: Verify repo status**

Run:

```bash
set -euo pipefail
cd /Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools
git status --short --ignored | rg '(\.codex/|\.claude/|\.agent/|AGENT_STATE.md|AGENT_HANDOFF.md|CLAUDE.md)' || true
git status --short
```

Expected:

- First command produces no output.
- Second command shows no tracked changes except this plan file if it has not yet been committed.

- [ ] **Step 3: Verify current Codex instruction loading**

Run:

```bash
set -euo pipefail
cd /Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools
/Applications/Codex.app/Contents/Resources/codex debug prompt-input "Show which instruction files are active. Summarize only file paths." > /tmp/grok-powertools-codex-prompt-input.json
rg -q 'Codex Agent Tool Routing' /tmp/grok-powertools-codex-prompt-input.json
rg -q 'Grok Power Tools Agent Guide' /tmp/grok-powertools-codex-prompt-input.json
```

Expected: rendered prompt input includes the global Codex routing and repo `AGENTS.md` content. If `codex debug prompt-input` cannot run in this environment, fall back to `codex exec --ephemeral --sandbox read-only --ask-for-approval never --cd /Users/philipbankier/Development/skunkworks/Grok-Tinker/chrome-extension-powertools "Show which instruction files are active. Summarize only file paths."` and report the fallback explicitly.

- [ ] **Step 4: Report final state**

Report:

```text
Archived repo-local agent state before deletion.
Deleted stale repo-local agent runtime files after archive verification.
Updated /Users/philipbankier/.codex/AGENTS.md using apply_patch.
Preserved /Users/philipbankier/AGENTS.md unchanged.
Kept agent-browser/plwr guidance with availability checks.
Kept Chrome DevTools MCP existing-window/session rule.
Left tracked repo AGENTS.md unchanged.
```

## Self-Review

- Spec coverage: The revised plan covers independent-audit findings, backup-before-delete, current upstream refresh, Codex docs assumptions, project-local hook safety, global AGENTS merge, home AGENTS preservation, `agent-browser`/`plwr`, and existing-window Chrome DevTools MCP rules.
- Placeholder scan: No TBD, TODO, "similar to", or unspecified validation steps.
- Type consistency: No code types are introduced. Paths and filenames are consistent across tasks.
