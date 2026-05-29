# Phase 7: Personal Config & Server Stats — Pattern Map

**Mapped:** 2025-05-26
**Files analyzed:** 12 (7 modified, 5 created)
**Analogs found:** 12 / 12

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/server/src/index.ts` *(modify)* | config/entrypoint | fail-fast guard | same file (lines 4-8) | exact |
| `packages/server/src/middleware/verify-auth.ts` *(modify)* | middleware | request-response | same file (line 4) | exact |
| `packages/server/src/routes/config.ts` *(create)* | route | request-response | `routes/containers.ts` + `server.ts /health` | role-match |
| `packages/server/src/routes/auth.ts` *(modify)* | route | request-response | same file (lines 6-64) | exact |
| `packages/server/src/routes/stats.ts` *(create)* | route | request-response | `routes/containers.ts` | exact |
| `packages/server/src/server.ts` *(modify)* | server bootstrap | config | same file (lines 7-12, 45-51) | exact |
| `packages/server/src/types/session.ts` *(no change needed)* | type | — | same file | exact |
| `packages/web/src/lib/axios.ts` *(modify)* | utility | request-response | same file (lines 1-6) | exact |
| `packages/web/src/pages/LoginPage.tsx` *(modify)* | page component | request-response | same file | exact |
| `packages/web/src/pages/DashboardPage.tsx` *(modify)* | page component | CRUD | same file | exact |
| `packages/web/src/components/StatsPanel.tsx` *(create)* | component | request-response | `ContainerCard.tsx` + `DashboardPage.tsx` | role-match |
| `packages/web/src/components/DomainHealthWidget.tsx` *(create)* | component | request-response | `ContainerCard.tsx` + `DashboardPage.tsx` fetch pattern | role-match |

---

## Pattern Assignments

---

### `packages/server/src/index.ts` *(modify — add SSH env guards)*

**Analog:** same file

**Existing fail-fast pattern** (`packages/server/src/index.ts` lines 4-8):
```typescript
// Fail fast if JWT_SECRET is not configured or too short (WR-01, ASVS V2.7.6)
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and at least 32 characters. Server cannot start.')
  process.exit(1)
}
```

**New guards to add immediately after line 8** — copy the same pattern three times:
```typescript
if (!process.env.SSH_HOST) {
  console.error('FATAL: SSH_HOST must be set. Server cannot start.')
  process.exit(1)
}

if (!process.env.SSH_USERNAME) {
  console.error('FATAL: SSH_USERNAME must be set. Server cannot start.')
  process.exit(1)
}

const _sshPort = Number(process.env.SSH_PORT ?? 22)
if (!Number.isInteger(_sshPort) || _sshPort < 1 || _sshPort > 65535) {
  console.error('FATAL: SSH_PORT must be a valid port number (1-65535).')
  process.exit(1)
}
```

**Key rule:** `process.exit(1)` + `console.error('FATAL: ...')` is the project-wide pattern for startup failures.

---

### `packages/server/src/middleware/verify-auth.ts` *(modify — add /api/config to public paths)*

**Analog:** same file

**Current EXCLUDED_PATHS** (`verify-auth.ts` line 4):
```typescript
const EXCLUDED_PATHS = ['/api/auth/login', '/api/auth/logout', '/health']
```

**Change to:**
```typescript
const EXCLUDED_PATHS = ['/api/auth/login', '/api/auth/logout', '/api/config', '/health']
```

**No other changes.** The rest of `verifyAuth` (lines 6-30) is untouched.

---

### `packages/server/src/routes/config.ts` *(create — new public endpoint)*

**Analog:** `packages/server/src/routes/containers.ts` (structure) + the `/health` route in `server.ts` line 51 (simplest public route pattern)

**Plugin registration pattern** (`containers.ts` lines 23-24):
```typescript
export async function containerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/containers', async (request: FastifyRequest, reply: FastifyReply) => {
```

**Imports pattern** (`containers.ts` lines 1-2):
```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
```

**Full skeleton for `config.ts`:**
```typescript
import type { FastifyInstance } from 'fastify'

