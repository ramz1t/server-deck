# Phase 1: Auth Foundation - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers a working login/logout flow with secure httpOnly JWT cookie sessions. Every API route (`/api/*`) and every WebSocket upgrade is gated behind authentication — unauthenticated requests return 401 before any Docker or SSH code runs. The app UI shows a login page to unauthenticated users and redirects to the dashboard on success. This is a single-user tool; there is no registration flow.

**In scope:** Login form, logout endpoint, httpOnly JWT cookie issuance, session persistence across refresh, rate limiting on login, auth middleware gating all API routes and WebSocket upgrades, React Router protected route wrapper, frontend 401 interceptor.

**Out of scope:** Registration/signup, password change UI, 2FA, OAuth, multi-user, user management.

</domain>

<decisions>
## Implementation Decisions

### Credential Storage
- **D-01:** Single user credentials are stored as environment variables: `USERNAME` and `PASSWORD_HASH` (bcrypt hash). No database required. The app reads these at startup from a `.env` file (loaded via `dotenv`).
- **D-02:** Password must be bcrypt-hashed before storing in `.env`. The project README will include a one-liner to generate the hash (e.g., `node -e "const b=require('bcrypt');b.hash('yourpassword',12).then(console.log)"`).

### Session / Token Strategy
- **D-03:** Auth token is a JWT stored in an httpOnly, Secure, SameSite=Strict cookie named `sd_token`. No token in localStorage or URL. No refresh token for v1.
- **D-04:** Cookie lifetime: 7 days (`maxAge: 7 * 24 * 60 * 60 * 1000`). Mobile-friendly — user stays logged in across the week. Explicit logout clears the cookie server-side.
- **D-05:** JWT payload: `{ sub: username, iat, exp }`. Signed with `JWT_SECRET` from `.env` (minimum 32-char random string). No user roles needed (single user).

### Login UX
- **D-06:** Login page is a minimal centered card (shadcn/ui `Card` component) with username input, password input with show/hide toggle, and a submit button with loading state. Works on mobile with `min-h-svh` centering.
- **D-07:** Error messaging: generic "Invalid credentials" for both wrong username and wrong password (prevents username enumeration). No toast — error shown inline below the form inputs.
- **D-08:** After successful login, redirect to `/` (dashboard). After logout, redirect to `/login`.

### Routing and Route Protection
- **D-09:** React Router v6 DOM. Routes: `/login` (public, redirects to `/` if already authed), `/` (protected dashboard). Any future routes are added as children of the protected route wrapper.
- **D-10:** Protected route wrapper: calls `GET /api/auth/me` (lightweight auth check endpoint returning `{ ok: true }`). On 401 → redirect to `/login`. On success → render outlet. Loading state shows a spinner to prevent flash of login page.
- **D-11:** Axios instance configured with `withCredentials: true` and a response interceptor: on any 401, clear local auth state and redirect to `/login`. This catches session expiry mid-session automatically.

### Backend Auth Endpoints
- **D-12:** `POST /api/auth/login` — accepts `{ username, password }`, validates against env vars with bcrypt, sets httpOnly cookie on success, returns `{ ok: true }`. Returns 401 on failure.
- **D-13:** `POST /api/auth/logout` — clears the cookie, returns `{ ok: true }`. No auth required (idempotent).
- **D-14:** `GET /api/auth/me` — requires valid cookie, returns `{ ok: true, username }`. Used by frontend protected route check.
- **D-15:** Rate limiting via `@fastify/rate-limit` on the login endpoint: max 10 requests per minute per IP. Returns 429 with `{ error: "Too many requests" }`.

### Auth Middleware
- **D-16:** Fastify preHandler hook (`fastify.addHook('preHandler', verifyAuth)`) protects all `/api/*` routes except `/api/auth/login` and `/api/auth/logout`. Middleware: reads cookie → verifies JWT → attaches `request.user`. On failure: returns 401 JSON.
- **D-17:** WebSocket upgrade protection: `@fastify/websocket` route handlers check auth in their own preHandler. Unauthenticated WS upgrades are rejected with 401 before the WebSocket handshake completes.

### the agent's Discretion
- Frontend loading/skeleton states beyond the protected-route spinner — the agent can use shadcn/ui Skeleton or a simple spinner, whatever looks clean on mobile.
- Fastify plugin organization — the agent may structure plugins (auth, rate-limit, cookie, jwt) as separate Fastify plugins registered in `server.ts`. No constraints imposed.
- `.env.example` file — agent should generate one with all required env vars and safe placeholder values.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Project overview, core value, constraints (single-user, self-hosted, mobile-first)
- `.planning/REQUIREMENTS.md` — AUTH-01 through AUTH-06 requirements with acceptance criteria

### Phase Roadmap
- `.planning/ROADMAP.md` §Phase 1 — Success criteria (5 observable tests this phase must pass)

### Research Findings
- `.planning/research/STACK.md` — Definitive stack choices: Fastify 5, `@fastify/jwt`, `@fastify/cookie`, `@fastify/rate-limit`, React + Vite, shadcn/ui, Tailwind v4
- `.planning/research/PITFALLS.md` — Security pitfalls relevant to this phase: httpOnly cookie config, rate limiting, WebSocket auth bypass pattern
- `.planning/research/SUMMARY.md` — Executive summary with phase structure rationale

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
- The `.env` file approach is intentional for simplicity — do not suggest a database or config UI for v1.

</specifics>

<deferred>
## Deferred Ideas

- **Password change UI** — useful eventually, but not needed for v1 (user can update `.env` directly). → Future phase or v2.
- **Session refresh tokens** — 7-day expiry is sufficient for v1. → Future hardening phase.
- **Audit log** — tracking login/logout events. → Future hardening phase.

</deferred>

---

*Phase: 1-Auth Foundation*
*Context gathered: 2026-05-25*
