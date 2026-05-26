# Phase 5: SSH Terminal — Pattern Map

**Mapped:** 2025-05-25
**Files analyzed:** 5 new files + 2 modifications
**Analogs found:** 7 / 7

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `packages/server/src/routes/terminal.ts` | route | streaming (bidirectional WS→SSH) | `packages/server/src/routes/container-logs.ts` | exact |
| `packages/server/src/services/terminal-ssh.ts` | service | streaming (SSH PTY) | `packages/server/src/services/docker-ssh.ts` | role-match |
| `packages/web/src/hooks/useTerminalSession.ts` | hook | event-driven WS | `packages/web/src/hooks/useLogStream.ts` | role-match |
| `packages/web/src/pages/TerminalPage.tsx` | page/component | request-response | `packages/web/src/pages/LogPage.tsx` | exact |
| `packages/web/src/components/TouchToolbar.tsx` | component | event-driven | `packages/web/src/components/ui/badge.tsx` | partial |
| `packages/server/src/server.ts` *(modify)* | config | — | self | — |
| `packages/web/src/App.tsx` *(modify)* | config | — | self | — |

---

## Global Patterns

### Import Style — `.js` extension required on ALL server imports

Every server-side import uses the `.js` extension even for `.ts` source files (TypeScript strict ESM).

**Source:** `packages/server/src/routes/container-logs.ts` lines 1–7
```typescript
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import type { ClientChannel } from 'ssh2'
import { Client } from 'ssh2'
import { verifyAuth } from '../middleware/verify-auth.js'       // ← .js required
import type { SessionData } from '../types/session.js'          // ← .js required
import { isValidContainerId } from '../services/docker-ssh.js'  // ← .js required
```

Frontend (React) imports do **not** use `.js` extensions — bare module specifiers only.

**Source:** `packages/web/src/pages/LogPage.tsx` lines 1–6
```typescript
import { useRef, useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useLogStream } from '../hooks/useLogStream'
```

---

### TypeScript Strict Patterns

**Session access via type assertion** — session is attached to request at runtime by `verifyAuth`; typed as `unknown` to satisfy strict mode:

**Source:** `packages/server/src/routes/container-logs.ts` lines 9–16 (identical copy in `container-events.ts` and `containers.ts`)
```typescript
function getSession(request: FastifyRequest): SessionData {
  const session = (request as unknown as { session?: SessionData }).session
  if (!session) {
    // Should never happen — verifyAuth preHandler always runs first
    throw new Error('session missing from request — verifyAuth did not run')
  }
  return session
}
```
→ **Copy this function verbatim** into `terminal.ts`. It appears in three route files already — it is the project-wide convention.

**Dynamic property write** — same `unknown as Record<string,unknown>` cast used in middleware:

**Source:** `packages/server/src/middleware/verify-auth.ts` line 21
```typescript
;(request as unknown as Record<string, unknown>)['session'] = session
```

---

### WS Route Registration in Fastify 5

WebSocket routes use `FastifyPluginAsync` + `{ websocket: true, preHandler: [verifyAuth] }`.
The global `verifyAuth` hook (`addHook`) does NOT fire for WS upgrades on its own in Fastify 5 — the per-route `preHandler` array is **mandatory**.

**Source:** `packages/server/src/routes/container-logs.ts` lines 18–22
```typescript
export const containerLogsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { id: string } }>(
    '/api/containers/:id/logs',
    { websocket: true, preHandler: [verifyAuth] },
    (socket: WebSocket, req) => {
```

**Note the handler signature difference from REST routes:**
- WS handler: `(socket: WebSocket, req)` — no `reply`
- REST handler: `async (request: FastifyRequest, reply: FastifyReply)`

---

### Plugin Registration in `server.ts`

**Source:** `packages/server/src/server.ts` lines 1–46 (full file)
```typescript
import { containerLogsRoute } from './routes/container-logs.js'
// ...
await fastify.register(containerLogsRoute)
```
→ Add two lines: one `import` at the top and one `await fastify.register(terminalRoute)` after the existing WS route registrations.

---

### React Route Registration in `App.tsx`

