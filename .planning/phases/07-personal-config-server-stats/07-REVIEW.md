---
phase: 07-personal-config-server-stats
status: findings
reviewed_at: 2026-05-30
depth: deep
files_reviewed: 12
files_reviewed_list:
  - packages/server/src/index.ts
  - packages/server/src/middleware/verify-auth.ts
  - packages/server/src/routes/auth.ts
  - packages/server/src/services/docker-ssh.ts
  - packages/server/src/routes/stats.ts
  - packages/server/src/routes/health.ts
  - packages/web/src/lib/axios.ts
  - packages/web/src/pages/LoginPage.tsx
  - packages/web/src/config/domains.ts
  - packages/web/src/components/StatsPanel.tsx
  - packages/web/src/components/DomainHealthWidget.tsx
  - packages/web/src/pages/DashboardPage.tsx
findings:
  critical: 0
  warning: 3
  info: 0
  total: 3
---

# Phase 7: Code Review Report

**Reviewed:** 2026-05-30  
**Depth:** deep  
**Files Reviewed:** 12  
**Status:** issues_found

## Summary

Overall the implementation is solid. Auth is correctly scoped, sentinel-marker parsing covers the common cases, the hooks-ordering concern in `DomainHealthWidget` is handled correctly (hook is called before the early return), and the `sshExec` exit-code issue is neutralised by the `; true` tail in `STATS_CMD`. Three issues worth fixing are documented below.

---

## Warnings

### WR-01: SSRF guard in `/api/health/domains` is incomplete — localhost and internal ranges are reachable

**File:** `packages/server/src/routes/health.ts:46-49`

**Issue:** The only validation applied to each URL is the JSON Schema `pattern: '^https?://'`. This permits any host that starts with `http://` or `https://`, including:

- `http://localhost:8080/` — probe services on the same host
- `http://127.0.0.1/` — same
- `http://169.254.169.254/latest/meta-data/` — EC2 / cloud metadata
- `http://192.168.x.x/` — LAN services

Additionally `checkUrl` uses `redirect: 'follow'` (line 20). This means a URL that passes schema validation (e.g., `https://public-site.com/`) can redirect the server to an internal address and the server will follow it — bypassing URL validation entirely.

The endpoint requires authentication, so exploitation requires a valid session. For the current single-user context the practical risk is low. The concern becomes material if the app is ever placed behind a shared reverse proxy or multi-user deployment.

**Fix:**

```typescript
import { URL } from 'node:url'

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^localhost$/i,
]

function isSafeHost(raw: string): boolean {
  try {
    const { hostname } = new URL(raw)
    return !PRIVATE_RANGES.some((re) => re.test(hostname))
  } catch {
    return false
  }
}
```

Apply in the route handler before `Promise.all`:

```typescript
const safe = urls.filter(isSafeHost)
if (safe.length !== urls.length) {
  return reply.status(400).send({ error: 'Private/internal URLs are not allowed' })
}
```

Change `redirect: 'follow'` → `redirect: 'manual'` so that open-redirect bypasses are impossible.

---

### WR-02: `GET /api/config` discloses `SSH_HOST` without authentication

**File:** `packages/server/src/routes/auth.ts:65-67`  
**File:** `packages/server/src/middleware/verify-auth.ts:4`

**Issue:** `/api/config` is added to `EXCLUDED_PATHS` and returns `process.env.SSH_HOST` to any unauthenticated caller. The intent is documented (login-page heading), but it means every internet-facing deployment of ServerDeck reveals the SSH target host/IP in plaintext to a passive network observer or scanner — without even requiring a login attempt. In environments where the hostname is not otherwise public, this is useful reconnaissance.

**Fix:** Two options:

1. **Preferred — move the heading into the login form itself.** Remove `/api/config` entirely and hard-code or bake the host into the build via `VITE_SERVER_HOST`. The value is only cosmetic; it does not need to be fetched at runtime.

2. **If runtime fetch is required** — serve the value only after the JWT cookie is verified. The login page already has an authenticated `/api/auth/me` path; the host is already returned there (`{ ok: true, host, port, username }`). The `/config` call in `LoginPage.useEffect` can be replaced with a conditional call to `/auth/me` before the redirect:

```typescript
useEffect(() => {
  api.get<{ ok: boolean; host: string }>('/auth/me')
    .then(({ data }) => {
      setServerHost(data.host)
      navigate('/', { replace: true })
    })
    .catch(() => {})
}, [navigate])
```

This removes the unauthenticated surface entirely while still populating the heading for already-authenticated users who land on `/login`.

---

### WR-03: `_parseDisk` silently produces `NaN` fields and poisons the 30-second stats cache

**File:** `packages/server/src/services/docker-ssh.ts:172-185`

**Issue:** `_parseDisk` joins all non-header lines of the `df` section and splits on whitespace. If the `__DISK__` section is empty — which happens when `df` emits its error on stderr and `sshExec` still resolves (possible if a prior section's output arrives before `df` fails and the overall exit code is 0 because of `; true`) — then:

```
lines = []
data  = ''          // lines.slice(1).join(' ')
parts = ['']        // ''.split(/\s+/)
parseInt(parts[1], 10)  // parseInt(undefined, 10) → NaN
```

The result object passes TypeScript's type checker because the return type is `ServerStats['disk']` and `NaN` satisfies `number`. The corrupted object is then written to `_statsCache` with a 30-second TTL. Every API response for the next 30 seconds returns `{ total: NaN, used: NaN, ... }`, and the frontend renders `"NaN B / NaN B (NaN%)"`.

The same silent-NaN path exists in `_parseUptime` if the `/proc/uptime` section is empty.

**Fix:** Add a bounds check and throw explicitly so the error surfaces and is caught by the `stats.ts` route handler (which already returns a 502 on thrown errors), preventing NaN from being cached:

```typescript
function _parseDisk(section: string): ServerStats['disk'] {
  const lines = section.trim().split('\n').filter(Boolean)
  if (lines.length < 2) throw new Error('df output missing data row')
  const data = lines.slice(1).join(' ').trim()
  const parts = data.split(/\s+/)
  if (parts.length < 5) throw new Error(`df output has too few columns: ${parts.length}`)
  return {
    filesystem: parts[0],
    total: parseInt(parts[1], 10),
    used: parseInt(parts[2], 10),
    available: parseInt(parts[3], 10),
    usePercent: parseInt(parts[4], 10),
  }
}
```

Apply the same pattern to `_parseUptime`:

```typescript
function _parseUptime(section: string): ServerStats['uptime'] {
  const raw = section.trim()
  if (!raw) throw new Error('uptime section is empty')
  const seconds = Math.floor(parseFloat(raw.split(/\s+/)[0]))
  if (!Number.isFinite(seconds)) throw new Error(`unparseable uptime value: ${raw}`)
  // ... rest unchanged
}
```

---

_Reviewed: 2026-05-30_  
_Reviewer: gsd-code-reviewer_  
_Depth: deep_
