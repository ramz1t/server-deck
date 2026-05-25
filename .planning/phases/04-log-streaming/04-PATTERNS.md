# Phase 4: Log Streaming - Pattern Map

**Mapped:** 2026-05-25
**Files analyzed:** 6 (3 new, 3 modified)
**Analogs found:** 6 / 6

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/server/src/routes/container-logs.ts` | route | streaming | `packages/server/src/routes/container-events.ts` | exact |
| `packages/web/src/hooks/useLogStream.ts` | hook | streaming | `packages/web/src/hooks/useContainerEvents.ts` | exact |
| `packages/web/src/pages/LogPage.tsx` | component/page | request-response | `packages/web/src/pages/DashboardPage.tsx` | role-match |
| `packages/server/src/server.ts` (modify) | config | — | self (lines 37–39) | exact |
| `packages/web/src/components/ContainerCard.tsx` (modify) | component | — | self (lines 85–162 action buttons) | exact |
| `packages/web/src/App.tsx` (modify) | config/router | — | self (lines 11–13 ProtectedRoute) | exact |

---

## Pattern Assignments

### `packages/server/src/routes/container-logs.ts` (route, streaming)

**Analog:** `packages/server/src/routes/container-events.ts`
**Also reference:** `packages/server/src/services/docker-events.ts` (NDJSON buffer), `packages/server/src/services/docker-ssh.ts` (SSH exec + isValidContainerId)

**Imports pattern** (analog lines 1–6):
```typescript
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import { verifyAuth } from '../middleware/verify-auth.js'
import type { SessionData } from '../types/session.js'
import { isValidContainerId } from '../services/docker-ssh.js'
import { Client } from 'ssh2'
```

**getSession helper** (analog lines 7–14 — verbatim copy):
```typescript
function getSession(request: FastifyRequest): SessionData {
  const session = (request as unknown as { session?: SessionData }).session
  if (!session) {
    throw new Error('session missing from request — verifyAuth did not run')
  }
  return session
}
```

**Route registration pattern** (analog lines 16–28):
```typescript
export const containerLogsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/containers/:id/logs',
    { websocket: true, preHandler: [verifyAuth] },
    (socket: WebSocket, req: FastifyRequest) => {
      const { id } = req.params as { id: string }
      if (!isValidContainerId(id)) {
        socket.close(1008, 'Invalid container ID')
        return
      }
      const session = getSession(req)
      // ... SSH exec + pipe ...
    }
  )
}
```

**NDJSON buffer pattern** (docker-events.ts lines 47–64 — reuse for log chunk splitting):
```typescript
let buffer = ''
stream.on('data', (chunk: Buffer) => {
  buffer += chunk.toString()
  // Split on \n, keep incomplete last fragment in buffer
  const lines = buffer.split('\n')
  buffer = lines.pop() ?? ''
  for (const line of lines) {
    if (line.trim()) {
      // send each line as JSON
      socket.send(JSON.stringify({ type: 'log', line }))
    }
  }
})
```

**SSH connection pattern** (docker-events.ts lines 44–87 — adapt for per-client exec):
```typescript
const conn = new Client()
conn.on('ready', () => {
  conn.exec(`docker logs --follow --tail 200 ${id} 2>&1`, (err, stream) => {
    if (err) {
      socket.close(1011, 'SSH exec failed')
      conn.end()
      return
    }
    // ... buffer + send loop ...
    stream.on('close', () => {
      try { conn.end() } catch { /* ignore */ }
      socket.close()
    })
  })
})
conn.on('error', (err) => {
  console.error('[ContainerLogs] SSH error:', err.message)
  try { conn.end() } catch { /* ignore */ }
  socket.close(1011, 'SSH error')
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

**Teardown on WS close** (CRITICAL — LOGS-04, no analog in codebase for active teardown):
```typescript
// In the WS handler, after conn.exec:
socket.on('close', () => {
  try { stream.destroy() } catch { /* ignore */ }
  try { conn.end() } catch { /* ignore */ }
})
```
> Note: `stream.destroy()` must be called (not `stream.close()`) to send channel close + EOF so remote `docker logs` gets SIGPIPE and terminates.

---

### `packages/web/src/hooks/useLogStream.ts` (hook, streaming)

**Analog:** `packages/web/src/hooks/useContainerEvents.ts`

**Imports pattern** (analog lines 1–2):
```typescript
import { useEffect, useRef, useState } from 'react'
```

**Hook signature** (differs from analog — no queryClient param):
```typescript
const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MAX_MS = 30_000

export function useLogStream(
  containerId: string,
): { lines: string[]; connected: boolean } {
  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const retryDelayRef = useRef(BACKOFF_INITIAL_MS)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  ...
}
```

**useEffect + connect function pattern** (analog lines 31–83 — copy structure verbatim, adapt URL and onmessage):
```typescript
useEffect(() => {
  let cancelled = false

  function connect() {
    if (cancelled) return
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/containers/${containerId}/logs`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      if (cancelled) { ws.close(); return }
      setConnected(true)
      retryDelayRef.current = BACKOFF_INITIAL_MS  // reset backoff on successful connect
    }

    ws.onmessage = (event) => {
      if (cancelled) return
      try {
        const msg = JSON.parse(event.data as string) as { type: 'log'; line: string }
        if (msg.type === 'log') {
          setLines((prev) => {
            const next = [...prev, msg.line]
            // 5 000-line cap — drop oldest lines (D-P4-15)
            return next.length > 5000 ? next.slice(next.length - 5000) : next
          })
        }
      } catch { /* malformed message — ignore */ }
    }

    ws.onclose = () => {
      if (cancelled) return
      setConnected(false)
      // Exponential backoff reconnect
      const delay = retryDelayRef.current
      retryDelayRef.current = Math.min(delay * 2, BACKOFF_MAX_MS)
      reconnectTimerRef.current = setTimeout(connect, delay)
    }

    ws.onerror = () => {
      ws.close()  // onclose fires after onerror — reconnect handled there
    }
  }

  connect()

  return () => {
    cancelled = true
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    if (wsRef.current) wsRef.current.close()
    setConnected(false)
  }
}, [containerId])  // re-connect if containerId changes
```

---

### `packages/web/src/pages/LogPage.tsx` (component, request-response)

**Analog:** `packages/web/src/pages/DashboardPage.tsx`

**Imports pattern** (analog lines 1–9 — adapt for LogPage needs):
```typescript
import { useRef, useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useLogStream } from '../hooks/useLogStream'
import Convert from 'ansi-to-html'
```

**Page skeleton structure** (analog lines 155–187 — sticky header + scrollable main):
```tsx
export function LogPage() {
  const { containerId } = useParams<{ containerId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const containerName = (location.state as { name?: string } | null)?.name
    ?? (containerId?.slice(0, 12) ?? 'unknown')

  const { lines, connected } = useLogStream(containerId ?? '')

  return (
    <div className="min-h-svh flex flex-col bg-black">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-3 max-w-4xl mx-auto">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => navigate('/')}
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="font-semibold truncate flex-1">{containerName}</span>
          {/* Live / disconnected badge — same pattern as DashboardPage wsConnected badge */}
          {connected ? (
            <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full shrink-0">
              live
            </span>
          ) : (
            <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full shrink-0">
              disconnected
            </span>
          )}
        </div>
      </header>

      {/* Log scroll area */}
      <main className="flex-1 relative overflow-hidden">
        {/* scroll container, auto-scroll logic attached here */}
        ...
      </main>
    </div>
  )
}
```

**Connected/disconnected badge pattern** (DashboardPage.tsx lines 167–171 — adapt colour logic):
```tsx
{!wsConnected && hasConnectedOnce && (
  <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full shrink-0">
    reconnecting…
  </span>
)}
```

**Auto-scroll + Resume button pattern** (no codebase analog — use refs):
```tsx
const scrollRef = useRef<HTMLDivElement>(null)
const autoScrollRef = useRef(true)
const [showResume, setShowResume] = useState(false)

// Scroll to bottom when new lines arrive and autoScroll is active
useEffect(() => {
  if (!autoScrollRef.current) return
  const el = scrollRef.current
  if (el) el.scrollTop = el.scrollHeight
}, [lines])

function handleScroll() {
  const el = scrollRef.current
  if (!el) return
  const atBottom = el.scrollTop >= el.scrollHeight - el.clientHeight - 50
  autoScrollRef.current = atBottom
  setShowResume(!atBottom)
}

function resumeAutoScroll() {
  autoScrollRef.current = true
  setShowResume(false)
  const el = scrollRef.current
  if (el) el.scrollTop = el.scrollHeight
}
```

**ANSI rendering pattern** (ansi-to-html, no codebase analog — new pattern):
```tsx
// Instantiate converter once with XSS-safe escapeXML: true
const converter = new Convert({ escapeXML: true })

// In render, map lines:
<div
  ref={scrollRef}
  onScroll={handleScroll}
  className="h-full overflow-y-auto bg-zinc-950 px-4 py-3"
>
  <pre className="font-mono text-sm text-zinc-200 whitespace-pre-wrap overflow-wrap-break-word">
    {lines.map((line, i) => (
      <div
        key={i}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: converter.toHtml(line) }}
      />
    ))}
  </pre>
