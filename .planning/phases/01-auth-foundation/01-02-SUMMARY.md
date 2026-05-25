---
plan: 01-02
phase: 01-auth-foundation
status: complete
completed_at: 2026-05-25T10:30:00Z
commit: 8ef2890
---

# Phase 1 Plan 02: Backend Auth Stack Summary

## One-liner
JWT httpOnly cookie auth with SSH credential validation (ssh2), in-memory session Map, rate-limited login, and global preHandler gating all /api/* routes.

## What Was Built
Complete Fastify 5 backend authentication for ServerDeck:
- SSH credential validation via ssh2 (10s timeout, pure-JS, no native modules)
- In-memory session `Map<sessionId, SessionData>` storing host/port/username/password server-side
- httpOnly JWT cookie (`sd_token`, 7-day expiry, SameSite=Strict)
- `POST /api/auth/login` — rate-limited 10/min/IP, validates via SSH, issues cookie on success
- `POST /api/auth/logout` — clears cookie, removes session from Map
- `GET /api/auth/me` — returns `{ok, host, username}` for valid session (used by frontend protected route)
- Global `preHandler` `verifyAuth` — gates all `/api/*` except `/api/auth/login`, `/api/auth/logout`, `/health`
- `dotenv` loaded in `index.ts` so `JWT_SECRET` is read from `.env`

## Key Files Created/Modified
- `packages/server/src/types/session.ts` — `SessionData` interface + `@fastify/jwt` module augmentation
- `packages/server/src/services/session-store.ts` — singleton `Map<string, SessionData>` with set/get/delete
- `packages/server/src/services/ssh-auth.ts` — `validateSshCredentials()` via ssh2 Client
- `packages/server/src/plugins/auth-plugins.ts` — registers `@fastify/cookie` + `@fastify/jwt`
- `packages/server/src/routes/auth.ts` — 3 auth endpoints with rate limiting and validation schemas
- `packages/server/src/middleware/verify-auth.ts` — global preHandler with excluded paths list
- `packages/server/src/server.ts` — wired plugins, preHandler, routes + empty-JSON-body parser
- `packages/server/src/index.ts` — added `import 'dotenv/config'` at top
- `packages/server/.env.example` — template with PORT, JWT_SECRET, LOG_LEVEL
- `packages/server/package.json` — added dotenv dependency

## Verification Results
- `GET /health` → 200 `{"ok":true}` ✓
- `GET /api/auth/me` (no cookie) → 401 ✓
- `POST /api/auth/logout` (no session, with Content-Type: application/json) → 200 `{"ok":true}` ✓
- `POST /api/auth/login` (invalid SSH creds) → 401 ✓
- TypeScript: no errors (`npx tsc --noEmit` exits 0) ✓
- JWT payload: `{sessionId}` only — no credentials in token ✓

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Error Handling] Empty JSON body on logout**
- **Found during:** Task 2 verification
- **Issue:** Fastify 5 strict body parser rejects `Content-Type: application/json` with empty body (`FST_ERR_CTP_EMPTY_JSON_BODY`). Real clients (Axios) may send Content-Type header without a body on bodyless POSTs.
- **Fix:** Added custom `addContentTypeParser` in `server.ts` that returns `{}` for empty string bodies and parses JSON normally otherwise. Does not affect schema validation on login route.
- **Files modified:** `packages/server/src/server.ts`
- **Commit:** 8ef2890 (included in main feature commit)

**2. [Rule 2 - Missing] dotenv dependency not pre-installed**
- **Found during:** Task 2 — JWT_SECRET must be loaded from `.env`
- **Fix:** Installed `dotenv` via `pnpm add dotenv`, added `import 'dotenv/config'` in `index.ts`
- **Files modified:** `packages/server/package.json`, `packages/server/src/index.ts`, `pnpm-lock.yaml`
- **Commit:** 8ef2890

**3. [Rule 1 - Minor] `request.cookies` type cast in logout route**
- **Found during:** Task 2 TypeScript check
- **Issue:** `@fastify/cookie` decorates the request, but accessing `request.cookies['sd_token']` requires a type cast in strict mode
- **Fix:** Used `(request.cookies as Record<string, string | undefined>)['sd_token']` for type-safe access
- **Files modified:** `packages/server/src/routes/auth.ts`

## Known Stubs
None — all endpoints are fully functional.

## Threat Flags
None — no new security-relevant surface beyond what the plan specifies. All endpoints are within the planned auth flow.

## Self-Check: PASSED
