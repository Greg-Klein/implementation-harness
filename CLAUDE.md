# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Two things in one repo:

1. **A Claude Code plugin** (`.claude-plugin/`, `commands/`, `agents/`, `hooks/`). `/implementation-harness:implement` drives a GitLab ticket end to end (clarify, plan, implement, test, specialized reviews, MR). `improve` and `rebase` run the self-improvement loop on this repo itself; `review` is the review step.
2. **A local console** (`console/`): a Next.js UI plus a Node server that spawns the real `claude` binary in a PTY (`claude --plugin-dir <this repo> "/implementation-harness:implement <ticket>"`), and makes its progress, agents, questions and documents visible. No direct Anthropic API calls, no API key.

`bin/implementation-harness` is the `impl` launcher (start/demo/restart/stop/status/config/improve). `bin/config.mjs` + `env-schema.mjs` + `env-file.mjs` implement `impl config` over a local `.env` (shell env > `.env` > defaults, see `.env.example`).

## Commands

All from `console/` (Node >= 22):

```bash
npm install                  # node-pty is native, needs build tools
npm run dev                  # tsx server/index.ts, http://127.0.0.1:3210
npm run typecheck            # tsc --noEmit
npm run test:unit            # Jest (swc), tests/unit/*.test.ts
npx jest tests/unit/hooks.test.ts -t "should ..."   # single unit test
npm run test:integration     # Playwright, starts an isolated dev server on :3211 (500ms demo steps, no local .env)
npx playwright test tests/integration/questions.spec.ts   # single spec
npm run build                # next build --webpack
```

CI (`.github/workflows/ci.yml`) runs typecheck, unit, build, integration. Run the same before calling work done.

`impl demo` (or the demo mode in the UI) replays a simulated run from `server/demo.ts` / `demo-data.ts` without touching any repo or GitLab. Integration tests lean on it.

## Architecture

Flow: Claude Code session (PTY) -> plugin hooks (`hooks/hooks.json` -> `hooks/emit.mjs` POSTs to the local server) -> `server/engine` translates raw hook payloads into `EngineEvent`s -> `server/hooks.ts` applies them to run state -> WebSocket -> React UI (`components/harness.tsx` and panels).

- `server/engine/` is **the only code that knows the driven agent is Claude Code**: binary, hook vocabulary, transcript JSONL format, how to submit input, `.claude/tasks` path, `hookSpecificOutput`. Nothing above it may import `node-pty` or read `hook_event_name`. Contract in `engine/types.ts`, rationale in `engine/README.md`. Keep new agent-specific logic there.
- Blocking questions: the `PreToolUse` hook on `AskUserQuestion` (timeout 3600s) waits for the UI answer, which returns as `updatedInput`. Claude Code replays the hook with answers; the engine ignores that second pass.
- `server/domain.ts`: pure logic, no FS/agent. Prefer putting logic here or in `engine/` so it is unit-testable.
- `server/context.ts`: shared mutable `ctx.state` + `activity()`/`publishState()`. On boot, non-terminal runs are reclassified `failed`.
- `server/artifacts.ts`: watches the target repo's `.claude/` (restricted to `tasks/`, because the workflow deletes and recreates `tasks/`) and copies documents into the run archive. Only files written since run start count.
- `server/transcript.ts`: tails the session transcript for the conversation panel (lags behind the terminal by design).
- `server/self-improvement.ts` + `worktree.ts`: feedback/self-audit storage, `self-improvement-*` worktrees, auto-rebase on HEAD moves, merge simulation via `git merge-tree --write-tree`, one improvement in flight at a time. Nothing is ever pushed or auto-merged; the UI merge button is the only promotion path.
- `server/repository.ts`: finds the GitLab checkout for a ticket by scanning `IMPL_SEARCH_ROOTS` two levels deep and reading `.git/config`.
- `lib/`: client-side helpers (run-state derivation, conversation, notifications, sound).

Runtime data lives in `console/data/runs/<run-id>/` (`run.json`, `terminal.log`, `artifacts/`). Gitignored and confidential (ticket content): never copy it into tracked files, commits or docs.

## Conventions

- Code, identifiers, comments and commit messages in English. User-facing UI text and READMEs in French.
- Commits: conventional prefixes (`fix:`, `feat:`, `chore:`), subject describes the behavior change in plain words. `self-improvement: apply improvements from self-improvement-<id>` is reserved for the improvement loop.
- Server modules are ESM and import siblings with the `.js` suffix (Jest maps it back).
- Unit tests: `describe(...)` + `it("should ...")`, one file per responsibility.
- Every `agents/*.md` and `commands/*.md` needs YAML frontmatter with `name` and `description` (enforced by `tests/unit/plugin-metadata.test.ts`).
- Editing `commands/` or `agents/` changes the workflow prompts run against real tickets; `implement.md` and agents are tightly coupled to Claude Code tool names.
- After changing server code, a running `impl` must be restarted (`impl restart`), otherwise it serves a stale Next manifest (unstyled page).