// GET /api/config — public (no auth); returns env-configured host for the login page heading
export async function configRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/config', async () => {
    return {
      host: process.env.SSH_HOST ?? '',
    }
  })
}
```

**Notes:**
- No `FastifyRequest`/`FastifyReply` imports needed — inline arrow return is sufficient (mirrors `/health` pattern in `server.ts` line 51: `fastify.get('/health', async () => ({ ok: true }))`)
- No auth — route is excluded via `EXCLUDED_PATHS` in `verify-auth.ts`
- No schema declaration needed for a simple read-only response

---

### `packages/server/src/routes/auth.ts` *(modify — body shrinks to `{ password }` only)*

**Analog:** same file

**Current `LoginBody` type** (lines 6-11):
```typescript
type LoginBody = {
  host: string
  port: number
  username: string
  password: string
}
```

**Replace with:**
```typescript
type LoginBody = {
  password: string
}
```

**Current schema** (lines 22-30):
```typescript
required: ['host', 'port', 'username', 'password'],
properties: {
  host: { type: 'string', minLength: 1 },
  port: { type: 'integer', minimum: 1, maximum: 65535 },
  username: { type: 'string', minLength: 1 },
  password: { type: 'string', minLength: 1 },
},
```

**Replace with:**
```typescript
required: ['password'],
properties: {
  password: { type: 'string', minLength: 1 },
},
```

**Current destructure + call** (lines 34-36):
```typescript
const { host, port, username, password } = request.body

const result = await validateSshCredentials(host, port, username, password)
```

**Replace with:**
```typescript
const { password } = request.body
const host = process.env.SSH_HOST!
const port = Number(process.env.SSH_PORT ?? 22)
const username = process.env.SSH_USERNAME!

const result = await validateSshCredentials(host, port, username, password)
```

**Session store call** (line 49) — stays the same but now populates from env:
```typescript
setSession(sessionId, { host, port, username, password })
```

**`/api/auth/me` response** (line 91) stays the same:
```typescript
return { ok: true, host: session.host, port: session.port, username: session.username }
```

**Imports** (lines 1-4) — **no change needed**. The `validateSshCredentials` and `setSession`/`getSession`/`deleteSession` imports are unchanged.

---

### `packages/server/src/routes/stats.ts` *(create — new authenticated route)*

**Analog:** `packages/server/src/routes/containers.ts` — same structure: plugin function, `getSession(request)`, `sshExec` call, try/catch with `502`.

**`getSession` helper** (`containers.ts` lines 14-21):
```typescript
function getSession(request: FastifyRequest): SessionData {
  const session = (request as unknown as { session?: SessionData }).session
  if (!session) {
    throw new Error('session missing from request — verifyAuth did not run')
  }
  return session
}
```
Copy this helper verbatim — it is used the same way in every authenticated route file.

**Route handler pattern** (`containers.ts` lines 24-33):
```typescript
fastify.get('/api/containers', async (request: FastifyRequest, reply: FastifyReply) => {
  const session = getSession(request)
  try {
    const containers = await listContainers(session)
    return containers
  } catch (err) {
    fastify.log.error(err, 'Failed to list containers')
    return reply.status(502).send({ error: 'Failed to connect to Docker on target server' })
  }
})
```

**`sshExec` is private in `docker-ssh.ts`** (line 20). Do NOT export it. Instead, add and export a new `getServerStats` function in `docker-ssh.ts`, then import and call it from `stats.ts`.

**Full skeleton for `packages/server/src/services/docker-ssh.ts` addition** (add at bottom of file):
```typescript
export interface ServerStats {
  disk: string       // raw output of `df -h /`
  ram: string        // raw output of `free -h`
  uptime: string     // raw output of `uptime`
  mntSdb: string     // raw output of `ls /mnt/sdb` (empty string if not mounted)
}

export async function getServerStats(session: SessionData): Promise<ServerStats> {
  // Run all four commands over separate SSH connections (sshExec opens/closes each time)
  const [disk, ram, uptime, mntSdb] = await Promise.all([
    sshExec(session, 'df -h /'),
    sshExec(session, 'free -h'),
    sshExec(session, 'uptime'),
    sshExec(session, 'ls /mnt/sdb 2>/dev/null || echo ""'),
  ])
  return { disk, ram, uptime, mntSdb }
}
```

**Full skeleton for `stats.ts`:**
```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getServerStats } from '../services/docker-ssh.js'
import type { SessionData } from '../types/session.js'

