---
phase: 01-auth-foundation
reviewed: 2025-05-30T00:00:00Z
depth: deep
files_reviewed: 7
files_reviewed_list:
  - packages/server/src/services/ssh-auth.ts
  - packages/server/src/routes/auth.ts
  - packages/server/src/middleware/verify-auth.ts
  - packages/server/src/services/session-store.ts
  - packages/web/src/lib/axios.ts
  - packages/web/src/components/ProtectedRoute.tsx
  - packages/web/src/pages/LoginPage.tsx
findings:
  critical: 4
  warning: 4
  info: 3
  total: 11
status: issues_found
---

# Phase 01: Auth Foundation — Code Review Report

**Reviewed:** 2025-05-30  
**Depth:** deep (cross-file call-chain analysis)  
**Files Reviewed:** 7  
**Status:** issues_found

---

## Summary

The auth foundation is architecturally sound: JWT lives only in an httpOnly cookie, the JWT payload contains only `sessionId`, SSH credentials are never echoed in responses, and the session store correctly separates the token from the credential blob. Rate limiting is scoped correctly to the login route.

However, there are **four blockers** that make the system partly non-functional and partly insecure in its current state:

1. The axios 401 interceptor causes an **infinite reload loop** on the login page and swallows login error messages — the core login UI flow is broken for wrong-credentials and unauthenticated states.
2. The logout endpoint calls `jwt.decode` (no signature check) instead of `jwt.verify`, allowing **unauthenticated session deletion** by anyone who can supply a base64-encoded payload with a target `sessionId`.
3. The `verifyAuth` preHandler matches against `request.url` which **includes query parameters**, so `POST /api/auth/login?anything` bypasses the exclusion list and returns 401 before the login handler runs.
4. All SSH failures (host unreachable, timeout, auth failure) resolve the same way, so **every SSH error maps to HTTP 401** "Invalid credentials" — making it impossible for the client to distinguish a wrong password from an unreachable host, and meaning the client's "Connection timed out" branch is dead code.

---

## Critical Issues

### CR-01: Axios 401 Interceptor Causes Infinite Reload Loop and Swallows Login Errors

**Files:**  
- `packages/web/src/lib/axios.ts:11-13`  
- `packages/web/src/pages/LoginPage.tsx:20-24` (useEffect)  
- `packages/web/src/pages/LoginPage.tsx:37-50` (handleSubmit)

**Issue:**  
The global 401 interceptor unconditionally does `window.location.href = '/login'` for every 401 response. This creates two broken flows:

**Flow A — Infinite reload on page open:**  
`LoginPage` mounts → `useEffect` calls `GET /api/auth/me` → server returns 401 (unauthenticated user has no cookie) → interceptor fires before the `.catch(() => {})` → `window.location.href = '/login'` → page reloads → repeat indefinitely.

**Flow B — Login errors never shown:**  
User submits wrong credentials → server returns 401 → interceptor fires before `handleSubmit`'s `catch` block runs → redirects to `/login` → page reloads with blank form and no error message. The user sees an unexplained page reload instead of "Invalid credentials."

The interceptor must be skipped when the app is already at `/login`, and should not intercept responses from endpoints that are deliberately calling unauthenticated routes.

**Fix:**
```typescript
// packages/web/src/lib/axios.ts
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      window.location.pathname !== '/login'
    ) {
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
```

---

### CR-02: Logout Endpoint Deletes Sessions Without Verifying JWT Signature

**File:** `packages/server/src/routes/auth.ts:60-69`

**Issue:**  
The logout handler reads the `sd_token` cookie and calls `fastify.jwt.decode(token)` — which is a **no-verification base64 decode**, not a cryptographic check. `decode` accepts any syntactically valid JWT regardless of whether the signature is correct.

Because `/api/auth/logout` is in `EXCLUDED_PATHS` (unauthenticated), anyone who sends a raw HTTP request with a hand-crafted cookie containing an arbitrary `sessionId` can delete that session without possessing the real JWT:

