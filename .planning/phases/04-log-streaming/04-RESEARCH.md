# Phase 4: Log Streaming — Research

**Researched:** 2026-05-25  
**Domain:** WebSocket log streaming, SSH exec teardown, ANSI rendering, React scroll behaviour  
**Confidence:** HIGH (all critical questions answered from live codebase + installed packages)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-P4-01:** "Logs" button on ContainerCard → navigates to `/logs/:containerId`. Present for all containers regardless of state. Ghost-button style matching existing actions.
- **D-P4-02:** Container name passed via React Router `state` (from `useNavigate`) — no extra API call.
- **D-P4-03:** New route `/logs/:containerId` → `LogPage` component, wrapped in ProtectedRoute.
- **D-P4-04:** LogPage header: back arrow `←` to `/`, container name, disconnected/live indicator badge.
- **D-P4-05:** WS route `GET /api/containers/:id/logs` — validated with `isValidContainerId()`, returns 400 on invalid ID, auth via `preHandler: [verifyAuth]`.
- **D-P4-06:** SSH exec: `docker logs --follow --tail 200 <id>` (stdout + stderr merged via `2>&1`).
- **D-P4-07:** Server sends `{ type: 'log', line: '<raw log line with ANSI>' }` per line; same NDJSON buffer pattern (split `\n`, pop last fragment).
- **D-P4-08:** WS close handler: `stream.destroy()` + `conn.end()`. No server-side reconnect.
- **D-P4-09:** 1-to-1 pipe — no `Set<WebSocket>` broadcast needed.
- **D-P4-10:** `ansi-to-html` npm package on the client side. `new Convert().toHtml(line)` per line.
- **D-P4-11:** `<pre>` or `<div style="font-family: monospace">` with `white-space: pre-wrap`, `overflow-wrap: break-word`, dark background, light text.
- **D-P4-12/13:** Smart auto-scroll: pause on scroll-up detected via `scrollTop < scrollHeight - clientHeight - 50px`, floating "↓ Resume" button to re-enable.
- **D-P4-14:** `useLogStream(containerId)` → `{ lines: string[], connected: boolean }`, same pattern as `useContainerEvents`.
- **D-P4-15:** 5 000-line memory cap — drop oldest lines on overflow.

### Agent's Discretion
- Exact internal variable naming, component sub-structure
- Whether to use `scrollIntoView` vs manual `scrollTop` assignment for auto-scroll
- Whether `autoScroll` is managed as a `useRef` (for effect reads) + `useState` (for render) pair
- Error UI design on LogPage when SSH exec fails

### Deferred Ideas (OUT OF SCOPE)
- Log search/filter
- Log download (save to file)
- Timestamps toggle
- Line count configuration (user-selectable tail size)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOGS-01 | User can open a live log view for any container | "Logs" button → `/logs/:containerId` route → LogPage; research confirms ProtectedRoute nesting pattern |
| LOGS-02 | Logs stream in real time via WebSocket | WS route `GET /api/containers/:id/logs`; useLogStream hook pattern confirmed identical to useContainerEvents |
| LOGS-03 | Last N lines of existing logs shown immediately on open | `docker logs --tail 200` delivers tail on connect; no buffering gap — first chunk arrives before follow starts streaming new lines |
| LOGS-04 | Log stream cleanly terminated when user closes the log view | `stream.destroy()` (calls end+close) + `conn.end()` in WS close handler; confirmed from ssh2 Channel.js source |
</phase_requirements>

---

## Summary

Phase 4 is a pattern-reuse phase. Every major technical primitive already exists in the codebase from Phases 2–3: the SSH exec pattern (`sshExec`), the NDJSON buffer (`docker-events.ts`), the WebSocket route shape (`container-events.ts`), and the hook lifecycle (`useContainerEvents`). The divergence points are small and well-bounded: (1) the log SSH connection is short-lived per client rather than global, (2) teardown must be active not passive (destroy the channel when WS closes), and (3) ANSI rendering is added client-side with `ansi-to-html`.

**The critical risk is LOGS-04 (no lingering file descriptors).** `docker logs --follow` is a long-running process attached to an SSH exec channel. On WS disconnect, the server must call `stream.destroy()` (not just `stream.close()`) to send both the stream EOF and the SSH channel close. This guarantees the remote `docker logs` process gets a broken pipe on its next write and terminates. `conn.end()` must follow to close the SSH TCP connection entirely.

**Secondary risk is XSS via `dangerouslySetInnerHTML`.** Log output is user-controlled (containers can write anything to stdout). `ansi-to-html` must be constructed with `escapeXML: true` to HTML-encode `<`, `>`, `&` before ANSI conversion. Without this option, malicious log output could inject HTML into the log view.

