# Phase 7: Personal Config & Server Stats — Research

**Researched:** 2025-06-05
**Domain:** Fastify 5 route refactoring + SSH exec + server stats parsing + domain health checks
**Confidence:** HIGH

---

## Summary

Phase 7 has three distinct workstreams: (1) eliminating user-entered SSH credentials by reading them from server `.env` and exposing a minimal public `/api/config` endpoint for the login heading, (2) adding a `GET /api/stats` endpoint that SSH-execs four shell commands in a single connection and returns parsed disk/RAM/uptime/directory stats, and (3) a server-side domain health checker (`POST /api/health/domains`) that avoids browser mixed-content problems.

The SSH exec pattern already exists in `docker-ssh.ts` — the stats service is a direct reuse of that `sshExec` helper. All shell commands are standard Linux utilities available on every Ubuntu/Debian server. The trickiest part is the combined multi-command approach: using `;` separators and sentinel echo markers to split a single SSH output into labelled sections, gracefully handling `/mnt/sdb` not existing.

The `VITE_API_BASE` change is a one-liner in `axios.ts`. The password-only login refactor touches five files but each edit is small and mechanical.

**Primary recommendation:** Implement all changes in three natural batches — (a) config/auth refactor, (b) stats SSH service + route, (c) domain health route + frontend wiring. Reuse `sshExec` from `docker-ssh.ts` or extract it into a shared `ssh-exec.ts` utility.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONF-01 | SSH host, port, username read from server `.env`; never entered by the user | §Topic 1 — env guard, session population, auth route refactor |
| CONF-02 | Login page shows `{SSH_HOST} ServerDeck` heading; only password field | §Topic 1 — `GET /api/config` public endpoint, LoginPage rewrite |
| CONF-03 | `VITE_API_BASE` build-time env var sets axios base origin | §Topic 4 — one-line axios.ts change + .env.example |
| STATS-01 | Dashboard: disk usage (used/available/%) for root filesystem | §Topic 2 — `df -B1 /` command, JS parsing |
| STATS-02 | Dashboard: RAM usage (used/total/%) | §Topic 2 — `free -b` command, JS parsing |
| STATS-03 | Dashboard: server uptime in human-readable form | §Topic 2 — `cat /proc/uptime`, JS formatter |
| STATS-04 | Dashboard: top-level directory listing of `/mnt/sdb` (name + size) | §Topic 2 — `du -sb /mnt/sdb/*`, graceful fallback |
| STATS-05 | Dashboard: hardcoded domain list with live up/down badge | §Topic 3 — server-side `POST /api/health/domains` |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SSH credential config (host/port/username) | API / Backend | — | These are server secrets; never in browser |
| Public host name for login heading | API / Backend | Browser (display) | Server exposes `GET /api/config`; browser fetches at render time |
| Login form (password only) | Browser / Client | — | UI concern; posts `{ password }` to API |
| Stats collection (disk/RAM/uptime/mnt) | API / Backend | — | SSH exec runs server-side; browser only receives parsed JSON |
| Stats display | Browser / Client | — | React components render the JSON response |
| Domain health check execution | API / Backend | — | Avoids browser mixed-content; server-side `fetch` has no TLS restrictions |
| Domain list (what to check) | Browser / Client | — | Hardcoded in frontend per STATS-05 requirement |
| `VITE_API_BASE` config | CDN / Static (build time) | Browser | Vite replaces `import.meta.env.VITE_API_BASE` at build time |

---

## Topic 1: Password-Only Login + SSH Config from `.env`

### Current vs. Target State

| Concern | Current | Target |
|---------|---------|--------|
| Login body fields | `{ host, port, username, password }` | `{ password }` only |
| SSH credentials source | Login form → request body → session | `process.env.SSH_HOST/SSH_PORT/SSH_USERNAME` → session |
| Login page heading | `"ServerDeck"` static | `"{SSH_HOST} ServerDeck"` fetched from `/api/config` |
| SessionData type | `{ host, port, username, password }` | **unchanged** — session still holds all four fields |

`SessionData` type does **not** change because subsequent SSH calls (containers, terminal, stats) still need host/port/username/password from the session. Only the _source_ of those values changes.

### Changes Required

#### 1. `packages/server/src/index.ts` — startup guard

Add after the JWT_SECRET guard:

```typescript
// CONF-01: Fail fast if SSH connection config is missing
const SSH_HOST = process.env.SSH_HOST
const SSH_PORT = Number(process.env.SSH_PORT ?? 22)
const SSH_USERNAME = process.env.SSH_USERNAME

if (!SSH_HOST || !SSH_HOST.trim()) {
  console.error('FATAL: SSH_HOST must be set in .env. Server cannot start.')
  process.exit(1)
}
if (!SSH_USERNAME || !SSH_USERNAME.trim()) {
  console.error('FATAL: SSH_USERNAME must be set in .env. Server cannot start.')
  process.exit(1)
}
if (isNaN(SSH_PORT) || SSH_PORT < 1 || SSH_PORT > 65535) {
  console.error('FATAL: SSH_PORT must be a valid port number (1-65535). Server cannot start.')
  process.exit(1)
}
```

The validated values don't need to be exported — each handler reads `process.env` directly (consistent with the JWT_SECRET pattern already in use).

