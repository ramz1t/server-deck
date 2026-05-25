# Phase 3: Real-Time Container Status — Pattern Map

**Mapped:** 2026-05-25
**Files analyzed:** 5 (3 new, 2 modified)
**Analogs found:** 4 / 5 (1 new file has no codebase analog)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/server/src/services/docker-events.ts` | service | event-driven | `packages/server/src/services/docker-ssh.ts` | role-match (same ssh2 Client, different lifecycle) |
| `packages/server/src/routes/container-events.ts` | route | event-driven (WS upgrade) | `packages/server/src/routes/containers.ts` | role-match (same FastifyInstance plugin shape + session extraction) |
| `packages/server/src/server.ts` | config | request-response | `packages/server/src/plugins/auth-plugins.ts` | role-match (same `await fastify.register(plugin)` registration pattern) |
| `packages/web/src/pages/DashboardPage.tsx` | component | request-response → event-driven | `packages/web/src/pages/DashboardPage.tsx` (itself) | self-modification |
| `packages/web/src/hooks/useContainerEvents.ts` | hook | event-driven | *(none — no hooks directory exists yet)* | no analog |

---

## Pattern Assignments

---

### `packages/server/src/services/docker-events.ts` (service, event-driven)

**Analog:** `packages/server/src/services/docker-ssh.ts`

**Imports pattern** (lines 1–2):
```typescript
import { Client } from 'ssh2'
import type { SessionData } from '../types/session.js'
```
> Copy this import block verbatim. The new service adds `import type { WebSocket } from 'ws'` for the client Set.

**ssh2 Client connect pattern** (lines 48–56):
```typescript
client.connect({
  host: session.host,
  port: session.port,
  username: session.username,
  password: session.password,
  readyTimeout: 10_000,
  keepaliveInterval: 0,   // ← change to 30_000 for the long-lived events stream
})
```
> In `docker-events.ts`, set `keepaliveInterval: 30_000` and `keepaliveCountMax: 3`. The rest of the connect call is identical.

**Core exec + stream pattern** (lines 34–46):
```typescript
client.on('ready', () => {
  client.exec(command, (err, stream) => {
    if (err) return settle(err, '')
    stream.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    stream.stderr.on('data', () => { /* ignore stderr */ })
    stream.on('close', (code: number) => {
      if (code !== 0) settle(new Error(`docker command exited with code ${code}`), '')
      else settle(null, stdout)
    })
  })
})
```
> Divergence: In `docker-events.ts`, do **not** call `client.end()` in `stream.on('close')` — call `onEnd()` instead to trigger reconnect. Accumulate NDJSON lines via a string buffer, split on `\n`, keep the incomplete last fragment in the buffer.

**Error handling pattern** (line 46):
```typescript
client.on('error', (err) => settle(err, ''))
```
> In `docker-events.ts`, replace `settle(err, '')` with `try { client.end() } catch { /* ignore */ }; onEnd()`.

**`listContainers` reuse** (line 59):
```typescript
export async function listContainers(session: SessionData): Promise<ContainerInfo[]>
```
> Import and call `listContainers(this.session)` from `docker-ssh.js` on every matching Docker event to get the full updated list before broadcasting.

---

### `packages/server/src/routes/container-events.ts` (route, event-driven / WS upgrade)

**Analog:** `packages/server/src/routes/containers.ts`

**Imports pattern** (lines 1–9):
```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import {
  listContainers,
  // ...
} from '../services/docker-ssh.js'
import type { SessionData } from '../types/session.js'
```
> Replace the docker-ssh imports with:
```typescript
import type { FastifyPluginAsync } from 'fastify'
import type { WebSocket } from 'ws'
import { eventsManager } from '../services/docker-events.js'
import type { SessionData } from '../types/session.js'
```

**Session extraction helper** (lines 13–19):
```typescript
function getSession(request: FastifyRequest): SessionData {
  const session = (request as unknown as { session?: SessionData }).session
  if (!session) {
    throw new Error('session missing from request — verifyAuth did not run')
  }
  return session
}
```
> Copy this helper verbatim — identical pattern needed in the WS route to pull `request.session` attached by `verifyAuth`.

**Route registration shell** (lines 22–55):
```typescript
export async function containerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/containers', async (request: FastifyRequest, reply: FastifyReply) => {
    // ...
  })
}
```
> Replace with:
```typescript
export const containerEventsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/containers/events',
    { websocket: true },
    (socket: WebSocket, req: FastifyRequest) => {
      const session = getSession(req)
      eventsManager.addClient(socket, session)
      socket.on('close', () => {
        eventsManager.removeClient(socket)
      })
    }
  )
}
```
> Note: `{ websocket: true }` is the only route option needed — the global `preHandler: verifyAuth` hook already runs before WS upgrade for all routes.

**Error handling pattern** (lines 28–31):
```typescript
try {
  const containers = await listContainers(session)
  return containers
} catch (err) {
  fastify.log.error(err, 'Failed to list containers')
  return reply.status(502).send({ error: 'Failed to connect to Docker on target server' })
}
```
> WS routes do not use `reply` — errors inside the WS handler are caught by the events manager's `broadcastUpdate()` try/catch. No route-level try/catch needed.

---

### `packages/server/src/server.ts` (config, registration — modify)

**Analog:** `packages/server/src/plugins/auth-plugins.ts` + `packages/server/src/server.ts` (self)

**Current plugin registration pattern** (lines 1–5, 29–34):
```typescript
import Fastify from 'fastify'
import { registerAuthPlugins } from './plugins/auth-plugins.js'
import { authRoutes } from './routes/auth.js'
import { containerRoutes } from './routes/containers.js'
import { verifyAuth } from './middleware/verify-auth.js'

