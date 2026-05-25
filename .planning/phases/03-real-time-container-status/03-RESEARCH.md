# Phase 3: Real-Time Container Status — Research

**Researched:** 2026-05-25
**Domain:** WebSocket (Fastify), SSH2 long-lived streaming, Docker Events NDJSON, TanStack Query v5 cache injection
**Confidence:** HIGH

---

## Summary

Phase 3 replaces the 5-second `refetchInterval` poll with a live push pipeline: a persistent SSH exec running `docker events --format '{{json .}}'` on Server B, a server-side events manager that filters container events and broadcasts the full container list via WebSocket to all connected browsers. The implementation splits into three bounded sub-problems:

**1. Server:** Register `@fastify/websocket` plugin, add a WS route at `GET /api/containers/events` protected by the existing `verifyAuth` preHandler, and build a singleton `DockerEventsManager` (`docker-events.ts`) that owns one long-lived SSH Client for the events stream, a `Set<WebSocket>` of connected browser clients, and the broadcast logic.

**2. SSH long-lived streaming:** Unlike `sshExec()` in `docker-ssh.ts` (which calls `conn.end()` when the stream closes), the events connection must keep the Client alive indefinitely. The SSH `keepaliveInterval` option maintains the TCP connection; on stream `close` or Client `error`, an exponential-backoff reconnect loop restarts the stream.

**3. Frontend:** A `useContainerEvents` hook opens a native `WebSocket` to the events endpoint, calls `queryClient.setQueryData(['containers'], data)` on each message, and dynamically sets `refetchInterval: false` on the existing `useQuery` while connected (re-enabling 5s polling as fallback on disconnect). Reconnect with exponential backoff (1 s → 2 s → … → 30 s max).

**Primary recommendation:** Implement the events manager as a pure TypeScript class/module (`docker-events.ts`) that is credential-agnostic at construction — the first WS client that connects passes its `request.session` to start the stream. This avoids the need to poll `session-store.ts` for credentials and keeps the flow synchronous.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-P3-01:** Docker events captured via persistent SSH exec: `docker events --format '{{json .}}'`
- **D-P3-02:** One global SSH connection for events stream, opened lazily on first WS client connect. Reconnect with exponential backoff (1 s → max 30 s).
- **D-P3-03:** Event types that trigger a refresh: `start`, `stop`, `die`, `kill`, `restart`, `pause`, `unpause`, `create`, `destroy`
- **D-P3-04:** On each matching event → call existing `listContainers()` → broadcast full list to all WS clients
- **D-P3-05:** Events SSH session (long-lived) separate from per-request sessions (short-lived)
- **D-P3-06:** SSH credentials for events stream come from first authenticated user's `request.session`; stream stays open on logout
- **D-P3-07:** Browser push via WebSocket using `@fastify/websocket ^11.2.0`
- **D-P3-08:** Endpoint: `GET /api/containers/events` — preHandler auth before WS handshake
- **D-P3-09:** Server maintains `Set<WebSocket>` of connected clients; broadcasts `{ type: 'containers', data: ContainerInfo[] }`
- **D-P3-10:** On WS client connect, immediately push current container list
- **D-P3-11:** No heartbeat/ping-pong for v1
- **D-P3-12:** Frontend uses `queryClient.setQueryData(['containers'], data)` on WS message
- **D-P3-13:** Keep initial `useQuery` fetch; disable `refetchInterval` once WS connected; re-enable if WS disconnects
- **D-P3-14:** Reconnect with exponential backoff (1 s → 2 s → 4 s → max 30 s). Show "reconnecting…" indicator.
- **D-P3-15:** WS managed in `useContainerEvents` hook

### Agent's Discretion
- Exact module path for the global events manager (e.g., `packages/server/src/services/docker-events.ts`)
- Whether to use `fastify.websocketServer.clients` or own `Set<WebSocket>` for broadcast
- Reconnect backoff implementation (setTimeout vs utility)
- Whether `useContainerEvents` uses `useRef` for WS instance or `useEffect`-scoped variable