function getSession(request: FastifyRequest): SessionData {
  const session = (request as unknown as { session?: SessionData }).session
  if (!session) {
    throw new Error('session missing from request — verifyAuth did not run')
  }
  return session
}

export async function statsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = getSession(request)
    try {
      const stats = await getServerStats(session)
      return stats
    } catch (err) {
      fastify.log.error(err, 'Failed to fetch server stats')
      return reply.status(502).send({ error: 'Failed to fetch server stats' })
    }
  })
}
```

---

### `packages/server/src/server.ts` *(modify — register two new route plugins)*

**Analog:** same file

**Current imports block** (lines 7-12):
```typescript
import { authRoutes } from './routes/auth.js'
import { containerRoutes } from './routes/containers.js'
import { containerEventsRoute } from './routes/container-events.js'
import { containerLogsRoute } from './routes/container-logs.js'
import { terminalRoute } from './routes/terminal.js'
```

**Add two new imports** after line 8:
```typescript
import { configRoutes } from './routes/config.js'
import { statsRoutes } from './routes/stats.js'
```

**Current route registration block** (lines 45-49):
```typescript
await fastify.register(authRoutes)
await fastify.register(containerRoutes)
await fastify.register(containerEventsRoute)
await fastify.register(containerLogsRoute)
await fastify.register(terminalRoute)
```

**Add two registrations** — `configRoutes` before `authRoutes` (public, order matters for clarity), `statsRoutes` after `containerRoutes`:
```typescript
await fastify.register(configRoutes)      // public — no auth required
await fastify.register(authRoutes)
await fastify.register(containerRoutes)
await fastify.register(statsRoutes)       // authenticated
await fastify.register(containerEventsRoute)
await fastify.register(containerLogsRoute)
await fastify.register(terminalRoute)
```

---

### `packages/web/src/lib/axios.ts` *(modify — one line)*

**Analog:** same file

**Current `baseURL`** (line 4):
```typescript
  baseURL: '/api',
```

**Replace with:**
```typescript
  baseURL: import.meta.env.VITE_API_BASE || '/api',
```

**Everything else** (lines 1-3, 5-18) is untouched.

---

### `packages/web/src/pages/LoginPage.tsx` *(modify — remove 3 fields, add config fetch for heading)*

**Analog:** same file

**State to REMOVE** (lines 12-14):
```typescript
  const [host, setHost] = useState(() => localStorage.getItem('sd_host') ?? '')
  const [port, setPort] = useState(() => localStorage.getItem('sd_port') ?? '22')
  const [username, setUsername] = useState(() => localStorage.getItem('sd_username') ?? '')
```

**State to ADD** (replace removed lines):
```typescript
  const [host, setHost] = useState<string>('')
```

**`useEffect` to REPLACE** (lines 20-24) — add a second `useEffect` for config fetch:
```typescript
  useEffect(() => {
    api.get('/auth/me')
      .then(() => navigate('/', { replace: true }))
      .catch(() => {})
  }, [navigate])

  useEffect(() => {
    api.get<{ host: string }>('/config')
      .then(({ data }) => setHost(data.host))
      .catch(() => {})
  }, [])
```

**`handleSubmit` body** (lines 32-37) — the post and localStorage calls:
```typescript
      // BEFORE:
      await api.post('/auth/login', { host, port: Number(port), username, password })
      localStorage.setItem('sd_host', host)
      localStorage.setItem('sd_port', port)
      localStorage.setItem('sd_username', username)
      navigate('/')

      // AFTER:
      await api.post('/auth/login', { password })
      navigate('/')
```

**Error handling** (lines 38-52) — REMOVE the `504` and `502` branches (those mean host/port unreachable — irrelevant when credentials are env-fixed). Keep `401`, `429`, and the catch-all. The `504`/`502` branches can stay for now but will never fire; removing them is cleaner:
```typescript
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status
      if (status === 401) {
        setError('Invalid credentials. Check your password.')
      } else if (status === 429) {
        setError('Too many attempts. Wait a minute and try again.')
      } else {
        setError('An unexpected error occurred. Please try again.')
      }
    }
```

**JSX heading** (lines 60-65) — replace static `CardDescription`:
```tsx
        <CardHeader className="space-y-1 pb-4">
          <div className="flex items-center gap-2">
            <Server size={20} className="text-primary" />
            <CardTitle className="text-2xl font-bold">
              {host ? `${host} ServerDeck` : 'ServerDeck'}
            </CardTitle>
          </div>
          <CardDescription>Enter your password to connect</CardDescription>
        </CardHeader>