```
POST /api/auth/logout HTTP/1.1
Cookie: sd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.<base64({"sessionId":"<target-uuid>"})>.fake_sig
```

`decode` extracts the payload, `deleteSession(targetUuid)` runs, the victim's session is gone. While UUIDs are not guessable in practice, using unverified data to make an authorization-adjacent decision is architecturally unsafe and violates the principle of only trusting signed tokens.

**Fix:** Verify the token before acting on its contents. Because `fastify.jwt.verify` is async and throws on failure, the existing `try/catch` handles errors correctly:

```typescript
// packages/server/src/routes/auth.ts — logout handler
try {
  const token = (request.cookies as Record<string, string | undefined>)['sd_token']
  if (token) {
    const decoded = await fastify.jwt.verify<{ sessionId: string }>(token)
    if (decoded?.sessionId) {
      deleteSession(decoded.sessionId)
    }
  }
} catch {
  // invalid/expired token — nothing to delete
}
```

---

### CR-03: `verifyAuth` Exclusion List Broken for URLs With Query Parameters

**File:** `packages/server/src/middleware/verify-auth.ts:10`

**Issue:**  
`request.url` in Fastify contains the **full raw URL** including query string, path parameters, etc. The exclusion check uses `Array.includes`, which requires an exact string match:

```typescript
if (EXCLUDED_PATHS.includes(request.url)) { // request.url = "/api/auth/login?foo=bar"
```

A request to `/api/auth/login?foo=bar` does **not** match `/api/auth/login`, so `verifyAuth` proceeds to call `request.jwtVerify()`, which throws (no token), and the middleware returns 401 before the login route handler ever runs.

While a well-behaved client would not append query params to a POST login, this is a fragile implementation that breaks under any deviation (e.g., a CDN that adds tracking params, a proxy that appends debugging params, or a future developer adding a redirect param like `?next=/dashboard`).

**Fix:** Use `request.routeOptions.url` (the matched route pattern, no query string) or strip the query string before comparing:

```typescript
// packages/server/src/middleware/verify-auth.ts
const pathname = request.url.split('?')[0]
if (EXCLUDED_PATHS.includes(pathname)) {
  return
}
```

Or, more robustly:

```typescript
// Use the matched route path (never includes query string)
if (EXCLUDED_PATHS.includes(request.routeOptions.url ?? '')) {
  return
}
```

---

### CR-04: All SSH Errors Collapse to HTTP 401 — "Connection Timed Out" Branch Is Dead Code

**Files:**  
- `packages/server/src/services/ssh-auth.ts:17-19`  
- `packages/server/src/routes/auth.ts:37-39`  
- `packages/web/src/pages/LoginPage.tsx:43-46`

**Issue:**  
`validateSshCredentials` returns a `Promise<boolean>` that **only resolves, never rejects**. The `error` event handler — which fires for authentication failures, connection refused, host unreachable, DNS resolution failure, and `readyTimeout` expiry — all call `resolve(false)`.

The auth route treats `false` uniformly as `reply.status(401)`. The client interprets any 401 as "Invalid credentials." The client's `else` branch (line 46: `"Connection timed out. Verify host and port are reachable."`) is only reachable for non-401/non-429 HTTP errors — but the server always returns 401, so that branch is unreachable dead code.

A user who types the wrong host IP gets "Invalid credentials" instead of "Connection failed." They have no signal that they mis-entered the host vs. the password.

**Fix:** Differentiate the error reason at the service level:

```typescript
// packages/server/src/services/ssh-auth.ts
export type SshAuthResult =
  | { ok: true }
  | { ok: false; reason: 'auth_failed' | 'unreachable' | 'timeout' }

export function validateSshCredentials(
  host: string, port: number, username: string, password: string
): Promise<SshAuthResult> {
  return new Promise((resolve) => {
    const client = new Client()

    client.on('ready', () => {
      client.end()
      resolve({ ok: true })
    })

    client.on('error', (err) => {
      client.end()
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ENETUNREACH') {
        resolve({ ok: false, reason: 'unreachable' })
      } else if (err.message?.includes('Timed out')) {
        resolve({ ok: false, reason: 'timeout' })
      } else {
        resolve({ ok: false, reason: 'auth_failed' })
      }
    })

    client.connect({ host, port, username, password, readyTimeout: 10000, keepaliveInterval: 0 })
  })
}
```

