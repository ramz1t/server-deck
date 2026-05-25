---
phase: 2
plan: 2
name: container-ui
wave: 2
title: Container dashboard UI with TanStack Query
---

# Plan 02-02: Container Dashboard UI

## Goal
Replace the Phase 1 dashboard stub with a fully functional container list. Users can see all containers, their status, and perform start/stop/restart actions with a confirmation guard on Stop.

## Dependencies
- Wave 1 (`02-PLAN-docker-api.md`) must complete first — the REST endpoints must exist before this plan executes.

## Files to Create / Modify

### New Files
- `packages/web/src/components/ContainerCard.tsx` — single container row/card
- `packages/web/src/components/ui/badge.tsx` — shadcn Badge component
- `packages/web/src/components/ui/alert-dialog.tsx` — shadcn AlertDialog component
- `packages/web/src/components/ui/skeleton.tsx` — shadcn Skeleton component

### Modified Files
- `packages/web/src/pages/DashboardPage.tsx` — replace stub with real container list
- `packages/web/src/main.tsx` — wrap app in QueryClientProvider
- `packages/web/package.json` — add @tanstack/react-query

## Tasks

### Task 1: Install frontend dependencies
```bash
cd packages/web
pnpm add @tanstack/react-query
```

### Task 2: Add shadcn components
```bash
cd packages/web
npx shadcn@latest add badge alert-dialog skeleton
```

### Task 3: Wrap app in QueryClientProvider in `packages/web/src/main.tsx`
```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const queryClient = new QueryClient()

// Wrap <App /> in <QueryClientProvider client={queryClient}>
```

### Task 4: Create `packages/web/src/components/ContainerCard.tsx`

Full component with:
- Container name (first of names array, bold)
- Image name (muted, small)
- State badge (color-coded)
- Status text (uptime: e.g. "Up 2 hours")
- Action buttons based on state:
  - `running` → Restart (outline) + Stop (destructive outline)
  - `exited`/`dead`/`created` → Start (outline)
  - `paused` → Start (outline)
  - `restarting` → disabled spinner
- AlertDialog confirmation before Stop

Badge color logic:
- `running` → `bg-green-500/15 text-green-400 border border-green-500/30`
- `exited`/`dead` → default zinc muted
- `paused` → `bg-yellow-500/15 text-yellow-400 border border-yellow-500/30`
- `created`/`restarting` → `bg-blue-500/15 text-blue-400 border border-blue-500/30`

### Task 5: Replace `packages/web/src/pages/DashboardPage.tsx`

Full implementation with:
- Header bar: ServerDeck title + "Connected to {host}" + Log out button
- `useQuery({ queryKey: ['containers'], queryFn: fetchContainers, refetchInterval: 5000 })`
- `useMutation` for each action (start/stop/restart) with `onSuccess` invalidating `['containers']`
- Loading state: 3 skeleton cards
- Error state: error message with Retry button
- Empty state: "No containers found" message
- Container list: map over containers, render ContainerCard

### Task 6: Wire axios API calls

In `packages/web/src/lib/axios.ts` (or new file):
```typescript
export const fetchContainers = async (): Promise<ContainerInfo[]> => {
  const { data } = await api.get('/containers')
  return data
}

export const containerAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
  const { data } = await api.post(`/containers/${id}/${action}`)
  return data
}
```

## Component Design

### DashboardPage layout
```
┌─────────────────────────────────┐
│  ⬡ ServerDeck        [Log out] │  ← sticky header
│  Connected to 192.168.1.100    │
├─────────────────────────────────┤
│  ┌─────────────────────────┐   │
│  │ nginx          [running] │   │
│  │ nginx:latest             │   │
│  │ Up 2 hours               │   │
│  │         [Restart] [Stop] │   │
│  └─────────────────────────┘   │
│  ┌─────────────────────────┐   │
│  │ postgres       [exited]  │   │
│  │ postgres:15              │   │
│  │ Exited (0) 3 days ago    │   │
│  │                  [Start] │   │
│  └─────────────────────────┘   │
└─────────────────────────────────┘
```

## Verification

After implementation:
```bash
# TypeScript clean
cd packages/web && npx tsc --noEmit
# Expected: 0 errors

# Check QueryClientProvider wraps App
grep -r "QueryClientProvider" packages/web/src/main.tsx
# Expected: match found

# Check ContainerCard exists with all states
grep -r "useMutation\|useQuery" packages/web/src/pages/DashboardPage.tsx
# Expected: match found

# Check AlertDialog for stop confirmation
grep -r "AlertDialog" packages/web/src/components/ContainerCard.tsx
# Expected: match found
```

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| XSS via container names | React's JSX auto-escapes all string values rendered in the DOM |
| Accidental stop (fat finger on mobile) | AlertDialog confirmation required before Stop |
| Stale container state | 5s refetchInterval ensures data is never more than 5s stale |
| Action on wrong container | Container ID from list data (server-authoritative), not user input |