**Primary recommendation:** Treat this as a diff on Phase 3. New server file = container-events.ts + teardown. New hook = useContainerEvents + line accumulation. New page = a scroll container + ansi-to-html render + Resume button. Every piece has a direct prototype in the existing codebase.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Container ID validation | API / Backend (preHandler) | — | Prevents shell injection before SSH exec; must happen server-side before any credential use |
| SSH exec (`docker logs`) | API / Backend | — | Runs on server; SSH credentials never leave server |
| NDJSON line splitting | API / Backend | — | Chunks arrive at server; split before sending over WS |
| WebSocket transport | API / Backend ↔ Browser | — | Bidirectional channel; server owns lifecycle, client owns teardown trigger via close event |
| ANSI → HTML conversion | Browser / Client | — | CPU-light per-line transform; no server overhead; keeps raw ANSI in WS messages (server stays dumb) |
| XSS prevention (`escapeXML`) | Browser / Client | — | Point of insertion into DOM; must escape at the render layer |
| Auto-scroll logic | Browser / Client | — | Pure DOM interaction; scroll position is a browser concept |
| 5 000-line memory cap | Browser / Client | — | Client-side array bound; prevents runaway memory on verbose containers |
| Route auth enforcement | Browser / Client (ProtectedRoute) + API | — | Belt-and-suspenders: ProtectedRoute redirects unauthenticated users; preHandler rejects unauthenticated WS upgrades |

---

## Package Legitimacy Audit

