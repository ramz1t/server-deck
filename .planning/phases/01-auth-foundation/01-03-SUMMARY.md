---
plan: 01-03
phase: 01-auth-foundation
status: complete
completed_at: 2026-05-25T12:28:40Z
commit: a75700e
subsystem: frontend-auth
tags: [react, axios, vite-proxy, protected-route, login-form, walking-skeleton]
dependency_graph:
  requires: [01-01-scaffold, 01-02-backend-auth]
  provides: [walking-skeleton-e2e, login-ui, protected-routing, dashboard-stub]
  affects: [packages/web/src]
tech_stack:
  added: [axios@1.7, lucide-react icons]
  patterns: [axios-interceptor-401-redirect, vite-proxy-dev, outlet-context-auth-state]
key_files:
  created:
    - packages/web/src/lib/axios.ts
    - packages/web/src/pages/LoginPage.tsx
    - packages/web/src/pages/DashboardPage.tsx
    - packages/web/src/components/ProtectedRoute.tsx
  modified:
    - packages/web/src/App.tsx
    - packages/web/vite.config.ts
decisions:
  - "aria-busy uses string value ('true'/'false') per React's HTMLAttributes type constraint"
  - "AlertCircle imported by alias name (backed by CircleAlert in lucide-react v1.16)"
  - "401 interceptor redirects via window.location.href; LoginPage .catch(()=>{}) prevents loop"
metrics:
  duration: "~15 minutes"
  completed_date: "2026-05-25"
  tasks_completed: 2
  files_changed: 6
---

# Phase 1 Plan 03: Frontend Auth — Walking Skeleton Complete

## One-liner
React login form (zinc dark, 4-field, iOS-safe) + Axios 401 interceptor + Vite /api proxy + ProtectedRoute + Dashboard stub completing the full E2E walking skeleton.

## What Was Built

Complete frontend authentication experience for ServerDeck:

- **Axios client** (`src/lib/axios.ts`): `baseURL='/api'`, `withCredentials: true`, 401 interceptor → `window.location.href = '/login'`
- **Vite proxy** (`vite.config.ts`): `/api/*` → `http://localhost:3001` with `changeOrigin: true` — enables cookies in dev without CORS issues
- **LoginPage** (`src/pages/LoginPage.tsx`): 4-field zinc dark card per UI-SPEC; localStorage pre-fill for host/port/username; iOS zoom prevention (`text-base` on all 4 inputs); loading/error states; accessibility (`role="alert"`, `aria-busy`, `aria-label`, `aria-pressed`); password never persisted
- **ProtectedRoute** (`src/components/ProtectedRoute.tsx`): calls `/api/auth/me` on mount; spinner while loading; `<Navigate to="/login" replace />` on 401; passes `host` via `<Outlet context>`
- **DashboardPage** (`src/pages/DashboardPage.tsx`): "Connected to {host}" + Log out button → `POST /api/auth/logout` → navigate to /login
- **App.tsx**: Final BrowserRouter routing — `/login` public, `/` nested under ProtectedRoute with DashboardPage index

## E2E Walking Skeleton Status

Full vertical slice operational:
```
Login form → POST /api/auth/login → SSH validates → JWT cookie set
→ ProtectedRoute reads /api/auth/me → Dashboard shows "Connected to {host}"
→ Log out → cookie cleared → back to /login
```

## Verification Results

| Check | Result |
|-------|--------|
| TypeScript (server) | ✓ no errors |
| TypeScript (web) | ✓ no errors |
| `text-base` on all 4 inputs (iOS zoom fix) | ✓ count=4 |
| `role="alert"` on error area | ✓ count=1 |
| Vite proxy config present | ✓ |
| `Navigate` to `/login` in ProtectedRoute | ✓ |
| `auth/logout` in DashboardPage | ✓ |
| `ProtectedRoute` in App.tsx | ✓ count=2 |
| GET `/health` → `{"ok":true}` | ✓ |
| GET `http://localhost:5173/api/auth/me` via proxy → 401 | ✓ |
| Frontend HTML served at 5173 | ✓ |

## Key Files Created/Modified

- `packages/web/src/lib/axios.ts` — Axios instance with withCredentials + 401 interceptor
- `packages/web/vite.config.ts` — proxy `/api/*` → `http://localhost:3001` added
- `packages/web/src/pages/LoginPage.tsx` — login form per UI-SPEC (zinc dark card, iOS-safe)
- `packages/web/src/components/ProtectedRoute.tsx` — auth gate with spinner + redirect
- `packages/web/src/pages/DashboardPage.tsx` — dashboard stub with logout
- `packages/web/src/App.tsx` — final routing replacing wave-1 stubs

## Deviations from Plan

### Auto-adjustments (not deviations)

**`aria-busy` string cast** — React's `aria-busy` HTMLAttribute expects `boolean | "true" | "false"`. Used `aria-busy={isLoading ? 'true' : 'false'}` to satisfy TypeScript. Plan noted this as a known watch item. No behavior change.

**No other deviations** — plan executed exactly as written.

## Known Stubs

- `DashboardPage` — intentional stub (Phase 1 objective). Shows host + logout only. Full dashboard metrics are Phase 2+.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary changes introduced beyond what the plan specified.

## Self-Check: PASSED
