---
phase: 07-personal-config-server-stats
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/server/src/index.ts
  - packages/server/src/middleware/verify-auth.ts
  - packages/server/src/routes/auth.ts
  - packages/server/src/services/docker-ssh.ts
  - packages/server/src/routes/stats.ts
  - packages/server/src/routes/health.ts
  - packages/server/src/server.ts
  - packages/web/src/lib/axios.ts
  - packages/web/src/pages/LoginPage.tsx
  - packages/web/src/config/domains.ts
  - packages/web/src/components/StatsPanel.tsx
  - packages/web/src/components/DomainHealthWidget.tsx
  - packages/web/src/pages/DashboardPage.tsx
  - packages/server/.env.example
  - packages/web/.env.example
autonomous: true
requirements: [CONF-01, CONF-02, CONF-03, STATS-01, STATS-02, STATS-03, STATS-04, STATS-05]

must_haves:
  truths:
    - "Server refuses to start if SSH_HOST, SSH_PORT, or SSH_USERNAME are missing from .env"
    - "Login page shows '{SSH_HOST} ServerDeck' heading fetched from GET /api/config (no auth)"
    - "Login form has password field only — host/port/username inputs are gone"
    - "GET /api/stats returns parsed disk/RAM/uptime/mntSdb JSON to authenticated callers"
    - "Dashboard shows a stats panel with disk usage, RAM, uptime, and /mnt/sdb listing"
    - "POST /api/health/domains checks each URL server-side and returns up/down + latency"
    - "Dashboard shows domain health badges, refreshed every 60 s"
    - "VITE_API_BASE env var controls axios baseURL at build time; falls back to /api"
  artifacts:
    - path: "packages/server/src/services/docker-ssh.ts"
      provides: "getServerStats(session) — combined SSH call, sentinel parsing, 30s cache"
      exports: ["getServerStats", "ServerStats"]
    - path: "packages/server/src/routes/stats.ts"
      provides: "GET /api/stats authenticated route"
      exports: ["statsRoutes"]
    - path: "packages/server/src/routes/health.ts"
      provides: "POST /api/health/domains authenticated route"
      exports: ["healthRoutes"]
    - path: "packages/web/src/config/domains.ts"
      provides: "MONITORED_DOMAINS hardcoded array"
      exports: ["MONITORED_DOMAINS"]
    - path: "packages/web/src/components/StatsPanel.tsx"
      provides: "Server stats display component"
      exports: ["StatsPanel"]
    - path: "packages/web/src/components/DomainHealthWidget.tsx"
      provides: "Domain up/down badge component"
      exports: ["DomainHealthWidget"]
  key_links:
    - from: "packages/web/src/components/StatsPanel.tsx"
      to: "GET /api/stats"
      via: "useQuery(['stats']) → api.get('/stats')"
      pattern: "api\\.get.*stats"
    - from: "packages/web/src/components/DomainHealthWidget.tsx"
      to: "POST /api/health/domains"
      via: "useQuery(['domain-health']) → api.post('/health/domains', { urls: MONITORED_DOMAINS })"
      pattern: "api\\.post.*health/domains"
    - from: "packages/server/src/routes/stats.ts"
      to: "packages/server/src/services/docker-ssh.ts"
      via: "import { getServerStats } from '../services/docker-ssh.js'"
      pattern: "getServerStats"
    - from: "packages/web/src/pages/LoginPage.tsx"
      to: "GET /api/config"
      via: "useEffect → api.get('/config')"
      pattern: "api\\.get.*config"
---

<objective>
Phase 7: Personal Config & Server Stats.

Move SSH connection details (host, port, username) to server `.env` so they are never entered by the
user. Refactor the login page to show `{SSH_HOST} ServerDeck` as the heading with a password-only
form. Add a server stats panel to the dashboard (disk / RAM / uptime / /mnt/sdb listing). Add a
domain health widget that server-side checks a hardcoded list of URLs for up/down status. Wire
`VITE_API_BASE` so the frontend can be deployed against a remote API origin.

Purpose: Transform ServerDeck from a generic multi-server tool into a personal, zero-config
appliance pointed at one server via env vars.

Output:
- Server startup guard for SSH env vars (CONF-01)
- `GET /api/config` public endpoint returning `{ host }` (CONF-02)
- Password-only login form with dynamic heading (CONF-02)
- `GET /api/stats` authenticated endpoint with parsed disk/RAM/uptime/mntSdb (STATS-01–04)
- `POST /api/health/domains` authenticated endpoint for server-side URL health checks (STATS-05)
- `StatsPanel` and `DomainHealthWidget` components wired into `DashboardPage` (STATS-01–05)
- `VITE_API_BASE` build-time support in `axios.ts` (CONF-03)
- Updated `.env.example` files for both packages
</objective>

<execution_context>
@~/.copilot/get-shit-done/workflows/execute-plan.md
@~/.copilot/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/07-personal-config-server-stats/07-RESEARCH.md
@.planning/phases/07-personal-config-server-stats/PATTERNS.md
@packages/server/src/index.ts
@packages/server/src/middleware/verify-auth.ts
@packages/server/src/routes/auth.ts
@packages/server/src/services/docker-ssh.ts
@packages/server/src/server.ts
@packages/web/src/lib/axios.ts
@packages/web/src/pages/LoginPage.tsx
@packages/web/src/pages/DashboardPage.tsx
@packages/web/src/components/ProtectedRoute.tsx
</context>

<!-- ═══════════════════════════════════════════════════════════════ -->
<!--  WAVE 1 — Server backend                                       -->
<!--  Tasks 1A–1G are logically grouped into three sub-groups.      -->
<!--  Execute all Wave 1 tasks before Wave 2 tasks.                 -->
<!-- ═══════════════════════════════════════════════════════════════ -->