**Source:** `packages/web/src/App.tsx` lines 1–21 (full file)
```typescript
import { TerminalPage } from './pages/TerminalPage'
// inside <Route path="/" element={<ProtectedRoute />}>:
<Route path="terminal" element={<TerminalPage />} />
```
Pattern: new protected pages go as children of the `<Route path="/" element={<ProtectedRoute />}>` route. LogPage used `path="logs/:containerId"` with a URL param — TerminalPage uses a fixed `path="terminal"` (no param, session is stored in Zustand).

---

## Pattern Assignments

### `packages/server/src/routes/terminal.ts`

**Analog:** `packages/server/src/routes/container-logs.ts`
**Why best match:** Only WS route that also opens an SSH connection. Terminal route adds bidirectional data flow (client→server keystrokes) and PTY shell instead of `exec`.

**Imports pattern** (analog lines 1–7):
```typescript
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import type { ClientChannel } from 'ssh2'
import { Client } from 'ssh2'
import { verifyAuth } from '../middleware/verify-auth.js'
import type { SessionData } from '../types/session.js'
```

**Auth / preHandler pattern** (analog lines 18–22):
```typescript
export const terminalRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/terminal',
    { websocket: true, preHandler: [verifyAuth] },
    (socket: WebSocket, req) => {
      const session = getSession(req)
```

**Core WS→SSH pattern** (analog lines 32–92 — adapt `exec` → `shell` with PTY):
```typescript
// container-logs.ts uses conn.exec(); terminal.ts must use conn.shell() instead:
conn.on('ready', () => {
  conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
    if (err) {
      try { socket.close(1011, 'SSH shell failed') } catch { /* ignore */ }
      try { conn.end() } catch { /* ignore */ }
      return
    }

    // Forward SSH output → WebSocket (raw bytes, not JSON lines)
    stream.on('data', (chunk: Buffer) => {
      try { socket.send(chunk) } catch { /* ignore */ }
    })

    // Forward WebSocket input → SSH stream
    socket.on('message', (data) => {
      try { stream.write(data) } catch { /* ignore */ }
    })

    stream.on('close', () => {
      try { conn.end() } catch { /* ignore */ }
      try { socket.close() } catch { /* ignore */ }
    })
  })
})
```

**KEY DIFFERENCE vs logs route:** logs sends `JSON.stringify({ type: 'log', line })` strings. Terminal sends **raw binary frames** directly to xterm.js's `AttachAddon`. Do NOT wrap terminal data in JSON.

**Resize message pattern** — terminal route must handle a special JSON resize message:
```typescript
socket.on('message', (data) => {
  // Check if this is a resize control message (JSON) vs raw keystroke (binary)
  try {
    const msg = JSON.parse(data.toString()) as { type: string; cols: number; rows: number }
    if (msg.type === 'resize' && stream) {
      stream.setWindow(msg.rows, msg.cols, 0, 0)
      return
    }
  } catch { /* not JSON → treat as raw input */ }
  try { stream.write(data) } catch { /* ignore */ }
})
```

**Error/teardown pattern** (analog lines 69–92 — copy exactly):
```typescript
conn.on('error', (err) => {
  fastify.log.error({ err }, 'terminal SSH error')
  try { conn.end() } catch { /* ignore */ }
  try { socket.close(1011, 'SSH error') } catch { /* ignore */ }
})

socket.on('close', () => {
  try { if (stream) stream.destroy() } catch { /* ignore */ }
  try { conn.end() } catch { /* ignore */ }
})

conn.connect({
  host: session.host,
  port: session.port,
  username: session.username,
  password: session.password,
  readyTimeout: 10_000,
  keepaliveInterval: 0,
})
```
`stream.destroy()` is mandatory (same as logs route) — `close()` alone leaks the SSH channel.

---

### `packages/server/src/services/terminal-ssh.ts`

**Analog:** `packages/server/src/services/docker-ssh.ts`
**Why best match:** Same SSH connection setup and session-driven pattern. Terminal service wraps the PTY shell lifetime in a class/object rather than fire-and-forget `exec`.

**Imports pattern** (analog lines 1–2):
```typescript
import { Client } from 'ssh2'
import type { SessionData } from '../types/session.js'
```

**Session connect options** (analog lines 48–55 — copy exactly):
```typescript
client.connect({
  host: session.host,
  port: session.port,
  username: session.username,
  password: session.password,
  readyTimeout: 10_000,
  keepaliveInterval: 0,
})
```