### Deferred Ideas (OUT OF SCOPE)
- Per-container delta push (only changed container) — needs `docker inspect` per event
- WS heartbeat/reconnect from server side (ping/pong)
- Multi-user broadcast isolation
- Docker stats streaming (CPU/memory)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONT-03 | Container list updates in real time when containers start, stop, or change state | @fastify/websocket WS route (D-P3-07, D-P3-08) + SSH exec `docker events` stream (D-P3-01) + TanStack Query cache injection via `setQueryData` (D-P3-12) |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Docker event stream (producer) | API/Backend | — | ssh2 exec is server-side; no browser access to SSH |
| WS broadcast logic | API/Backend | — | Server owns the `Set<WebSocket>` and calls `socket.send()` |
| WS endpoint + auth gate | API/Backend | — | `@fastify/websocket` route with preHandler; Fastify handles upgrade |
| Container list refresh on event | API/Backend | — | Calls existing `listContainers()` SSH exec |
| WS connection lifecycle | Browser/Client | — | Native `WebSocket` in `useContainerEvents` hook |
| Cache update on WS message | Browser/Client | — | `queryClient.setQueryData` in React hook |
| Fallback polling when WS down | Browser/Client | — | Dynamic `refetchInterval` on `useQuery` |
| Reconnect backoff (client) | Browser/Client | — | `useContainerEvents` hook manages retry timers |

---

## Standard Stack

### Core — Server
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@fastify/websocket` | `^11.2.0` | WS upgrade, routing, auth lifecycle | Official Fastify plugin; preHandler hooks run before upgrade — same auth hook works for HTTP and WS |
| `@types/ws` | `^8.18.1` | TypeScript types for `WebSocket`, `WebSocket.Server` | Required because `@fastify/websocket` wraps `ws` and returns `ws` types |
| `ssh2` | `^1.17.0` | Long-lived SSH exec stream | Already used for per-request exec; same Client API, different lifecycle |

[VERIFIED: npm registry] — `@fastify/websocket` 11.2.0 (published 2025-07-14), `@types/ws` 8.18.1 (published 2025-04-01), `ssh2` 1.17.0 confirmed

### Core — Frontend
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native `WebSocket` | Browser API | WS connection from React hook | No extra package; cookie sent automatically for same-origin |
| `@tanstack/react-query` | `^5.100.14` | `queryClient.setQueryData` cache injection | Already installed; v5 API verified |

### Installation
```bash
# Server package only — frontend uses native WebSocket
cd packages/server
npm install @fastify/websocket
npm install --save-dev @types/ws
```

---

## Package Legitimacy Audit

| Package | Registry | Age | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|
| `@fastify/websocket` | npm | ~3 yrs (created 2022-04-27) | [OK] | Approved — official Fastify org package |
| `@types/ws` | npm | ~9 yrs (created 2016-05-17) | [OK] | Approved — DefinitelyTyped |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Browser                    Fastify Server (Server A)              Server B (Docker host)
──────                     ─────────────────────────              ──────────────────────
DashboardPage
  │
  ├─ useQuery(['containers'])
  │    queryFn: GET /api/containers ──────────────────────────── ssh2 exec: docker ps -a
  │
  └─ useContainerEvents(queryClient)
       │
       ├─ new WebSocket('/api/containers/events')
       │    │
       │    │  WS Upgrade request (with sd_token cookie)
       │    │──────────────────────────────────────────►
       │    │                │
       │    │          preHandler: verifyAuth
       │    │          (rejects 401 if no valid session)
       │    │                │
       │    │          WS route handler
       │    │          DockerEventsManager.addClient(socket)
       │    │                │
       │    │                ├─ if not started: startStream(request.session)
       │    │                │    │
       │    │                │    └─► ssh2 Client.connect()
       │    │                │             │
       │    │                │        Client.exec('docker events --format {{json .}}')
       │    │                │             │
       │    │                │        stream.on('data') ─► NDJSON line buffer
       │    │                │             │
       │    │                │        parse line → check Type==='container' && Action in set
       │    │                │             │
       │    │                │        (matching event) ──► listContainers(session) [short-lived ssh2]
       │    │                │                                │
       │    │                │                         broadcast { type:'containers', data:[...] }
       │    │                │                                │
       │    │◄──────────────────────────────────────────────┤
       │    │  WS message                                    │
       │    │                                         for each ws in clients Set
       │    │                                           ws.send(JSON.stringify(payload))
       │    │
       ├─ ws.onmessage → queryClient.setQueryData(['containers'], msg.data)
       ├─ ws.onopen  → setWsConnected(true), retryDelay = 1000
       └─ ws.onclose → setWsConnected(false), schedule reconnect(retryDelay)

DashboardPage
  useQuery refetchInterval: wsConnected ? false : 5000
```

### Recommended Project Structure
```
packages/server/src/
├── services/
│   ├── docker-ssh.ts         # Existing: sshExec, listContainers, ContainerInfo
│   ├── docker-events.ts      # NEW: DockerEventsManager singleton
│   └── session-store.ts      # Existing: add getAnySession() export
├── routes/
│   ├── containers.ts         # Existing REST routes
│   └── container-events.ts   # NEW: WS route GET /api/containers/events
└── server.ts                 # Register @fastify/websocket BEFORE routes

packages/web/src/
├── hooks/
│   └── useContainerEvents.ts # NEW: WS hook with backoff reconnect
└── pages/
    └── DashboardPage.tsx     # Modify: use hook, dynamic refetchInterval
```

