---
phase: 05-ssh-terminal
plan: "02"
type: execute
wave: 2
depends_on:
  - "05-01"
files_modified:
  - packages/web/src/hooks/useTerminalSession.ts
  - packages/web/src/components/TouchToolbar.tsx
  - packages/web/src/pages/TerminalPage.tsx
  - packages/web/src/App.tsx
  - packages/web/src/pages/DashboardPage.tsx
  - packages/web/package.json
autonomous: true
requirements:
  - SSH-01
  - SSH-03
  - SSH-04
  - SSH-05
  - SSH-06
must_haves:
  truths:
    - "xterm.js terminal renders in TerminalPage and connects to /api/terminal WebSocket"
    - "Terminal fills calc(100dvh - var(--terminal-header-height) - var(--toolbar-height)) — dvh not svh"
    - "Touch toolbar (11 buttons) is fixed at bottom with env(safe-area-inset-bottom) padding"
    - "Toolbar Ctrl modifier arms on first tap (blue ring), sends ctrl sequence on next toolbar tap"
    - "ResizeObserver + FitAddon + requestAnimationFrame resize the terminal and send JSON resize to server"
    - "terminal.dispose() fires before ws.close() on component unmount — no WebGL context leak"
    - "Terminal button in DashboardPage header navigates to /terminal"
    - "TerminalPage shows spinner in connecting state, inline error + Retry in failed state, overlay in disconnected state"
  artifacts:
    - path: "packages/web/src/hooks/useTerminalSession.ts"
      provides: "xterm.js + WS lifecycle hook"
      exports: ["useTerminalSession", "TerminalStatus"]
    - path: "packages/web/src/components/TouchToolbar.tsx"
      provides: "Fixed-bottom mobile key toolbar"
      exports: ["TouchToolbar"]
    - path: "packages/web/src/pages/TerminalPage.tsx"
      provides: "Full-page terminal view"
      exports: ["TerminalPage"]
    - path: "packages/web/src/App.tsx"
      provides: "Route registration"
      contains: "terminal"
    - path: "packages/web/src/pages/DashboardPage.tsx"
      provides: "Terminal entry point button"
      contains: "Terminal"
  key_links:
    - from: "packages/web/src/pages/TerminalPage.tsx"
      to: "packages/web/src/hooks/useTerminalSession.ts"
      via: "useTerminalSession(containerRef)"
      pattern: "useTerminalSession"
    - from: "packages/web/src/hooks/useTerminalSession.ts"
      to: "/api/terminal"
      via: "new WebSocket(wsUrl)"
      pattern: "api/terminal"
    - from: "packages/web/src/pages/TerminalPage.tsx"
      to: "packages/web/src/components/TouchToolbar.tsx"
      via: "sendKey prop"
      pattern: "TouchToolbar"
    - from: "packages/web/src/App.tsx"
      to: "packages/web/src/pages/TerminalPage.tsx"
      via: "Route path='terminal'"
      pattern: "path.*terminal"
---

## Goal

Build the complete frontend terminal: install xterm.js packages, create the WebSocket+xterm hook (`useTerminalSession`), the mobile touch toolbar (`TouchToolbar`), and the full-page terminal view (`TerminalPage`), then wire the route in `App.tsx` and add the entry-point button to `DashboardPage`.

## Requirements

- **SSH-01** — User can open a web-based SSH terminal to the server
- **SSH-03** — Terminal input and output are streamed over WebSocket (via AttachAddon)
- **SSH-04** — Terminal resizes correctly when browser or iOS keyboard changes size (FitAddon + ResizeObserver)
- **SSH-05** — Touch toolbar with Ctrl, Tab, Esc, and arrow keys
- **SSH-06** — SSH session cleanly terminated on unmount (terminal.dispose() then ws.close())

## Tasks

### Task 1 — Install xterm packages and create `packages/web/src/hooks/useTerminalSession.ts`

**Step 1a — Install packages:**

Run inside `packages/web/`:
```
pnpm add @xterm/xterm@^6.0.0 @xterm/addon-fit@^0.11.0 @xterm/addon-attach@^0.12.0
```