// ...
await registerAuthPlugins(fastify)
fastify.addHook('preHandler', verifyAuth)
await fastify.register(authRoutes)
await fastify.register(containerRoutes)
```

**How to extend** — insert websocket plugin registration before routes (between `registerAuthPlugins` and `addHook`/route registration):
```typescript
// Add to imports:
import websocket from '@fastify/websocket'
import { containerEventsRoute } from './routes/container-events.js'

// Add inside buildServer(), BEFORE any route registrations:
await fastify.register(websocket)

// Add after containerRoutes registration:
await fastify.register(containerEventsRoute)
```
> `@fastify/websocket` **must** be registered before all routes. The existing `fastify.addHook('preHandler', verifyAuth)` at line 31 fires before the WS upgrade for the events route — no additional auth setup is needed.

**Plugin registration pattern from `auth-plugins.ts`** (lines 6–14):
```typescript
export async function registerAuthPlugins(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifyCookie)
  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET!,
    cookie: { cookieName: 'sd_token', signed: false },
  })
}
```
> `await fastify.register(websocket)` follows this exact same one-liner pattern with no options object needed.

---

### `packages/web/src/pages/DashboardPage.tsx` (component, event-driven — modify)

**Analog:** itself — `packages/web/src/pages/DashboardPage.tsx`

**Current imports block** (lines 1–9):
```typescript
import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Server, RefreshCw, AlertCircle, Layers, ChevronRight } from 'lucide-react'
import { api } from '../lib/axios'
import { ContainerCard } from '../components/ContainerCard'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
```
> Add one import:
```typescript
import { useContainerEvents } from '../hooks/useContainerEvents'
```

**Current polling setup** (lines 88–98):
```typescript
const {
  data: containers,
  isLoading,
  isError,
  error,
  refetch,
} = useQuery<ContainerInfo[]>({
  queryKey: ['containers'],
  queryFn: fetchContainers,
  refetchInterval: 5000,
})
```
> Replace with:
```typescript
const wsConnected = useContainerEvents(queryClient)