### Pattern 1: @fastify/websocket Route Registration

**What:** Plugin must be registered before any routes; WS routes use `{ websocket: true }` flag.

**Critical:** `@fastify/websocket` must be registered before all routes in order to intercept WebSocket connections. [VERIFIED: github.com/fastify/fastify-websocket README]

```typescript
// Source: github.com/fastify/fastify-websocket README (verified)
import websocket from '@fastify/websocket'
import type { WebSocket } from 'ws'

// In server.ts — BEFORE route registrations
await fastify.register(websocket)

// Then register routes
await fastify.register(containerEventsRoute)
```

```typescript
// In routes/container-events.ts
import type { FastifyPluginAsync } from 'fastify'
import type { WebSocket } from 'ws'
import { eventsManager } from '../services/docker-events.js'
import type { SessionData } from '../types/session.js'

export const containerEventsRoute: FastifyPluginAsync = async (fastify) => {
  // The global fastify.addHook('preHandler', verifyAuth) from server.ts
  // fires before WS upgrade for this route — no separate preHandler needed.
  // D-P3-08: auth is enforced by existing global hook.
  fastify.get(
    '/api/containers/events',
    { websocket: true },
    (socket: WebSocket, req) => {
      const session = (req as unknown as Record<string, unknown>)['session'] as SessionData

      eventsManager.addClient(socket, session)

      socket.on('close', () => {
        eventsManager.removeClient(socket)
      })
    }
  )
}
```

**Note on global preHandler vs per-route preHandler:** The existing `fastify.addHook('preHandler', verifyAuth)` in `server.ts` runs for ALL routes including WS upgrades. The `@fastify/websocket` README confirms: *"Hooks that run before the websocket connection is established will be called — this includes onRequest, preParsing, preValidation, and preHandler."* So no duplicate auth logic is needed. [VERIFIED: github.com/fastify/fastify-websocket README]

### Pattern 2: @fastify/websocket TypeScript Types

```typescript
// Import WebSocket type from 'ws' (which @fastify/websocket wraps)
import type { WebSocket } from 'ws'

// fastify.websocketServer is WebSocket.Server (from ws library)
// It has .clients: Set<WebSocket> — but we maintain our own Set per D-P3-09
// fastify.websocketServer.clients is available as alternative

// The WS handler's socket parameter is WebSocket (from ws)
// Type declaration for the handler:
type WsHandler = (socket: WebSocket, req: FastifyRequest) => void
```

### Pattern 3: ssh2 Long-Lived Exec Stream

**What:** Unlike `sshExec()` which calls `conn.end()` on stream close, the events manager keeps the Client alive and uses `keepaliveInterval` to maintain the connection.

```typescript
// Source: github.com/mscdex/ssh2 README — connect options (verified)
import { Client } from 'ssh2'
import type { SessionData } from '../types/session.js'

function startEventsStream(session: SessionData, onLine: (line: string) => void, onEnd: () => void) {
  const client = new Client()
  let buffer = ''

  client.on('ready', () => {
    client.exec("docker events --format '{{json .}}'", (err, stream) => {
      if (err) {
        client.end()
        onEnd()
        return
      }

      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        // NDJSON: split on newlines, keep incomplete last line in buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim()) onLine(line)
        }
      })

      stream.stderr.on('data', () => { /* ignore */ })

      // For `docker events`, stream.close fires if docker daemon restarts
      // or the connection drops. Do NOT call client.end() here — onEnd handles reconnect.
      stream.on('close', () => {
        try { client.end() } catch { /* ignore */ }
        onEnd()
      })
    })
  })

  client.on('error', (err) => {
    console.error('Events SSH error:', err.message)
    try { client.end() } catch { /* ignore */ }
    onEnd()
  })

  client.connect({
    host: session.host,
    port: session.port,
    username: session.username,
    password: session.password,
    readyTimeout: 10_000,
    keepaliveInterval: 30_000,   // SSH-level keepalive every 30s [VERIFIED: ssh2 README]
    keepaliveCountMax: 3,         // Disconnect after 3 missed keepalives [VERIFIED: ssh2 README]
  })

  return client
}
```

**Key difference from `sshExec()`:** Do NOT call `client.end()` in the stream `close` handler during normal operation — the `onEnd` callback triggers the reconnect loop instead.