<tasks>

<!-- ─────────────────────────────────────────────────────────────── -->
<!--  Wave 1 · Group A: Auth refactor — index.ts, verify-auth, auth -->
<!-- ─────────────────────────────────────────────────────────────── -->

<task type="auto">
  <name>Task 1A: Add SSH env-var fail-fast guards to index.ts (CONF-01)</name>
  <files>packages/server/src/index.ts</files>
  <action>
After the existing JWT_SECRET guard (lines 4–8), add three new fail-fast guards using the same
`console.error('FATAL: …') + process.exit(1)` pattern already in use.

Insert immediately after the closing brace of the JWT_SECRET check:

  if (!process.env.SSH_HOST) {
    console.error('FATAL: SSH_HOST must be set in .env. Server cannot start.')
    process.exit(1)
  }

  if (!process.env.SSH_USERNAME) {
    console.error('FATAL: SSH_USERNAME must be set in .env. Server cannot start.')
    process.exit(1)
  }

  const _sshPort = Number(process.env.SSH_PORT ?? 22)
  if (!Number.isInteger(_sshPort) || _sshPort < 1 || _sshPort > 65535) {
    console.error('FATAL: SSH_PORT must be a valid port number (1–65535). Server cannot start.')
    process.exit(1)
  }

The `_sshPort` variable is intentionally prefixed with `_` to signal that it is used only for
validation; individual handlers read `process.env.SSH_PORT` directly (matching the existing
JWT_SECRET pattern where the validated value is never stored in a module-level variable).
  </action>
  <verify>
    <automated>cd packages/server && grep -c 'SSH_HOST\|SSH_USERNAME\|SSH_PORT' src/index.ts</automated>
  </verify>
  <done>
`src/index.ts` contains three SSH env-var guards. Running the server without SSH_HOST set exits
immediately with a FATAL message.
  </done>
</task>

<task type="auto">
  <name>Task 1B: Add /api/config to EXCLUDED_PATHS in verify-auth.ts (CONF-02)</name>
  <files>packages/server/src/middleware/verify-auth.ts</files>
  <action>
Line 4 of `verify-auth.ts` currently reads:

  const EXCLUDED_PATHS = ['/api/auth/login', '/api/auth/logout', '/health']

Change it to:

  const EXCLUDED_PATHS = ['/api/auth/login', '/api/auth/logout', '/api/config', '/health']

No other changes. The path `/api/config` must be excluded BEFORE any route is registered so the
preHandler hook never challenges it for a JWT cookie.
  </action>
  <verify>
    <automated>cd packages/server && grep "api/config" src/middleware/verify-auth.ts</automated>
  </verify>
  <done>
`EXCLUDED_PATHS` array in `verify-auth.ts` contains `/api/config`. The rest of the file is
unchanged.
  </done>
</task>

<task type="auto">
  <name>Task 1C: Refactor auth.ts — password-only schema + GET /api/config (CONF-01, CONF-02)</name>
  <files>packages/server/src/routes/auth.ts</files>
  <action>
Make three surgical edits to `auth.ts`. Existing imports (lines 1–4) and logout/me handlers
(lines 66–93) are untouched.

EDIT 1 — Replace `LoginBody` type (lines 6–11):

  // BEFORE:
  type LoginBody = {
    host: string
    port: number
    username: string
    password: string
  }

  // AFTER:
  type LoginBody = {
    password: string
    // host/port/username removed — read from process.env (CONF-01)
  }

EDIT 2 — Replace login schema + handler body inside the POST /api/auth/login route
(affects lines 16–64). Keep rate-limit config and JWT cookie logic verbatim.

  Schema (replace `required` + `properties` block):
    required: ['password'],
    properties: {
      password: { type: 'string', minLength: 1 },
    },

  Handler destructure + env reads (replace lines 34–36):
    const { password } = request.body
    const host = process.env.SSH_HOST!
    const port = Number(process.env.SSH_PORT ?? 22)
    const username = process.env.SSH_USERNAME!

  The `validateSshCredentials(host, port, username, password)` call on the next line stays
  identical. The `setSession(sessionId, { host, port, username, password })` call stays identical.

EDIT 3 — Add GET /api/config handler BEFORE the existing `fastify.post('/api/auth/logout', ...)`
block (i.e. between line 64 and line 66):

  // GET /api/config — public (no auth); returns SSH_HOST for the login page heading (CONF-02)
  fastify.get('/api/config', async () => ({
    host: process.env.SSH_HOST ?? '',
  }))

No new imports required. The `authRoutes` plugin is already registered in `server.ts`.
  </action>
  <verify>
    <automated>cd packages/server && grep -c "SSH_HOST\|SSH_USERNAME\|SSH_PORT" src/routes/auth.ts && grep "api/config" src/routes/auth.ts</automated>
  </verify>
  <done>
`auth.ts` login schema requires only `{ password }`. Handler reads host/port/username from env.
`GET /api/config` handler exists inside `authRoutes`. TypeScript compiles without errors:
`cd packages/server && npx tsc --noEmit`.
  </done>
</task>

<!-- ─────────────────────────────────────────────────────────────── -->
<!--  Wave 1 · Group B: Stats SSH service                          -->
<!-- ─────────────────────────────────────────────────────────────── -->

<task type="auto">
  <name>Task 1D: Add getServerStats() to docker-ssh.ts with sentinel parsing + 30s cache (STATS-01–04)</name>
  <files>packages/server/src/services/docker-ssh.ts</files>
  <action>
Append the following block at the END of `docker-ssh.ts` (after `deleteContainer`). The private
`sshExec` helper on line 20 is accessible within the same module — do NOT export it and do NOT
create a separate `ssh-exec.ts` file.

--- APPEND BELOW ---

