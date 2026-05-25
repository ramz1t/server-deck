# Walking Skeleton — ServerDeck

**Phase:** 1
**Generated:** 2026-05-25

## Capability Proven End-to-End

> A user enters SSH credentials (host, port, username, password) on the login page, the backend validates them via a live SSH connection using `ssh2`, sets an httpOnly JWT cookie (`sd_token`), and the browser redirects to a protected dashboard stub page. Refreshing the browser re-validates the session via `GET /api/auth/me` and keeps the user on the dashboard. Clicking "Log out" clears the cookie and returns the user to `/login`.

---

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend framework | Fastify 5 (`^5.8.5`) | Plugin-based architecture, TypeScript-native, 2–3× faster than Express, official plugins for JWT/cookie/rate-limit/static match all Phase 1 requirements exactly. Express 4 is maintenance-only; Fastify 5 is the active choice. |
| Frontend framework | React 19 + Vite (`^8.0.14`) | Largest ecosystem for xterm.js/shadcn/TanStack; Vite produces the `dist/` Fastify serves in production. Native ESM, fastest HMR. |
| Auth | SSH credential validation (`ssh2@^1.17.0`) + httpOnly JWT cookie (`@fastify/jwt@^10.1.0` + `@fastify/cookie@^11.0.2`) | SSH auth validates real access — no separate app password (D-22). JWT in httpOnly cookie is XSS-proof; cookie is sent on WebSocket upgrade automatically (solves Pitfall 6). No refresh token for v1 (D-04). |
| Session store | Server-side `Map<sessionId, {host,port,username,password}>` | Zero external dependencies, acceptable for single-user personal tool. Backend restart = re-login (D-21). SSH credentials stored server-side only — never in JWT (D-06, D-07). |
| Monorepo layout | pnpm workspaces: `packages/server` + `packages/web` | Clean separation of backend/frontend with shared dev tooling. pnpm hoists node_modules efficiently. |
| Dev workflow | `concurrently` at root: `pnpm --filter @serverdeck/server dev` + `pnpm --filter @serverdeck/web dev` | Single `pnpm dev` from root starts both services. Vite proxies `/api/*` to `localhost:3001` in dev (no CORS config needed). |
| Styling | Tailwind v4 via `@tailwindcss/vite` plugin + shadcn/ui (zinc dark) | `@tailwindcss/vite` eliminates separate `tailwind.config.ts`. CSS variables in `src/index.css` via `@theme` block. shadcn copies components into project — no version lock-in. |
| API client | Axios with `withCredentials: true` + 401 interceptor | Cookie sent on every request automatically. 401 interceptor catches mid-session expiry and redirects to `/login` (D-14). |
| Routing | React Router v6 DOM | Protected route wrapper calls `GET /api/auth/me`; 401 → `/login` (D-12, D-13). |
| Rate limiting | `@fastify/rate-limit@^10.2.0` on `POST /api/auth/login` only | 10 req/min/IP. Returns 429. Prevents SSH credential brute-force (AUTH-05, D-18). |

---

## Stack Touched in Phase 1

- [x] Project scaffold (monorepo, pnpm workspaces, concurrently dev script)
- [x] `packages/server` — Fastify 5, TypeScript, tsx dev runner
- [x] `packages/web` — React 19, Vite, TypeScript, Tailwind v4, shadcn/ui (zinc dark)
- [x] Routing — `/login` (public) and `/` (protected, ProtectedRoute wrapper)
- [x] SSH auth service — `ssh2` validates credentials, 10s timeout, pure-JS no native compile
- [x] In-memory session Map — `Map<sessionId, SessionData>`, scoped to process lifetime
- [x] httpOnly JWT cookie — `sd_token`, 7-day maxAge, Secure, SameSite=Strict
- [x] Auth middleware — Fastify `preHandler` hook gates all `/api/*` except login/logout
- [x] Login form — 4 fields (Host, Port, Username, Password), localStorage pre-fill, show/hide password, loading + error states, per UI-SPEC zinc dark design
- [x] Dashboard stub — "ServerDeck" heading + "Connected to {host}" + "Log out" button
- [x] Vite proxy — `/api/*` → `http://localhost:3001` in dev