Then in `auth.ts`, return `503` for `unreachable`/`timeout` and `401` for `auth_failed`, so the client's error branches all become reachable.

---

## Warnings

### WR-01: `JWT_SECRET` Not Validated at Startup — Silent Undefined at Runtime

**File:** `packages/server/src/plugins/auth-plugins.ts:8`

**Issue:**  
`process.env.JWT_SECRET!` suppresses TypeScript's undefined check but does nothing at runtime. If `JWT_SECRET` is missing from `.env`, `@fastify/jwt` receives `undefined` as the secret. The server starts without error, but the first JWT sign or verify call throws a cryptic internal error at request time rather than a clear startup failure.

**Fix:** Validate required env vars before server boot:

```typescript
// packages/server/src/index.ts (or a dedicated config.ts)
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required')
  process.exit(1)
}
```

---

### WR-02: `Secure` Cookie Flag Absent Unless `NODE_ENV=production`

**File:** `packages/server/src/routes/auth.ts:48`

**Issue:**  
```typescript
secure: process.env.NODE_ENV === 'production',
```

A self-hosted deployment running behind an HTTPS reverse proxy (Caddy, nginx) that never sets `NODE_ENV=production` will serve the `sd_token` cookie **without the `Secure` flag**. The browser will send the cookie over plain HTTP if the connection is ever downgraded (HTTP fallback, HSTS not enforced, etc.), exposing the JWT.

This app's security model depends on the cookie not being readable in transit. The copilot instructions specifically call out HTTPS as required.

**Fix:** Consider defaulting `secure: true` and allowing override, or document prominently that `NODE_ENV=production` is required for secure deployment:

```typescript
secure: process.env.COOKIE_SECURE !== 'false', // opt-out rather than opt-in
```

---

### WR-03: No Session TTL — Expired JWTs Leave Orphaned Sessions in Memory

**File:** `packages/server/src/services/session-store.ts:3`

**Issue:**  
Sessions are stored in a plain `Map` with no expiry mechanism. The JWT expires in 7 days (`expiresIn: '7d'`), but the `SessionData` entry in the Map is never cleaned up after expiry. Sessions are only removed on explicit logout (`deleteSession`). 

Over time (or with many logins, or after a crash/restart that resumes without clearing state), orphaned entries accumulate indefinitely. Each entry holds a plaintext SSH password in memory.

**Fix:** Store session creation time and either:
- Run a periodic cleanup (e.g., `setInterval`) that removes entries older than 7 days, or
- Store `expiresAt` alongside the session and check it in `getSession`:

```typescript
interface StoredSession extends SessionData {
  expiresAt: number
}

export function setSession(sessionId: string, data: SessionData): void {
  sessionStore.set(sessionId, {
    ...data,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  })
}

export function getSession(sessionId: string): SessionData | undefined {
  const entry = sessionStore.get(sessionId)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    sessionStore.delete(sessionId)
    return undefined
  }
  return entry
}
```

---

### WR-04: SSH `error` Handler Does Not Call `client.end()` — Potential Resource Leak

**File:** `packages/server/src/services/ssh-auth.ts:17-19`

**Issue:**  
The `ready` handler calls `client.end()` before resolving. The `error` handler resolves immediately without calling `client.end()`. After an error event, ssh2 will eventually emit `close`, but the timing is non-deterministic. Under concurrent login attempts (the rate limit allows 10 per minute), up to 10 half-open SSH clients may be sitting open simultaneously waiting for their internal close sequence.

**Fix:** Call `client.end()` in the error handler:

