# Phase 1: Auth Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-25
**Phase:** 1-Auth Foundation
**Mode:** Autonomous (user unavailable — autopilot decisions)
**Areas discussed:** Credential Storage, Session Strategy, Login UX, Route Protection, Backend Endpoints

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