---

## Directory Layout

```
serverdeck/
├── package.json                    # root: pnpm workspaces, concurrently dev script
├── pnpm-workspace.yaml             # packages: ["packages/*"]
├── .npmrc
├── .gitignore
└── packages/
    ├── server/
    │   ├── package.json            # @serverdeck/server
    │   ├── tsconfig.json
    │   ├── .env                    # JWT_SECRET (never committed)
    │   ├── .env.example
    │   └── src/
    │       ├── index.ts            # entry: listen on PORT (default 3001)
    │       ├── server.ts           # buildServer(): Fastify instance, register plugins/routes
    │       ├── types/
    │       │   └── session.ts      # SessionData interface + @fastify/jwt module augmentation
    │       ├── services/
    │       │   ├── session-store.ts # Map<sessionId, SessionData>
    │       │   └── ssh-auth.ts     # validateSshCredentials() → Promise<boolean>
    │       ├── plugins/
    │       │   └── auth-plugins.ts # register @fastify/jwt + @fastify/cookie
    │       ├── routes/
    │       │   └── auth.ts         # POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
    │       └── middleware/
    │           └── verify-auth.ts  # preHandler hook: cookie → JWT verify → sessionId lookup
    └── web/
        ├── package.json            # @serverdeck/web
        ├── tsconfig.json
        ├── tsconfig.node.json
        ├── vite.config.ts          # @tailwindcss/vite plugin + /api proxy
        ├── index.html
        ├── components.json         # shadcn/ui config (zinc, dark, Tailwind v4)
        └── src/
            ├── main.tsx            # React root
            ├── App.tsx             # BrowserRouter + Routes
            ├── index.css           # @import "tailwindcss" + @layer base CSS vars
            ├── lib/
            │   └── axios.ts        # Axios instance, withCredentials, 401 interceptor
            ├── pages/
            │   ├── LoginPage.tsx   # 4-field login card per UI-SPEC
            │   └── DashboardPage.tsx # stub: heading + host + logout button
            └── components/
                ├── ProtectedRoute.tsx # GET /api/auth/me + spinner + Navigate
                └── ui/             # shadcn auto-generated: button, card, input, label
```

---

## Out of Scope (Deferred)

- Docker container listing (Phase 2)
- Real-time container status via WebSocket (Phase 3)
- Log streaming (Phase 4)
- SSH terminal in browser (Phase 5)
- Mobile PWA + offline shell (Phase 6)
- SSH key auth (deferred per CONTEXT.md)
- Refresh tokens (deferred per CONTEXT.md)
- Multi-server / multi-user (out of scope v1)

---

## Subsequent Slice Plan

- **Phase 2:** View + control Docker containers (CONT-01..06) — builds on auth middleware established here
- **Phase 3:** Real-time container status via WebSocket (CONT-03) — uses auth cookie for WS upgrade
- **Phase 4:** Live log streaming via WebSocket (LOGS-01..04)
- **Phase 5:** SSH terminal (SSH-01..06) — uses session credentials from this phase's Map
- **Phase 6:** Mobile polish + PWA installable (MOBL-01..05)

---

## Critical Integration Points for Future Phases

1. **`verifyAuth` middleware** (`packages/server/src/middleware/verify-auth.ts`) — import and reuse verbatim in every future route plugin
2. **`request.session`** — the `SessionData` (`{ host, port, username, password }`) attached by `verifyAuth` is available to all Phase 2+ route handlers for Docker API calls and SSH terminal sessions
3. **Axios instance** (`packages/web/src/lib/axios.ts`) — the base HTTP client for all future API calls; 401 interceptor is already wired
4. **`ProtectedRoute`** — wraps all future routes; add new pages as `<Route>` children in `App.tsx`

---

*Walking Skeleton established: Phase 1 — Auth Foundation*
*Next: `/gsd-execute-phase 1`*