These three packages are verified as legitimate (Microsoft/xtermjs org, [OK] slopcheck per RESEARCH.md Package Legitimacy Audit). `@xterm/xterm@^5.6.0` does NOT exist on npm — `6.0.0` is correct stable (critical research finding #1).

**Step 1b — Create `packages/web/src/hooks/useTerminalSession.ts`** (new file — mirrors `packages/web/src/hooks/useLogStream.ts` structure; no `.js` extensions on frontend imports):

**Exports:**
- `export type TerminalStatus = 'connecting' | 'connected' | 'disconnected' | 'failed'`
- `export function useTerminalSession(containerRef: React.RefObject<HTMLDivElement | null>)`

**Return shape:**
```
{ status: TerminalStatus, errorMsg: string | null, sendKey: (sequence: string) => void }
```

**`XTERM_OPTIONS` constant** (define at module level, type `ITerminalOptions` from `@xterm/xterm`) — use the full theme from D-P5-24 / UI-SPEC:
```
theme: {
  background: '#09090b',          // zinc-950 (D-P5-07, D-P5-24)
  foreground: '#e4e4e7',          // zinc-200
  cursor: '#a1a1aa',              // zinc-400
  cursorAccent: '#09090b',
  selectionBackground: 'rgba(161,161,170,0.3)',
  black: '#18181b',  brightBlack: '#52525b',
  red: '#ef4444',    brightRed: '#f87171',
  green: '#22c55e',  brightGreen: '#4ade80',
  yellow: '#eab308', brightYellow: '#facc15',
  blue: '#3b82f6',   brightBlue: '#60a5fa',
  magenta: '#a855f7',brightMagenta: '#c084fc',
  cyan: '#06b6d4',   brightCyan: '#22d3ee',
  white: '#d4d4d8',  brightWhite: '#fafafa',
}
fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace"
fontSize: 13, lineHeight: 1.2, cursorStyle: 'block', cursorBlink: true
scrollback: 1000, allowTransparency: false, convertEol: true
```

**Hook body — `useEffect` (runs once, dep: containerRef):**

State: `const [status, setStatus] = useState<TerminalStatus>('connecting')` and `const [errorMsg, setErrorMsg] = useState<string | null>(null)`.

Refs: `terminalRef = useRef<Terminal | null>(null)`, `fitAddonRef = useRef<FitAddon | null>(null)`, `wsRef = useRef<WebSocket | null>(null)`.

**Initialization order (critical — must follow this sequence per Q8):**

1. Guard: `if (!containerRef.current) return`

2. **Phase 1 — DOM mount (synchronous):**
   - `const terminal = new Terminal(XTERM_OPTIONS)`
   - `const fitAddon = new FitAddon()`
   - `terminal.loadAddon(fitAddon)` — load FitAddon BEFORE `open()`
   - `terminal.open(containerRef.current)` — attaches xterm to DOM; terminal is now renderable
   - `terminalRef.current = terminal`; `fitAddonRef.current = fitAddon`

3. **Phase 2 — WS connect (async):**
   - Build WS URL with relative host: `const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'` then `const ws = new WebSocket(\`${protocol}//\${window.location.host}/api/terminal\`)` (same pattern as `useLogStream.ts` lines 18–19)
   - `ws.binaryType = 'arraybuffer'` — receive binary frames as ArrayBuffer for xterm compatibility
   - `wsRef.current = ws`

4. **`ws.onopen`:**
   - `const attachAddon = new AttachAddon(ws)` — creates bidirectional pipe (D-P5-22)
   - `terminal.loadAddon(attachAddon)` — wires WS messages → terminal.write and terminal.onData → ws.send
   - Wrap fit in `requestAnimationFrame` (D-P5-23 — prevents pre-layout call):
     ```
     requestAnimationFrame(() => {
       fitAddon.fit()
       if (ws.readyState === WebSocket.OPEN) {
         ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
       }
       setStatus('connected')
     })
     ```

5. **`ws.onclose = (ev) => { ... }`:**
   - If `ev.code === 1000`: `setStatus('disconnected')` (clean close — session ended normally)
   - Else: `setStatus('failed')` + `setErrorMsg(ev.reason || 'Connection closed unexpectedly')` (D-P5-20)
   - No auto-reconnect (D-P5-19) — user must tap Retry/Reconnect

6. **`ws.onerror = () => { setStatus('failed'); setErrorMsg('WebSocket connection failed') }`**

7. **Phase 3 — ResizeObserver (D-P5-23, SSH-04):**
   ```
   let rafId: number | null = null
   const observer = new ResizeObserver(() => {
     if (rafId) cancelAnimationFrame(rafId)
     rafId = requestAnimationFrame(() => {
       fitAddon.fit()
       if (ws.readyState === WebSocket.OPEN) {
         ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
       }
     })
   })
   observer.observe(containerRef.current)
   ```

8. **Cleanup (return function) — order is critical (D-P5-25, Q12):**
   ```
   if (rafId) cancelAnimationFrame(rafId)
   observer.disconnect()
   attachAddon.dispose()   // unsubscribes onData before terminal is disposed
   terminal.dispose()      // MUST come before ws.close() — D-P5-25, prevents iOS WebGL exhaustion
   ws.close()              // triggers server stream.destroy() + conn.end() — D-P5-18
   ```

**`sendKey` function** (exposed in return value):
```
function sendKey(sequence: string) {
  terminalRef.current?.input(sequence)
}
```
Use `terminal.input()` ONLY — NOT `ws.send()` separately. AttachAddon's `onData` subscription handles the WS direction. Calling `ws.send()` separately would double-send the keystroke to the PTY (critical research finding #4, Q10).

---

### Task 2 — Create `packages/web/src/components/TouchToolbar.tsx`

**File:** `packages/web/src/components/TouchToolbar.tsx` (new file — new UI primitive, no exact analog; follow shadcn component structure from PATTERNS.md §TouchToolbar)

**Props interface:**
```typescript
export interface TouchToolbarProps {
  sendKey: (sequence: string) => void
  className?: string
}
```

**Ctrl modifier state:** `const [ctrlActive, setCtrlActive] = useState(false)`

**Toolbar key table** (D-P5-10 — all 11 buttons in order):

| Button label | Sequence | Ctrl+sequence |
|---|---|---|
| `Ctrl` | — (modifier toggle) | — |
| `Tab` | `\t` | `\t` |
| `Esc` | `\x1b` | `\x1b` |
| `↑` | `\x1b[A` | `\x1b[A` |
| `↓` | `\x1b[B` | `\x1b[B` |
| `←` | `\x1b[D` | `\x1b[D` |
| `→` | `\x1b[C` | `\x1b[C` |
| `\|` | `\x7c` | `\x7c` |
| `` ` `` | `` \x60 `` | `` \x60 `` |
| `~` | `\x7e` | `\x7e` |
| `/` | `\x2f` | `\x2f` |

Ctrl sequences for letter keys (D-P5-11): `\x03` (C), `\x04` (D), `\x0c` (L), `\x1a` (Z), `\x15` (U), `\x0b` (K). However, letter keys are only typed via the on-screen keyboard — the toolbar only handles the 11 buttons listed above.

**Ctrl button behavior (D-P5-11):**
- First tap: `setCtrlActive(true)` — no sequence sent
- While active, tapping any other toolbar button: send the button's standard sequence via `sendKey(sequence)`, then `setCtrlActive(false)`. (Arrow keys, Tab, Esc, symbols do not have Ctrl-modified variants that differ meaningfully; send their standard sequences.)
- Second tap of Ctrl while active: `setCtrlActive(false)` — no sequence sent

**Button `onClick` handler pattern:**
```typescript
function handleKey(sequence: string) {
  sendKey(sequence)
  if (ctrlActive) setCtrlActive(false)
}
```

**Container layout** (D-P5-08, D-P5-09, UI-SPEC):
```
position: fixed; bottom: 0; left: 0; right: 0
height: 44px
padding-bottom: env(safe-area-inset-bottom)
background: #18181b (zinc-900)
border-top: 1px solid #27272a (zinc-800)
z-index: 20
display: flex; align-items: center
overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none
```

Use Tailwind classes: `fixed bottom-0 left-0 right-0 h-[44px] pb-[env(safe-area-inset-bottom)] bg-zinc-900 border-t border-zinc-800 z-20 flex items-center overflow-x-auto`

**Individual button anatomy** (UI-SPEC §ToolbarButton, MOBL-03 — 44×44px min tap target):
```
<button
  type="button"
  className="h-[44px] min-w-[44px] px-3 flex items-center justify-center
             text-zinc-300 text-sm font-mono rounded-md shrink-0
             hover:bg-zinc-700 active:bg-zinc-600 transition-colors
             select-none touch-manipulation"
>
```

**Ctrl active state** (D-P5-11, UI-SPEC): when `ctrlActive === true`, apply additional classes to Ctrl button:
`bg-blue-500/20 text-blue-400 ring-2 ring-blue-500/60 ring-inset`

Add `aria-label` to each button (`aria-label="Tab"`, `aria-label="Escape"`, etc.). Add `aria-pressed={ctrlActive}` to the Ctrl button.

Do NOT use the shadcn `<Button>` component — use a plain `<button>` to avoid variant/size overrides on the fixed height. Use native touch events for maximum iOS responsiveness.

---

### Task 3 — Create `packages/web/src/pages/TerminalPage.tsx`, wire `App.tsx`, add Terminal button to `DashboardPage.tsx`

**File 3a: `packages/web/src/pages/TerminalPage.tsx`** (new file — mirrors `packages/web/src/pages/LogPage.tsx` structure; adapt `svh` → `dvh` throughout)

**Imports:**
```typescript
import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, X, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useTerminalSession } from '../hooks/useTerminalSession'
import { TouchToolbar } from '../components/TouchToolbar'
```

**CSS variables** (add to the `<style>` tag or inline in the component file, or add to `index.css`):
```css
:root {
  --terminal-header-height: 57px;
  --toolbar-height: calc(44px + env(safe-area-inset-bottom));
}
```
If adding to `index.css` is preferred, add to the existing `:root` block. Either location is acceptable.

**Component structure:**

```
export function TerminalPage() {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const { status, errorMsg, sendKey } = useTerminalSession(containerRef)

  return (
    <div className="min-h-dvh flex flex-col bg-[#09090b]">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#09090b]/80 backdrop-blur border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        ...
      </header>

      {/* Terminal area */}
      <main className="flex-1 relative overflow-hidden">
        ...
      </main>

      {/* Touch toolbar — always visible (D-P5-13) */}
      <TouchToolbar sendKey={sendKey} />
    </div>
  )
}
```

**Header contents** (D-P5-04, UI-SPEC §Component Tree):
1. Back button: `<Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigate(-1)} aria-label="Back to dashboard"><ArrowLeft className="h-4 w-4" /></Button>`
2. Title: `<h1 className="font-semibold truncate flex-1 text-zinc-100">Terminal</h1>`
3. Connection status badge (D-P5-21, UI-SPEC §ConnectionBadge):
   - `connecting`: `text-yellow-400 bg-yellow-500/10` → text "Connecting…"
   - `connected`: `text-green-400 bg-green-500/10` → text "Connected"
   - `disconnected`: `text-zinc-400 bg-zinc-800` → text "Disconnected"
   - `failed`: `text-red-400 bg-red-500/10` → text "Failed"
   - Badge element: `<span className="text-xs px-2 py-0.5 rounded-full shrink-0 {colorClasses}">{text}</span>`
4. X close button: `<Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigate(-1)} aria-label="Close terminal"><X className="h-4 w-4" /></Button>` — navigates back (D-P5-02); no confirmation dialog (UI-SPEC).

**Main area — state overlays + terminal container:**

The terminal `<div ref={containerRef}>` is ALWAYS rendered (xterm must be in the DOM for FitAddon to measure). Overlays float above it:

```tsx
<main className="flex-1 relative overflow-hidden">
  {/* Terminal mount point — always rendered; opacity controlled by state */}
  <div
    ref={containerRef}
    className={`w-full touch-none ${status === 'connecting' ? 'opacity-0' : 'opacity-100'}`}
    style={{
      height: 'calc(100dvh - var(--terminal-header-height) - var(--toolbar-height))',
      background: '#09090b',          // D-P5-07 — no color flash during resize
      overflow: 'hidden',
    }}
    autoCorrect="off"
    autoCapitalize="off"
    spellCheck={false}
    data-gramm="false"
  />

  {/* Connecting overlay (D-P5-21) */}
  {status === 'connecting' && (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090b]">
      <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      <p className="text-zinc-400 text-sm mt-2">Connecting…</p>
    </div>
  )}

  {/* Failed state (D-P5-20) */}
  {status === 'failed' && (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090b]">
      <div className="flex flex-col items-center gap-3 text-center p-6">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="font-semibold text-red-400">Connection failed</p>
        <p className="text-sm text-zinc-400">{errorMsg}</p>
        <Button variant="outline" size="sm" className="h-11" onClick={() => navigate(0)}>
          Retry
        </Button>
      </div>
    </div>
  )}

  {/* Disconnected / session ended (D-P5-19) */}
  {status === 'disconnected' && (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090b]/90">
      <div className="flex flex-col items-center gap-3 text-center p-6">
        <p className="font-semibold text-zinc-200">Session ended</p>
        <p className="text-sm text-zinc-400">Your SSH session was closed.</p>
        <Button variant="outline" size="sm" className="h-11" onClick={() => navigate('/terminal')}>
          Reconnect
        </Button>
      </div>
    </div>
  )}