// ── Server Stats (STATS-01–04) ────────────────────────────────────────────────

export interface ServerStats {
  disk: {
    filesystem: string
    total: number      // bytes
    used: number       // bytes
    available: number  // bytes
    usePercent: number // 0-100
  }
  ram: {
    total: number      // bytes
    used: number       // bytes
    available: number  // bytes
    usePercent: number // 0-100
  }
  uptime: {
    seconds: number    // floor of /proc/uptime first field
    human: string      // e.g. "14d 6h 32m" | "3h 5m" | "47m"
  }
  mntSdb: Array<{
    name: string       // basename only, e.g. "data"
    bytes: number
    human: string      // e.g. "12.3 GB"
  }> | null            // null when /mnt/sdb is absent or empty
}

// Single combined command — semicolons (not &&) so every section runs regardless.
// ; true at the end guarantees exit code 0 even if du finds nothing.
const STATS_CMD =
  "echo '__DISK__'; df -B1 /; " +
  "echo '__RAM__'; free -b; " +
  "echo '__UPTIME__'; cat /proc/uptime; " +
  "echo '__MNT__'; du -sb /mnt/sdb/* 2>/dev/null; " +
  "echo '__END__'; true"

// 30-second in-memory cache — stats don't change meaningfully in 30 s.
// Cache is session-agnostic: all callers share the same server stats.
let _statsCache: { data: ServerStats; expiresAt: number } | null = null
const STATS_CACHE_TTL = 30_000

function _splitSections(raw: string): Record<string, string> {
  const MARKERS = ['__DISK__', '__RAM__', '__UPTIME__', '__MNT__', '__END__']
  const sections: Record<string, string> = {}
  let current = ''
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (MARKERS.includes(trimmed)) {
      current = trimmed
      sections[current] = ''
    } else if (current && current !== '__END__') {
      sections[current] = (sections[current] ?? '') + line + '\n'
    }
  }
  return sections
}

function _formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function _parseDisk(section: string): ServerStats['disk'] {
  // Join all non-header lines to handle long LVM device names that wrap onto the next line
  const lines = section.trim().split('\n').filter(Boolean)
  const data = lines.slice(1).join(' ').trim()
  const parts = data.split(/\s+/)
  // parts: [filesystem, 1B-blocks, used, available, use%, mountpoint]
  return {
    filesystem: parts[0],
    total: parseInt(parts[1], 10),
    used: parseInt(parts[2], 10),
    available: parseInt(parts[3], 10),
    usePercent: parseInt(parts[4], 10), // parseInt strips trailing %
  }
}

function _parseRam(section: string): ServerStats['ram'] {
  const lines = section.trim().split('\n').filter(Boolean)
  const memLine = lines.find((l) => l.startsWith('Mem:'))
  if (!memLine) throw new Error('Mem: line not found in free -b output')
  const parts = memLine.split(/\s+/)
  // parts: ['Mem:', total, used, free, shared, buff/cache, available]
  const total = parseInt(parts[1], 10)
  const used = parseInt(parts[2], 10)
  const available = parseInt(parts[6], 10)
  return {
    total,
    used,
    available,
    usePercent: Math.round((used / total) * 100),
  }
}

function _parseUptime(section: string): ServerStats['uptime'] {
  const seconds = Math.floor(parseFloat(section.trim().split(/\s+/)[0]))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  parts.push(`${minutes}m`)
  return { seconds, human: parts.join(' ') }
}

function _parseMntSdb(section: string): ServerStats['mntSdb'] {
  const lines = section.trim().split('\n').filter(Boolean)
  if (lines.length === 0) return null
  return lines.map((line) => {
    const [bytesStr, fullPath] = line.split('\t')
    const bytes = parseInt(bytesStr, 10)
    const name = (fullPath ?? '').split('/').pop() ?? fullPath
    return { name, bytes, human: _formatBytes(bytes) }
  })
}

function _parseStats(raw: string): ServerStats {
  const s = _splitSections(raw)
  return {
    disk: _parseDisk(s['__DISK__'] ?? ''),
    ram: _parseRam(s['__RAM__'] ?? ''),
    uptime: _parseUptime(s['__UPTIME__'] ?? ''),
    mntSdb: _parseMntSdb(s['__MNT__'] ?? ''),
  }
}

export async function getServerStats(session: SessionData): Promise<ServerStats> {
  if (_statsCache && Date.now() < _statsCache.expiresAt) {
    return _statsCache.data
  }
  const raw = await sshExec(session, STATS_CMD)
  const data = _parseStats(raw)
  _statsCache = { data, expiresAt: Date.now() + STATS_CACHE_TTL }
  return data
}
--- END APPEND ---

Key constraints:
- All helper functions prefixed with `_` (module-private by convention, not exported).
- `sshExec` is already in scope — no import needed.
- `_statsCache` is module-level state; this is intentional (single-server personal tool, no
  multi-tenant concerns).
- Use `free -b` (bytes), never `free -h` (human strings break JS parsing).
- Use `df -B1` (1-byte blocks), never `df -h`.
- `; true` at end of STATS_CMD ensures exit code 0 when `du` finds no entries.
  </action>
  <verify>
    <automated>cd packages/server && npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>
`docker-ssh.ts` exports `ServerStats` interface and `getServerStats(session)` function.
`npx tsc --noEmit` passes with no errors on the server package. The module-level cache variable,
all five parse helpers, and the combined SSH command constant are present in the file.
  </done>
</task>

<!-- ─────────────────────────────────────────────────────────────── -->
<!--  Wave 1 · Group C: New routes + server.ts wiring              -->
<!-- ─────────────────────────────────────────────────────────────── -->

<task type="auto">
  <name>Task 1E: Create routes/stats.ts — GET /api/stats (STATS-01–04)</name>
  <files>packages/server/src/routes/stats.ts</files>
  <action>
