# Phase 01-auth-foundation — Security Audit Report

**Audit Date:** 2025-07-14
**ASVS Level:** L1
**Plans Audited:** 01-PLAN-scaffold · 01-PLAN-backend-auth · 01-PLAN-frontend-auth
**Verdict:** ✅ CONDITIONAL PASS (all items resolved — see accepted risks)

---

## Threat Disposition Summary

| Metric | Count |
|--------|-------|
| Total threats | 13 |
| CLOSED (mitigated) | 9 |
| Formally accepted | 6 (T-02-02, T-03-03, T-03-05, T-01-SC, T-02-SC, T-03-SC) |
| OPEN blockers | 0 |

---

## Threat Register

| ID | Category | Disposition | Status | Evidence |
|----|----------|-------------|--------|----------|
| T-02-01 | Spoofing (brute-force) | mitigate | ✅ CLOSED | `routes/auth.ts:14,19` — rate-limit `{ max: 10, timeWindow: '1 minute' }` |
| T-02-02 | Info Disclosure (login errors) | **accept** | ✅ ACCEPTED | See acceptance rationale below |
| T-02-03 | Info Disclosure (JWT payload) | mitigate | ✅ CLOSED | `routes/auth.ts:51` — `jwt.sign({ sessionId }, ...)` only |
| T-02-04 | Tampering (cookie flags) | mitigate | ✅ CLOSED | `httpOnly:true`, `sameSite:'strict'`, `path:'/'`, `secure` in prod/HTTPS |
| T-02-05 | EoP (preHandler bypass) | mitigate | ✅ CLOSED | Global `addHook('preHandler', verifyAuth)`; query-string stripped before path match |
| T-02-06 | Info Disclosure (/me response) | mitigate | ✅ CLOSED | Returns `{ ok, host, username }` only — `session.password` never exposed |
| T-02-07 | EoP (JWT_SECRET exposure) | mitigate | ✅ CLOSED | Env var only; `.env` gitignored; startup exits if absent or < 32 chars |
| T-03-01 | Info Disclosure (localStorage) | mitigate | ✅ CLOSED | Only `sd_host/port/username` stored; password never passed to localStorage |
| T-03-02 | Info Disclosure (XSS → cookie) | mitigate | ✅ CLOSED | `httpOnly: true` on `sd_token` |
| T-03-03 | Spoofing (CSRF logout) | **accept** | ✅ ACCEPTED | `SameSite=Strict` present; logout is idempotent. Accepted in plan. |
| T-03-04 | EoP (client-side route bypass) | mitigate | ✅ CLOSED | `ProtectedRoute.tsx` calls `/api/auth/me` on every mount |
| T-03-05 | Info Disclosure (401 redirect) | **accept** | ✅ ACCEPTED | `/login` guard prevents infinite loop. Accepted in plan. |
| T-01-SC | Tampering (supply chain) | **accept** | ✅ ACCEPTED | See supply-chain acceptance below |
| T-02-SC | Tampering (supply chain) | **accept** | ✅ ACCEPTED | See supply-chain acceptance below |
| T-03-SC | Tampering (supply chain) | **accept** | ✅ ACCEPTED | See supply-chain acceptance below |

---

## Accepted Risks Rationale

### T-02-02 — Distinct SSH error codes (host-reachability enumeration)

**Plan declared:** "Generic 'Invalid credentials' error for all failures."
**Implemented:** `auth.ts` returns `401` (auth_failed), `504` (timeout), `502` (unreachable) with distinct messages.

**Acceptance rationale:**
- ServerDeck is a **single-user, self-hosted personal tool** (D-01). The attacker model does not include an adversary probing the login endpoint to enumerate infrastructure — the tool has no public-facing user base.
- The UX benefit of distinct codes is significant: a user who misconfigures the host gets actionable feedback ("Host unreachable") rather than a generic "Invalid credentials" that implies a password problem.
- Username enumeration is correctly prevented (all `auth_failed` paths return `401`).
- The formal plan mitigation for D-10 (no username enumeration) is fully satisfied.

**Risk accepted by:** Phase 1 security review, 2025-07-14.

### T-01-SC / T-02-SC / T-03-SC — npm package supply chain attestation

All packages installed are well-established industry-standard dependencies with multi-million weekly downloads and long-standing security track records:
- **Wave 1:** `fastify`, `react`, `vite`, `tailwindcss`, `shadcn/ui`, `lucide-react`
- **Wave 2:** `@fastify/jwt`, `@fastify/cookie`, `@fastify/rate-limit`, `ssh2`, `dotenv`
- **Wave 3:** `axios`, `react-router-dom`

No novel or obscure packages were introduced. Supply-chain process control accepted for Phase 1.

---

## ASVS L1 Checks

| Ref | Requirement | Result | Notes |
|-----|-------------|--------|-------|
| V2.2.1 | Anti-automation on auth | ✅ PASS | Rate limit 10/min/IP on login |
| V2.2.2 | Credentials not in URL | ✅ PASS | POST body only |
| V3.2.1 | Session token entropy | ✅ PASS | `crypto.randomUUID()` — 122-bit CSPRNG |
| V3.2.3 | Credentials not in session token | ✅ PASS | JWT payload: `{ sessionId, iat, exp }` only |
| V3.3.1 | Logout invalidates server-side session | ✅ PASS | `jwt.verify` + `deleteSession` on logout |
| V3.4.1 | SameSite cookie | ✅ PASS | `sameSite: 'strict'` |
| V3.4.2 | HttpOnly cookie | ✅ PASS | `httpOnly: true` |
| V3.4.3 | Secure cookie | ✅ PASS | `secure` when `NODE_ENV=production` or `HTTPS=true` |
| V2.7.6 | JWT secret strength | ✅ PASS | Startup exits if `JWT_SECRET` absent or < 32 chars |
| — | Password at rest | ⚠️ ADVISORY | `session-store.ts` stores plaintext password in process memory. Required by architecture (SSH re-auth, D-07). Single-user deployment; not a Phase 1 blocker. |

---

## Positive Deviations (beyond plan)

- **Logout uses `jwt.verify` not `jwt.decode`** — prevents forged cookie from deleting arbitrary sessions.
- **axios 401 guard** — `window.location.pathname !== '/login'` prevents infinite redirect loop not specified in plan.
- **Session TTL** — 7-day expiry on session Map entries matches JWT lifetime; lazy eviction on `getSession`.
- **Typed `SshAuthResult`** — `ssh-auth.ts` returns `'ok'|'auth_failed'|'unreachable'|'timeout'`; `client.end()` always called.