### Pattern 4: Exponential Backoff Reconnect (Server Side)

```typescript
// Source: [ASSUMED] — standard backoff pattern
const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MAX_MS = 30_000

class DockerEventsManager {
  private sshClient: Client | null = null
  private session: SessionData | null = null
  private clients = new Set<WebSocket>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = BACKOFF_INITIAL_MS
  private isRunning = false

  addClient(ws: WebSocket, session: SessionData) {
    this.clients.add(ws)
    if (!this.isRunning) {
      this.session = session
      this.retryDelay = BACKOFF_INITIAL_MS
      this.startStream()
    } else {
      // D-P3-10: immediate push on connect
      this.pushCurrentList()
    }
  }

  removeClient(ws: WebSocket) {
    this.clients.delete(ws)
    // NOTE: do NOT stop the stream when all clients disconnect (D-P3-02)
  }

  private startStream() {
    if (!this.session) return
    this.isRunning = true
    this.sshClient = startEventsStream(
      this.session,
      (line) => this.handleLine(line),
      () => this.scheduleReconnect()
    )
  }

  private scheduleReconnect() {
    this.isRunning = false
    this.reconnectTimer = setTimeout(() => {
      this.retryDelay = Math.min(this.retryDelay * 2, BACKOFF_MAX_MS)
      this.startStream()
    }, this.retryDelay)
  }

  private handleLine(line: string) {
    try {
      const event = JSON.parse(line) as { Type: string; Action: string }
      const CONTAINER_ACTIONS = new Set(['start','stop','die','kill','restart','pause','unpause','create','destroy'])
      if (event.Type === 'container' && CONTAINER_ACTIONS.has(event.Action)) {
        this.broadcastUpdate()
      }
    } catch { /* skip malformed JSON */ }
  }

  private async broadcastUpdate() {
    if (!this.session || this.clients.size === 0) return
    try {
      const containers = await listContainers(this.session)
      const payload = JSON.stringify({ type: 'containers', data: containers })
      // Snapshot clients at broadcast time — Set may change during await
      for (const ws of Array.from(this.clients)) {
        if (ws.readyState === ws.OPEN) {
          ws.send(payload)
        }
      }
    } catch { /* SSH exec failure — next event will retry */ }
  }

  private async pushCurrentList() {
    if (!this.session) return
    try {
      const containers = await listContainers(this.session)
      // ... same broadcast to all clients
    } catch { /* ignore */ }
  }
}

export const eventsManager = new DockerEventsManager()
```

### Pattern 5: Docker Events NDJSON Schema

`docker events --format '{{json .}}'` outputs one JSON object per newline. [VERIFIED: docker/cli docs — github.com/docker/cli/docs/reference/commandline/system_events.md]

```typescript
// Typical event shape from --format '{{json .}}'
interface DockerEvent {
  Type: 'container' | 'image' | 'network' | 'volume' | 'daemon' | 'plugin'
  Action: string  // 'start' | 'stop' | 'die' | 'kill' | etc.
  Actor: {
    ID: string                  // container ID
    Attributes: Record<string, string>  // e.g. { image: 'nginx:latest', name: 'my-container' }
  }
  scope: 'local' | 'swarm'
  time: number          // Unix timestamp (seconds)
  timeNano: number      // Unix timestamp (nanoseconds)
}
```

**Filter logic:**
```typescript
const WATCHED_ACTIONS = new Set(['start', 'stop', 'die', 'kill', 'restart', 'pause', 'unpause', 'create', 'destroy'])

if (event.Type === 'container' && WATCHED_ACTIONS.has(event.Action)) {
  // trigger listContainers + broadcast
}
```

### Pattern 6: TanStack Query v5 — setQueryData

[VERIFIED: tanstack.com/query/v5/docs/reference/QueryClient]

```typescript
// Synchronous cache update — no network round-trip
// updater can be a value or a function
queryClient.setQueryData(['containers'], newContainerArray)

// If updater function returns undefined, no update occurs (safe for missing data)
queryClient.setQueryData(['containers'], (old) => {
  if (!old) return undefined
  return newContainerArray
})
```

**Important:** Updates must be immutable — do NOT mutate the old array. Always pass a new array reference.

### Pattern 7: React useContainerEvents Hook