const {
  data: containers,
  isLoading,
  isError,
  error,
  refetch,
} = useQuery<ContainerInfo[]>({
  queryKey: ['containers'],
  queryFn: fetchContainers,
  refetchInterval: wsConnected ? false : 5000,   // D-P3-13
})
```
> `useContainerEvents` is called before `useQuery` so the `wsConnected` boolean is available for `refetchInterval`. The `queryClient` ref is already available from `useQueryClient()` at line 85 — pass it to the hook.

**"reconnecting" indicator placement** — insert into existing header JSX (lines 156–180):
```tsx
{/* inside the header, after the ServerDeck brand span: */}
{!wsConnected && (
  <span className="text-xs text-yellow-400 animate-pulse">reconnecting…</span>
)}
```
> Use the `wsConnected` boolean returned from `useContainerEvents`. The header's `flex items-center gap-2` container (line 158) accommodates the extra inline element without layout changes.

---

### `packages/web/src/hooks/useContainerEvents.ts` (hook, event-driven — NEW)

**No codebase analog** — no `hooks/` directory exists yet. Use RESEARCH.md Pattern 7 as the authoritative reference.

**Directory to create:** `packages/web/src/hooks/` (new directory)

**Imports pattern** — modeled after `DashboardPage.tsx` React hook imports (lines 1, 3):
```typescript
import { useEffect, useRef, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
```
> `@tanstack/react-query` is already installed. Import `QueryClient` type only — `useQueryClient()` is called at the call site (DashboardPage), not inside this hook.

**Type definitions** — modeled after `DashboardPage.tsx` interface style (lines 10–18):
```typescript
interface ContainerInfo {
  id: string
  shortId: string
  names: string[]
  image: string
  status: string
  state: string
  createdAt: string
}

interface WsMessage {
  type: 'containers'
  data: ContainerInfo[]
}
```
> `ContainerInfo` is currently defined inline in `DashboardPage.tsx` — duplicate it here until a shared types package is created.

**Hook signature** — follows React hooks convention (`use` prefix, returns primitive):
```typescript
export function useContainerEvents(queryClient: QueryClient): boolean {
  const [wsConnected, setWsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelay = useRef(1000)
  // ...
  return wsConnected
}
```

**useEffect cleanup pattern** — modeled after React 19 conventions (no deps that change frequently; ws instance lives in a ref):
```typescript
useEffect(() => {
  function connect() { /* ... */ }
  connect()

  return () => {
    // Cleanup on unmount — prevent reconnect after component removal
    if (timerRef.current) clearTimeout(timerRef.current)
    wsRef.current?.close()
  }
}, [queryClient])  // queryClient is stable (from useQueryClient())
```

**WebSocket URL construction** — copy from RESEARCH.md Pattern 7 (handles http vs https):
```typescript
const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const url = `${proto}//${window.location.host}/api/containers/events`
const ws = new WebSocket(url)
```
> Native browser `WebSocket` automatically includes the `sd_token` httpOnly cookie for same-origin connections — no `withCredentials` option (that's XMLHttpRequest-only).

**Exponential backoff** — copy from RESEARCH.md Pattern 7:
```typescript
ws.onclose = () => {
  setWsConnected(false)
  const delay = retryDelay.current
  retryDelay.current = Math.min(delay * 2, 30_000)
  timerRef.current = setTimeout(connect, delay)
}
ws.onerror = () => {
  ws.close()  // triggers onclose → schedules reconnect
}
```

**Cache injection** — from RESEARCH.md Pattern 6 (TanStack Query v5 verified):
```typescript
ws.onmessage = (evt: MessageEvent<string>) => {
  try {
    const msg = JSON.parse(evt.data) as WsMessage
    if (msg.type === 'containers') {
      queryClient.setQueryData(['containers'], msg.data)
    }
  } catch { /* ignore malformed JSON */ }
}
```

---

## Shared Patterns

### Session Extraction (request → SessionData)
**Source:** `packages/server/src/routes/containers.ts` lines 13–19
**Apply to:** `container-events.ts` route (copy `getSession()` helper verbatim)
```typescript
function getSession(request: FastifyRequest): SessionData {
  const session = (request as unknown as { session?: SessionData }).session
  if (!session) {
    throw new Error('session missing from request — verifyAuth did not run')
  }
  return session
}
```

### Authentication Middleware (preHandler)
**Source:** `packages/server/src/middleware/verify-auth.ts` lines 1–25
**Apply to:** `container-events.ts` — no new code needed; the global `fastify.addHook('preHandler', verifyAuth)` in `server.ts` line 31 already intercepts the WS upgrade request. `@fastify/websocket` README confirms preHandler runs before upgrade.
```typescript
// verify-auth.ts — runs automatically for /api/containers/events
await request.jwtVerify()
const session = getSession(request.user.sessionId)
if (!session) return reply.status(401).send({ error: 'Unauthorized' })
;(request as unknown as Record<string, unknown>)['session'] = session
```

### Error Handling (SSH exec failures)
**Source:** `packages/server/src/routes/containers.ts` lines 28–31
**Apply to:** `docker-events.ts` `broadcastUpdate()` — use silent catch (same pattern as containers route, but without `reply`):
```typescript
// containers.ts style: log + return error response
fastify.log.error(err, 'Failed to list containers')
return reply.status(502).send({ error: '...' })

// docker-events.ts adaptation: log + skip (next event will retry)
} catch (err) {
  // SSH exec failure — next Docker event will retry the list fetch
}
```

### Plugin Registration
**Source:** `packages/server/src/plugins/auth-plugins.ts` lines 6–14
**Apply to:** `server.ts` — `await fastify.register(websocket)` follows the same one-liner `await fastify.register(plugin)` pattern used for every plugin in this codebase.

### Import Path Convention
**Source:** All existing server files (e.g., `docker-ssh.ts` line 2, `containers.ts` line 9)
**Apply to:** All new server files
```typescript
// Use .js extension on all relative imports (TypeScript project with Node16/ESM resolution)
import type { SessionData } from '../types/session.js'
import { eventsManager } from '../services/docker-events.js'
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/web/src/hooks/useContainerEvents.ts` | hook | event-driven | No `hooks/` directory exists; no WebSocket hooks anywhere in the frontend. Use RESEARCH.md Pattern 7 as reference. |

---

## Metadata

**Analog search scope:** `packages/server/src/`, `packages/web/src/`
**Files scanned:** 12 source files (all non-UI files in both packages)
**Pattern extraction date:** 2026-05-25
