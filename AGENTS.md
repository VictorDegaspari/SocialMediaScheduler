# Agent entrypoint

Optimize for reliable agent changes and small, task-specific context. Keep semantic names and executable contracts; reduce duplication and unrelated context. Add abstractions only when they remove real repeated work.

## Context protocol

1. `./scripts/ctx map` lists areas; `./scripts/ctx map <area>` gives owned files, tests and optional docs. Read dependencies only when the change crosses that boundary.
2. `./scripts/ctx outline <file>` lists symbols/routes without bodies. For closures/classes: `outline <file>#<symbol>`; `--match=seek` searches nested symbols.
3. `./scripts/ctx show <file>#<symbol>` reads the exact AST range, including nested names (`CutsService.state`, `createCutEditor.read`). Output defaults to 6,000 characters; oversize selections fail explicitly. Use a narrower symbol before raising `--max-chars`.
4. `./scripts/ctx checks <area>` prints focused validation commands. Run those affected by the change. Broaden after cross-boundary changes or unresolved failures.

Do not eagerly read full source files, README, all docs, lockfiles, generated output or media. Search with `rg -n`/`rg --files`; inspect bounded context. Current source/AST is authoritative; `scripts/context-map.json` routes discovery and must track moved files. `./scripts/ctx check` validates its paths and source coverage.

## Execution

- Node >=22 via `scripts/node-local.sh`; TS ESM/Express/PostgreSQL/BullMQ; Vue views with browser ES-module controllers. Schema: `src/db.ts`; HTTP startup: `src/server.ts`. Never import the server for inspection.
- Instructions specific to backend, frontend, tests and scripts live in their local `AGENTS.md`; consult the relevant scope.
- Preserve existing work and staging. Keep patches scoped; no repository-wide reformatting or identifier shortening for byte count.
- Validate behavior at boundaries; reuse focused tests. Do not run real publishing/account operations to test a refactor. UI remains pt-BR.
- After finishing app changes, reload the running local app and verify its health and the changed behavior before reporting completion. With Docker Compose, use `docker compose up -d --build --no-deps --wait --wait-timeout 180 app`. Let active publishing and media processing finish before recreating the app.
- For requested video/live cuts, always download the best available source video quality and audio. Preserve that source quality independently of preview/export limits. Prioritize export quality over speed or file size, retain source frame rates and higher resolutions, and never reduce quality during upload.
- Keep entrypoints small and feature modules cohesive. Separate large presentation templates from orchestration where that reduces context. Comments describe non-obvious invariants; avoid parallel documentation of implementation details.