```typescript
// Source: [ASSUMED] — standard React WebSocket hook pattern
import { useEffect, useRef, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { ContainerInfo } from '../types' // or inline

interface WsMessage {
  type: 'containers'
  data: ContainerInfo[]
}

export function useContainerEvents(queryClient: QueryClient): boolean {
  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelay = useRef(1000)

  useEffect(() => {
    function connect() {
      // Native WS: cookie sent automatically for same-origin (no withCredentials needed)
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${proto}//${window.location.host}/api/containers/events`
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setWsConnected(true)
        retryDelay.current = 1000  // reset on successful connect
      }

      ws.onmessage = (evt: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(evt.data) as WsMessage
          if (msg.type === 'containers') {
            queryClient.setQueryData(['containers'], msg.data)
          }
        } catch { /* ignore malformed */ }
      }

      ws.onclose = () => {
        setWsConnected(false)
        const delay = retryDelay.current
        retryDelay.current = Math.min(delay * 2, 30_000)
        timerRef.current = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        ws.close()  // triggers onclose which schedules reconnect
      }
    }

    connect()

    return () => {
      // Cleanup on unmount — prevent reconnect loop after unmount
      if (timerRef.current) clearTimeout(timerRef.current)
      if (wsRef.current) {
        // Override onclose before closing to prevent triggering reconnect
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [queryClient])  // queryClient is stable — no re-runs expected

  return wsConnected
}
```

### Pattern 8: DashboardPage.tsx — Dynamic refetchInterval

```typescript
// In DashboardPage.tsx
const wsConnected = useContainerEvents(queryClient)

const { data: containers, isLoading, isError, error, refetch } = useQuery<ContainerInfo[]>({
  queryKey: ['containers'],
  queryFn: fetchContainers,
  refetchInterval: wsConnected ? false : 5000,  // D-P3-13
})
```

### Pattern 9: Reconnecting Indicator

```tsx
// D-P3-14: show "reconnecting…" in header when WS disconnected (after initial page load)
// Only show after first connect attempt — don't flash on initial load
const [hasConnectedOnce, setHasConnectedOnce] = useState(false)

useEffect(() => {
  if (wsConnected) setHasConnectedOnce(true)
}, [wsConnected])