```

**JSX fields to REMOVE entirely** (lines 69-115): the Host `<div>`, Port `<div>`, and Username `<div>` blocks. Keep only the Password `<div>` (lines 118-142) and everything below it.

**Icons import** (line 8) — remove unused `Server` if replaced; actually `Server` is still used in the header. Remove nothing from imports. The `Eye`, `EyeOff`, `Loader2`, `AlertCircle` icons are all still used.

---

### `packages/web/src/pages/DashboardPage.tsx` *(modify — add stats section and DomainHealthWidget)*

**Analog:** same file

**Imports to ADD** (after line 17):
```typescript
import { StatsPanel } from '../components/StatsPanel'
import { DomainHealthWidget } from '../components/DomainHealthWidget'
```

**Existing `main` content area** (lines 282-356) — the `<main>` wraps a `<div className="max-w-screen-2xl mx-auto space-y-3">`. Add the two new sections **above** the container loading/error/empty/grouped-list section:

```tsx
      <main className="flex-1 overflow-auto px-4 py-4">
        <div className="max-w-screen-2xl mx-auto space-y-3">

          {/* Server stats — always show; StatsPanel handles its own loading state */}
          <StatsPanel />

          {/* Domain health */}
          <DomainHealthWidget />

          {/* Loading skeletons */}
          {isLoading && ...}
          ...
        </div>
      </main>
```

**Context type** (line 34) — `DashboardContext` currently has `{ host, username, port }`. These come from `useOutletContext`. After Phase 7, `host`/`username`/`port` are still returned by `/api/auth/me` (the `me` route reads from session, which is populated from env), so the outlet context shape is **unchanged**.

---

### `packages/web/src/components/StatsPanel.tsx` *(create)*

**Analog:** `DashboardPage.tsx` (useQuery + Skeleton pattern, lines 143-152, 284-298) + `ContainerCard.tsx` (card visual pattern, lines 73-87)

**TanStack Query fetch pattern** (`DashboardPage.tsx` lines 143-152):
```typescript
const {
  data: containers,
  isLoading,
  isError,
  error,
  refetch,
} = useQuery<ContainerInfo[]>({
  queryKey: ["containers"],
  queryFn: fetchContainers,
  refetchInterval: wsConnected ? false : 5000,
})
```

**Skeleton loading pattern** (`DashboardPage.tsx` lines 285-298):
```tsx
{isLoading &&
  Array.from({ length: 3 }).map((_, i) => (
    <div key={i} className="border border-zinc-800 p-4 space-y-3">
      <div className="flex justify-between">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="h-4 w-48" />
    </div>
  ))}
```

**Card visual pattern** (`ContainerCard.tsx` line 73):
```tsx
<div className="rounded-none bg-zinc-800 p-4 space-y-3">
```

**Full skeleton for `StatsPanel.tsx`:**
```tsx
import { useQuery } from '@tanstack/react-query'
import { HardDrive, MemoryStick, Clock, FolderOpen } from 'lucide-react'
import { api } from '../lib/axios'
import { Skeleton } from './ui/skeleton'

interface ServerStats {
  disk: string
  ram: string
  uptime: string
  mntSdb: string
}

async function fetchStats(): Promise<ServerStats> {
  const { data } = await api.get<ServerStats>('/stats')
  return data
}