</main>
```

`navigate(0)` for Retry reloads the page (remounts the component → fresh `useTerminalSession` → new WS attempt). `navigate('/terminal')` for Reconnect navigates to the same route fresh (D-P5-19).

**File 3b: `packages/web/src/App.tsx`** (modify — 2 lines):

Add import after the existing `LogPage` import:
```typescript
import { TerminalPage } from './pages/TerminalPage'
```

Add route inside `<Route path="/" element={<ProtectedRoute />}>` after the `logs/:containerId` route (current line 14):
```tsx
<Route path="terminal" element={<TerminalPage />} />
```

Exact insertion point: after `<Route path="logs/:containerId" element={<LogPage />} />` (App.tsx line 14).

**File 3c: `packages/web/src/pages/DashboardPage.tsx`** (modify — 1 line):

Add Terminal button inside the `<div className="flex items-center gap-2 shrink-0">` header action cluster (current lines 179–192), between the Refresh icon button and the Log out button (D-P5-01, UI-SPEC §Header Terminal Button):

```tsx
<Button
  variant="outline"
  size="sm"
  className="h-9"
  onClick={() => navigate('/terminal')}
>
  Terminal
</Button>
```

Insert after the closing `</Button>` of the Refresh button (after line 188) and before the Log out Button. `useNavigate` is already imported (DashboardPage line 2).

## Verification

1. **TypeScript compile** — `cd packages/web && npx tsc --noEmit` must exit 0 with no errors in any of the new or modified files.

2. **xterm packages installed** — `grep -c '@xterm/xterm' packages/web/package.json` returns `1`; same for `@xterm/addon-fit` and `@xterm/addon-attach`.

3. **Terminal button visible** — Open dashboard in browser; the sticky header should show `[Refresh icon] [Terminal] [Log out]` buttons in that order.

4. **Navigation** — Clicking Terminal in the DashboardPage header navigates to `/terminal` and shows the TerminalPage with "Connecting…" spinner.

5. **Connection flow (manual, requires 05-01 backend running + valid SSH config):**
   - Navigate to `/terminal`
   - Status badge changes from "Connecting…" to "Connected" within a few seconds
   - Type a command (e.g., `ls -la`) — output appears in terminal
   - `echo $$` — shows the shell PID; navigate away; run `kill -0 {PID}` on server — should fail (process gone)

6. **Touch toolbar** — All 11 buttons render; tap Tab and verify `\t` is sent (terminal shows completion prompt if shell supports it); tap Ctrl, observe blue ring; tap Ctrl again, ring disappears.

7. **Resize** — Open browser DevTools responsive mode; resize to different widths; terminal columns should reflow without blank space or overflow.

8. **Cleanup** — Navigate away from TerminalPage; in server logs, confirm `ws.on('close')` triggered `stream.destroy()` + `conn.end()` with no error traces.

## Dependencies

- **Depends on `05-01`** (Wave 2) — backend `GET /api/terminal` WS route must exist before frontend can connect. TypeScript types from `useTerminalSession` are self-contained; frontend can be written in parallel but integration requires the backend.
- `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-attach` — installed as Task 1 step 1a in this plan
