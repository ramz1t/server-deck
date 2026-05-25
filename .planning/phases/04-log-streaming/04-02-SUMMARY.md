# Phase 04 Plan 02 — Summary: Frontend Log View

**Status:** Complete  
**Wave:** 2  
**Commit:** `feat(04-02): add log streaming UI (useLogStream + LogPage + routing)`

## Tasks Completed

### Task 1: ansi-to-html + useLogStream hook
- Installed `ansi-to-html@0.7.2` in packages/web
- Created `packages/web/src/hooks/useLogStream.ts`
- Hook returns `{ lines: string[], connected: boolean }`
- WS URL: `/api/containers/${containerId}/logs`
- 5000-line cap: `next.slice(next.length - 5000)` in functional state updater
- Exponential backoff reconnect (1s → 30s) with `cancelled` flag
- Cleanup closes WS → triggers `stream.destroy()` on server (LOGS-04)

### Task 2: LogPage component
- Created `packages/web/src/pages/LogPage.tsx`
- `new Convert({ escapeXML: true, stream: true })` at module level (XSS safety)
- Sticky header: ArrowLeft back button + container name + live/disconnected badge
- Smart auto-scroll: pauses when >50px from bottom, Resume button re-enables
- `dangerouslySetInnerHTML={{ __html: html }}` for ANSI-converted lines
- try/catch around `converter.toHtml(line)` returns `''` on binary/malformed data

### Task 3: ContainerCard + App.tsx + DashboardPage wiring
- Added `onLogs: (id: string) => void` prop to ContainerCardProps
- Added `<Button variant="ghost">Logs</Button>` before state-conditional buttons
- Added `import { LogPage } from './pages/LogPage'` to App.tsx
- Added `<Route path="logs/:containerId" element={<LogPage />}>` nested in ProtectedRoute
- Added `handleLogs` in DashboardPage: `navigate('/logs/${id}', { state: { name } })`
- Passed `onLogs={handleLogs}` to all ContainerCard usages (single render site)

## Verification
- `npx tsc --noEmit` (packages/web): ✅ clean
- ansi-to-html in package.json: ✅
- escapeXML: true: ✅
- 5000-line cap: ✅
- onLogs prop: ✅
- logs/:containerId route: ✅
- state.name in navigate: ✅

## Key Decisions Applied
- D-P4-01: Logs button on ContainerCard (ghost variant, always visible)
- D-P4-02: Container name via router state
- D-P4-03: /logs/:containerId full-page route, ProtectedRoute wrapped
- D-P4-04: Back arrow + name + live badge header
- D-P4-10/11: ansi-to-html + dangerouslySetInnerHTML
- D-P4-12/13: Smart auto-scroll + Resume button
- D-P4-14: useLogStream returns { lines, connected }
- D-P4-15: 5000-line cap