**KEY DIFFERENCE:** `docker-ssh.ts` is a stateless utility (functions, not class). `terminal-ssh.ts` may be a class or factory that holds a `Client` instance per session because the shell connection is long-lived. The `sshExec` pattern (Promise resolving on close) does not apply — use event-based stream piping instead.

**OPTIONAL NOTE:** The terminal route is simple enough that a standalone `services/terminal-ssh.ts` may not be needed — the route itself can own the `Client` lifecycle (as `container-logs.ts` does). Only extract to a service if shared SSH shell logic emerges.

---

### `packages/web/src/hooks/useTerminalSession.ts`

**Analog:** `packages/web/src/hooks/useLogStream.ts`
**Why best match:** Same WebSocket lifecycle management (connect, cleanup on unmount, cancelled flag). Terminal adds xterm.js init/dispose and sends data back.

**Imports pattern** (analog lines 1):
```typescript
import { useEffect, useRef, useState } from 'react'
```
→ Add xterm.js imports:
```typescript
import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { AttachAddon } from '@xterm/addon-attach'
import { FitAddon } from '@xterm/addon-fit'
```

**WS URL construction** (analog lines 18–19 — copy exactly):
```typescript
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const wsUrl = `${protocol}//${window.location.host}/api/terminal`
```

**Cancelled flag + cleanup pattern** (analog lines 14–66 — copy the structure):
```typescript
useEffect(() => {
  let cancelled = false

  function connect() {
    if (cancelled) return
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      if (cancelled) { ws.close(); return }
      setConnected(true)
    }

    ws.onclose = () => {
      if (cancelled) return
      setConnected(false)
      // NO auto-reconnect for terminal — show manual reconnect button instead
    }

    ws.onerror = () => { ws.close() }
  }

  connect()

  return () => {
    cancelled = true
    if (wsRef.current) wsRef.current.close()
    setConnected(false)
    // Also dispose xterm instance here
    termRef.current?.dispose()
  }
}, [])
```

**KEY DIFFERENCE:** `useLogStream` auto-reconnects with exponential backoff. Terminal sessions **must NOT auto-reconnect** (per copilot-instructions.md mobile considerations: "Do not auto-reconnect without user intent"). Expose a `reconnect()` callback instead.

**KEY DIFFERENCE:** `useLogStream` returns `{ lines, connected }`. `useTerminalSession` returns `{ terminalRef, connected, reconnect }` where `terminalRef` is passed to a `<div>` that xterm.js mounts into.

**Resize send pattern** (no analog — new for terminal):
```typescript
const fitAddon = new FitAddon()
// After mount:
const resizeObserver = new ResizeObserver(() => {
  fitAddon.fit()
  const dims = fitAddon.proposeDimensions()
  if (dims && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
  }
})
resizeObserver.observe(containerEl)
// Cleanup:
resizeObserver.disconnect()
```

---

### `packages/web/src/pages/TerminalPage.tsx`

**Analog:** `packages/web/src/pages/LogPage.tsx`
**Why best match:** Same full-page layout (sticky header + full-height content), same back-navigation pattern, same connection status badge inline in header.

**Full layout skeleton** (analog lines 62–119 — adapt structure):
```tsx
return (
  <div className="min-h-svh flex flex-col bg-black">
    {/* Sticky header */}
    <header className="sticky top-0 z-10 bg-black/80 backdrop-blur border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0"
        onClick={() => navigate('/')}
        aria-label="Back to dashboard"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <span className="font-semibold truncate flex-1">Terminal — {username}@{host}</span>
      {/* Status badge — mirror exact Tailwind classes from LogPage */}
      {connected ? (
        <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full shrink-0">
          connected
        </span>
      ) : (
        <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full shrink-0">
          disconnected
        </span>
      )}
    </header>

    {/* Terminal fill area — use dvh to handle iOS keyboard resize */}
    <main className="flex-1 relative overflow-hidden">
      <div
        ref={terminalContainerRef}
        className="h-full w-full"
        style={{ height: 'calc(100dvh - 57px)' }}  {/* dvh not svh — handles keyboard */}
      />
      {/* TouchToolbar — mobile only */}
      <TouchToolbar onKey={(key) => sendKey(key)} />
    </main>
  </div>
)
```

**Imports pattern** (analog lines 1–6):
```typescript
import { useRef } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { ArrowLeft, Terminal as TerminalIcon } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useTerminalSession } from '../hooks/useTerminalSession'
```

**KEY DIFFERENCE:** LogPage uses `useParams` for `containerId`. TerminalPage gets `host`/`username` from `useOutletContext<DashboardContext>()` (same as DashboardPage line 85) — no URL params needed.

**KEY DIFFERENCE:** LogPage renders a `<pre>` with HTML lines. TerminalPage renders a `<div ref>` that xterm.js mounts into — no `dangerouslySetInnerHTML`.

**`calc()` height pattern** — copy from LogPage but change `svh` → `dvh`:
```tsx
// LogPage (analog):
style={{ height: 'calc(100svh - 57px)' }}

