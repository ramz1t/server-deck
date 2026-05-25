# Phase 1: Auth Foundation - Context

**Gathered:** 2026-05-25 (updated 2026-05-25)
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers a working login/logout flow with secure httpOnly JWT cookie sessions. The app is deployed on **Server A** (a separate deploy server); it observes and controls **Server B** (the target server, running Docker). Authentication is SSH-based — the login form collects host, port, username, and password for the **target server**, and the backend validates them by attempting an actual SSH connection.

Every API route (`/api/*`) and every WebSocket upgrade is gated behind this session — unauthenticated requests return 401 before any Docker or SSH code runs. The app UI shows a login page to unauthenticated users and redirects to the dashboard on success. This is a single-user tool; there is no registration flow and no separate app-level password.

**In scope:** Login form (4 fields), SSH credential validation, server-side session storage, httpOnly JWT cookie issuance, session persistence across refresh, rate limiting on login, auth middleware gating all API routes and WebSocket upgrades, React Router protected route wrapper, frontend 401 interceptor, localStorage persistence of last-used host+port.

**Out of scope:** Registration/signup, password change UI, 2FA, OAuth, multi-user, user management, multiple target servers.

</domain>

<decisions>
## Implementation Decisions

### Authentication Architecture
- **D-01:** Auth credentials are collected via the login form — **not** stored in `.env`. The login form has four fields: `Host` (target server IP/hostname), `Port` (SSH port, default 22), `Username`, `Password`. No separate app-level password exists.
- **D-02:** Authentication validation: the backend attempts a real SSH connection to the target server using the provided credentials (via `ssh2`). If the SSH handshake succeeds, the user is authenticated. If it fails, return 401 "Invalid credentials".
- **D-03:** This is a **remote-first architecture**: ServerDeck runs on Server A, observes/controls Server B (target server). All Docker operations and SSH terminal sessions go through Server B via SSH.

### Session / Token Strategy
- **D-04:** Auth token is a JWT stored in an httpOnly, Secure, SameSite=Strict cookie named `sd_token`. No token in localStorage or URL. No refresh token for v1.
- **D-05:** Cookie lifetime: 7 days (`maxAge: 7 * 24 * 60 * 60 * 1000`). Mobile-friendly — user stays logged in across the week. Explicit logout clears the cookie server-side.
- **D-06:** JWT payload: `{ sessionId, iat, exp }` — a random session ID only. **SSH credentials are never stored in the JWT.** Signed with `JWT_SECRET` from `.env` (minimum 32-char random string).
- **D-07:** SSH credentials (host, port, username, password) are kept in a **server-side in-memory Map** keyed by `sessionId`. If the backend restarts, all sessions are cleared and users must re-login.

### Login UX
- **D-08:** Login page is a minimal centered card (shadcn/ui `Card` component) with four inputs: `Host`, `Port` (numeric, default 22), `Username`, `Password` (with show/hide toggle), and a submit button with loading state. Works on mobile with `min-h-svh` centering. ServerDeck name/branding at the top.
- **D-09:** `Host` and `Port` values are persisted in `localStorage` as a convenience — pre-filled on next visit. Password is **never** persisted.
- **D-10:** Error messaging: generic "Invalid credentials" (prevents enumeration; also covers SSH connection failure). Error shown inline below the form inputs. Loading state covers the SSH handshake delay.
- **D-11:** After successful login, redirect to `/` (dashboard). After logout, redirect to `/login`.

### Routing and Route Protection
- **D-12:** React Router v6 DOM. Routes: `/login` (public, redirects to `/` if already authed), `/` (protected dashboard). Any future routes are added as children of the protected route wrapper.
- **D-13:** Protected route wrapper: calls `GET /api/auth/me` (lightweight auth check endpoint returning `{ ok: true, host, username }`). On 401 → redirect to `/login`. On success → render outlet. Loading state shows a spinner to prevent flash of login page.
- **D-14:** Axios instance configured with `withCredentials: true` and a response interceptor: on any 401, clear local auth state and redirect to `/login`. This catches session expiry mid-session automatically.

### Backend Auth Endpoints
- **D-15:** `POST /api/auth/login` — accepts `{ host, port, username, password }`, validates by attempting SSH connection (via `ssh2`), creates session in memory Map, sets httpOnly cookie with `sessionId`, returns `{ ok: true }`. Returns 401 on failure.
- **D-16:** `POST /api/auth/logout` — clears the cookie, removes session from in-memory Map, returns `{ ok: true }`. No auth required (idempotent).
- **D-17:** `GET /api/auth/me` — requires valid cookie + valid sessionId in session Map, returns `{ ok: true, host, username }`. Returns 401 if session not found (e.g., after backend restart).
- **D-18:** Rate limiting via `@fastify/rate-limit` on the login endpoint: max 10 requests per minute per IP. Returns 429 with `{ error: "Too many requests" }`. (Important: SSH handshake is slow so rate limit also prevents slow-connection DOS.)