> Required — Phase 4 installs `ansi-to-html` in `packages/web`.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `ansi-to-html` | npm | ~14 yrs (created 2012-09-16) | ~2.3M/week | [github.com/rburns/ansi-to-html](https://github.com/rburns/ansi-to-html) | [OK] | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none  
**Packages flagged as suspicious [SUS]:** none

**Additional notes:**
- `ansi-to-html@0.7.2` ships its own TypeScript declarations at `./lib/ansi_to_html.d.ts` — no `@types/ansi-to-html` needed. [VERIFIED: npm registry]
- No `postinstall` script. [VERIFIED: npm registry]
- Last modified 2022-06-13; actively downloaded. Maintenance status: stable/maintenance mode — no new features expected, which is fine for this use case.

**Installation command (runs in `packages/web`):**
```bash
pnpm add ansi-to-html
```

---

## Pattern 1: SSH Exec Teardown for `docker logs --follow` (LOGS-04)

**What goes wrong without this:** `docker logs --follow` keeps running on the remote server after the client disconnects. File descriptors accumulate. After N clients open and close the log view, the server has N zombie processes.

### ssh2 Channel.js — confirmed teardown methods [VERIFIED: source code]

From `/packages/server/node_modules/ssh2/lib/Channel.js`:
```javascript
close() {
  if (this.outgoing.state === 'open' || this.outgoing.state === 'eof') {
    this.outgoing.state = 'closing';
    this._client._protocol.channelClose(this.outgoing.id);  // SSH_MSG_CHANNEL_CLOSE
  }
}

destroy() {
  this.end();    // marks stream writable=false, sends stream EOF
  this.close();  // sends SSH_MSG_CHANNEL_CLOSE
  return this;
}
```

**Use `stream.destroy()`, not `stream.close()`** because:
- `close()` alone sends the SSH channel close but does NOT call `end()` — the Node.js Duplex stream may not be properly torn down
- `destroy()` calls both: stream-level EOF + SSH protocol close
- This matches what STATE.md says: _"Log stream leak — `logStream.destroy()` must fire in the WS `close` handler"_

### How `docker logs` dies [ASSUMED — based on standard POSIX pipe semantics]

When `stream.destroy()` is called:
1. SSH_MSG_CHANNEL_CLOSE is sent to the remote SSH server
2. The remote SSH server closes the exec channel's stdout/stdin pipes
3. On the next write attempt, `docker logs --follow` receives SIGPIPE (broken pipe)
4. `docker logs` terminates immediately

### Canonical teardown pattern for container-logs.ts

```typescript
// Inside the WS handler:
client.on('ready', () => {
  client.exec(`docker logs --follow --tail 200 ${id} 2>&1`, (err, stream) => {
    if (err) {
      socket.close()
      try { client.end() } catch { /* ignore */ }
      return
    }

    let buffer = ''
    stream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''  // keep incomplete fragment
      for (const line of lines) {
        if (line && socket.readyState === 1) {
          socket.send(JSON.stringify({ type: 'log', line }))
        }
      }
    })

    stream.on('close', () => {
      try { client.end() } catch { /* ignore */ }
    })

    // LOGS-04: clean teardown on WS disconnect
    socket.on('close', () => {
      stream.destroy()          // end() + SSH channel close → SIGPIPE to docker logs
      try { client.end() } catch { /* ignore */ }
    })

    socket.on('error', () => {
      stream.destroy()
      try { client.end() } catch { /* ignore */ }
    })
  })
})
```

**Key difference from Phase 3's DockerEventsManager:** No reconnect, no global instance. This is a simple 1-to-1 pipe that tears down completely when the WS closes.

---

## Pattern 2: `ansi-to-html` API Surface + XSS Prevention

### Package API [VERIFIED: github.com/rburns/ansi-to-html README]

```javascript
import Convert from 'ansi-to-html'

const convert = new Convert({
  escapeXML: true,   // REQUIRED: HTML-encode <, >, & before ANSI conversion (XSS prevention)
  stream: true,      // Maintain ANSI state across calls (handles reset codes that span lines)
  fg: '#e4e4e7',    // Default foreground (zinc-200) — matches LogPage dark theme
  bg: '#09090b',    // Default background (zinc-950)
})

// Per-line usage:
const html = convert.toHtml(line)  // returns safe HTML string
```

**Options that matter for this phase:**

| Option | Default | What to use | Why |
|--------|---------|-------------|-----|
| `escapeXML` | `false` | **`true`** | Log output is user-controlled; must escape HTML before insertion into DOM |
| `stream` | `false` | **`true`** | Maintains color state across `toHtml()` calls; handles ANSI resets that appear on subsequent lines |
| `newline` | `false` | `false` | Lines are individually newline-stripped; `<br>` not needed |

### XSS threat model [ASSUMED — standard web security]

Without `escapeXML: true`:
```
log line: "error: <script>alert(1)</script>"
→ convert.toHtml() produces: "error: <script>alert(1)</script>"
→ dangerouslySetInnerHTML inserts active script tag
```

With `escapeXML: true`:
```
log line: "error: <script>alert(1)</script>"
→ convert.toHtml() produces: "error: &lt;script&gt;alert(1)&lt;/script&gt;"
→ dangerouslySetInnerHTML renders it as literal text — safe
```

### React render pattern

```typescript
// In LogPage.tsx:
import Convert from 'ansi-to-html'

const converter = useMemo(() => new Convert({
  escapeXML: true,
  stream: true,
  fg: '#e4e4e7',
  bg: '#09090b',
}), [])

// Per-line rendering:
{lines.map((line, i) => (
  <div
    key={i}
    dangerouslySetInnerHTML={{ __html: converter.toHtml(line) }}
  />
))}
```

**Important:** Create ONE `Convert` instance (via `useMemo`) for the component lifetime. With `stream: true`, state is maintained across calls — creating a new instance per line loses color persistence across lines.

---

## Pattern 3: `@fastify/websocket` WS Handler with URL Params

**Context:** Phase 3's `container-events.ts` WS route has NO URL params. Phase 4's `/api/containers/:id/logs` introduces a `:id` param — a new pattern in this codebase.

### Confirmed from existing REST route pattern [VERIFIED: packages/server/src/routes/containers.ts]

The REST routes already use typed params:
```typescript
type ActionParams = { id: string }

fastify.post<{ Params: ActionParams }>(
  `/api/containers/:id/start`,
  async (request: FastifyRequest<{ Params: ActionParams }>, reply: FastifyReply) => {
    const { id } = request.params  // ← fully typed
  }
)
```

### WS route with params — same generic syntax [VERIFIED: @fastify/websocket type definitions]

From `packages/server/node_modules/@fastify/websocket/types/index.d.ts`:
```typescript
export type WebsocketHandler<
  RequestGeneric extends RequestGenericInterface = RequestGenericInterface,
  ...
> = (
  this: FastifyInstance,
  socket: WebSocket.WebSocket,
  request: FastifyRequest<RequestGeneric, ...>
) => void | Promise<any>
```

The `RequestGeneric` type flows through — same as REST routes. **Pattern:**

```typescript
type LogParams = { id: string }

export const containerLogsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: LogParams }>(
    '/api/containers/:id/logs',
    {
      websocket: true,
      preHandler: [
        verifyAuth,
        async (request: FastifyRequest<{ Params: LogParams }>, reply) => {
          const { id } = request.params
          if (!isValidContainerId(id)) {
            return reply.status(400).send({ error: 'Invalid container ID' })
          }
        },
      ],
    },
    (socket: WebSocket, req: FastifyRequest<{ Params: LogParams }>) => {
      const { id } = req.params  // fully typed, already validated
      // ...
    }
  )
}
```

### Validation in preHandler vs in handler [VERIFIED: @fastify/websocket behavior from Phase 3 auth pattern]

`preHandler` runs **before** the WebSocket upgrade (D-P4-05 says "returns 400 on invalid ID"). This is the established pattern — `verifyAuth` already does this to reject unauthenticated WS connections with 401. Same mechanism applies for returning 400 on invalid ID.

Returning `reply.status(400).send(...)` in a preHandler sends an HTTP 400 response and **prevents** the WebSocket upgrade from happening. The WS client sees an HTTP 400 Not a valid WebSocket connection error.

---

## Pattern 4: React Router v6 — Adding `/logs/:containerId` Route

### Current App.tsx structure [VERIFIED: packages/web/src/App.tsx]

```tsx
<BrowserRouter>
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/" element={<ProtectedRoute />}>
      <Route index element={<DashboardPage />} />
    </Route>
  </Routes>
</BrowserRouter>
```

### ProtectedRoute uses Outlet context [VERIFIED: packages/web/src/components/ProtectedRoute.tsx]

`ProtectedRoute` renders `<Outlet context={{ host, username }}>`. Any nested route receives this context via `useOutletContext()`. `LogPage` can call `useOutletContext<{ host: string; username: string }>()` to get the SSH host/username for display purposes (if needed).

### Adding LogPage — exact diff to App.tsx

```tsx
import { LogPage } from './pages/LogPage'

// Inside Routes:
<Route path="/" element={<ProtectedRoute />}>
  <Route index element={<DashboardPage />} />
  <Route path="logs/:containerId" element={<LogPage />} />  {/* ADD */}
</Route>
```

Note: path is `logs/:containerId` (no leading slash) for nested route.

### Navigating with container name state (D-P4-02)

```typescript
// In DashboardPage.tsx (or ContainerCard via callback):
const navigate = useNavigate()

function handleLogsClick(container: ContainerInfo) {
  navigate(`/logs/${container.id}`, {
    state: { containerName: container.names[0] ?? container.shortId }
  })
}
```

### Reading state in LogPage

```typescript
import { useParams, useLocation, useNavigate } from 'react-router-dom'

export function LogPage() {
  const { containerId } = useParams<{ containerId: string }>()
  const { state } = useLocation()
  const navigate = useNavigate()

  const containerName =
    (state as { containerName?: string } | null)?.containerName
    ?? containerId?.slice(0, 12)
    ?? 'unknown'

  // containerId is guaranteed by route match — safe to use non-null assertion
  const { lines, connected } = useLogStream(containerId!)
  // ...
}
```

### ContainerCard prop change needed

`ContainerCard` needs an `onLogs` callback prop (like `onStart`/`onStop`/`onRestart`) OR the navigate call can happen inside `ContainerCard` directly if it imports `useNavigate`. The cleanest approach consistent with the existing pattern (all actions are callbacks from DashboardPage) is adding `onLogs: (id: string) => void` to `ContainerCardProps`.

---

## Pattern 5: `useLogStream` Hook

### Template from `useContainerEvents` [VERIFIED: packages/web/src/hooks/useContainerEvents.ts]

Direct analogue — same lifecycle, different message handling:

```typescript
// packages/web/src/hooks/useLogStream.ts
import { useEffect, useRef, useState } from 'react'

const MAX_LINES = 5_000  // D-P4-15

export function useLogStream(containerId: string): {
  lines: string[]
  connected: boolean
} {
  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let cancelled = false

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/api/containers/${containerId}/logs`
    )
    wsRef.current = ws

    ws.onopen = () => {
      if (cancelled) { ws.close(); return }
      setConnected(true)
    }

    ws.onmessage = (event) => {
      if (cancelled) return
      try {
        const msg = JSON.parse(event.data as string) as { type: string; line: string }
        if (msg.type === 'log') {
          setLines(prev => {
            const next = [...prev, msg.line]
            // 5 000-line cap: drop oldest (D-P4-15)
            return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
          })
        }
      } catch { /* malformed message — ignore */ }
    }

    ws.onclose = () => {
      if (cancelled) return
      setConnected(false)
      // NOTE: No reconnect — log stream is intentionally one-shot per page visit.
      // If the stream dies (container stops, SSH error), user sees "Disconnected" indicator.
    }

    ws.onerror = () => { ws.close() }  // onclose fires after onerror

    return () => {
      cancelled = true
      ws.close()   // triggers WS close → server teardown (LOGS-04)
      setConnected(false)
    }
  }, [containerId])  // re-run if containerId changes (navigation between log views)

  return { lines, connected }
}
```

**Key differences from `useContainerEvents`:**
1. No reconnect logic — log view is ephemeral; if stream dies, show "Disconnected" (user can navigate back and re-open)
2. Accumulates `lines[]` instead of writing to queryClient
3. `containerId` in dependency array (not `queryClient`)
4. 5 000-line cap

---

## Pattern 6: Smart Auto-Scroll (D-P4-12/13)

### The challenge

`lines` state updates → `useEffect` fires → scroll to bottom. But if user has manually scrolled up, DON'T scroll. Need to track "is user at bottom?" across renders.

### Pattern: ref for immediate reads, state for re-renders

```typescript
// In LogPage.tsx:
const scrollContainerRef = useRef<HTMLDivElement>(null)
const bottomSentinelRef = useRef<HTMLDivElement>(null)
const [autoScroll, setAutoScroll] = useState(true)
const autoScrollRef = useRef(true)  // ref copy — read in effects without re-triggering them