// TerminalPage (adapted) — dvh recalculates when iOS keyboard appears:
style={{ height: 'calc(100dvh - 57px)' }}
```

---

### `packages/web/src/components/TouchToolbar.tsx`

**Analog:** `packages/web/src/components/ui/badge.tsx` (partial — structure only)
**Why:** Only shadcn component available for structure. TouchToolbar is a new UI primitive with no existing analog.

**shadcn component structure** (analog lines 1–36 — copy the pattern, not content):
```typescript
import * as React from "react"
import { cn } from "@/lib/utils"

// Named interface export (shadcn convention)
export interface TouchToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  onKey: (key: string) => void
}

// Named function export (shadcn convention)
function TouchToolbar({ className, onKey, ...props }: TouchToolbarProps) {
  return (
    <div className={cn("...", className)} {...props}>
      {/* key buttons */}
    </div>
  )
}

export { TouchToolbar }
```

**Button pattern for touch keys** — use existing `Button` component with `min-h-[44px]` (44px minimum tap target from copilot-instructions.md):
```tsx
// Reuse DashboardPage's inline button pattern (analog lines 180–194):
<Button
  variant="ghost"
  size="icon"
  className="h-11 w-11"  // 44px touch target
  onClick={() => onKey('\t')}
  aria-label="Tab"
>
  Tab
</Button>
```

**Mobile-only visibility** — use Tailwind responsive prefix:
```tsx
<div className="flex sm:hidden items-center gap-1 px-2 py-1 bg-zinc-900 border-t border-zinc-800 overflow-x-auto">
```

---

### `packages/server/src/server.ts` *(modification)*

**Source:** `packages/server/src/server.ts` lines 1–46 (full file)

**Pattern:** Add import + register, mirroring `containerLogsRoute` lines exactly:

```typescript
// Line ~8 — add import after containerLogsRoute import:
import { terminalRoute } from './routes/terminal.js'

// Line ~41 — add register after containerLogsRoute register:
await fastify.register(containerLogsRoute)
await fastify.register(terminalRoute)   // ← add this line
```

---

### `packages/web/src/App.tsx` *(modification)*

**Source:** `packages/web/src/App.tsx` lines 1–21 (full file)

**Pattern:** Add import + route, mirroring `LogPage` lines exactly:

```typescript
// Add import:
import { TerminalPage } from './pages/TerminalPage'

// Add route inside <Route path="/" element={<ProtectedRoute />}>:
<Route path="logs/:containerId" element={<LogPage />} />
<Route path="terminal" element={<TerminalPage />} />   {/* ← add this line */}
```

---

### `packages/web/src/pages/DashboardPage.tsx` *(modification — Terminal button)*

**Source:** `packages/web/src/pages/DashboardPage.tsx` lines 179–194

**Pattern:** Add Terminal button in the header action cluster, before the Logout button:

```tsx
{/* Existing header action cluster (lines 179–193): */}
<div className="flex items-center gap-2 shrink-0">
  <Button
    variant="ghost"
    size="icon"
    className="h-9 w-9"
    onClick={() => refetch()}
    aria-label="Refresh"
  >
    <RefreshCw className="h-4 w-4" />
  </Button>
  {/* ADD: Terminal button */}
  <Button
    variant="ghost"
    size="icon"
    className="h-9 w-9"
    onClick={() => navigate('/terminal')}
    aria-label="Open terminal"
  >
    <TerminalIcon className="h-4 w-4" />
  </Button>
  <Button variant="outline" size="sm" className="h-9" onClick={handleLogout}>
    Log out
  </Button>