Create `packages/server/src/routes/stats.ts` from scratch. Pattern: identical structure to
`containers.ts` (plugin function + `getSession` helper + try/catch 502).

Full file content:

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

Notes:
- `getSession` is copied verbatim from `containers.ts` (intentionally local per project pattern).
- Route is protected by `verifyAuth` preHandler globally registered in `server.ts` — no per-route
  auth config needed.
- Return 502 (bad gateway) on SSH failure, consistent with containers route pattern.
  </action>
  <verify>
    <automated>cd packages/server && npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>
File `packages/server/src/routes/stats.ts` exists and exports `statsRoutes`. TypeScript compiles
without errors.
  </done>
</task>

<task type="auto">
  <name>Task 1F: Create routes/health.ts — POST /api/health/domains (STATS-05)</name>
  <files>packages/server/src/routes/health.ts</files>
  <action>
Create `packages/server/src/routes/health.ts` from scratch. Uses Node.js built-in `fetch`
(available since Node 18, no import needed). Uses `AbortController` for the 8-second timeout
(safer than `AbortSignal.timeout` for Node 18 compatibility).

Full file content:

  import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

  interface HealthBody {
    urls: string[]
  }

  interface DomainResult {
    url: string
    up: boolean
    latencyMs: number | null
  }

  async function checkUrl(url: string): Promise<DomainResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    const start = Date.now()
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        redirect: 'follow',
      })
      clearTimeout(timer)
      const latencyMs = Date.now() - start
      // Any response below 500 counts as "up" — 4xx means reachable
      return { url, up: response.status < 500, latencyMs }
    } catch {
      clearTimeout(timer)
      return { url, up: false, latencyMs: null }
    }
  }

  export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.post<{ Body: HealthBody }>(
      '/api/health/domains',
      {
        schema: {
          body: {
            type: 'object',
            required: ['urls'],
            properties: {
              urls: {
                type: 'array',
                maxItems: 20,
                items: {
                  type: 'string',
                  // SSRF guard: only http:// and https:// are permitted (STATS-05 personal tool)
                  pattern: '^https?://',
                },
              },
            },
          },
        },
      },
      async (request: FastifyRequest<{ Body: HealthBody }>, reply: FastifyReply) => {
        const { urls } = request.body
        try {
          const results = await Promise.all(urls.map(checkUrl))
          return { results }
        } catch (err) {
          fastify.log.error(err, 'Domain health check failed')
          return reply.status(500).send({ error: 'Health check failed' })
        }
      }
    )
  }

Key constraints:
- `fetch` is Node.js built-in on Node 18+ — do NOT import it.
- `AbortController` + `setTimeout` pattern (not `AbortSignal.timeout`) for broadest Node 18
  compatibility.
- Fastify schema `pattern: '^https?://'` validates each URL before the handler runs (SSRF guard).
- `maxItems: 20` prevents abuse.
- Timing via `Date.now()` before `fetch`, subtracted after response.
- All checks run in `Promise.all` (parallel), so worst-case latency = max(single check timeout).
  </action>
  <verify>
    <automated>cd packages/server && npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>
File `packages/server/src/routes/health.ts` exists and exports `healthRoutes`. TypeScript compiles
without errors. File contains SSRF guard schema and `AbortController` timeout.
  </done>
</task>

<task type="auto">
  <name>Task 1G: Register statsRoutes and healthRoutes in server.ts</name>
  <files>packages/server/src/server.ts</files>
  <action>
Make two edits to `server.ts`.

EDIT 1 — Add two new imports after the existing `terminalRoute` import (line 11):

  import { statsRoutes } from './routes/stats.js'
  import { healthRoutes } from './routes/health.js'

EDIT 2 — Register both new route plugins in the route registration block. Insert after the
existing `await fastify.register(containerRoutes)` line (currently line 46):

  await fastify.register(statsRoutes)
  await fastify.register(healthRoutes)

Final registration order:
  await fastify.register(authRoutes)
  await fastify.register(containerRoutes)
  await fastify.register(statsRoutes)       // ← new
  await fastify.register(healthRoutes)      // ← new
  await fastify.register(containerEventsRoute)
  await fastify.register(containerLogsRoute)
  await fastify.register(terminalRoute)

The `verifyAuth` preHandler (registered on line 43) already protects all `/api/*` routes — no
additional per-route auth needed. The `GET /api/config` endpoint is served by `authRoutes` which
is already registered.
  </action>
  <verify>
    <automated>cd packages/server && npx tsc --noEmit 2>&1 | head -20 && grep -c "statsRoutes\|healthRoutes" src/server.ts</automated>
  </verify>
  <done>
`server.ts` imports and registers both `statsRoutes` and `healthRoutes`. TypeScript compiles
without errors. `grep -c` returns 4 (2 imports + 2 register calls).
  </done>
</task>

<!-- ═══════════════════════════════════════════════════════════════ -->
<!--  WAVE 2 — Frontend                                             -->
<!--  Execute after Wave 1 Group A–C tasks complete.                -->
<!-- ═══════════════════════════════════════════════════════════════ -->

<task type="auto">
  <name>Task 2A: Add VITE_API_BASE support to axios.ts (CONF-03)</name>
  <files>packages/web/src/lib/axios.ts</files>
  <action>
One-line change. Replace the `baseURL` value on line 4:

  // BEFORE:
  baseURL: '/api',

  // AFTER:
  baseURL: import.meta.env.VITE_API_BASE || '/api',