// In header JSX:
{hasConnectedOnce && !wsConnected && (
  <span className="text-xs text-yellow-400 animate-pulse">reconnecting…</span>
)}
```

### Anti-Patterns to Avoid

- **Calling `conn.end()` in stream `close` for long-lived connection:** The short-lived `sshExec()` calls `client.end()` on stream close — correct for that pattern. For the events stream, calling `client.end()` in the `close` handler is still correct (cleaning up the old client before reconnecting) — but the key is that reconnect is triggered by `onEnd` callback, NOT by stream success.
- **Using `fastify.websocketServer.clients` for broadcast:** The `ws` library's built-in clients Set includes ALL WS connections, not just the events route. Maintain a dedicated `Set<WebSocket>` in the events manager.
- **Not snapshotting clients before async broadcast:** `await listContainers()` takes time; by the time it resolves, clients may have disconnected. Always snapshot: `Array.from(this.clients)` before the async call.
- **Sending on non-OPEN sockets:** Always check `ws.readyState === ws.OPEN` (i.e., `WebSocket.OPEN` = 1) before calling `ws.send()`.
- **Not nullifying `ws.onclose` on cleanup:** If `useEffect` cleanup calls `ws.close()` without nullifying `onclose` first, the `onclose` handler fires and schedules a reconnect timer after unmount, causing a memory leak.
- **Registering `@fastify/websocket` after routes:** From official README: plugin must be registered BEFORE all routes that use `{ websocket: true }`.
- **Attaching async message handlers in WS route without synchronous setup:** The `@fastify/websocket` README warns: *"Websocket route handlers must attach event handlers synchronously during handler execution to avoid accidentally dropping messages."* Ensure `socket.on('close', ...)` is attached synchronously.
- **NDJSON not buffered per chunk:** SSH stream delivers data in chunks that may split a JSON line mid-object. Always buffer and split on `\n`, keeping the last incomplete fragment.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WS upgrade + auth lifecycle | Custom HTTP upgrade handler | `@fastify/websocket` + existing `preHandler` hook | Upgrade handling is 50+ lines of raw HTTP; plugin handles it with proper error status codes |
| WS types in TypeScript | `any` cast for socket | `import type { WebSocket } from 'ws'` | `@fastify/websocket` ships TS types that reference `ws` types |
| NDJSON streaming parse | Custom framing protocol | `buffer.split('\n')` with leftover tracking | Docker events guarantee newline-delimited — no need for a streaming JSON parser |
| SSH keepalive | Manual ping-pong over SSH exec | `keepaliveInterval` option on `ssh2` Client.connect() | ssh2 implements SSH-level keepalive (RFC 4254 §4) natively |

---

## Common Pitfalls

### Pitfall 1: @fastify/websocket Registered After Routes
**What goes wrong:** WS upgrade requests fall through to normal HTTP handlers and return 404 or 426.
**Why it happens:** `@fastify/websocket` intercepts upgrade events on `fastify.server`; if routes register before this, the WS upgrade event is missed.
**How to avoid:** In `server.ts`, register `fastify.register(websocket)` before `fastify.register(containerEventsRoute)` and before `fastify.register(containerRoutes)`.
**Warning signs:** `101 Switching Protocols` is never returned; browser console shows WS connection error.

### Pitfall 2: Incomplete NDJSON Lines in SSH Stream Chunks
**What goes wrong:** `JSON.parse(line)` throws on every event because SSH delivers data in chunks that split JSON objects mid-line.
**Why it happens:** TCP/SSH fragmentation; `docker events` outputs one JSON object per line but the SSH stream delivers arbitrary byte chunks.
**How to avoid:** Maintain a string buffer: `buffer += chunk.toString()`. Split on `\n`, process complete lines, keep the last (possibly incomplete) fragment in `buffer`.
**Warning signs:** `SyntaxError: Unexpected end of JSON input` appearing ~50% of events; some events silently dropped.

### Pitfall 3: WS.send() on Closed Sockets During Broadcast
**What goes wrong:** `Error: WebSocket is not open` thrown during `broadcastUpdate()` when a client disconnects between the `await listContainers()` call and the send loop.
**Why it happens:** `listContainers()` is async (~100–500 ms SSH exec); a client can disconnect in that window.
**How to avoid:** Check `ws.readyState === ws.OPEN` (value `1`) before `ws.send()`. Also snapshot `Array.from(this.clients)` before the async call.
**Warning signs:** Unhandled error events in Fastify logs referencing WebSocket send.

### Pitfall 4: Event Storm — Multiple Rapid Events Triggering Redundant SSH Calls
**What goes wrong:** `docker restart` fires `stop` + `die` + `start` in rapid succession, causing 3 parallel `listContainers()` SSH calls and 3 broadcasts within 100 ms.
**Why it happens:** Each NDJSON line is processed immediately with no deduplication.
**How to avoid:** Simple debounce: clear a pending timer on each matching event and set a new 150 ms timer before calling `broadcastUpdate()`.
**Warning signs:** Multiple identical broadcasts reaching the browser in quick succession; `listContainers()` SSH errors from connection contention.

### Pitfall 5: useEffect Cleanup Race on Unmount
**What goes wrong:** After `DashboardPage` unmounts (e.g., user logs out), the WS `onclose` fires and schedules a reconnect timer. The timer fires, creates a new WebSocket, which triggers auth failure (session cleared) or a phantom connection.
**Why it happens:** `ws.close()` in cleanup triggers `onclose`, which schedules `setTimeout(connect, delay)`.
**How to avoid:** Before `ws.close()`, set `wsRef.current.onclose = null` (and `onerror = null`) so the handlers do not fire during intentional cleanup.

### Pitfall 6: SSH Events Client Credentials Lost on Server Restart
**What goes wrong:** After a server restart, no WS clients are connected yet, so `eventsManager.session` is `null`. If a WS client connects and the manager is asked to restart the stream but `session` was cleared, the stream never starts.
**Why it happens:** `session` is stored in-memory in the events manager class; it is reset on server restart.
**How to avoid:** `session` is set from `request.session` of the FIRST WS client that connects post-restart. Because `verifyAuth` runs before the WS handler, `request.session` is always valid when the handler runs. Design: `addClient(ws, session)` passes session, which is stored if not already present. This is correct by construction — the first client after restart re-supplies credentials.

### Pitfall 7: queryClient.setQueryData Mutating oldData
**What goes wrong:** React Query's internal checks or Strict Mode dev warnings fire; UI updates are inconsistent.
**Why it happens:** `setQueryData` requires immutable updates — mutating the existing array bypasses React's re-render detection.
**How to avoid:** Always pass the new array from `listContainers()` directly: `queryClient.setQueryData(['containers'], containers)`. Never spread-mutate the old value.
**Warning signs:** TanStack Query dev tools show stale data; list doesn't update in Strict Mode.

---

## Code Examples

### Complete WS Route Registration in server.ts
```typescript
// Source: @fastify/websocket README [VERIFIED: github.com/fastify/fastify-websocket]
import websocket from '@fastify/websocket'
import { containerEventsRoute } from './routes/container-events.js'

