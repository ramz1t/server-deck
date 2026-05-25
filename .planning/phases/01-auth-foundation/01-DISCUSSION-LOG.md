# Phase 1: Auth Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-25 (updated 2026-05-25)
**Phase:** 1-Auth Foundation
**Mode:** Session 1: Autonomous (user unavailable) · Session 2: Interactive (user present)
**Areas discussed:** Credential Storage, Session Strategy, Login UX, Route Protection, Backend Endpoints, **Auth Architecture (major update)**

---

## [UPDATE — Session 2] Auth Architecture Overhaul

**User clarified:** The app is deployed on a **separate server** from the one being observed. The login form must collect SSH credentials (host, port, username, password) for the **target server**. Authentication is validated by attempting a real SSH connection — no `.env` credentials.

| Question | Options | Selected |
|----------|---------|----------|
| What are the login credentials for? | SSH credentials for target server / Separate ServerDeck app password / Both | SSH credentials (user + password SSH auth to target server) |
| How to access Docker on target server? | SSH tunnel / Docker TCP API / Agent decides | SSH tunnel — backend SSHes into target and runs docker commands |
| Remember connection between sessions? | Always re-enter / Persist host+port in localStorage / Store profile on server | Persist last-used host + port in localStorage; password always re-entered |
| Multiple targets? | Single target / Multiple targets | Single target only |
| Where to store SSH credentials server-side? | In JWT (encrypted) / In server memory (session Map) / Agent decides | Server memory (session Map) — more secure |
| Is SSH auth the only gate? | SSH auth only / Separate app password on top | SSH auth is the only auth layer |

**Impact on existing decisions:**
- D-01, D-02 (`.env` credentials) → **REPLACED** by SSH login form (D-01–D-03 new)
- D-05 (JWT payload `sub: username`) → **UPDATED** to `{ sessionId }` only (D-06)
- D-06 (2-field login form) → **UPDATED** to 4-field form (D-08)
- New decisions added: D-07 (in-memory session Map), D-09 (localStorage host+port), D-21, D-22

---

## [Original — Session 1] Credential Storage

| Option | Description | Selected |
|--------|-------------|----------|
| `.env` environment variables | `USERNAME` + `PASSWORD_HASH` (bcrypt) | ✓ (superseded by Session 2) |
| Flat config file | Slightly more structured; no clear benefit over .env | |
| SQLite database | Overkill for single-user | |

**Superseded by Session 2:** SSH credential validation replaces `.env` approach.

---

## Session Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| 1-hour cookie | Most secure; annoying on mobile | |
| 7-day cookie (recommended) | Mobile-friendly — stays logged in across the week | ✓ |
| 30-day cookie | Too long for an internet-exposed tool | |

**Agent's choice:** 7-day httpOnly, Secure, SameSite=Strict cookie. JWT payload updated to `{ sessionId }` — no credentials in token.

---

## Login UX

| Option | Description | Selected |
|--------|-------------|----------|
| 2-field form (username + password) | Original design | (superseded) |
| 4-field form (host + port + username + password) | SSH target credentials | ✓ |
| Generic "Invalid credentials" error | Security best practice — prevents enumeration | ✓ |

**Notes:** Loading state during login covers SSH handshake delay (1-3 seconds). Host + port pre-filled from localStorage.

---

## Route Protection

| Option | Description | Selected |
|--------|-------------|----------|
| React Router v6 protected route + axios interceptor | Standard SPA pattern | ✓ |

**No change from Session 1.** Protected route calls `GET /api/auth/me`; 401 interceptor handles session expiry.

---

## Backend Endpoints

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated `/api/auth/*` namespace | Clean separation | ✓ |

**Updated:** `POST /api/auth/login` now accepts `{ host, port, username, password }` and validates via SSH. Session stored in server-side Map.

---

## the agent's Discretion

- Frontend skeleton/loading styles beyond the protected-route spinner
- Fastify plugin file organization
- `.env.example` content (JWT_SECRET only — no credential fields)
- SSH connection timeout value for login validation
- sessionId generation strategy (crypto.randomUUID vs nanoid)

## Deferred Ideas

- SSH key auth (key pair instead of password) — future enhancement
- Session refresh tokens — deferred to future hardening phase
- Audit log (login/logout events) — deferred to future hardening phase
- Multiple target servers — explicitly out of scope for v1


---

## Credential Storage

| Option | Description | Selected |
|--------|-------------|----------|
| `.env` environment variables | `USERNAME` + `PASSWORD_HASH` (bcrypt) — no database, no migration, single-process | ✓ |
| Flat config file (`config.json`) | Slightly more structured but adds a read/parse step; no clear benefit over .env | |
| SQLite database | Overkill for single-user; adds dependency and migration complexity | |

**Agent's choice:** `.env` with `USERNAME` + `PASSWORD_HASH`
**Notes:** Personal single-user tool — environment variable approach is idiomatic for self-hosted apps. README will include bcrypt hash generator one-liner.

---

## Session Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| 1-hour cookie | Most secure; annoying on mobile — requires login every hour | |
| 24-hour cookie | Reasonable balance | |
| 7-day cookie (recommended) | Mobile-friendly — stays logged in across the week; explicit logout always available | ✓ |
| 30-day cookie | Too long for an internet-exposed tool | |

**Agent's choice:** 7-day httpOnly, Secure, SameSite=Strict cookie
**Notes:** The app is mobile-first — requiring daily logins creates friction. 7 days balances convenience with security for a personal tool. JWT secret from env var.

---

## Login UX

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal centered card | shadcn/ui Card, username/password inputs, generic error inline, show/hide toggle | ✓ |
| Full-screen branded | Heavier design, more effort for v1 | |
| Specific error messages | "User not found" / "Wrong password" — enables username enumeration attack | |
| Generic "Invalid credentials" (recommended) | Security best practice | ✓ |

**Agent's choice:** Minimal centered card with generic errors and show/hide password toggle
**Notes:** ServerDeck branding (name at top of card) makes it feel like a real product when added to phone home screen.

---

## Route Protection

| Option | Description | Selected |
|--------|-------------|----------|
| React Router v6 protected route + axios interceptor (recommended) | Standard SPA pattern — catches both initial navigation and mid-session 401s | ✓ |
| Server-side redirect | Not applicable for SPA architecture | |
| Manual check in each component | Error-prone, repetitive | |

**Agent's choice:** Protected route wrapper calling `GET /api/auth/me` + axios 401 interceptor
**Notes:** `/login` redirects to `/` if already authenticated. Loading state prevents flash of login page.

---

## Backend Endpoints

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated `/api/auth/*` namespace (recommended) | Clean separation, easy to exclude from auth middleware | ✓ |
| Single `/api/login` endpoint | Fine but less extensible | |

**Agent's choice:** `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
**Notes:** Rate limit on login: 10 req/min/IP via `@fastify/rate-limit`. All other `/api/*` routes protected by Fastify `preHandler` hook.

---

## the agent's Discretion

- Frontend skeleton/loading styles beyond the protected-route spinner
- Fastify plugin file organization
- `.env.example` content and format

## Deferred Ideas

- Password change UI — deferred to v2 (user updates `.env` directly for now)
- Session refresh tokens — deferred to future hardening phase
- Audit log (login/logout events) — deferred to future hardening phase