// Scroll handler — detects user scroll-up
function handleScroll() {
  const el = scrollContainerRef.current
  if (!el) return
  const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  const atBottom = distFromBottom <= 50  // D-P4-13: 50px threshold
  autoScrollRef.current = atBottom
  setAutoScroll(atBottom)  // triggers Resume button re-render
}

// Auto-scroll when new lines arrive
useEffect(() => {
  if (autoScrollRef.current && bottomSentinelRef.current) {
    bottomSentinelRef.current.scrollIntoView({ behavior: 'instant' })
  }
}, [lines])

// Attach scroll listener
useEffect(() => {
  const el = scrollContainerRef.current
  if (!el) return
  el.addEventListener('scroll', handleScroll, { passive: true })
  return () => el.removeEventListener('scroll', handleScroll)
}, [])  // run once on mount; handleScroll reads ref, no dependency needed
```

### JSX structure

```tsx
<div
  ref={scrollContainerRef}
  className="flex-1 overflow-y-auto bg-zinc-950 font-mono text-sm text-zinc-200"
>
  <div className="p-4 space-y-0">
    {lines.map((line, i) => (
      <div key={i} dangerouslySetInnerHTML={{ __html: converter.toHtml(line) }} />
    ))}
    <div ref={bottomSentinelRef} />  {/* bottom anchor for scrollIntoView */}
  </div>