export function StatsPanel() {
  const { data, isLoading, isError } = useQuery<ServerStats>({
    queryKey: ['stats'],
    queryFn: fetchStats,
    refetchInterval: 30_000,   // refresh every 30 s
  })

  if (isLoading) {
    return (
      <div className="border border-zinc-800 p-4 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
    )
  }

  if (isError || !data) {
    return null  // silent fail — stats are supplementary
  }

  return (
    <div className="border border-zinc-800 divide-y divide-zinc-800">
      <StatRow icon={<Clock className="h-4 w-4 text-muted-foreground" />} label="Uptime" value={data.uptime.trim()} />
      <StatRow icon={<MemoryStick className="h-4 w-4 text-muted-foreground" />} label="RAM" value={data.ram.trim()} />
      <StatRow icon={<HardDrive className="h-4 w-4 text-muted-foreground" />} label="Disk (/)" value={data.disk.trim()} />
      {data.mntSdb && (
        <StatRow icon={<FolderOpen className="h-4 w-4 text-muted-foreground" />} label="/mnt/sdb" value={data.mntSdb.trim()} />
      )}
    </div>
  )
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 bg-zinc-900">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <pre className="text-xs font-mono whitespace-pre-wrap break-all mt-0.5">{value}</pre>
      </div>
    </div>
  )
}
```

**Notes:**
- `queryKey: ['stats']` follows the same string-array convention as `['containers']`
- `refetchInterval: 30_000` — stats change slowly, no need for 5 s polling
- Silent error (`return null`) — stats are supplementary; container list must not be blocked
- `pre` + `whitespace-pre-wrap` renders raw terminal output (df/free/uptime) readably on mobile

---

### `packages/web/src/components/DomainHealthWidget.tsx` *(create)*

**Analog:** `DashboardPage.tsx` fetch + error pattern; `ContainerCard.tsx` visual card pattern; `ContainerCard.tsx` `StateBadge` sub-component pattern (lines 36-59)

**StateBadge pattern** (`ContainerCard.tsx` lines 36-59) — the coloured inline badge:
```tsx
function StateBadge({ state }: { state: string }) {
  let className = ""
  switch (state) {
    case "running":
      className = "bg-green-500/15 text-green-400 border border-green-500/30 text-xs px-2 py-0.5 rounded-none"
      break
    case "exited":
    case "dead":
      className = "bg-zinc-500/15 text-zinc-400 border border-zinc-500/30 text-xs px-2 py-0.5 rounded-none"
      break
    ...
  }
  return <span className={className}>{state}</span>
}
```

**useQuery with manual re-fetch pattern** (`DashboardPage.tsx` lines 247-255):
```tsx
<Button
  variant="ghost"
  size="icon"
  className="h-11 w-11 rounded-none"
  onClick={() => refetch()}
  aria-label="Refresh"
>
  <RefreshCw className="h-4 w-4" />
</Button>
```

**Full skeleton for `DomainHealthWidget.tsx`:**
```tsx
import { useQuery } from '@tanstack/react-query'
import { Globe, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'

// Hardcoded domain list — Phase 7 decision (no config UI yet)
const DOMAINS: string[] = [
  // Add your domains here, e.g.:
  // 'example.com',
  // 'app.example.com',
]

interface DomainStatus {
  domain: string
  ok: boolean
  status?: number
  error?: string
}

async function checkDomains(): Promise<DomainStatus[]> {
  return Promise.all(
    DOMAINS.map(async (domain): Promise<DomainStatus> => {
      try {
        const res = await fetch(`https://${domain}`, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
        return { domain, ok: res.ok || res.status < 500, status: res.status }
      } catch (err) {
        return { domain, ok: false, error: err instanceof Error ? err.message : 'Unreachable' }
      }
    })
  )
}

function StatusBadge({ ok }: { ok: boolean }) {
  // Copy badge style from ContainerCard.tsx StateBadge pattern
  const className = ok
    ? "bg-green-500/15 text-green-400 border border-green-500/30 text-xs px-2 py-0.5 rounded-none"
    : "bg-red-500/15 text-red-400 border border-red-500/30 text-xs px-2 py-0.5 rounded-none"
  return <span className={className}>{ok ? 'up' : 'down'}</span>
}

export function DomainHealthWidget() {
  if (DOMAINS.length === 0) return null

  const { data, isLoading, refetch, isFetching } = useQuery<DomainStatus[]>({
    queryKey: ['domain-health'],
    queryFn: checkDomains,
    refetchInterval: 60_000,   // passive 60 s polling
    retry: false,
  })

  return (
    <div className="border border-zinc-800">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Domains</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-none"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh domain checks"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Domain rows */}
      {isLoading && (
        <div className="px-4 py-3 text-xs text-muted-foreground">Checking…</div>
      )}
      {data?.map((d) => (
        <div key={d.domain} className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 last:border-0">
          <span className="text-sm font-mono truncate">{d.domain}</span>
          <StatusBadge ok={d.ok} />
        </div>
      ))}
    </div>
  )
}
```

**Notes:**
- Uses `fetch` directly (not `api` from `axios.ts`) — domain health checks are external URLs, not the local server API
- `AbortSignal.timeout(8000)` — native browser API, no import needed, supported on iOS 16+ / Android Chrome 108+
- `if (DOMAINS.length === 0) return null` — graceful no-op before any domains are configured
- `retry: false` — domain checks should fail fast, not silently retry 3 times

---

## Shared Patterns

### Auth guard — `EXCLUDED_PATHS` list
**Source:** `packages/server/src/middleware/verify-auth.ts` line 4
**Apply to:** Any new public route (`/api/config`)
```typescript
const EXCLUDED_PATHS = ['/api/auth/login', '/api/auth/logout', '/api/config', '/health']
```
Rule: Add path to this array AND register the route plugin in `server.ts`. Both are required.

### Route plugin shape
**Source:** `packages/server/src/routes/containers.ts` lines 23-24
**Apply to:** `config.ts`, `stats.ts`
```typescript
export async function xyzRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/xyz', async (request, reply) => { ... })
}
```
Rule: named export, `async`, takes `FastifyInstance`, returns `Promise<void>`.

### `getSession` helper
**Source:** `packages/server/src/routes/containers.ts` lines 14-21
**Apply to:** `stats.ts` (and any future authenticated route file)
```typescript
function getSession(request: FastifyRequest): SessionData {
  const session = (request as unknown as { session?: SessionData }).session
  if (!session) {
    throw new Error('session missing from request — verifyAuth did not run')
  }
  return session
}
```
Rule: copy verbatim into each route file that needs it. It is intentionally local (not shared via import) so each file is self-contained.

### 502 error response
**Source:** `packages/server/src/routes/containers.ts` lines 29-32
**Apply to:** `stats.ts`
```typescript
  } catch (err) {
    fastify.log.error(err, 'Failed to list containers')
    return reply.status(502).send({ error: 'Failed to connect to Docker on target server' })
  }