`import.meta.env.VITE_API_BASE` is replaced by Vite at build time. The empty string `''` is
falsy, so `|| '/api'` correctly falls back when the variable is unset or empty (default behaviour
for local dev and single-origin deployments). All other lines (imports, interceptor) are unchanged.
  </action>
  <verify>
    <automated>cd packages/web && grep "VITE_API_BASE" src/lib/axios.ts</automated>
  </verify>
  <done>
`axios.ts` line 4 reads `baseURL: import.meta.env.VITE_API_BASE || '/api'`. Everything else is
unchanged.
  </done>
</task>

<task type="auto">
  <name>Task 2B: Rewrite LoginPage.tsx — password-only form + dynamic host heading (CONF-01, CONF-02)</name>
  <files>packages/web/src/pages/LoginPage.tsx</files>
  <action>
Rewrite `LoginPage.tsx` with these specific changes. Keep all existing imports; none become unused.

REMOVE from state:
  const [host, setHost] = useState(() => localStorage.getItem('sd_host') ?? '')
  const [port, setPort] = useState(() => localStorage.getItem('sd_port') ?? '22')
  const [username, setUsername] = useState(() => localStorage.getItem('sd_username') ?? '')

ADD in their place:
  const [serverHost, setServerHost] = useState('')

REPLACE the single useEffect (lines 20–24) with TWO effects:

  useEffect(() => {
    api.get('/auth/me')
      .then(() => navigate('/', { replace: true }))
      .catch(() => {})
  }, [navigate])

  useEffect(() => {
    api.get<{ host: string }>('/config')
      .then(({ data }) => setServerHost(data.host ?? ''))
      .catch(() => {})
  }, [])

REPLACE the `handleSubmit` try block internals (lines 32–37):
  // BEFORE:
  await api.post('/auth/login', { host, port: Number(port), username, password })
  localStorage.setItem('sd_host', host)
  localStorage.setItem('sd_port', port)
  localStorage.setItem('sd_username', username)
  navigate('/')

  // AFTER:
  await api.post('/auth/login', { password })
  navigate('/')

REPLACE the error handling catch block (lines 39–51) — remove 504/502 branches:
  const status = (err as { response?: { status?: number } }).response?.status
  if (status === 401) {
    setError('Invalid credentials. Check your password.')
  } else if (status === 429) {
    setError('Too many attempts. Wait a minute and try again.')
  } else {
    setError('An unexpected error occurred. Please try again.')
  }

REPLACE CardHeader section to use dynamic heading:
  <CardHeader className="space-y-1 pb-4">
    <div className="flex items-center gap-2">
      <Server size={20} className="text-primary" />
      <CardTitle className="text-2xl font-bold">
        {serverHost ? `${serverHost} ServerDeck` : 'ServerDeck'}
      </CardTitle>
    </div>
    <CardDescription>Enter your password to connect</CardDescription>
  </CardHeader>

REMOVE the three field blocks in the form (Host div, Port div, Username div — lines 69–115).
Keep only the Password div (lines 118–142) and everything below it (error paragraph + submit
button). The password field's JSX is unchanged.

Do NOT remove any imports — Server, Eye, EyeOff, Loader2, AlertCircle are all still used.
  </action>
  <verify>
    <automated>cd packages/web && npx tsc --noEmit 2>&1 | head -20 && grep -c "serverHost\|/config" src/pages/LoginPage.tsx</automated>
  </verify>
  <done>
`LoginPage.tsx` has no host/port/username state or fields. Form posts `{ password }` only.
Heading shows `{serverHost} ServerDeck` when serverHost is truthy. `npx tsc --noEmit` passes.
  </done>
</task>

<task type="auto">
  <name>Task 2C: Create packages/web/src/config/domains.ts — hardcoded domain list (STATS-05)</name>
  <files>packages/web/src/config/domains.ts</files>
  <action>
Create `packages/web/src/config/domains.ts` (new directory `config/` must be created).

Full file content:

  /**
   * Hardcoded domain list for the DomainHealthWidget.
   * Edit this array before deployment to monitor your own services.
   * Each entry must be a full URL including scheme (http:// or https://).
   */
  export const MONITORED_DOMAINS = [
    'https://example.com',
    'https://another.example.com',
    // Add your domains here, e.g.:
    // 'http://192.168.1.50:8080',
    // 'https://grafana.homelab.local',
  ] as const

No other files in this directory. The `as const` assertion preserves tuple type for strict
downstream typing.
  </action>
  <verify>
    <automated>cat packages/web/src/config/domains.ts</automated>
  </verify>
  <done>
File `packages/web/src/config/domains.ts` exists and exports `MONITORED_DOMAINS` as a readonly
tuple containing at least the two placeholder URLs.
  </done>
</task>

<task type="auto">
  <name>Task 2D: Create StatsPanel.tsx — disk/RAM/uptime/mntSdb display (STATS-01–04)</name>
  <files>packages/web/src/components/StatsPanel.tsx</files>
  <action>
Create `packages/web/src/components/StatsPanel.tsx` from scratch.

Design rules (from PATTERNS.md):
- Use `border border-zinc-800` wrapper (NOT shadcn `Card`) — matches existing ContainerCard style.
- Use `rounded-none` badges — no `rounded` anywhere.
- Use `bg-zinc-900` for stat row backgrounds.
- Skeleton loading uses `Skeleton` from `./ui/skeleton`.
- `useQuery` from `@tanstack/react-query` with `queryKey: ['stats']`, `refetchInterval: 30_000`.
- Silent fail on error (`return null`) — stats are supplementary, must not block container list.

The `ServerStats` interface mirrors `docker-ssh.ts`'s exported type (copy it; do not import across
packages):

  interface ServerStats {
    disk: { filesystem: string; total: number; used: number; available: number; usePercent: number }
    ram: { total: number; used: number; available: number; usePercent: number }
    uptime: { seconds: number; human: string }
    mntSdb: Array<{ name: string; bytes: number; human: string }> | null
  }