</div>

{/* Floating Resume button — visible only when user scrolled up */}
{!autoScroll && (
  <button
    onClick={() => {
      autoScrollRef.current = true
      setAutoScroll(true)
      bottomSentinelRef.current?.scrollIntoView({ behavior: 'smooth' })
    }}
    className="absolute bottom-4 right-4 ...floating button styles..."
  >
    ↓ Resume
  </button>
)}
```

**Why `behavior: 'instant'` for auto-scroll:** Smooth scroll has latency; if lines arrive faster than the animation, the view falls behind. Instant scroll keeps the view at the bottom in real time.

---

## Pattern 7: NDJSON Buffer for Log Lines

The Phase 3 `docker-events.ts` buffer pattern applies identically to `docker logs` output:

```typescript
let buffer = ''

stream.on('data', (chunk: Buffer) => {
  buffer += chunk.toString()
  const lines = buffer.split('\n')
  buffer = lines.pop() ?? ''  // keep incomplete last fragment
  for (const line of lines) {
    if (line.trim() && socket.readyState === 1) {
      socket.send(JSON.stringify({ type: 'log', line }))
    }
  }
})
```

**Confirmed:** `docker logs` output is newline-terminated text. Same chunking risk applies: a single TCP packet can contain multiple log lines, or a line can be split across packets. The `split('\n')` + `pop()` pattern handles both cases correctly. [VERIFIED: docker-events.ts in codebase]

**stderr merging:** D-P4-06 says `2>&1` in the command. This merges stderr into stdout at the shell level — `stream.stderr` on the ssh2 client side will be empty. No need to separately listen on `stream.stderr.on('data')`. If stderr merging is not desired (and is changed), add `stream.stderr.on('data', (chunk) => { /* same buffer treatment */ })`.

---

## Pattern 8: Vite Dev Proxy for Multiple WS Paths

### Current vite.config.ts [VERIFIED: packages/web/vite.config.ts]

```typescript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true,
      // NOTE: no 'ws: true' — Vite handles WS upgrades automatically
    },
  },
},
```

**The `/api` prefix-match rule covers ALL paths:**
- `GET /api/containers` (REST) ✓
- `WS /api/containers/events` (Phase 3) ✓  
- `WS /api/containers/:id/logs` (Phase 4) ✓ **— no config changes needed**

[ASSUMED — based on how Vite's http-proxy handles upgrade requests] Vite's proxy (via `http-proxy`) automatically forwards WebSocket upgrade requests for any matched path. The `ws: true` option is for registering a separate WebSocket-only proxy rule; without it, WS upgrades are still forwarded for HTTP proxy rules when an Upgrade header is detected. Phase 3's `useContainerEvents` already works without `ws: true`, confirming this behavior.

**No changes to `vite.config.ts` needed for Phase 4.**

---

## Pattern 9: server.ts Plugin Registration

### Current server.ts [VERIFIED: packages/server/src/server.ts]

```typescript
await fastify.register(websocket)           // already registered (Phase 3)
await registerAuthPlugins(fastify)
fastify.addHook('preHandler', verifyAuth)   // global auth hook
await fastify.register(authRoutes)
await fastify.register(containerRoutes)
await fastify.register(containerEventsRoute)
// → ADD: await fastify.register(containerLogsRoute)
```

The global `preHandler: verifyAuth` hook means the per-route `preHandler: [verifyAuth]` in Phase 3/4 WS routes is belt-and-suspenders redundancy (a project convention per STATE.md). Maintain the pattern.

**Registration order:** `containerLogsRoute` after `containerEventsRoute` — no ordering dependency between them, but consistency with the pattern.

---

## Architectural Responsibility Map (Detailed)

### System Data Flow

```
Browser (LogPage)
  ↓ useNavigate('/logs/:containerId', { state: { containerName } })
  ↓ useLogStream(containerId)
  ↓ WS connect: ws://host/api/containers/:id/logs
        ↓