#### 2. `packages/server/src/server.ts` — register `/api/config` route + add to exclusions

Add a public config route **before** the `verifyAuth` hook is in effect, or add `/api/config` to `EXCLUDED_PATHS`:

```typescript
// In server.ts, after registerAuthPlugins, before the preHandler hook:
fastify.get('/api/config', async () => ({
  host: process.env.SSH_HOST ?? '',
}))
```

**Alternative (preferred):** Add `/api/config` to `EXCLUDED_PATHS` in `middleware/verify-auth.ts`:

```typescript
const EXCLUDED_PATHS = ['/api/auth/login', '/api/auth/logout', '/health', '/api/config']
```

This keeps the route registered through the normal `authRoutes` plugin and is consistent with how login/logout are excluded.

#### 3. `packages/server/src/routes/auth.ts` — password-only login body

```typescript
type LoginBody = {
  password: string
  // host/port/username removed — read from process.env (CONF-01)
}

// Schema changes:
schema: {
  body: {
    type: 'object',
    required: ['password'],
    properties: {
      password: { type: 'string', minLength: 1 },
    },
  },
},

// Handler changes:
async (request, reply) => {
  const { password } = request.body
  const host = process.env.SSH_HOST!
  const port = Number(process.env.SSH_PORT ?? 22)
  const username = process.env.SSH_USERNAME!

  const result = await validateSshCredentials(host, port, username, password)
  // ... error handling unchanged ...

  const sessionId = crypto.randomUUID()
  setSession(sessionId, { host, port, username, password })
  // ... JWT cookie unchanged ...
}
```