### Auth Middleware
- **D-19:** Fastify preHandler hook (`fastify.addHook('preHandler', verifyAuth)`) protects all `/api/*` routes except `/api/auth/login` and `/api/auth/logout`. Middleware: reads cookie → verifies JWT → looks up sessionId in in-memory Map → attaches `request.session` (containing `{ host, port, username, password }`). On failure: returns 401 JSON.
- **D-20:** WebSocket upgrade protection: `@fastify/websocket` route handlers check auth in their own preHandler. Unauthenticated WS upgrades are rejected with 401 before the WebSocket handshake completes.

### Session Lifecycle
- **D-21:** In-memory session Map is scoped to the Fastify server process. Backend restart = all sessions cleared. Users must re-login after a restart. This is acceptable for a personal tool.
- **D-22:** SSH auth is the only authentication gate. There is no separate ServerDeck app password — valid SSH credentials = access to ServerDeck.

### the agent's Discretion
- Frontend loading/skeleton states beyond the protected-route spinner — the agent can use shadcn/ui Skeleton or a simple spinner, whatever looks clean on mobile.
- Fastify plugin organization — the agent may structure plugins (auth, rate-limit, cookie, jwt) as separate Fastify plugins registered in `server.ts`. No constraints imposed.
- `.env.example` file — agent should generate one with all required env vars (JWT_SECRET minimum) and safe placeholder values.
- SSH connection timeout for login validation — agent decides a sensible value (e.g., 10 seconds).
- Whether to use a `crypto.randomUUID()` or `nanoid` for sessionId generation — agent decides.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Project overview, core value, constraints (single-user, self-hosted, mobile-first, **remote target server**)
- `.planning/REQUIREMENTS.md` — AUTH-01 through AUTH-06 requirements with acceptance criteria

### Phase Roadmap
- `.planning/ROADMAP.md` §Phase 1 — Success criteria (5 observable tests this phase must pass)

### Research Findings
- `.planning/research/STACK.md` — Definitive stack choices: Fastify 5, `@fastify/jwt`, `@fastify/cookie`, `@fastify/rate-limit`, `ssh2`, React + Vite, shadcn/ui, Tailwind v4
- `.planning/research/PITFALLS.md` — Security pitfalls: httpOnly cookie config, rate limiting, WebSocket auth bypass, SSH credential handling
- `.planning/research/SUMMARY.md` — Executive summary with phase structure rationale and Fastify-over-Express rationale

### No external specs
No external ADRs or specs beyond the above planning documents.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None yet — this is Phase 1, greenfield. No existing code to reuse.

### Established Patterns
- None yet — patterns established in this phase become the baseline for Phase 2+.

### Integration Points
- The auth middleware (`verifyAuth` hook) established here will be reused verbatim in Phase 2 (Docker API), Phase 3 (WebSocket events), Phase 4 (log streaming), Phase 5 (SSH terminal).
- The axios instance with `withCredentials: true` and 401 interceptor will be the base HTTP client for all future API calls.
- The protected route wrapper established here wraps all future routes.

</code_context>

<specifics>
## Specific Ideas

- The app is named **ServerDeck** — use this as the page title and branding on the login card.
- Login form should have the ServerDeck name/logo at the top of the card to make it feel like a real product on the phone home screen.
- The login form has 4 fields: `Host`, `Port` (default 22), `Username`, `Password` — laid out vertically for mobile.
- Host and port pre-filled from localStorage if previously entered; password always blank.
- SSH credential validation happens server-side — the loading state on the submit button covers the SSH handshake time (can take 1-3 seconds).
- The app is **deployed separately** from the server it observes — no assumption that it runs on the same host as Docker.

</specifics>

<deferred>
## Deferred Ideas

- **Password change** — user can update credentials by changing what they enter at login (no stored credentials to update). → N/A for this architecture.
- **SSH key auth** — using SSH key pairs instead of password auth on the login form. → Future enhancement.
- **Session refresh tokens** — 7-day expiry is sufficient for v1. → Future hardening phase.
- **Audit log** — tracking login/logout events. → Future hardening phase.
- **Multiple target servers** — connecting to more than one server. → Explicitly out of scope for v1.

</deferred>

---

*Phase: 1-Auth Foundation*
*Context gathered: 2026-05-25, updated: 2026-05-25*