Fastify (container-logs.ts)
  ↓ preHandler[0]: verifyAuth → 401 if no cookie
  ↓ preHandler[1]: isValidContainerId → 400 if invalid
  ↓ WS upgrade
  ↓ ssh2 Client.connect(session credentials)
  ↓ client.exec('docker logs --follow --tail 200 <id> 2>&1')
        ↓
Remote SSH server → docker logs process (stdout/stderr merged)
  ↓ chunks → NDJSON buffer → split on \n
  ↓ socket.send({ type: 'log', line: '<raw ANSI line>' })
        ↓
Browser (useLogStream)
  ↓ ws.onmessage → append to lines[] (cap at 5 000)
  ↓ LogPage renders lines
  ↓ converter.toHtml(line) with escapeXML:true → safe HTML
  ↓ dangerouslySetInnerHTML
  ↓ auto-scroll to bottom (unless user scrolled up)

[Browser navigates away / closes tab]
  ↓ useEffect cleanup → ws.close()
  ↓ socket.on('close') fires on server
  ↓ stream.destroy() → SSH channel close → docker logs SIGPIPE → process exit
  ↓ conn.end() → SSH TCP connection closes
```

### Recommended Project Structure — New Files

```
packages/
├── server/src/routes/
│   ├── container-events.ts    # Phase 3 (exists)
│   └── container-logs.ts      # Phase 4 NEW
├── web/src/
│   ├── hooks/
│   │   ├── useContainerEvents.ts  # Phase 3 (exists)
│   │   └── useLogStream.ts        # Phase 4 NEW
│   ├── pages/
│   │   ├── DashboardPage.tsx      # Modified: add onLogs handler
│   │   └── LogPage.tsx            # Phase 4 NEW
│   ├── components/
│   │   └── ContainerCard.tsx      # Modified: add Logs button + onLogs prop
│   └── App.tsx                    # Modified: add logs/:containerId route
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ANSI escape code rendering | Custom regex/replace for color codes | `ansi-to-html` | ANSI covers 256 colors, bold, italic, underline, hyperlinks, cursor codes — regex doesn't cover 1% of the spec |
| HTML injection prevention | Manual string sanitization | `ansi-to-html` with `escapeXML: true` | Centralized, tested; DIY misses edge cases (`\0`, surrogate pairs, etc.) |
| SSH channel teardown sequencing | Custom state machine for close order | `stream.destroy()` + `conn.end()` | ssh2's destroy() handles end+close atomically; manual sequencing risks missed cleanup on error paths |

---

## Common Pitfalls

### Pitfall 1: `stream.close()` instead of `stream.destroy()` (LOGS-04)
**What goes wrong:** `stream.close()` sends SSH channel close but does NOT call Node's `stream.end()`. In some Node.js versions, the duplex stream may not emit 'close' cleanly, leaving the SSH channel in a half-open state longer than expected. The remote `docker logs` process may persist until the SSH connection is dropped by keepalive timeout (30+ seconds).  
**How to avoid:** Always use `stream.destroy()` — it calls both `this.end()` and `this.close()`.  
**Warning signs:** Running `docker ps` on the remote server and seeing `docker logs` processes that persist after the browser navigates away.

### Pitfall 2: `ansi-to-html` with `escapeXML: false` (default)
**What goes wrong:** Log lines containing `<`, `>`, `<script>`, `&` render as raw HTML — potential XSS from user-controlled container output.  
**How to avoid:** Always construct `Convert` with `{ escapeXML: true }`.  
**Warning signs:** Any container whose logs contain `<b>text</b>` showing up as bold in the log view.

### Pitfall 3: New `Convert` instance per line
**What goes wrong:** With `stream: false` (default) or a new instance per line, ANSI color state is not maintained across lines. A log line that opens a color but resets on the NEXT line will leave a dangling open `<span>` — corrupting all subsequent rendered HTML.  
**How to avoid:** Create ONE `Convert({ stream: true })` instance in `useMemo` and reuse it for all lines in the component's lifetime.  
**Warning signs:** Color "bleeding" — log lines appearing in the wrong color after a container writes multi-line ANSI sequences.

### Pitfall 4: Missing `onLogs` prop in ContainerCard
**What goes wrong:** DashboardPage calls `<ContainerCard onLogs={...}>` but `ContainerCardProps` doesn't declare it. TypeScript compile error.  
**How to avoid:** Add `onLogs: (id: string) => void` to `ContainerCardProps` interface and wire the button.

### Pitfall 5: 5000-line cap mutating array incorrectly
**What goes wrong:** `prev.slice(-MAX_LINES)` works but `prev.slice(prev.length - MAX_LINES)` is equivalent and explicit. The pitfall is doing `prev.splice(0, ...)` which mutates the array in place — never mutate React state.  
**How to avoid:** `const next = [...prev, newLine]; return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next` — always returns a new array.