</div>
```

Add `TerminalIcon` to the lucide-react import on line 4:
```typescript
import { Server, RefreshCw, AlertCircle, Layers, ChevronRight, Terminal as TerminalIcon } from 'lucide-react'
```

---

## Shared Patterns

### Auth preHandler
**Source:** `packages/server/src/middleware/verify-auth.ts` + `packages/server/src/routes/container-logs.ts` line 21
**Apply to:** `terminal.ts` (WS route)
```typescript
// Per-route — NOT the global addHook — is what runs before WS upgrade:
{ websocket: true, preHandler: [verifyAuth] }
```

### Session extraction helper
**Source:** `packages/server/src/routes/container-logs.ts` lines 9–16
**Apply to:** `terminal.ts`
```typescript
function getSession(request: FastifyRequest): SessionData {
  const session = (request as unknown as { session?: SessionData }).session
  if (!session) {
    throw new Error('session missing from request — verifyAuth did not run')
  }
  return session
}
```

### SSH connect options
**Source:** `packages/server/src/services/docker-ssh.ts` lines 48–55
**Apply to:** `terminal.ts`, `terminal-ssh.ts`
```typescript
client.connect({
  host: session.host,
  port: session.port,
  username: session.username,
  password: session.password,
  readyTimeout: 10_000,
  keepaliveInterval: 0,
})
```

### try/catch-ignore teardown
**Source:** `packages/server/src/routes/container-logs.ts` lines 62–63, 70–72, 79–82
**Apply to:** `terminal.ts` — every `socket.close()`, `conn.end()`, `stream.destroy()` call
```typescript
try { if (stream) stream.destroy() } catch { /* ignore */ }
try { conn.end() } catch { /* ignore */ }
try { socket.close() } catch { /* ignore */ }
```

### WS URL construction (frontend)
**Source:** `packages/web/src/hooks/useLogStream.ts` lines 18–19
**Apply to:** `useTerminalSession.ts`
```typescript
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const wsUrl = `${protocol}//${window.location.host}/api/terminal`
```

### Connection status badge (inline Tailwind, no Badge component)
**Source:** `packages/web/src/pages/LogPage.tsx` lines 76–84
**Apply to:** `TerminalPage.tsx` header
```tsx
{connected ? (
  <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full shrink-0">
    connected
  </span>
) : (
  <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full shrink-0">
    disconnected
  </span>
)}
```
Note: The codebase uses **inline Tailwind spans**, not the `<Badge>` shadcn component, for status indicators. Match this existing pattern.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/web/src/components/TouchToolbar.tsx` | component | event-driven | No toolbar/toolbar-like component exists; closest is badge.tsx for export structure only |

---

## Critical Gotchas (Do NOT copy blindly)

| Gotcha | Location | Notes |
|--------|----------|-------|
| `conn.exec()` → must become `conn.shell()` | `container-logs.ts:36` | exec is one-way; shell is bidirectional PTY |
| JSON message wrapping | `container-logs.ts:54-56` | Logs wrap in `{type, line}` JSON — terminal sends **raw bytes** to xterm AttachAddon, except resize messages |
| `useLogStream` auto-reconnects | `useLogStream.ts:43-49` | Terminal must NOT auto-reconnect — mobile UX requirement, show Reconnect button instead |
| `svh` height unit | `LogPage.tsx:93` | Use `dvh` in TerminalPage — `dvh` recalculates when iOS virtual keyboard appears; `svh` does not |
| `preHandler` on WS route | `container-logs.ts:21` | Global `addHook('preHandler', verifyAuth)` in server.ts does NOT cover WS upgrades in Fastify 5; per-route array is mandatory |
| `stream.destroy()` not `stream.close()` | `container-logs.ts:80` | `close()` alone leaks the SSH channel; `destroy()` sends SSH_MSG_CHANNEL_CLOSE |

---

## Metadata

**Analog search scope:** `packages/server/src/`, `packages/web/src/`
**Files scanned:** 11
**Pattern extraction date:** 2025-05-25