</div>
```

> ⚠️ **Security note:** `escapeXML: true` is mandatory. Without it, malicious container log output can inject arbitrary HTML (XSS).

**Floating Resume button:**
```tsx
{showResume && (
  <button
    type="button"
    onClick={resumeAutoScroll}
    className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-zinc-800 text-zinc-200 text-sm px-4 py-2 rounded-full shadow-lg border border-zinc-700 hover:bg-zinc-700 transition-colors"
  >
    ↓ Resume
  </button>
)}
```

---

### `packages/server/src/server.ts` (modify — registration)

**Analog:** self (lines 37–39)

**Registration order pattern** (lines 37–39):
```typescript
  await fastify.register(authRoutes)
  await fastify.register(containerRoutes)
  await fastify.register(containerEventsRoute)
  // ADD AFTER containerEventsRoute:
  await fastify.register(containerLogsRoute)
```

**Import to add** (line 6 area, after containerEventsRoute import):
```typescript
import { containerLogsRoute } from './routes/container-logs.js'
```

---

### `packages/web/src/components/ContainerCard.tsx` (modify — add Logs button)

**Analog:** self (lines 85–162 action buttons area)

**Prop interface extension** (lines 26–32 — add `onLogs` callback):
```typescript
interface ContainerCardProps {
  container: ContainerInfo
  onStart: (id: string) => void
  onStop: (id: string) => void
  onRestart: (id: string) => void
  isActing: boolean
  onLogs: (id: string) => void  // ADD THIS
}
```

**Logs button placement** (inside `<div className="flex justify-end gap-2">` at line 85, add before the state-conditional buttons):
```tsx
{/* Logs — always visible regardless of container state (D-P4-01) */}
<Button
  variant="ghost"
  size="sm"
  className="min-h-[44px] h-11"
  onClick={() => onLogs(container.id)}