### Pitfall 6: Router path with leading slash for nested route
**What goes wrong:** `<Route path="/logs/:containerId">` nested under `<Route path="/">` — the leading slash makes it an absolute path, which React Router v6 expects but can cause unexpected behavior in some configurations.  
**How to avoid:** Use `<Route path="logs/:containerId">` (no leading slash) for nested routes. React Router v6 resolves relative paths automatically.

---

## Open Questions

1. **Container stopped during log stream — behavior** [RESOLVED]
   - What we know: `docker logs --follow` continues reading until the container is removed. If the container stops, `docker logs --follow` stays open waiting for new output (it doesn't exit on container stop, only on container removal with `--since`).
   - What's unclear: Whether Phase 4 should detect this and show a "container stopped" notice.
   - Recommendation: Out of scope for Phase 4 per CONTEXT.md. The WS stream stays connected until the user navigates away. The status badge on DashboardPage (Phase 3) already shows state changes. Accept this behavior for v1.

2. **Container not found (invalid ID passes validation regex but container deleted)** [RESOLVED]  
   - What we know: `isValidContainerId()` validates format only. If the container was deleted between button click and WS connect, `docker logs <id>` will exit with an error code.
   - Recommendation: Emit a `{ type: 'error', message: 'Container not found' }` message and close the WS. `stream.on('close', (code) => { if (code !== 0) /* send error */ })`.

3. **ansi-to-html handling of binary garbage in logs** [NOT RESOLVED]
   - What we know: Some containers write binary data to stdout (e.g., compressed streams). `ansi-to-html` is designed for text; binary will likely corrupt the ANSI state machine.
   - What's unclear: Whether `ansi-to-html` throws on binary input or produces garbled-but-safe output.
   - Recommendation: For v1, accept garbled rendering for binary log output. If it throws, wrap `converter.toHtml(line)` in try/catch and fall back to rendering the raw line escaped.

---

## Validation Architecture

> `workflow.nyquist_validation: true` in config.json — section required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (no new install) — used in Phase 3 VALIDATION.md |
| Config file | None — tests run directly with `node --test` |
| Quick run command | `node --test packages/server/src/**/*.test.ts 2>&1 \| head -50` |
| Full suite command | `cd packages/server && npx tsx --test src/**/*.test.ts` |
| Frontend type check | `cd packages/web && npx tsc --noEmit` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOGS-01 | Logs button renders on ContainerCard and navigates to /logs/:id | Manual / smoke | Navigate in browser, verify URL | ❌ Wave 0 |
| LOGS-02 | WS messages arrive within 1s of container writing to stdout | Integration (manual) | Write to container stdout, observe browser | Manual only |
| LOGS-03 | First message batch contains ~200 lines (--tail 200) | Integration | Count lines in first WS burst | Manual only |
| LOGS-04 | No lingering `docker logs` processes after WS close | Integration (manual) | `ps aux \| grep "docker logs"` on server before/after | Manual only |
| LOGS-04 | `stream.destroy()` + `conn.end()` are called in `socket.on('close')` | Unit (code review) | `npx tsc --noEmit` confirms types compile | ❌ Wave 0 |
| ANSI | `escapeXML: true` prevents HTML injection | Unit | `converter.toHtml('<script>') === '&lt;script&gt;'` | ❌ Wave 0 |
| Types | All new TS files compile without errors | Type check | `cd packages/web && npx tsc --noEmit` | N/A (runs on build) |

### Wave 0 Gaps

- [ ] `packages/server/src/routes/container-logs.test.ts` — covers LOGS-04 teardown registration (unit: confirms socket.on('close') calls stream.destroy)
- [ ] `packages/web/src/hooks/useLogStream.test.ts` — covers 5000-line cap logic (unit: push 5001 lines, assert length === 5000 with oldest dropped)
- [ ] `packages/web/src/utils/ansi-safety.test.ts` — covers escapeXML behavior (unit: `<script>` → `&lt;script&gt;`)

**Existing test infrastructure from Phase 3:**
- `packages/server/src/routes/container-events.test.ts` (if exists) — patterns reusable
- See Phase 3 VALIDATION.md for test runner setup

### Sampling Rate
- **Per task commit:** `cd packages/web && npx tsc --noEmit && cd ../server && npx tsc --noEmit`
- **Per wave merge:** Full TS check + manual smoke test of log page
- **Phase gate:** All 4 success criteria verified manually before `/gsd-verify-work`

---

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1` in config.json.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | `verifyAuth` preHandler — same as all routes (D-20) |
| V3 Session Management | No | Sessions managed by Phase 1; no change |
| V4 Access Control | Yes | `preHandler: [verifyAuth]` before WS upgrade — Docker operations require auth |
| V5 Input Validation | **Yes — critical** | `isValidContainerId()` on `:id` param prevents shell injection; `escapeXML: true` prevents XSS output |
| V6 Cryptography | No | No new crypto; SSH connection uses existing session credentials |

### Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Container ID injection (`; rm -rf /`) | Tampering | `isValidContainerId()` regex `/^[a-zA-Z0-9]{12,64}$/` — allows only hex chars, 12-64 length |
| XSS via ANSI-to-HTML log output | Information disclosure / tampering | `ansi-to-html` with `escapeXML: true` — HTML-encodes all raw content before ANSI conversion |
| Unauthenticated log access | Information disclosure | `preHandler: [verifyAuth]` runs before WS upgrade — 401 before any SSH exec |
| WS connection without valid ID (DoS via leaked container IDs) | DoS | `isValidContainerId()` validation in preHandler — 400 before SSH connection is opened |
| SSH credential exposure via logs | Information disclosure | Raw lines are forwarded as-is — if the container logs credentials, they appear in the UI. Out-of-scope for Phase 4 (application-level concern). |

---

## Environment Availability

> Phase 4 has no new external tool dependencies beyond Phase 3's established environment.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥ 20 | Runtime | ✓ (assumed from Phase 2/3 running) | ≥ 20 LTS | — |
| pnpm | Package manager | ✓ (existing monorepo) | ≥ 8 | — |
| ssh2 | SSH exec for docker logs | ✓ (packages/server/node_modules) | 1.17.0 | — |
| @fastify/websocket | WS upgrade | ✓ (packages/server/node_modules) | 11.2.0 | — |
| ansi-to-html | ANSI rendering | ✗ (not yet installed) | 0.7.2 | No fallback — required for D-P4-10 |

**Missing dependencies with no fallback:**
- `ansi-to-html` — install: `cd packages/web && pnpm add ansi-to-html`

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| xterm.js for log rendering | `ansi-to-html` for log view, xterm.js for SSH terminal | Phase 4 decision | ~2MB bundle savings for log view; xterm.js reserved for Phase 5 PTY |
| `stream.close()` | `stream.destroy()` (preferred) | ssh2 v1.x | Ensures both stream EOF and channel close fire |
| `scroll({ behavior: 'smooth' })` | `scrollIntoView({ behavior: 'instant' })` | — | Prevents scroll animation lag falling behind fast log output |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Vite proxy forwards WS upgrade requests for HTTP proxy rules without `ws: true` | Pattern 8 | If wrong: add `ws: true` to vite.config.ts `/api` proxy rule — low-risk one-line fix |
| A2 | `docker logs --follow` terminates via SIGPIPE when SSH channel closes | Pattern 1 | If wrong: use `stream.signal('KILL')` before destroy() to send SIGKILL via SSH; or prefix command with `timeout 0` |
| A3 | `ansi-to-html` with `stream: true` correctly handles ANSI state across separate `toHtml()` calls | Pattern 2 | If wrong: wrap each line individually (new Convert per line) and accept color-bleeding for multi-line sequences |
| A4 | Binary log data produces garbled but non-throwing output in `ansi-to-html` | Open Questions | If wrong: wrap `converter.toHtml()` in try/catch with raw-text fallback |

---

## Sources

### Primary (HIGH confidence)
- `packages/server/node_modules/ssh2/lib/Channel.js` — ssh2 Channel close/destroy implementation (VERIFIED from installed source)
- `packages/server/node_modules/@fastify/websocket/types/index.d.ts` — WS handler type signatures (VERIFIED from installed types)
- `packages/server/src/routes/containers.ts` — existing typed params pattern to replicate (VERIFIED from codebase)
- `packages/web/src/hooks/useContainerEvents.ts` — hook pattern to follow (VERIFIED from codebase)
- `packages/web/src/App.tsx` + `ProtectedRoute.tsx` — routing and auth wrapper pattern (VERIFIED from codebase)
- `packages/web/vite.config.ts` — proxy config confirming /api covers all sub-paths (VERIFIED from codebase)
- npm registry: `ansi-to-html@0.7.2` — version, age, downloads, types (VERIFIED: npm registry)
- slopcheck: `ansi-to-html [OK]` (VERIFIED: slopcheck run in session)

### Secondary (MEDIUM confidence)
- `github.com/rburns/ansi-to-html/README.md` — API surface, `escapeXML` option documentation (CITED: github.com/rburns/ansi-to-html)

### Tertiary (LOW confidence)
- Vite proxy WS auto-upgrade behavior without `ws: true` — inferred from Phase 3 working and general http-proxy behavior (ASSUMED)
- docker logs SIGPIPE behavior when SSH channel closes — inferred from POSIX pipe semantics (ASSUMED)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified installed, types verified from source
- Architecture: HIGH — all patterns exist verbatim in codebase, diff is small and well-bounded
- Teardown (LOGS-04): HIGH — confirmed from ssh2 Channel.js source + STATE.md pitfall documentation
- ansi-to-html XSS: HIGH — `escapeXML` option confirmed from official README
- Pitfalls: HIGH — derived from source code analysis + STATE.md accumulated pitfalls

**Research date:** 2026-05-25  
**Valid until:** 2026-07-01 (stable libraries; ssh2 and @fastify/websocket APIs change rarely)