export async function buildServer() {
  const fastify = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })

  // ... content type parser ...
  await registerAuthPlugins(fastify)

  fastify.addHook('preHandler', verifyAuth)  // protects ALL routes including WS

  // ⚠️ MUST register @fastify/websocket BEFORE all routes
  await fastify.register(websocket)

  await fastify.register(authRoutes)
  await fastify.register(containerRoutes)
  await fastify.register(containerEventsRoute)  // WS route last is fine, but websocket plugin first

  fastify.get('/health', async () => ({ ok: true }))
  return fastify
}
```

### NDJSON Line Buffer (Server)
```typescript
// Source: [ASSUMED] — documented pattern for streaming NDJSON
let buffer = ''

stream.on('data', (chunk: Buffer) => {
  buffer += chunk.toString()
  const lines = buffer.split('\n')
  buffer = lines.pop() ?? ''   // keep incomplete last line
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as DockerEvent
      handleEvent(event)
    } catch {
      // Skip non-JSON lines (e.g. Docker daemon warnings) — same pattern as listContainers()
    }
  }
})
```

### WS readyState Guard
```typescript
// Source: MDN WebSocket.readyState [ASSUMED — well-known browser API constant]
import WebSocket from 'ws'  // ws library constant: ws.OPEN === 1

for (const ws of Array.from(this.clients)) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(payload)
  }
}
```

### Debounce for Event Storm Prevention
```typescript
// Source: [ASSUMED] — standard debounce pattern
private broadcastDebounceTimer: ReturnType<typeof setTimeout> | null = null