```typescript
client.on('error', (err) => {
  client.end()   // ← add this
  resolve(false)
})
```

---

## Info

### IN-01: SSH Username Stored in `localStorage` — Accessible to XSS

**File:** `packages/web/src/pages/LoginPage.tsx:34`

**Issue:**  
Host, port, and username are saved to `localStorage` as convenience pre-fill values. Password is correctly excluded. However, the SSH username is a credential component — combined with the SSH host (also stored), an XSS attack on any page in this origin can read the likely SSH username for that server, reducing the guess-work for further attacks.

Given this app is internet-exposed (per the project brief), XSS is a realistic threat vector.

**Fix:** Consider storing only `sd_host` and `sd_port` (non-sensitive), and letting the username field start empty. If username pre-fill is a required UX feature, document the trade-off.

---

### IN-02: `localStorage` Updated Before Login Succeeds

**File:** `packages/web/src/pages/LoginPage.tsx:32-34`

**Issue:**  
`localStorage.setItem('sd_host', host)` etc. run on line 32-34, before the `await api.post('/auth/login', ...)` on line 38. If the user typed the wrong host and the login fails, the previously-saved correct host is overwritten with the wrong one. On next page load, the form is pre-filled with the failed credentials.

**Fix:** Move the `setItem` calls inside the `try` block, after the `await api.post(...)` succeeds:

```typescript
try {
  await api.post('/auth/login', { host, port: Number(port), username, password })
  localStorage.setItem('sd_host', host)
  localStorage.setItem('sd_port', port)
  localStorage.setItem('sd_username', username)
  navigate('/')
} catch (err: unknown) { ... }
```

---

### IN-03: `GET /api/auth/me` Triggers Double `jwtVerify` Call

**Files:**  
- `packages/server/src/middleware/verify-auth.ts:15`  
- `packages/server/src/routes/auth.ts:76`

**Issue:**  
`/api/auth/me` is not in `EXCLUDED_PATHS`, so `verifyAuth` calls `request.jwtVerify()` and validates the session. Then the route handler calls `request.jwtVerify()` a second time. This is redundant work — the JWT is verified twice per `/me` request.

**Fix:** Remove the redundant `await request.jwtVerify()` from the `/api/auth/me` route handler. Since `verifyAuth` already attached the session to `request['session']`, the handler can read it from there (or use `request.user.sessionId` which is already populated):

```typescript
fastify.get('/api/auth/me', async (request, reply) => {
  // verifyAuth preHandler already verified JWT and validated session
  const session = getSession(request.user.sessionId)
  if (!session) {
    return reply.status(401).send({ error: 'Session not found' })
  }
  return { ok: true, host: session.host, username: session.username }
})
```

---

## Security Checklist Verification

| Check | Result |
|-------|--------|
| JWT payload contains ONLY `sessionId` — no credentials | ✅ PASS — `types/session.ts` declares payload as `{ sessionId: string }` only |
| Cookie has `httpOnly: true`, `sameSite: 'strict'`, `path: '/'` | ✅ PASS — all three set in `auth.ts:47-52` |
| SSH credentials never returned in API responses | ✅ PASS — `/api/auth/me` returns only `{ ok, host, username }`, never `password` |
| `verifyAuth` excludes only `/health`, `/api/auth/login`, `/api/auth/logout` | ⚠️ PASS in intent, but broken by query-string matching bug (CR-03) |
| `localStorage` never stores password | ✅ PASS — explicitly commented in `LoginPage.tsx:35` |
| SSH auth timeout prevents indefinite hang (`readyTimeout`) | ✅ PASS — `readyTimeout: 10000` set in `ssh-auth.ts:26` |
| Session Map cleaned up on logout | ✅ PASS — `deleteSession` called in logout handler; broken only when forged token is used (CR-02) |

---

_Reviewed: 2025-05-30_  
_Reviewer: gsd-code-reviewer (adversarial deep review)_  
_Depth: deep_
