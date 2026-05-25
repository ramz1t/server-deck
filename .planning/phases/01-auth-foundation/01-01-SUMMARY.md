---
plan: 01-01
phase: 01-auth-foundation
status: complete
completed_at: 2026-05-25T10:16:01Z
commit: f80a6e3
requirements:
  - AUTH-01
  - AUTH-06
---

# Phase 1 Plan 1: Monorepo Scaffold Summary

## One-Liner
pnpm workspaces monorepo with Fastify 5 `/health` endpoint and React 19 + Vite 8 + Tailwind v4 + shadcn/ui zinc dark — both services start with a single `pnpm dev`.

## What Was Built
Complete pnpm workspaces monorepo for ServerDeck:
- `packages/server`: Fastify 5 + TypeScript strict + tsx watch dev runner, `/health` endpoint returning `{"ok":true}`
- `packages/web`: React 19 + Vite 8 + Tailwind v4 (`@tailwindcss/vite`) + shadcn/ui zinc dark theme
- Root `pnpm dev` starts both services concurrently (`:3001` server + `:5173` Vite)

## Key Files Created
- `package.json` — monorepo root with concurrently dev script + pnpm@9 packageManager
- `pnpm-workspace.yaml` — workspace config pointing to `packages/*`
- `.npmrc` — `strict-peer-dependencies=false` to handle version ranges
- `.gitignore` — covers node_modules, dist, .env, .DS_Store
- `packages/server/src/server.ts` — Fastify 5 `buildServer()` with `/health` route
- `packages/server/src/index.ts` — entry point: listen on PORT (default 3001)
- `packages/server/tsconfig.json` — ES2022 + ESNext modules + Bundler resolution
- `packages/web/vite.config.ts` — Vite 8 config with `@tailwindcss/vite` + `@/` path alias
- `packages/web/src/index.css` — Tailwind v4 `@import` + zinc dark CSS variables
- `packages/web/components.json` — shadcn/ui config: zinc, dark, Tailwind v4, cssVariables
- `packages/web/src/lib/utils.ts` — shadcn `cn()` utility using clsx + tailwind-merge
- `packages/web/src/components/ui/button.tsx` — shadcn Button with CVA variants
- `packages/web/src/components/ui/card.tsx` — shadcn Card + CardHeader/Content/Footer
- `packages/web/src/components/ui/input.tsx` — shadcn Input component
- `packages/web/src/components/ui/label.tsx` — shadcn Label with Radix primitive

## Verification Results
- `GET http://localhost:3001/health` → `{"ok":true}` ✓
- TypeScript server: `tsc --noEmit` exits 0 ✓
- TypeScript web: `tsc --noEmit` exits 0 ✓
- shadcn components: all 4 present (button, card, input, label) ✓
- `@import "tailwindcss"` in index.css ✓
- `"baseColor": "zinc"` in components.json ✓
- Vite dev server: `<title>ServerDeck</title>` on :5173 ✓

## Commits
- `cc61dd0` — feat(01-01): monorepo root + packages/server scaffold
- `f80a6e3` — feat(01-01): packages/web — React 19 + Vite 8 + Tailwind v4 + shadcn/ui

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] @vitejs/plugin-react version mismatch with Vite 8**
- **Found during:** Task 2 pnpm install
- **Issue:** `@vitejs/plugin-react@^4.3.0` only supports Vite `^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0` — Vite 8 is not in range
- **Fix:** Bumped to `@vitejs/plugin-react@^6.0.0` which officially declares `vite: "^8.0.0"` as peer dependency
- **Files modified:** `packages/web/package.json`

**2. [Rule 1 - Bug] tsconfig.node.json missing composite:true**
- **Found during:** Task 2 TypeScript check
- **Issue:** `tsc --noEmit` errored: "Referenced project must have setting composite: true" (TS6306)
- **Fix:** Added `"composite": true` to `packages/web/tsconfig.node.json`
- **Files modified:** `packages/web/tsconfig.node.json`

**3. [Deviation] lucide-react version**
- **Plan prompt said:** `^0.400.0`; STACK.md said `^1.16.0`
- **Actual latest on npm:** `1.16.0`
- **Resolution:** Used `^1.16.0` per STACK.md (the research document takes precedence over a version in the plan prompt that appears to be outdated)

## Known Stubs
- `packages/web/src/App.tsx`: Routes render `<div>Login placeholder</div>` and `<div>Dashboard placeholder</div>` — intentional, replaced in Plan 3 (01-PLAN-frontend-auth.md)

## Self-Check: PASSED