private scheduleBroadcast() {
  if (this.broadcastDebounceTimer) clearTimeout(this.broadcastDebounceTimer)
  this.broadcastDebounceTimer = setTimeout(() => {
    this.broadcastDebounceTimer = null
    void this.broadcastUpdate()
  }, 150)
}
```

---

## Session Store: Required Addition

`session-store.ts` currently exports `setSession`, `getSession`, `deleteSession` only.

The events manager uses `request.session` passed from the WS handler (set by `verifyAuth`) — so `getAnySession()` is **NOT required** for the primary flow described in D-P3-06.

However, to support reconnect after the events SSH Client drops (and no new WS clients connect for a while), the events manager needs to re-establish the SSH connection using stored credentials. Since `session` is stored as a class field on the manager singleton after the first client connect, it is available for reconnects without accessing `session-store.ts` again. ✓ No changes to `session-store.ts` are needed.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `refetchInterval: 5000` polling | WS push + `setQueryData` cache injection | This phase | Reduces SSH exec calls from 12/min to event-driven (typically <1/min); sub-2s latency |
| Short-lived ssh2 Client per exec | Long-lived ssh2 Client with `keepaliveInterval` | This phase | New pattern; must not accidentally import the short-lived pattern from docker-ssh.ts |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ (macOS) | `>=20` assumed | — |
| `@fastify/websocket` | WS server | ✗ (not yet in package.json) | 11.2.0 on npm | — (must install) |
| `@types/ws` | TypeScript | ✗ (devDep) | 8.18.1 on npm | — (must install) |
| Native `WebSocket` (browser) | Frontend hook | ✓ all modern browsers | ES2015+ | — |
| `docker events` CLI | Server B | ✓ (assumed standard Docker) | — | — |

**Missing dependencies with no fallback:**
- `@fastify/websocket` — must be installed in `packages/server`
- `@types/ws` — must be installed as devDependency in `packages/server`

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected (no test config found) |
| Config file | None — Wave 0 must scaffold |
| Quick run command | `node --test packages/server/test/**/*.test.js` (if using Node built-in test) |
| Full suite command | same |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONT-03 | WS message received when container state changes | integration (manual/smoke) | Run docker stop + observe browser | ❌ Wave 0 |
| CONT-03 | WS auth: unauthenticated upgrade returns 401 | unit | `fastify.injectWS('/api/containers/events')` without cookie → expect close with 401 | ❌ Wave 0 |
| CONT-03 | `setQueryData` updates rendered list | manual | Open dashboard, run `docker stop <name>` from CLI, verify badge flips | manual only |
| CONT-03 | Reconnect after WS close | unit | Close WS server-side, verify client reconnects within 2 s | ❌ Wave 0 |

**Note on `fastify.injectWS`:** `@fastify/websocket` exposes `fastify.injectWS(path, upgradeContext)` for testing WS routes without a network socket. [VERIFIED: github.com/fastify/fastify-websocket README — Testing section]

### Wave 0 Gaps
- [ ] `packages/server/test/container-events.test.ts` — covers CONT-03 auth + basic connect
- [ ] Test infrastructure: decide on Node built-in `node:test` (already available, no install) vs vitest

---

## Security Domain

`security_enforcement: true` — ASVS Level 1 applies.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | **yes** | Cookie JWT verified via `verifyAuth` preHandler before WS upgrade |
| V3 Session Management | **yes** | Session validity checked in `verifyAuth` (session-store lookup) |
| V4 Access Control | **yes** | All WS routes reject 401 before upgrade per D-P3-08 |
| V5 Input Validation | **yes** | Docker event JSON parsed with try/catch; malformed lines skipped |
| V6 Cryptography | no | No new crypto — JWT signing handled by `@fastify/jwt` (Phase 1) |

### Known Threat Patterns for WebSocket + SSH stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| WS upgrade without auth check | Elevation of Privilege | `preHandler` runs before upgrade (confirmed: `@fastify/websocket` docs); existing `verifyAuth` covers this |
| Cross-Site WebSocket Hijacking | Spoofing | `SameSite=Strict` cookie (set in Phase 1 D-04) prevents cross-origin cookie send; same-origin WS origin check is enforced by browser |
| SSH credential exposure in WS messages | Information Disclosure | Session credentials are never sent to clients; only `ContainerInfo[]` payload is broadcast |
| Docker event injection | Tampering | Events are read-only; we parse and filter them, never exec based on event content directly |
| Broadcast to stale sockets | DoS (resource leak) | `readyState === OPEN` guard + explicit `removeClient` in WS `close` handler prevents accumulation |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The global `fastify.addHook('preHandler', verifyAuth)` in `server.ts` fires for WS routes — no separate per-route preHandler needed | Pattern 1, Security Domain | If wrong, the WS route is publicly accessible; mitigation: add explicit `preHandler: [verifyAuth]` to the WS route definition as belt-and-suspenders |
| A2 | `docker events --format '{{json .}}'` never terminates unless Docker daemon stops or connection is killed | Pattern 3 | If `docker events` has a timeout flag or exit behavior we haven't found, the stream closes unexpectedly; the reconnect loop handles this correctly either way |
| A3 | React's `queryClient` reference is stable across renders (not recreated) | Pattern 7 | If recreated, `useEffect` re-runs and reconnects unnecessarily; use `useQueryClient()` from TanStack Query which returns a stable ref |
| A4 | Debounce at 150 ms is sufficient to batch rapid Docker events | Code Examples | If Docker fires events spaced >150 ms apart, no debounce benefit; adjust threshold at runtime |

---

## Open Questions

1. **`verifyAuth` global hook + WS route interaction**
   - What we know: `@fastify/websocket` README confirms preHandler runs before WS upgrade [VERIFIED]
   - What's unclear: Whether Fastify's global hook is applied to plugin-encapsulated routes from `containerEventsRoute` if registered in a different plugin scope
   - Recommendation: Add `preHandler: [verifyAuth]` explicitly on the WS route as belt-and-suspenders (belt = global hook, suspenders = explicit per-route hook). This costs nothing and eliminates the ambiguity.

2. **Event debouncing necessity**
   - What we know: `docker restart` generates 3 events; `docker stop` generates 2 events
   - What's unclear: Whether rapid-fire events cause observable issues in practice for a single-user tool
   - Recommendation: Implement 150 ms debounce from the start; it's 4 lines of code and prevents SSH contention.

---

## Sources

### Primary (HIGH confidence)
- `github.com/fastify/fastify-websocket` README — plugin registration order, preHandler lifecycle, TypeScript types, `injectWS` testing API, `websocketServer.clients`
- `github.com/mscdex/ssh2` README — `keepaliveInterval`, `keepaliveCountMax`, `readyTimeout` connect options
- `github.com/docker/cli/docs/reference/commandline/system_events.md` — container event types, `--format '{{json .}}'` JSON Lines output
- `tanstack.com/query/v5/docs/reference/QueryClient` — `setQueryData(queryKey, updater)` API, immutability requirement

### Secondary (MEDIUM confidence)
- npm registry — package versions and publish dates verified (`@fastify/websocket` 11.2.0, `@types/ws` 8.18.1)
- slopcheck — `@fastify/websocket` [OK], `@types/ws` [OK]

### Tertiary (LOW confidence)
- Debounce pattern, React hook cleanup pattern, WS URL construction — [ASSUMED] well-known patterns; no specific source

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `@fastify/websocket` README read directly, npm versions verified
- Architecture: HIGH — @fastify/websocket TypeScript types read directly from GitHub
- Pitfalls: HIGH for WS/ssh2 specifics (verified from source code and docs); MEDIUM for React hook patterns (assumed)
- Docker events schema: HIGH — official docker/cli docs confirmed event types and `{{json .}}` output format

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (stable libraries; @fastify/websocket v12 not yet signaled)