Add `GET /api/config` handler in `auth.ts` (co-location rationale: config belongs near auth since it's the data the login page needs before authenticating):

```typescript
fastify.get('/api/config', async () => ({
  host: process.env.SSH_HOST ?? '',
}))
```

#### 4. `packages/web/src/pages/LoginPage.tsx` — password-only + host heading

- Remove `host`, `port`, `username` state variables
- Remove localStorage reads/writes for those fields
- Add `useEffect` to fetch `/api/config` and display host in heading
- Change POST body to `{ password }` only
- Update error messages (no more 502/504 "verify host and port" hints — those are now internal server errors)

```tsx
export function LoginPage() {
  const navigate = useNavigate()
  const [serverHost, setServerHost] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get('/auth/me')
      .then(() => navigate('/', { replace: true }))
      .catch(() => {})

    api.get('/config')
      .then((res) => setServerHost(res.data.host ?? ''))
      .catch(() => {})
  }, [navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    try {
      await api.post('/auth/login', { password })
      navigate('/')
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status
      if (status === 401) setError('Invalid password.')
      else if (status === 429) setError('Too many attempts. Wait a minute and try again.')
      else setError('An unexpected error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1 pb-4">
          <div className="flex items-center gap-2">
            <Server size={20} className="text-primary" />
            <CardTitle className="text-2xl font-bold">
              {serverHost ? `${serverHost} ServerDeck` : 'ServerDeck'}
            </CardTitle>
          </div>
          <CardDescription>Enter your SSH password</CardDescription>
        </CardHeader>
        <CardContent>
          {/* password field only — host/port/username removed */}
          ...
        </CardContent>
      </Card>
    </div>
  )
}
```

#### 5. `packages/server/.env.example` — add new variables

```
PORT=3001
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=replace-with-a-random-32-plus-character-string
LOG_LEVEL=info

# SSH connection — read at server startup (CONF-01)
SSH_HOST=192.168.1.100
SSH_PORT=22
SSH_USERNAME=ubuntu
```

### What Stays the Same

- `SessionData` type — still `{ host, port, username, password }` [VERIFIED: codebase]
- `GET /api/auth/me` response — still returns `{ ok: true, host, port, username }` from session
- `ProtectedRoute.tsx` — still reads host/username/port from `/auth/me`, passes as outlet context
- `DashboardPage.tsx` header display — still shows `username@host:port` unchanged
- `verifyAuth` middleware logic — no changes needed (just add `/api/config` to excluded paths)

---

## Topic 2: Server Stats via SSH

### Architecture Decision: One SSH Connection vs. Four

**Recommendation: ONE combined SSH call per stats request.** [ASSUMED — based on SSH connection overhead analysis]

Rationale:
- Each SSH handshake takes ~50–200ms plus TCP overhead
- Four separate connections = 200–800ms serial latency (or complexity of parallel Promise.all)
- One connection with multiple commands joined by `;` is standard shell practice
- The `sshExec` pattern in `docker-ssh.ts` already exists — just pass a longer command string

**Caveat:** The existing `sshExec` in `docker-ssh.ts` rejects the Promise if the exit code is non-zero. The combined stats command must ensure exit code 0 regardless of individual command failures (e.g., `/mnt/sdb` not mounted). Solution: terminate the command string with `; echo __END__` so the last command always succeeds.

### Shell Commands

#### Disk Usage (STATS-01)

```bash
df -B1 /
```

Output format:
```
Filesystem     1B-blocks      Used  Available Use% Mounted on
/dev/sda1     21474836480 8589934592 12622254080  41% /
```

Use `-B1` (1-byte blocks) rather than `-h` to get raw numbers for precise JS formatting. Never `-H` (powers of 1000 vs 1024 confusion).

**Parsing:**
```typescript
function parseDisk(section: string): DiskStats {
  const lines = section.trim().split('\n').filter(Boolean)
  // Header is lines[0]; data starts at lines[1]
  // Some filesystems have long names that cause line wrapping — join continued lines
  const dataLine = lines.slice(1).join(' ').trim()
  const parts = dataLine.split(/\s+/)
  // parts: [filesystem, 1B-blocks, used, available, use%, mountpoint]
  return {
    filesystem: parts[0],
    total: parseInt(parts[1], 10),
    used: parseInt(parts[2], 10),
    available: parseInt(parts[3], 10),
    usePercent: parseInt(parts[4], 10), // strips trailing %
  }
}
```

**Gotcha:** On some systems a long device name causes `df` to wrap the row onto the next line:
```
/dev/mapper/ubuntu--vg-ubuntu--lv
               21474836480 ...
```
Handle by joining all non-header lines and splitting by whitespace.

#### RAM Usage (STATS-02)

```bash
free -b
```

Output format:
```
               total        used        free      shared  buff/cache   available
Mem:     8589934592  1234567890  4567890123   123456789  2787476579  7000000000
Swap:    2147483648   567890123  1579593525
```

**Critical:** Use `available` column (column 6), NOT `free` column (column 3). The `free` column excludes buff/cache; `available` is what the kernel actually has for new allocations. [ASSUMED — standard Linux memory accounting]

```typescript
function parseRam(section: string): RamStats {
  const lines = section.trim().split('\n').filter(Boolean)
  const memLine = lines.find(l => l.startsWith('Mem:'))
  if (!memLine) throw new Error('Mem: line not found in free output')
  const parts = memLine.split(/\s+/)
  // parts: ['Mem:', total, used, free, shared, buff/cache, available]
  return {
    total: parseInt(parts[1], 10),
    used: parseInt(parts[2], 10),
    available: parseInt(parts[6], 10),
    usePercent: Math.round((parseInt(parts[2], 10) / parseInt(parts[1], 10)) * 100),
  }
}
```

**Fallback if `free` not available:** Parse `/proc/meminfo` directly. However, `free` ships with `procps` which is present on all major Linux distros. [ASSUMED]

#### Server Uptime (STATS-03)

```bash
cat /proc/uptime
```

Output: `86400.12 345600.45`

First number = uptime seconds (float). Second = cumulative CPU idle time across all cores (ignore).

`/proc/uptime` is always available on Linux kernels 2.6+ [ASSUMED]. Prefer this over `uptime -p` because `uptime -p` format varies by locale and may not be present on minimal installs.

```typescript
function parseUptime(section: string): UptimeStats {
  const seconds = parseFloat(section.trim().split(/\s+/)[0])
  const totalSeconds = Math.floor(seconds)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  parts.push(`${minutes}m`)

  return { seconds: totalSeconds, human: parts.join(' ') }
}
// Examples: "14d 6h 32m" | "3h 5m" | "47m"
```

#### `/mnt/sdb` Directory Listing (STATS-04)

```bash
du -sb /mnt/sdb/* 2>/dev/null; true
```

- `-s` = summarize (don't recurse further)
- `-b` = bytes (machine-parseable; format in JS)
- `2>/dev/null` = suppress "permission denied" errors for unreadable subdirs
- `; true` = ensure exit code 0 even if path doesn't exist or is empty

Output: `<bytes>\t<path>` per line:
```
12345678	/mnt/sdb/data
987654321	/mnt/sdb/backups
234567	/mnt/sdb/config
```

**Why `du -sb` over `ls -la`:** `ls -la` shows directory inode size (always 4096), not actual content size. `du -sb` recursively totals actual content — what users care about for "how big is my backups folder". [ASSUMED — standard distinction]

**Why not `du -sh`:** `-h` (human-readable) makes JS parsing fragile (`1.2G` vs `1.2T` etc.). Use `-sb` for bytes, format in JS.

```typescript
function parseMntSdb(section: string): MntEntry[] {
  return section
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [bytesStr, fullPath] = line.split('\t')
      const bytes = parseInt(bytesStr, 10)
      const name = fullPath.split('/').pop() ?? fullPath
      return { name, bytes, human: formatBytes(bytes) }
    })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
```

### Combined SSH Command

Use semicolons (not `&&`) so every command runs regardless. Sentinel echo markers delimit sections. The final `echo '__END__'` guarantees exit code 0.

```bash
echo '__DISK__'; df -B1 /; echo '__RAM__'; free -b; echo '__UPTIME__'; cat /proc/uptime; echo '__MNT__'; du -sb /mnt/sdb/* 2>/dev/null; echo '__END__'
```

**Section splitting:**

```typescript
function splitSections(raw: string): Record<string, string> {
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
```

### Stats Service: `packages/server/src/services/stats-ssh.ts`

Extract `sshExec` into a shared utility or import it from `docker-ssh.ts` — but `docker-ssh.ts`'s `sshExec` is module-private. **Recommendation:** Extract `sshExec` into a new `packages/server/src/services/ssh-exec.ts` utility that both `docker-ssh.ts` and `stats-ssh.ts` import.

```typescript
// ssh-exec.ts (extracted shared utility)
import { Client } from 'ssh2'
import type { SessionData } from '../types/session.js'

export async function sshExec(session: SessionData, command: string): Promise<string> {
  // ... same implementation as in docker-ssh.ts ...
}
```

The stats service then uses this:

```typescript
// stats-ssh.ts
import { sshExec } from './ssh-exec.js'
import type { SessionData } from '../types/session.js'

const STATS_COMMAND = [
  "echo '__DISK__'", 'df -B1 /',
  "echo '__RAM__'", 'free -b',
  "echo '__UPTIME__'", 'cat /proc/uptime',
  "echo '__MNT__'", 'du -sb /mnt/sdb/* 2>/dev/null',
  "echo '__END__'",
].join('; ')

// 30-second in-memory cache
let cache: { data: StatsResult; expiresAt: number } | null = null
const CACHE_TTL = 30_000

export async function getStats(session: SessionData): Promise<StatsResult> {
  if (cache && Date.now() < cache.expiresAt) return cache.data
  const raw = await sshExec(session, STATS_COMMAND)
  const data = parseStats(raw)
  cache = { data, expiresAt: Date.now() + CACHE_TTL }
  return data
}
```

### Stats Route: `GET /api/stats`

```typescript
// routes/stats.ts
fastify.get('/api/stats', async (request, reply) => {
  const session = (request as unknown as { session: SessionData }).session
  if (!session) return reply.status(401).send({ error: 'Unauthorized' })
  try {
    const stats = await getStats(session)
    return stats
  } catch (err) {
    fastify.log.error(err, 'stats fetch failed')
    return reply.status(503).send({ error: 'Stats unavailable' })
  }
})
```

### Response Type

```typescript
export interface StatsResult {
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
    seconds: number    // total uptime seconds
    human: string      // e.g. "14d 6h 32m"
  }
  mntSdb: Array<{
    name: string       // directory name only (no path)
    bytes: number
    human: string      // e.g. "12.3 GB"
  }> | null            // null if /mnt/sdb doesn't exist or is empty
}
```

### Error Handling Strategy

| Failure Scenario | Handling |
|-----------------|----------|
| `/mnt/sdb` not mounted | `du` exits non-zero; `; true` ensures SSH command exits 0; `__MNT__` section is empty → `mntSdb: null` |
| `free` not installed | Parse error → return `ram: null` and log warning |
| SSH connection fails | `sshExec` rejects → route returns `503` |
| Partial section data | Each parser is wrapped in try/catch; partial data returns what's available |

---

## Topic 3: Domain Health Check (STATS-05)

### Why Server-Side (Not Browser-Side)

| Factor | Browser `fetch` | Server-Side |
|--------|----------------|-------------|
| Mixed-content (http:// from https:// page) | ❌ Blocked by browser | ✅ No restriction |
| CORS | ❌ Blocked unless domain allows | ✅ No restriction |
| Actual reachability from server | ❌ Tests browser's network | ✅ Tests server's network (what you want) |
| `mode: 'no-cors'` status visibility | ❌ Opaque — can't read status code | ✅ Full response access |

**Conclusion:** Server-side is the correct approach. [ASSUMED — based on standard mixed-content and CORS analysis]

The homelab use case makes mixed-content especially relevant: HTTP-only internal services (e.g., `http://192.168.1.50:8080`) are common on home networks. If ServerDeck is deployed with HTTPS (required for `Secure` cookies), the browser will block all `http://` fetch calls. Server-side sidesteps this entirely.

### Endpoint Design

```
POST /api/health/domains
Body: { urls: string[] }
Response: { results: Array<{ url: string; ok: boolean; status: number | null }> }
```

**Why POST over GET:** A list of URLs is too long for query parameters (some domain lists could have 10+ long URLs). POST body is cleaner and avoids URL encoding issues.

**Why not GET `/api/health/domains?urls=...`:** Query strings have length limits; URL encoding is fragile. POST body with `{ urls: string[] }` is idiomatic.

**Security (SSRF hardening for personal tool):** Validate that each URL starts with `http://` or `https://` only. For a personal tool, this is sufficient. [ASSUMED — SSRF mitigation practice]

```typescript
// Fastify schema for validation
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
          pattern: '^https?://',
        },
      },
    },
  },
}
```

### Node.js `fetch` for HEAD Requests

Node.js 18+ ships with built-in `fetch` (Undici-based). [ASSUMED — Node 18+ confirmed in stack as LTS requirement]

```typescript
async function checkDomain(url: string): Promise<DomainCheckResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000) // 5s timeout
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    })
    clearTimeout(timer)
    // Consider any 2xx or 3xx "up"; 5xx = down; connection refused = down
    const ok = response.status < 500
    return { url, ok, status: response.status }
  } catch {
    clearTimeout(timer)
    return { url, ok: false, status: null }
  }
}
```

**Run all checks in parallel:**

```typescript
const results = await Promise.all(urls.map(checkDomain))
```

With 5s timeout and parallel execution, worst-case latency is 5s for a single call with all-offline domains.

**Frontend domain list (hardcoded):**

The domains live in the frontend (STATS-05 requirement: "hardcoded list"). The frontend calls `POST /api/health/domains` with its list. Example frontend structure:

```typescript
// web/src/config/domains.ts
export const MONITORED_DOMAINS = [
  'https://myapp.example.com',
  'https://grafana.homelab.local',
  'http://pihole.homelab.local',
] as const
```

The frontend React query:
```typescript
const { data } = useQuery({
  queryKey: ['domainHealth'],
  queryFn: () => api.post('/health/domains', { urls: MONITORED_DOMAINS }).then(r => r.data),
  refetchInterval: 60_000, // check every 60s — no need for real-time
  staleTime: 30_000,
})
```

---

## Topic 4: `VITE_API_BASE` (CONF-03)

### Change Required: `packages/web/src/lib/axios.ts`

```typescript
// Before
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

// After (one-line change)
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
  withCredentials: true,
})
```

**Important:** `import.meta.env.VITE_API_BASE` is replaced at Vite build time — it is NOT a runtime variable. The empty string `''` is falsy, so `|| '/api'` correctly falls back when the variable is unset or empty. [ASSUMED — standard Vite env var behavior]

### New file: `packages/web/.env.example`

```
# API base URL for cross-origin deployments.
# Leave empty (or delete this line) when the frontend is served from the same
# origin as the Fastify backend (default setup).
# Example for separate deployments: VITE_API_BASE=https://api.yourdomain.com
VITE_API_BASE=
```

---

## Topic 5: API Design for Stats

### Single Endpoint vs. Multiple Endpoints

**Recommendation: Single `GET /api/stats`** returning all four stats in one response. [ASSUMED]

Rationale:
- All four stats are collected in one SSH connection anyway
- Frontend can show one loading spinner for the stats section
- Simpler caching (one cache entry vs. four)
- Reduces waterfall; dashboard loads with one API call

**Single 30-second in-memory cache on the server:**
- Stats don't change significantly in 30 seconds
- Avoids hammering SSH for every dashboard render
- Cache is session-agnostic (all users share the same server, same stats)
- Cache invalidation is simple: TTL expires, next request refreshes

**TanStack Query on the frontend:**
```typescript
const { data: stats, isLoading } = useQuery({
  queryKey: ['stats'],
  queryFn: () => api.get('/stats').then(r => r.data),
  refetchInterval: 30_000,  // poll every 30s
  staleTime: 25_000,        // don't refetch if data is <25s old
})
```

### Register Stats Route in `server.ts`

```typescript
import { statsRoutes } from './routes/stats.js'
// ...
await fastify.register(statsRoutes)
```

The `verifyAuth` preHandler already protects all `/api/*` routes, so no extra auth needed on the stats route.

---

## Architecture Patterns

### Recommended Project Structure (additions for this phase)

```
packages/server/src/
├── services/
│   ├── ssh-exec.ts          # NEW: extracted shared sshExec utility
│   ├── docker-ssh.ts        # MODIFIED: import sshExec from ssh-exec.ts
│   └── stats-ssh.ts         # NEW: stats collection + 30s cache
├── routes/
│   ├── auth.ts              # MODIFIED: password-only + /api/config endpoint
│   └── stats.ts             # NEW: GET /api/stats + POST /api/health/domains
├── middleware/
│   └── verify-auth.ts       # MODIFIED: add /api/config to EXCLUDED_PATHS
└── index.ts                 # MODIFIED: SSH_HOST/PORT/USERNAME startup guard

packages/web/src/
├── config/
│   └── domains.ts           # NEW: hardcoded domain list for STATS-05
├── lib/
│   └── axios.ts             # MODIFIED: VITE_API_BASE support
└── pages/
    ├── LoginPage.tsx         # MODIFIED: password-only, host heading
    └── DashboardPage.tsx     # MODIFIED: stats panel + domain badges
```

### Data Flow: Stats Request

```
Browser (DashboardPage)
  └─ useQuery(['stats']) → GET /api/stats
       └─ verifyAuth middleware (validates JWT cookie, loads session)
            └─ statsRoutes handler
                 ├─ check in-memory cache (30s TTL)
                 │    └─ HIT: return cached data
                 └─ MISS: sshExec(session, STATS_COMMAND)
                      └─ SSH to SSH_HOST:SSH_PORT as SSH_USERNAME
                           └─ combined shell command runs
                                ├─ df -B1 /
                                ├─ free -b
                                ├─ cat /proc/uptime
                                └─ du -sb /mnt/sdb/*
                           └─ raw stdout returned
                      └─ parseStats(raw) → StatsResult
                      └─ store in cache with expiresAt
                      └─ return StatsResult as JSON
```

### Data Flow: Domain Health Check

```
Browser (DashboardPage)
  └─ useQuery(['domainHealth']) → POST /api/health/domains { urls: MONITORED_DOMAINS }
       └─ verifyAuth middleware
            └─ healthRoutes handler
                 └─ validate urls[] (schema: http/https only, maxItems: 20)
                      └─ Promise.all(urls.map(checkDomain))
                           └─ fetch(url, { method: 'HEAD', timeout: 5s })
                      └─ return { results: [...] }
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSH execution | Custom SSH client | `ssh2` (already in project) | Already used in `docker-ssh.ts` |
| Stats output parsing | Regex spaghetti | Structured `split(/\s+/)` on well-defined formats | `df -B1` and `free -b` have stable, machine-readable layouts |
| HTTP health checks | Custom TCP checker | Node.js built-in `fetch` (Undici) | Available on Node 18+, handles redirects, TLS, timeouts via AbortController |
| Frontend state caching | Custom fetch cache | TanStack Query `staleTime` + `refetchInterval` | Already in use in `DashboardPage.tsx` |
| Response validation | Manual type checking | Fastify JSON schema validation | Already used in all routes |

---

## Common Pitfalls

### Pitfall 1: `df` Long-Device-Name Line Wrapping
**What goes wrong:** On systems with LVM volumes (`/dev/mapper/ubuntu--vg-ubuntu--lv`), `df` wraps the data row across two lines. `lines[1]` has only the device name; `lines[2]` has the numbers.
**How to avoid:** Join all non-header lines before splitting by whitespace: `lines.slice(1).join(' ').split(/\s+/)`.
**Warning signs:** `parseInt(parts[1], 10)` returns `NaN` for disk stats.

### Pitfall 2: Using `free` Column Instead of `available`
**What goes wrong:** `free` column excludes buff/cache (intentionally "wasted" memory the kernel can reclaim). Reporting it makes RAM look artificially consumed on any real workload.
**How to avoid:** Always use `available` (column 6 in `free -b` output), which is the kernel's estimate of memory available for new allocations.
**Warning signs:** RAM usage shows 80%+ even with few processes running.

### Pitfall 3: `du -sb /mnt/sdb/*` Fails with Non-Zero Exit
**What goes wrong:** If `/mnt/sdb` doesn't exist or is empty, `du` exits non-zero. The `sshExec` utility in `docker-ssh.ts` rejects the Promise on non-zero exit, which would make the entire stats request fail.
**How to avoid:** Terminate the combined command string with `; echo '__END__'` — the last command is always `echo`, exit code is always 0.
**Warning signs:** `GET /api/stats` always returns 503 when the server doesn't have `/mnt/sdb`.

### Pitfall 4: `/api/config` Not in `EXCLUDED_PATHS`
**What goes wrong:** `verifyAuth` blocks unauthenticated access to `/api/config`. The login page fetches it before login, so the heading is never shown.
**How to avoid:** Add `/api/config` to `EXCLUDED_PATHS` in `middleware/verify-auth.ts`.
**Warning signs:** Login page always shows "ServerDeck" without the host prefix; browser DevTools shows 401 on `/api/config`.

### Pitfall 5: `VITE_API_BASE` vs. Runtime `process.env`
**What goes wrong:** Treating `import.meta.env.VITE_API_BASE` as a runtime variable. It is replaced at `vite build` time — changing the environment variable after the build has no effect.
**How to avoid:** Document this clearly in `.env.example`. The build must be re-run when `VITE_API_BASE` changes.
**Warning signs:** Changing `VITE_API_BASE` in production `.env` and wondering why API calls still go to the old URL.

### Pitfall 6: Domain Health Check `fetch` in Browser vs. Server
**What goes wrong:** Implementing STATS-05 with `fetch` in the React component. Works in dev (HTTP), silently fails in production (HTTPS → HTTP mixed-content blocked, CORS errors).
**How to avoid:** Always use the `POST /api/health/domains` server-side endpoint. The server has no mixed-content restrictions.
**Warning signs:** Health badges all show "down" in production on HTTPS but "up" in local dev.

### Pitfall 7: Session `host/port/username` Population After Login Change
**What goes wrong:** After removing host/port/username from the login body, forgetting to populate them from `process.env` before calling `setSession`. Session is created with undefined values, breaking all subsequent SSH calls.
**How to avoid:** In `auth.ts` handler, explicitly read `process.env.SSH_HOST!`, `Number(process.env.SSH_PORT ?? 22)`, `process.env.SSH_USERNAME!` before calling `setSession`.
**Warning signs:** Container list returns SSH errors; terminal can't connect after login.

---

## Code Examples

### Complete `parseStats` Function

```typescript
// Source: codebase analysis + standard Linux command output formats [ASSUMED]

export function parseStats(raw: string): StatsResult {
  const sections = splitSections(raw)

  return {
    disk: parseDisk(sections['__DISK__'] ?? ''),
    ram: parseRam(sections['__RAM__'] ?? ''),
    uptime: parseUptime(sections['__UPTIME__'] ?? ''),
    mntSdb: parseMntSdb(sections['__MNT__'] ?? ''),
  }
}

function splitSections(raw: string): Record<string, string> {
  const MARKERS = new Set(['__DISK__', '__RAM__', '__UPTIME__', '__MNT__', '__END__'])
  const sections: Record<string, string> = {}
  let current = ''
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (MARKERS.has(trimmed)) {
      current = trimmed
      if (current !== '__END__') sections[current] = ''
    } else if (current && current !== '__END__') {
      sections[current] += line + '\n'
    }
  }
  return sections
}

function parseDisk(section: string): StatsResult['disk'] {
  const lines = section.trim().split('\n').filter(Boolean)
  if (lines.length < 2) throw new Error('Unexpected df output')
  // Join all non-header lines to handle long device names that wrap
  const data = lines.slice(1).join(' ').trim().split(/\s+/)
  return {
    filesystem: data[0],
    total: parseInt(data[1], 10),
    used: parseInt(data[2], 10),
    available: parseInt(data[3], 10),
    usePercent: parseInt(data[4], 10), // e.g. "41%" → 41
  }
}

function parseRam(section: string): StatsResult['ram'] {
  const lines = section.trim().split('\n').filter(Boolean)
  const memLine = lines.find(l => l.startsWith('Mem:'))
  if (!memLine) throw new Error('Mem: line missing from free output')
  const p = memLine.split(/\s+/)
  // p[0]='Mem:', p[1]=total, p[2]=used, p[3]=free, p[4]=shared, p[5]=buff/cache, p[6]=available
  const total = parseInt(p[1], 10)
  const used = parseInt(p[2], 10)
  const available = parseInt(p[6], 10)
  return { total, used, available, usePercent: Math.round((used / total) * 100) }
}

function parseUptime(section: string): StatsResult['uptime'] {
  const seconds = Math.floor(parseFloat(section.trim().split(/\s+/)[0]))
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return { seconds, human: parts.join(' ') }
}

function parseMntSdb(section: string): StatsResult['mntSdb'] {
  const lines = section.trim().split('\n').filter(Boolean)
  if (lines.length === 0) return null
  return lines.map(line => {
    const tabIdx = line.indexOf('\t')
    const bytes = parseInt(line.slice(0, tabIdx), 10)
    const fullPath = line.slice(tabIdx + 1).trim()
    const name = fullPath.split('/').pop() ?? fullPath
    return { name, bytes, human: formatBytes(bytes) }
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
```

### Domain Health Check Route

```typescript
// Source: codebase analysis + Node.js fetch API [ASSUMED]

import type { FastifyInstance } from 'fastify'

interface DomainCheckResult {
  url: string
  ok: boolean
  status: number | null
}

async function checkDomain(url: string): Promise<DomainCheckResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    })
    clearTimeout(timer)
    return { url, ok: res.status < 500, status: res.status }
  } catch {
    clearTimeout(timer)
    return { url, ok: false, status: null }
  }
}

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: { urls: string[] } }>(
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
              items: { type: 'string', pattern: '^https?://' },
            },
          },
        },
      },
    },
    async (request) => {
      const { urls } = request.body
      const results = await Promise.all(urls.map(checkDomain))
      return { results }
    }
  )
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `uptime -p` (human-readable string) | `cat /proc/uptime` (float seconds) | Always preferred for parsing | JS formats the string; no locale dependency |
| `df -h` (human-readable) | `df -B1` (bytes) | Always preferred for parsing | Eliminates unit ambiguity (G vs GiB) |
| `free -m` or `free -g` | `free -b` (bytes) | Always preferred for parsing | Eliminates rounding errors in small values |
| Browser-side fetch for health checks | Server-side fetch | Phase 7 decision | Avoids mixed-content and CORS issues |
| axios baseURL hardcoded | `import.meta.env.VITE_API_BASE \|\| '/api'` | Phase 7 | Enables separate frontend/backend deployments |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | SSH handshake overhead makes one combined call preferable to four separate connections | Topic 2 | Low — worst case is slightly more latency; correctness unaffected |
| A2 | `free -b` is available on the target server (procps package installed) | Topic 2 | Medium — `/proc/meminfo` fallback parsing needed if `free` absent |
| A3 | `/proc/uptime` is always available on Linux 2.6+ kernels | Topic 2 | Low — essentially all modern Linux systems have this |
| A4 | `du -sb /mnt/sdb/*` exits non-zero when path doesn't exist, and `; true` prevents SSH exec rejection | Topic 2 | Medium — must test; if `sshExec` still rejects, add explicit `|| true` to du line |
| A5 | Server-side `fetch` (Node 18+ built-in, Undici) handles HTTP and HTTPS without mixed-content restriction | Topic 3 | Low — this is a fundamental Node.js property |
| A6 | `import.meta.env.VITE_API_BASE` is replaced at Vite build time | Topic 4 | Low — this is documented Vite behavior |
| A7 | SSRF risk from domain health check is acceptable for a personal tool with validated http/https URLs | Topic 3 | Low — personal tool running on personal server |

---

## Open Questions

1. **Should `/api/config` return only `host`, or also `port` and `username`?**
   - What we know: CONF-02 only requires the host in the heading
   - What's unclear: Is there value in showing port/username anywhere publicly?
   - Recommendation: Return only `{ host }`. Username/port are not needed by the login page.

2. **Should the stats cache be per-session or global?**
   - What we know: All sessions SSH to the same server, so all stats are identical
   - What's unclear: Is there a case where different sessions would see different stats?
   - Recommendation: Global cache (one cache entry regardless of session). The session is only used to establish the SSH connection.

3. **What domains should be in the initial `MONITORED_DOMAINS` list?**
   - This is user-specific and must be configured by the user
   - Recommendation: Start with an empty array or a placeholder; document that users edit `web/src/config/domains.ts`

4. **Should `/mnt/sdb` path be configurable (via env var) or hardcoded?**
   - STATS-04 specifies `/mnt/sdb` explicitly
   - Recommendation: Hardcode for now; env var override is a future enhancement

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `df` command | STATS-01 | ✓ (standard on all Linux) | pre-installed | None needed |
| `free` command (procps) | STATS-02 | ✓ (standard on Ubuntu/Debian) | pre-installed | Parse `/proc/meminfo` directly |
| `/proc/uptime` | STATS-03 | ✓ (Linux kernel 2.6+) | always present | None needed |
| `du` command (coreutils) | STATS-04 | ✓ (standard on all Linux) | pre-installed | `ls -la /mnt/sdb` (shows inode size only) |
| Node.js `fetch` (Undici) | STATS-05 | ✓ (Node 18+ LTS) | ≥18 required by stack | `node-fetch` package |
| `ssh2` npm package | Topic 2 SSH exec | ✓ already in `package.json` | 1.17.0 | Already installed |

**Missing dependencies with no fallback:** None.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected — no vitest/jest config found |
| Config file | None — Wave 0 gap |
| Quick run command | N/A — no test runner configured |
| Full suite command | N/A — no test runner configured |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONF-01 | Server starts with SSH_HOST/PORT/USERNAME in env; fails without them | Integration (manual smoke) | N/A — startup guard | ❌ No test infra |
| CONF-02 | Login page heading shows host from `/api/config` | Manual UI check | N/A | ❌ No test infra |
| CONF-03 | `VITE_API_BASE` changes axios baseURL at build time | Build smoke test | `VITE_API_BASE=https://test.com pnpm build && grep test.com packages/web/dist/assets/*.js` | ❌ No test infra |
| STATS-01 | `GET /api/stats` returns disk stats with total/used/available/usePercent | Unit (parseStats) | N/A | ❌ No test infra |
| STATS-02 | `GET /api/stats` returns RAM stats with total/used/available/usePercent | Unit (parseRam) | N/A | ❌ No test infra |
| STATS-03 | `GET /api/stats` returns uptime.human in "Xd Xh Xm" format | Unit (parseUptime) | N/A | ❌ No test infra |
| STATS-04 | `GET /api/stats` returns mntSdb array with name/bytes/human | Unit (parseMntSdb) | N/A | ❌ No test infra |
| STATS-05 | `POST /api/health/domains` returns ok/status for each URL | Integration (manual) | N/A | ❌ No test infra |

### Wave 0 Gaps

No existing test infrastructure in the project. For this phase:
- [ ] Parser functions (`parseDisk`, `parseRam`, `parseUptime`, `parseMntSdb`) are pure functions operating on strings — they are the prime candidates for unit tests if a test runner is ever added
- [ ] The `VITE_API_BASE` build-time substitution can be verified manually with a `grep` on the built assets

**Practical recommendation:** Since this is a personal project with no test infrastructure, verification is manual. The parsing functions should be written as pure, exported functions so they can be tested trivially if vitest is added later.

---

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | Existing JWT httpOnly cookie — unchanged |
| V3 Session Management | Yes | Existing session store — unchanged |
| V4 Access Control | Yes | `verifyAuth` preHandler covers all new `/api/stats` and `/api/health/domains` routes |
| V5 Input Validation | Yes | Fastify JSON schema validates all request bodies |
| V6 Cryptography | No | No new crypto operations |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthenticated access to stats | Elevation of privilege | `verifyAuth` preHandler (already in place) |
| SSRF via domain health check | Spoofing/Info disclosure | Schema validation: `pattern: '^https?://'`, `maxItems: 20` |
| Leaked SSH credentials via `/api/config` | Information disclosure | `/api/config` returns only `host` — never password, username, or port |
| Startup with missing SSH env vars | Denial of service (misconfiguration) | Fail-fast guard in `index.ts` with clear error message |
| Injection via SSH command strings | Tampering | Stats command is a static string constant — no user input interpolated |

---

## Package Legitimacy Audit

No new packages are installed in this phase. All SSH, HTTP, and parsing functionality uses:
- `ssh2` — already installed at v1.17.0 [VERIFIED: codebase — in `packages/server/package.json`]
- Node.js built-in `fetch` — no npm package needed
- Standard Fastify patterns already in use

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Sources

### Primary (HIGH confidence)
- Codebase direct inspection: `packages/server/src/routes/auth.ts`, `services/docker-ssh.ts`, `services/session-store.ts`, `types/session.ts`, `middleware/verify-auth.ts`, `index.ts`, `server.ts` — all implementation details verified by reading actual source [VERIFIED: codebase]
- Codebase direct inspection: `packages/web/src/lib/axios.ts`, `pages/LoginPage.tsx`, `pages/DashboardPage.tsx`, `components/ProtectedRoute.tsx` [VERIFIED: codebase]

### Secondary (MEDIUM confidence)
- Linux `df -B1`, `free -b`, `/proc/uptime`, `du -sb` command output formats — standard Linux utilities with well-defined stable output formats [ASSUMED — training knowledge, confirmed against standard man page formats]
- Node.js built-in `fetch` availability (Node 18+ LTS) — project requires Node ≥20 LTS (from `copilot-instructions.md` stack section) [ASSUMED]

### Tertiary (LOW confidence — flagged in Assumptions Log)
- SSH connection overhead estimates (50–200ms) — basis for recommending single combined call
- `procps` package availability on target server

---

## Metadata

**Confidence breakdown:**
- Auth refactor (CONF-01/02): HIGH — direct codebase read, surgical changes
- VITE_API_BASE (CONF-03): HIGH — one-line change, standard Vite env pattern
- SSH stats commands: MEDIUM — standard Linux utilities, output formats assumed stable
- Stats parsing: HIGH — pure functions on deterministic formats
- Domain health (STATS-05): HIGH — server-side fetch avoids all browser restrictions

**Research date:** 2025-06-05
**Valid until:** 2025-07-05 (stable domain — no fast-moving dependencies)