Full file:

  import { useQuery } from '@tanstack/react-query'
  import { HardDrive, MemoryStick, Clock, FolderOpen } from 'lucide-react'
  import { api } from '../lib/axios'
  import { Skeleton } from './ui/skeleton'

  interface ServerStats {
    disk: { filesystem: string; total: number; used: number; available: number; usePercent: number }
    ram: { total: number; used: number; available: number; usePercent: number }
    uptime: { seconds: number; human: string }
    mntSdb: Array<{ name: string; bytes: number; human: string }> | null
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  }

  async function fetchStats(): Promise<ServerStats> {
    const { data } = await api.get<ServerStats>('/stats')
    return data
  }

  export function StatsPanel() {
    const { data, isLoading, isError } = useQuery<ServerStats>({
      queryKey: ['stats'],
      queryFn: fetchStats,
      refetchInterval: 30_000,
      staleTime: 25_000,
    })

    if (isLoading) {
      return (
        <div className="border border-zinc-800 p-4 space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
      )
    }

    if (isError || !data) {
      return null // silent fail — stats panel is supplementary
    }

    return (
      <div className="border border-zinc-800 divide-y divide-zinc-800">
        <StatRow
          icon={<Clock className="h-4 w-4 text-muted-foreground shrink-0" />}
          label="Uptime"
          value={data.uptime.human}
        />
        <StatRow
          icon={<MemoryStick className="h-4 w-4 text-muted-foreground shrink-0" />}
          label="RAM"
          value={`${formatBytes(data.ram.used)} / ${formatBytes(data.ram.total)} (${data.ram.usePercent}%)`}
        />
        <StatRow
          icon={<HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />}
          label="Disk (/)"
          value={`${formatBytes(data.disk.used)} / ${formatBytes(data.disk.total)} (${data.disk.usePercent}%)`}
        />
        {data.mntSdb && data.mntSdb.length > 0 && (
          <div className="px-4 py-3 bg-zinc-900">
            <div className="flex items-center gap-3 mb-2">
              <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground">/mnt/sdb</p>
            </div>
            <div className="space-y-1 pl-7">
              {data.mntSdb.map((entry) => (
                <div key={entry.name} className="flex items-center justify-between gap-4">
                  <span className="text-xs font-mono truncate">{entry.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{entry.human}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  function StatRow({
    icon,
    label,
    value,
  }: {
    icon: React.ReactNode
    label: string
    value: string
  }) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-zinc-900">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-sm font-mono mt-0.5 truncate">{value}</p>
        </div>
      </div>
    )
  }

Check that `MemoryStick` is available in the installed version of lucide-react. If the icon is
not found (TypeScript import error), replace with `Cpu` which is always available.
  </action>
  <verify>
    <automated>cd packages/web && npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>
`StatsPanel.tsx` exists, exports `StatsPanel`, TypeScript compiles without errors. Component
displays disk/RAM/uptime as formatted strings and conditionally renders /mnt/sdb directory listing.
  </done>
</task>

<task type="auto">
  <name>Task 2E: Create DomainHealthWidget.tsx — POST /api/health/domains, 60s poll, up/down badges (STATS-05)</name>
  <files>packages/web/src/components/DomainHealthWidget.tsx</files>
  <action>
Create `packages/web/src/components/DomainHealthWidget.tsx` from scratch.

Key decisions:
- Calls `POST /api/health/domains` (server-side check) — do NOT use browser `fetch` directly
  (mixed-content blocks http:// from https:// page, CORS blocks many external domains).
- Imports `MONITORED_DOMAINS` from `../config/domains`.
- Returns `null` immediately if `MONITORED_DOMAINS.length === 0` (graceful no-op).
- `useQuery` with `queryKey: ['domain-health']`, `refetchInterval: 60_000`, `retry: false`.
- Badge style: `rounded-none bg-green-500/15 text-green-400 border border-green-500/30` for up;
  `rounded-none bg-red-500/15 text-red-400 border border-red-500/30` for down — matching
  ContainerCard StateBadge pattern exactly.
- Shows latency in ms when `up === true` and `latencyMs !== null`.

Full file:

  import { useQuery } from '@tanstack/react-query'
  import { Globe, RefreshCw } from 'lucide-react'
  import { api } from '../lib/axios'
  import { Button } from './ui/button'
  import { MONITORED_DOMAINS } from '../config/domains'

  interface DomainResult {
    url: string
    up: boolean
    latencyMs: number | null
  }

  async function fetchDomainHealth(): Promise<DomainResult[]> {
    const { data } = await api.post<{ results: DomainResult[] }>('/health/domains', {
      urls: [...MONITORED_DOMAINS],
    })
    return data.results
  }

  function StatusBadge({ up, latencyMs }: { up: boolean; latencyMs: number | null }) {
    if (up) {
      return (
        <span className="bg-green-500/15 text-green-400 border border-green-500/30 text-xs px-2 py-0.5 rounded-none">
          {latencyMs !== null ? `up ${latencyMs}ms` : 'up'}
        </span>
      )
    }
    return (
      <span className="bg-red-500/15 text-red-400 border border-red-500/30 text-xs px-2 py-0.5 rounded-none">
        down
      </span>
    )
  }

  export function DomainHealthWidget() {
    if (MONITORED_DOMAINS.length === 0) return null

    const { data, isLoading, refetch, isFetching } = useQuery<DomainResult[]>({
      queryKey: ['domain-health'],
      queryFn: fetchDomainHealth,
      refetchInterval: 60_000,
      staleTime: 30_000,
      retry: false,
    })

    return (
      <div className="border border-zinc-800">
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
            aria-label="Refresh domain health checks"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {isLoading && (
          <div className="px-4 py-3 text-xs text-muted-foreground">Checking…</div>
        )}

        {data?.map((result) => (
          <div
            key={result.url}
            className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 last:border-0"
          >
            <span className="text-sm font-mono truncate">{result.url}</span>
            <StatusBadge up={result.up} latencyMs={result.latencyMs} />
          </div>
        ))}
      </div>
    )
  }

Note: The `useQuery` hook call is INSIDE the function body but AFTER the early return guard.
This is intentional — React Rules of Hooks forbid hooks after early returns; move the
`if (MONITORED_DOMAINS.length === 0) return null` AFTER the hook call if TypeScript or the
linter complains. Correct ordering:

  export function DomainHealthWidget() {
    const { data, isLoading, refetch, isFetching } = useQuery<DomainResult[]>({ ... })

    if (MONITORED_DOMAINS.length === 0) return null
    // ... rest of JSX
  }
  </action>
  <verify>
    <automated>cd packages/web && npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>
`DomainHealthWidget.tsx` exists, exports `DomainHealthWidget`, TypeScript compiles without errors.
Component calls `POST /api/health/domains`, polls every 60 s, shows up/down badges with latency.
  </done>
</task>

<task type="auto">
  <name>Task 2F: Add StatsPanel and DomainHealthWidget to DashboardPage.tsx (STATS-01–05)</name>
  <files>packages/web/src/pages/DashboardPage.tsx</files>
  <action>
Make two edits to `DashboardPage.tsx`.

EDIT 1 — Add two new imports after the existing `PWAInstallBanner` import (line ~17):

  import { StatsPanel } from '../components/StatsPanel'
  import { DomainHealthWidget } from '../components/DomainHealthWidget'

EDIT 2 — Inside `<main>`, inside the `<div className="max-w-screen-2xl mx-auto space-y-3">`,
insert the two new sections BEFORE the loading-skeletons comment:

  {/* Server stats */}
  <StatsPanel />

  {/* Domain health */}
  <DomainHealthWidget />

  {/* Loading skeletons */}
  {isLoading && ...}

The final order of children inside `<div className="max-w-screen-2xl mx-auto space-y-3">`:
  1. <StatsPanel />                ← new
  2. <DomainHealthWidget />        ← new
  3. {isLoading && skeletons...}   ← existing
  4. {isError && error block}      ← existing
  5. {empty state}                 ← existing
  6. {groups.map(ContainerGroup)}  ← existing

No other changes. The existing `DashboardContext` type, `useOutletContext` call, and all
container-related logic are untouched.
  </action>
  <verify>
    <automated>cd packages/web && npx tsc --noEmit 2>&1 | head -20 && grep -c "StatsPanel\|DomainHealthWidget" src/pages/DashboardPage.tsx</automated>
  </verify>
  <done>
`DashboardPage.tsx` imports and renders both `StatsPanel` and `DomainHealthWidget` above the
container list. TypeScript compiles without errors. `grep -c` returns 4 (2 imports + 2 usages).
  </done>
</task>

<!-- ═══════════════════════════════════════════════════════════════ -->
<!--  WAVE 3 — Env examples + build verify                          -->
<!-- ═══════════════════════════════════════════════════════════════ -->

<task type="auto">
  <name>Task 3A: Write .env.example files for server and web packages (CONF-01, CONF-03)</name>
  <files>packages/server/.env.example, packages/web/.env.example</files>
  <action>
Create or overwrite `packages/server/.env.example` with:

  PORT=3001
  # Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  JWT_SECRET=replace-with-a-random-32-plus-character-string
  LOG_LEVEL=info

  # SSH connection — these are read at startup (CONF-01).
  # The server will exit immediately if SSH_HOST or SSH_USERNAME are missing.
  SSH_HOST=192.168.1.100
  SSH_PORT=22
  SSH_USERNAME=ubuntu

Create or overwrite `packages/web/.env.example` with:

  # API base URL for cross-origin deployments.
  # Leave empty (or delete this line) when the frontend is served from the same
  # origin as the Fastify backend — this is the default setup.
  # Example for separate deployments:
  # VITE_API_BASE=https://api.yourdomain.com
  VITE_API_BASE=

Check whether `packages/server/.env.example` already exists — if it does, overwrite it with the
content above (do not append). The HTTPS and NODE_ENV variables are intentionally omitted from the
example (they are optional and self-explanatory).
  </action>
  <verify>
    <automated>grep "SSH_HOST\|SSH_PORT\|SSH_USERNAME" packages/server/.env.example && grep "VITE_API_BASE" packages/web/.env.example</automated>
  </verify>
  <done>
`packages/server/.env.example` documents all five server env vars. `packages/web/.env.example`
documents `VITE_API_BASE` with an explanatory comment.
  </done>
</task>

<task type="auto">
  <name>Task 3B: Verify frontend build passes with all new components (CONF-03)</name>
  <files></files>
  <action>
Run the Vite production build for the web package. This catches any TypeScript errors that
`tsc --noEmit` might miss (e.g. missing imports, unresolved modules) and confirms the bundle
compiles cleanly.

  cd packages/web && pnpm run build

Expected: build completes successfully with no TypeScript or Vite errors. Warnings about chunk
sizes are acceptable and can be ignored.

If the build fails:
1. Read the error message carefully — it will point to a specific file and line.
2. Common causes at this stage: wrong import path (case-sensitivity), missing `as const` on
   MONITORED_DOMAINS causing type mismatch, `MemoryStick` icon not found (replace with `Cpu`).
3. Fix the issue, re-run build.
  </action>
  <verify>
    <automated>cd packages/web && pnpm run build 2>&1 | tail -10</automated>
  </verify>
  <done>
`pnpm run build` exits with code 0. Output contains "built in" or similar success message.
No TypeScript errors or unresolved import errors in the output.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser → POST /api/health/domains | Authenticated user supplies URL list; server executes outbound HTTP requests |
| GET /api/config | Unauthenticated callers receive SSH_HOST; must not leak other secrets |
| Browser → GET /api/stats | Authenticated; SSH exec runs server-side on behalf of session |
| SSH_HOST/USERNAME env vars | Process environment read at startup and per-request; never transmitted to client |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-07-01 | Spoofing | GET /api/config | accept | Returns only SSH_HOST (hostname). No secret material (password, key, JWT secret) is ever returned. Hostname is not sensitive. |
| T-07-02 | Tampering | POST /api/health/domains | mitigate | Fastify schema enforces `pattern: '^https?://'` and `maxItems: 20` before handler runs. Prevents SSRF to file:// / gopher:// / ftp:// etc. |
| T-07-03 | Repudiation | GET /api/stats | accept | Stats are read-only; no state change. SSH command is fully hardcoded — no user input reaches the shell. |
| T-07-04 | Information Disclosure | GET /api/stats | accept | Returns server metrics (disk %, RAM %). No secrets, credentials, or file contents are returned. Route is authenticated. |
| T-07-05 | Denial of Service | POST /api/health/domains | mitigate | `maxItems: 20` caps parallel HEAD requests. 8-second `AbortController` timeout per URL caps worst-case handler duration at ~8 s. Rate-limit inherited from global preHandler; add per-route limit if needed in future. |
| T-07-06 | Elevation of Privilege | index.ts fail-fast guards | mitigate | Server refuses to start without SSH_HOST/USERNAME, preventing silent fallback to wrong credentials. Startup guard runs before any request is accepted. |
| T-07-SC | Tampering | No new npm/pip/cargo installs | accept | Phase 7 introduces zero new packages. No supply-chain slopcheck required. |
</threat_model>

<verification>
## Phase 7 End-to-End Checks

After all tasks complete:

1. Server TypeScript compiles cleanly:
   `cd packages/server && npx tsc --noEmit`

2. Web build succeeds:
   `cd packages/web && pnpm run build`

3. GET /api/config returns `{ host }` without a cookie:
   `curl -s http://localhost:3001/api/config`
   Expected: `{"host":"<SSH_HOST value>"}`

4. POST /api/auth/login with `{ password }` only succeeds:
   `curl -s -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"password":"<pass>"}'`
   Expected: `{"ok":true}` + `sd_token` cookie

5. POST /api/auth/login with `{ host, port, username, password }` still succeeds (extra fields
   are stripped by Fastify schema — this is a non-breaking change for any existing clients).

6. GET /api/stats returns parsed stats object (requires valid session cookie):
   `curl -s -b sd_token=<token> http://localhost:3001/api/stats`
   Expected: JSON with `disk.usePercent`, `ram.usePercent`, `uptime.human`, `mntSdb`

7. POST /api/health/domains returns results array:
   `curl -s -b sd_token=<token> -X POST http://localhost:3001/api/health/domains -H "Content-Type: application/json" -d '{"urls":["https://example.com"]}'`
   Expected: `{"results":[{"url":"https://example.com","up":true,"latencyMs":<N>}]}`

8. Login page heading shows `{SSH_HOST} ServerDeck` — verified visually or via:
   `cd packages/web && pnpm run build && grep -r "VITE_API_BASE" dist/` should be absent
   (replaced at build time).
</verification>

<success_criteria>
- `packages/server/src/index.ts` exits with FATAL if SSH_HOST, SSH_USERNAME, or SSH_PORT (invalid
  range) are absent from the environment.
- `GET /api/config` is accessible without authentication and returns `{ host: string }`.
- `POST /api/auth/login` schema requires only `{ password: string }`.
- `GET /api/stats` is authenticated, returns structured `ServerStats` JSON with disk/RAM/uptime/
  mntSdb fields parsed from a single combined SSH exec.
- `POST /api/health/domains` is authenticated, accepts `{ urls: string[] }` (max 20, http/https
  only), returns `{ results: Array<{ url, up, latencyMs }> }`.
- `DashboardPage` renders `<StatsPanel />` and `<DomainHealthWidget />` above container groups.
- `StatsPanel` shows disk used/total/%, RAM used/total/%, uptime human string, /mnt/sdb listing.
- `DomainHealthWidget` calls POST /api/health/domains every 60 s, shows up/down badge per domain.
- `MONITORED_DOMAINS` in `packages/web/src/config/domains.ts` is the single source for the
  domain list.
- `axios.ts` `baseURL` falls back to `/api` when `VITE_API_BASE` is empty or unset.
- Both `.env.example` files document all required env vars for their respective packages.
- `pnpm run build` in `packages/web` exits 0 with no errors.
</success_criteria>

<output>
Create `.planning/phases/07-personal-config-server-stats/07-01-SUMMARY.md` when done.

SUMMARY should record:
- Files created: routes/stats.ts, routes/health.ts, config/domains.ts, StatsPanel.tsx,
  DomainHealthWidget.tsx, packages/web/.env.example
- Files modified: index.ts, verify-auth.ts, auth.ts, docker-ssh.ts, server.ts, axios.ts,
  LoginPage.tsx, DashboardPage.tsx, packages/server/.env.example
- Key decisions: /api/config co-located in auth.ts; getServerStats in docker-ssh.ts (no
  ssh-exec.ts extraction); 30s server-side stats cache; server-side domain health checks via
  POST (not browser fetch); MONITORED_DOMAINS as const in config/domains.ts
- Exports added: ServerStats, getServerStats (docker-ssh.ts); statsRoutes (stats.ts);
  healthRoutes (health.ts); MONITORED_DOMAINS (config/domains.ts); StatsPanel; DomainHealthWidget
</output>