>
  Logs
</Button>
```

**Ghost button style reference** (existing Restart button lines 88–100 for `variant="outline"`, but Logs uses `variant="ghost"` per D-P4-01):
```tsx
<Button
  variant="outline"        // Restart uses "outline"
  size="sm"
  className="min-h-[44px] h-11"  // 44px touch target — keep on Logs button too
  ...
```

---

### `packages/web/src/App.tsx` (modify — add /logs/:containerId route)

**Analog:** self (lines 11–13 — ProtectedRoute + nested index route)

**Existing ProtectedRoute pattern** (lines 10–13):
```tsx
<Route path="/" element={<ProtectedRoute />}>
  <Route index element={<DashboardPage />} />
</Route>
```

**New route to add** (nest `/logs/:containerId` inside same ProtectedRoute wrapper):
```tsx
<Route path="/" element={<ProtectedRoute />}>
  <Route index element={<DashboardPage />} />
  <Route path="logs/:containerId" element={<LogPage />} />
</Route>
```

**Import to add** (after DashboardPage import):
```typescript
import { LogPage } from './pages/LogPage'
```

---

## Shared Patterns

### Auth (preHandler)
**Source:** `packages/server/src/routes/container-events.ts` line 19
**Apply to:** `container-logs.ts` route registration
```typescript
{ websocket: true, preHandler: [verifyAuth] }
```

### getSession helper
**Source:** `packages/server/src/routes/container-events.ts` lines 7–14
**Apply to:** `container-logs.ts` — copy verbatim
```typescript
function getSession(request: FastifyRequest): SessionData {
  const session = (request as unknown as { session?: SessionData }).session
  if (!session) {
    throw new Error('session missing from request — verifyAuth did not run')
  }
  return session
}
```

### SSH connection config
**Source:** `packages/server/src/services/docker-events.ts` lines 79–87
**Apply to:** `container-logs.ts` SSH Client.connect() call
```typescript
client.connect({
  host: session.host,
  port: session.port,
  username: session.username,
  password: session.password,
  readyTimeout: 10_000,
  keepaliveInterval: 0,  // short-lived per-client connection — no keepalive needed
})
```

### WS URL derivation
**Source:** `packages/web/src/hooks/useContainerEvents.ts` lines 37–38
**Apply to:** `useLogStream.ts`
```typescript
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const wsUrl = `${protocol}//${window.location.host}/api/containers/${containerId}/logs`
```

### Exponential backoff reconnect
**Source:** `packages/web/src/hooks/useContainerEvents.ts` lines 62–65
**Apply to:** `useLogStream.ts` `ws.onclose` handler
```typescript
const delay = retryDelayRef.current
retryDelayRef.current = Math.min(delay * 2, BACKOFF_MAX_MS)
reconnectTimerRef.current = setTimeout(connect, delay)
```

### Touch target minimum (44px)
**Source:** `packages/web/src/components/ContainerCard.tsx` lines 92–93, 141
**Apply to:** All new buttons in `ContainerCard.tsx` and `LogPage.tsx`
```typescript
className="min-h-[44px] h-11"
```

### `.js` extension in server imports
**Source:** All existing server files (e.g., `container-events.ts` lines 3–5)
**Apply to:** All new server-side import statements
```typescript
import { verifyAuth } from '../middleware/verify-auth.js'  // .js extension required even for .ts files
```

---

## No Analog Found

| File / Pattern | Role | Reason |
|---|---|---|
| `stream.destroy()` teardown | server teardown | Phase 3 uses passive teardown (client closes, `Set.delete`); active stream kill on WS close is new |
| ANSI rendering via `ansi-to-html` | client transform | No prior ANSI/terminal rendering in codebase — `ansi-to-html` is a new dependency |
| Auto-scroll + Resume button | UI behaviour | No scroll-following log view exists in codebase; pattern sourced from D-P4-12/13 decisions |
| `converter = new Convert({ escapeXML: true })` | client security | No `dangerouslySetInnerHTML` usage in codebase; XSS-safe pattern is new |

---

## Metadata

**Analog search scope:** `packages/server/src/`, `packages/web/src/`
**Files scanned:** 7 source files read
**Pattern extraction date:** 2026-05-25