```
Rule: always `fastify.log.error(err, '<description>')` before returning 502 so the error reaches Fastify's JSON logger.

### Cookie/JWT response shape
**Source:** `packages/server/src/routes/auth.ts` lines 48-63
**Apply to:** `auth.ts` (unchanged — login still issues the same cookie)
```typescript
const token = fastify.jwt.sign({ sessionId }, { expiresIn: '7d' })
const isSecure = process.env.NODE_ENV === 'production' || process.env.HTTPS === 'true'
reply.setCookie('sd_token', token, {
  httpOnly: true,
  secure: isSecure,
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60,
  path: '/',
})
return reply.send({ ok: true })
```

### Fail-fast env guard
**Source:** `packages/server/src/index.ts` lines 4-8
**Apply to:** `index.ts` (SSH env var additions)
```typescript
if (!process.env.SOME_VAR) {
  console.error('FATAL: SOME_VAR must be set. Server cannot start.')
  process.exit(1)
}
```

### TanStack Query data-fetch hook
**Source:** `packages/web/src/pages/DashboardPage.tsx` lines 143-152
**Apply to:** `StatsPanel.tsx`, `DomainHealthWidget.tsx`
```typescript
const { data, isLoading, isError, refetch } = useQuery<T>({
  queryKey: ['key'],
  queryFn: fetchFn,
  refetchInterval: N,
})
```

### Badge / status pill
**Source:** `packages/web/src/components/ContainerCard.tsx` lines 36-59
**Apply to:** `DomainHealthWidget.tsx` `StatusBadge`
```tsx
const className = "bg-green-500/15 text-green-400 border border-green-500/30 text-xs px-2 py-0.5 rounded-none"
```
Rule: no `rounded` (the design uses `rounded-none` consistently), colour via `bg-*/15 text-* border border-*/30` pattern.

### Card wrapper
**Source:** `packages/web/src/components/ContainerCard.tsx` line 73
**Apply to:** `StatsPanel.tsx`, `DomainHealthWidget.tsx`
```tsx
<div className="border border-zinc-800 ...">
```
Rule: use `border border-zinc-800` (not shadcn `Card` component) for all dashboard widgets — matches the existing container card style.

---

## No Analog Found

All 12 files have close analogs. No files require falling back to RESEARCH.md patterns.

---

## Metadata

**Analog search scope:** `packages/server/src/`, `packages/web/src/`
**Files read:** 14 source files
**Pattern extraction date:** 2025-05-26
