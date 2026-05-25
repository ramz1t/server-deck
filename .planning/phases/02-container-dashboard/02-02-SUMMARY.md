---
phase: "02"
plan: "02"
subsystem: frontend
tags: [react, tanstack-query, shadcn, dashboard, containers]
dependency_graph:
  requires: ["02-01"]
  provides: ["container-dashboard-ui"]
  affects: ["packages/web/src"]
tech_stack:
  added:
    - "@tanstack/react-query ^5.100.14 — server state management with polling"
    - "shadcn/ui badge — status badge component"
    - "shadcn/ui alert-dialog — stop confirmation dialog"
    - "shadcn/ui skeleton — loading state placeholders"
  patterns:
    - "useQuery with refetchInterval for polling"
    - "useMutation with optimistic acting-container tracking via Set<string>"
    - "AlertDialog for destructive action confirmation"
key_files:
  created:
    - packages/web/src/components/ContainerCard.tsx
    - packages/web/src/components/ui/alert-dialog.tsx
    - packages/web/src/components/ui/badge.tsx
    - packages/web/src/components/ui/skeleton.tsx
  modified:
    - packages/web/src/main.tsx
    - packages/web/src/pages/DashboardPage.tsx
    - packages/web/package.json
    - pnpm-lock.yaml
decisions:
  - "Used onSuccess/onError separately instead of onSettled for mutation acting-container cleanup — avoids undefined first arg issue noted in plan"
  - "Kept badge colors as inline className per plan spec (not shadcn badge variants) for custom state colors"
  - "Mobile hostname shown below header on small screens, inline on sm+"
metrics:
  duration: "~3 minutes"
  completed: "2026-05-25"
  tasks_completed: 5
  files_changed: 8
---

# Phase 2 Plan 02: Container Dashboard UI Summary

**One-liner:** React container dashboard with TanStack Query 5s polling, per-container mutations, AlertDialog stop confirmation, and skeleton/error/empty states.

---

## What Was Built

Replaced the stub `DashboardPage` with a fully functional container management UI:

1. **`@tanstack/react-query` installed** — `QueryClientProvider` wraps `<App />` in `main.tsx` with `retry: 1, staleTime: 2000` defaults.

2. **shadcn components added** — `badge`, `alert-dialog`, `skeleton` via CLI (`npx shadcn@latest add`).

3. **`ContainerCard` component** — Displays container name, image, state badge (color-coded by state), human-readable status string, and action buttons:
   - `running` → Restart + Stop (Stop opens AlertDialog confirmation)
   - `exited/dead/created/paused` → Start
   - `restarting` → disabled spinner button
   - All action buttons: `min-h-[44px] h-11` for mobile tap targets

4. **`DashboardPage`** — Full TanStack Query integration:
   - `useQuery(['containers'])` with `refetchInterval: 5000` (5s auto-poll)
   - `useMutation` for start/stop/restart actions with `Set<string>` tracking acting containers
   - `onMutate` adds container ID to acting set; `onSuccess`/`onError` remove it and invalidate query
   - Loading: 3 skeleton cards
   - Error: red alert box with AlertCircle icon and Retry button
   - Empty: helpful "No containers" message with Server icon
   - Sticky header: ServerDeck branding, hostname (responsive), refresh icon, logout button

---

## Decisions Made

1. **onSuccess/onError vs onSettled for acting-container cleanup** — The plan noted `onSettled`'s first arg is undefined for void mutations. Used separate `onSuccess`/`onError` handlers that both receive `(data, variables)` correctly, accessing `variables.id` for cleanup.

2. **Badge as inline `<span>`** — Per plan spec, badge colors are inline className strings (not shadcn Badge variants) to support the custom `bg-green-500/15` / `text-green-400` Tailwind v4 opacity syntax.

3. **Mobile hostname placement** — Shows hostname inline in header on `sm+` screens; on mobile (`< sm`), rendered as a small muted line below the header bar to avoid crowding the button row.

---

## Deviations from Plan

None — plan executed exactly as written. The `onSettled` concern noted in "Important Notes" was addressed by using `onSuccess`/`onError` separately, which was one of the suggested alternatives.

---

## Verification Results

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| TypeScript `tsc --noEmit` | 0 errors | 0 errors | ✅ |
| `QueryClientProvider` in main.tsx | ≥ 2 | 3 | ✅ |
| `useQuery\|useMutation` in DashboardPage | ≥ 2 | 4 | ✅ |
| `AlertDialog` in ContainerCard | ≥ 1 | 26 | ✅ |
| Touch targets in ContainerCard | ≥ 1 match | 4 matches | ✅ |

---

## Known Stubs

None — all data flows from TanStack Query → API → ContainerCard. No placeholder or hardcoded values.

---

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary changes introduced. UI-only plan consuming existing `/api/containers` and `/api/containers/:id/action` endpoints.

---

## Self-Check: PASSED

- `packages/web/src/components/ContainerCard.tsx` — FOUND ✅
- `packages/web/src/components/ui/alert-dialog.tsx` — FOUND ✅
- `packages/web/src/components/ui/badge.tsx` — FOUND ✅
- `packages/web/src/components/ui/skeleton.tsx` — FOUND ✅
- `packages/web/src/main.tsx` — modified ✅
- `packages/web/src/pages/DashboardPage.tsx` — modified ✅
- Commit `e114a6e` — FOUND ✅
