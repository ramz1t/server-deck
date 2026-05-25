---
phase: 01-auth-foundation
plan: 02
type: execute
wave: 2
depends_on:
  - 01-PLAN-scaffold
files_modified:
  - packages/server/src/types/session.ts
  - packages/server/src/services/session-store.ts
  - packages/server/src/services/ssh-auth.ts
  - packages/server/src/plugins/auth-plugins.ts
  - packages/server/src/routes/auth.ts
  - packages/server/src/middleware/verify-auth.ts
  - packages/server/src/server.ts
  - packages/server/.env.example
  - packages/server/.env
autonomous: true
requirements:
  - AUTH-02
  - AUTH-04
  - AUTH-05
  - AUTH-06

must_haves:
  truths:
    - "POST /api/auth/login with valid SSH credentials returns HTTP 200 and sets a Set-Cookie header for sd_token with HttpOnly and SameSite=Strict flags"
    - "POST /api/auth/login with invalid SSH credentials returns HTTP 401 with body {\"error\":\"Invalid credentials\"}"
    - "POST /api/auth/login called 11 times in under 60 seconds from the same IP returns HTTP 429 on the 11th call"
    - "POST /api/auth/logout clears the sd_token cookie and returns {\"ok\":true}"
    - "GET /api/auth/me with a valid sd_token cookie returns {\"ok\":true,\"host\":\"...\",\"username\":\"...\"}"
    - "GET /api/auth/me with no cookie returns HTTP 401"
    - "GET /api/some-future-route with no cookie returns HTTP 401 (preHandler blocks it before any handler runs)"
    - "SSH credentials are not present anywhere in the JWT token body"
  artifacts:
    - path: "packages/server/src/types/session.ts"
      provides: "SessionData interface and @fastify/jwt module augmentation"
      exports: ["SessionData"]
    - path: "packages/server/src/services/session-store.ts"
      provides: "In-memory Map<sessionId, SessionData> singleton with get/set/delete"
      exports: ["sessionStore"]
    - path: "packages/server/src/services/ssh-auth.ts"
      provides: "validateSshCredentials(host, port, username, password) → Promise<boolean>"
      exports: ["validateSshCredentials"]
    - path: "packages/server/src/routes/auth.ts"
      provides: "POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me"
      exports: ["authRoutes"]
    - path: "packages/server/src/middleware/verify-auth.ts"
      provides: "Fastify preHandler hook that gates all /api/* routes except auth routes"
      exports: ["verifyAuth"]
    - path: "packages/server/.env.example"
      provides: "Template with JWT_SECRET placeholder"
      contains: "JWT_SECRET"
  key_links:
    - from: "packages/server/src/routes/auth.ts POST /login"
      to: "packages/server/src/services/ssh-auth.ts"
      via: "validateSshCredentials(host, port, username, password)"
      pattern: "validateSshCredentials"
    - from: "packages/server/src/routes/auth.ts POST /login"
      to: "packages/server/src/services/session-store.ts"
      via: "sessionStore.set(sessionId, { host, port, username, password })"
      pattern: "sessionStore.set"
    - from: "packages/server/src/middleware/verify-auth.ts"
      to: "packages/server/src/services/session-store.ts"
      via: "sessionStore.get(sessionId) to validate active session"
      pattern: "sessionStore.get"
    - from: "packages/server/src/server.ts"
      to: "packages/server/src/middleware/verify-auth.ts"
      via: "fastify.addHook('preHandler', verifyAuth)"
      pattern: "addHook.*preHandler"
---

<objective>
Implement the complete backend authentication stack for ServerDeck: SSH credential validation via ssh2, server-side session storage, JWT httpOnly cookie issuance, all three auth API endpoints, rate limiting on login, and the Fastify preHandler auth middleware that gates every /api/* route.

Purpose: This plan delivers AUTH-02 (httpOnly JWT cookie), AUTH-04 (logout + invalidation), AUTH-05 (rate limiting), and AUTH-06 (all API routes gated). After this plan, the backend is fully secure — no unauthenticated request reaches any future route handler.

Output:
- `types/session.ts` — SessionData interface + @fastify/jwt type augmentation
- `services/session-store.ts` — in-memory Map singleton (D-07)
- `services/ssh-auth.ts` — ssh2 validation function (D-02)
- `plugins/auth-plugins.ts` — @fastify/jwt + @fastify/cookie registration (D-04)
- `routes/auth.ts` — POST /login + POST /logout + GET /me with rate limit on login (D-15, D-16, D-17, D-18)
- `middleware/verify-auth.ts` — preHandler hook (D-19)
- `server.ts` — updated to register plugins, middleware, routes (modifies Plan 1 stub)
- `.env.example` + `.env` — JWT_SECRET (D-06)
</objective>

<execution_context>
@~/.copilot/get-shit-done/workflows/execute-plan.md
@~/.copilot/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/01-auth-foundation/01-SKELETON.md
@.planning/phases/01-auth-foundation/01-CONTEXT.md
@.planning/research/STACK.md
@.planning/research/PITFALLS.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: SSH service + session store + type definitions</name>
  <files>
    packages/server/src/types/session.ts,
    packages/server/src/services/session-store.ts,
    packages/server/src/services/ssh-auth.ts,
    packages/server/.env.example,
    packages/server/.env
  </files>
  <read_first>
    - .planning/phases/01-auth-foundation/01-CONTEXT.md — decisions D-02, D-06, D-07, D-21, D-22 (SSH validation approach, session Map, JWT payload, sessionId generation)
    - .planning/research/PITFALLS.md — Pitfall 6 (token-in-URL anti-pattern), Pitfall 1 (Docker socket auth — foreshadows why verifyAuth must be ironclad)
    - .planning/research/STACK.md — ssh2 usage pattern in "WebSocket → SSH Terminal Flow" section
  </read_first>
  <action>
    Create the foundational types, session storage, and SSH validation service. Paths are relative to `packages/server/src/`.

    **types/session.ts**
    Export interface `SessionData` with fields: `host: string`, `port: number`, `username: string`, `password: string`. Also add a module augmentation for `@fastify/jwt` to type the JWT payload and user: declare module `"@fastify/jwt"` and inside it declare interface `FastifyJWT` with `payload: { sessionId: string }` and `user: { sessionId: string }`. This augmentation ensures `request.user.sessionId` is typed throughout the codebase.

    **services/session-store.ts**
    Import `SessionData` from `"../types/session.js"`. Create and export a `sessionStore` constant typed as `Map<string, SessionData>` initialized as `new Map()`. Export three thin wrapper functions: `setSession(sessionId: string, data: SessionData): void` (calls `sessionStore.set`), `getSession(sessionId: string): SessionData | undefined` (calls `sessionStore.get`), `deleteSession(sessionId: string): void` (calls `sessionStore.delete`). Exporting the Map directly alongside helpers keeps it testable.

    **services/ssh-auth.ts**
    Import `{ Client }` from `"ssh2"`. Export async function `validateSshCredentials(host: string, port: number, username: string, password: string): Promise<boolean>`. Inside, return a `new Promise<boolean>((resolve) => { ... })`. Create a `new Client()`. Call `client.on('ready', () => { client.end(); resolve(true); })`. Call `client.on('error', () => { resolve(false); })`. Call `client.connect({ host, port, username, password, readyTimeout: 10000, keepaliveInterval: 0 })`. No other listeners needed. The `readyTimeout: 10000` gives 10 seconds for slow networks — covers D-10's "covers SSH connection failure" case. On connection timeout, ssh2 emits 'error', so `resolve(false)` handles it automatically.

    **.env.example**
    Create with content: `PORT=3001`, `JWT_SECRET=replace-with-a-random-32-plus-character-string`, `LOG_LEVEL=info`. Add a comment line above JWT_SECRET: `# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

    **.env**
    Create with the same keys as .env.example but with a real `JWT_SECRET` value: call `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` to generate a random 64-char hex string and use it as the value. Set `PORT=3001`. This file MUST exist for the server to start but MUST NOT be committed to git (.gitignore already covers `.env` from Plan 1).
  </action>
  <acceptance_criteria>
    - `packages/server/src/types/session.ts` exports `SessionData` interface with `host`, `port`, `username`, `password` fields
    - `packages/server/src/types/session.ts` contains a `declare module "@fastify/jwt"` augmentation with `FastifyJWT` interface
    - `packages/server/src/services/session-store.ts` exports `sessionStore` (Map), `setSession`, `getSession`, `deleteSession`
    - `packages/server/src/services/ssh-auth.ts` exports `validateSshCredentials` with signature `(host: string, port: number, username: string, password: string) => Promise<boolean>`
    - `packages/server/.env.example` contains `JWT_SECRET=replace-with-a-random-32-plus-character-string`
    - `packages/server/.env` contains `JWT_SECRET=` followed by a string of 60+ characters (actual generated secret)
    - `packages/server/.env` is listed in `.gitignore` (verified in Plan 1 — confirm it's still there)
    - `cd packages/server && npx tsc --noEmit` exits with code 0 after these files are added
  </acceptance_criteria>
  <verify>
    <automated>cd packages/server &amp;&amp; npx tsc --noEmit &amp;&amp; echo "TS OK" &amp;&amp; grep -c "validateSshCredentials" src/services/ssh-auth.ts</automated>
  </verify>
  <done>SessionData type, session-store Map, and ssh-auth validation function exist with no TypeScript errors</done>
</task>

<task type="auto">
  <name>Task 2: Auth endpoints + JWT/cookie plugins + rate limiting + auth middleware + wire into server.ts</name>
  <files>
    packages/server/src/plugins/auth-plugins.ts,
    packages/server/src/routes/auth.ts,
    packages/server/src/middleware/verify-auth.ts,
    packages/server/src/server.ts
  </files>
  <read_first>
    - .planning/phases/01-auth-foundation/01-CONTEXT.md — D-04 (cookie name sd_token, 7-day, Secure, SameSite=Strict), D-05 (maxAge), D-06 (JWT payload: {sessionId} only — no credentials), D-15 (POST /login spec), D-16 (POST /logout spec), D-17 (GET /me spec), D-18 (rate limit: 10/min/IP, 429), D-19 (preHandler on /api/* except login/logout)
    - .planning/research/PITFALLS.md — Pitfall 6 (cookie-based WS auth, never token-in-URL)
  </read_first>
  <action>
    Create three files and update server.ts. All paths relative to `packages/server/src/`.

    **plugins/auth-plugins.ts**
    Import `fastifyJwt` from `"@fastify/jwt"` and `fastifyCookie` from `"@fastify/cookie"`. Import `FastifyInstance` from `"fastify"`. Export async function `registerAuthPlugins(fastify: FastifyInstance): Promise<void>`. Inside: first register `fastifyCookie` (no options needed). Then register `fastifyJwt` with options: `secret: process.env.JWT_SECRET!` and `cookie: { cookieName: 'sd_token', signed: false }`. The `cookie.cookieName` tells @fastify/jwt where to find the token when `request.jwtVerify()` is called — it reads the cookie named `sd_token` automatically. This satisfies D-04 (httpOnly cookie named sd_token).

    **routes/auth.ts**
    Import `FastifyInstance`, `FastifyRequest`, `FastifyReply` from `"fastify"`. Import `fastifyRateLimit` from `"@fastify/rate-limit"`. Import `validateSshCredentials` from `"../services/ssh-auth.js"`. Import `setSession`, `getSession`, `deleteSession` from `"../services/session-store.js"`. Import `SessionData` from `"../types/session.js"`. Export async function `authRoutes(fastify: FastifyInstance): Promise<void>`.

    Inside `authRoutes`, first register rate-limit plugin scoped to this plugin context: `await fastify.register(fastifyRateLimit, { global: false })`. This scopes rate limiting to routes that opt in.

    Define the request body type for login: `type LoginBody = { host: string; port: number; username: string; password: string }`.

    Register POST /api/auth/login with schema validation and per-route rate limit. Route options: `{ config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: { type: 'object', required: ['host','port','username','password'], properties: { host: { type: 'string', minLength: 1 }, port: { type: 'integer', minimum: 1, maximum: 65535 }, username: { type: 'string', minLength: 1 }, password: { type: 'string', minLength: 1 } } } } }`. Handler: destructure `{ host, port, username, password }` from `request.body as LoginBody`. Call `await validateSshCredentials(host, port, username, password)`. If false, return `reply.status(401).send({ error: 'Invalid credentials' })` (D-10 — generic error, no enumeration). If true: generate `sessionId` with `crypto.randomUUID()` (D-22 discretion — no nanoid needed). Call `setSession(sessionId, { host, port, username, password })`. Sign JWT: `const token = fastify.jwt.sign({ sessionId }, { expiresIn: '7d' })`. Set cookie: `reply.setCookie('sd_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60, path: '/' })` (D-04, D-05 — note maxAge in seconds for Set-Cookie header). Return `reply.send({ ok: true })`.

    Register POST /api/auth/logout. No auth required (idempotent per D-16). Handler: try to read cookie, if present decode sessionId and call `deleteSession(sessionId)` — wrap in try/catch to handle invalid tokens gracefully. Always clear cookie: `reply.clearCookie('sd_token', { path: '/' })`. Return `{ ok: true }`.

    Register GET /api/auth/me. Handler: call `await request.jwtVerify()`. Look up `const session = getSession(request.user.sessionId)`. If undefined, return `reply.status(401).send({ error: 'Session not found' })`. Return `{ ok: true, host: session.host, username: session.username }` (D-17 — never expose password in response).

    **middleware/verify-auth.ts**
    Import `FastifyRequest`, `FastifyReply` from `"fastify"`. Import `getSession` from `"../services/session-store.js"`. Export async function `verifyAuth(request: FastifyRequest, reply: FastifyReply): Promise<void>`. Inside: define `EXCLUDED_PATHS = ['/api/auth/login', '/api/auth/logout', '/health']`. If `EXCLUDED_PATHS.includes(request.url)`, return immediately (pass through). Otherwise: wrap in try/catch. In try block: call `await request.jwtVerify()`. Look up `const session = getSession(request.user.sessionId)`. If session is undefined, return `reply.status(401).send({ error: 'Unauthorized' })`. Attach session to request: `(request as any).session = session`. In catch block: return `reply.status(401).send({ error: 'Unauthorized' })`. This satisfies D-19 (preHandler on all /api/* except login/logout) and AUTH-06. Future phases add new routes — they are automatically protected because the preHandler is registered globally.

    **server.ts** (update the stub from Plan 1)
    Replace the minimal stub from Plan 1 with the full server setup. Import: `Fastify` from `"fastify"`, `registerAuthPlugins` from `"./plugins/auth-plugins.js"`, `authRoutes` from `"./routes/auth.js"`, `verifyAuth` from `"./middleware/verify-auth.js"`. Inside `buildServer()`: create Fastify instance (same as before). Call `await registerAuthPlugins(fastify)`. Register the global preHandler hook: `fastify.addHook('preHandler', verifyAuth)`. Register the auth routes plugin: `await fastify.register(authRoutes)`. Keep the GET /health route (no auth required — excluded by verify-auth). Return the fastify instance.
  </action>
  <acceptance_criteria>
    - `packages/server/src/plugins/auth-plugins.ts` registers both `@fastify/cookie` and `@fastify/jwt` with `cookieName: 'sd_token'`
    - `packages/server/src/routes/auth.ts` registers `POST /api/auth/login` with `rateLimit: { max: 10, timeWindow: '1 minute' }`
    - `packages/server/src/routes/auth.ts` calls `crypto.randomUUID()` for sessionId (no nanoid import)
    - `packages/server/src/routes/auth.ts` JWT sign payload contains only `sessionId` (not host, username, or password — per D-06)
    - `packages/server/src/routes/auth.ts` cookie options include `httpOnly: true`, `sameSite: 'strict'`, `path: '/'`
    - `packages/server/src/routes/auth.ts` POST /login 401 response body is exactly `{ error: 'Invalid credentials' }` (no username-enumeration leak)
    - `packages/server/src/middleware/verify-auth.ts` excludes `/api/auth/login`, `/api/auth/logout`, `/health` from auth check
    - `packages/server/src/server.ts` calls `fastify.addHook('preHandler', verifyAuth)`
    - `cd packages/server && npx tsc --noEmit` exits with code 0
    - Server starts: `pnpm --filter @serverdeck/server dev` shows no startup errors
    - `curl -sf http://localhost:3001/health` returns `{"ok":true}` (health still works, excluded from auth)
    - `curl -sf -X GET http://localhost:3001/api/auth/me` returns HTTP 401 (no cookie = unauthorized)
    - `curl -sf -X POST http://localhost:3001/api/auth/logout -H "Content-Type: application/json"` returns `{"ok":true}` (idempotent — works without a session)
  </acceptance_criteria>
  <verify>
    <automated>
      pnpm --filter @serverdeck/server dev &amp; sleep 4 &amp;&amp;
      curl -sf http://localhost:3001/health | grep '"ok":true' &amp;&amp;
      curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/auth/me | grep 401 &amp;&amp;
      curl -sf -X POST http://localhost:3001/api/auth/logout -H "Content-Type: application/json" | grep '"ok":true' &amp;&amp;
      cd packages/server &amp;&amp; npx tsc --noEmit &amp;&amp; echo "ALL CHECKS PASSED" &amp;&amp;
      kill %1
    </automated>
  </verify>
  <done>
    All three auth endpoints respond correctly; preHandler blocks unauthenticated /api/auth/me; /health still reachable; TypeScript clean
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| internet → POST /api/auth/login | Untrusted credentials cross here; SSH validation is the gate |
| JWT cookie → Fastify preHandler | Cookie value is untrusted until @fastify/jwt verifies signature |
| preHandler → route handler | Only authenticated + session-validated requests reach handlers |
| JWT payload → session Map | sessionId from JWT is used as Map key; stale sessionId (after restart) returns undefined = 401 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-01 | Spoofing | POST /api/auth/login | mitigate | SSH credential brute-force blocked by @fastify/rate-limit: max 10 req/min/IP on login route (D-18, AUTH-05). Returns 429 with `{ error: "Too many requests" }`. |
| T-02-02 | Information Disclosure | POST /api/auth/login 401 response | mitigate | Generic "Invalid credentials" error for all failures (wrong password, wrong host, SSH timeout). No username enumeration possible (D-10). |
| T-02-03 | Information Disclosure | JWT payload | mitigate | JWT contains only `{ sessionId, iat, exp }` — no host, username, or password (D-06). Even if JWT is decoded, attacker gets only a UUID. |
| T-02-04 | Tampering | sd_token cookie | mitigate | Cookie flags: `httpOnly: true` (JS cannot read), `secure: true` in production (HTTPS-only), `sameSite: 'strict'` (no CSRF cross-site). Signed by JWT_SECRET (HS256). |
| T-02-05 | Elevation of Privilege | Fastify preHandler bypass | mitigate | `verifyAuth` registered as global `addHook('preHandler', ...)` — fires before every route handler including any future routes. Exclusion list is explicit (login/logout/health only). |
| T-02-06 | Information Disclosure | GET /api/auth/me response | mitigate | Returns only `{ ok, host, username }` — never exposes password from session Map (D-17). |
| T-02-07 | Elevation of Privilege | JWT_SECRET exposure | mitigate | JWT_SECRET loaded from `.env` via `process.env.JWT_SECRET`. `.env` is in `.gitignore` (established in Plan 1). `.env.example` has placeholder only. |
| T-02-SC | Tampering | npm install (@fastify/rate-limit, ssh2, @fastify/jwt) | mitigate | Packages verified in STACK.md via Context7. Executor must confirm package names on npmjs.com before install. |
</threat_model>

<verification>
After both tasks complete, run with a real SSH server available (or use localhost if SSH daemon is running):

```bash
# Start server
pnpm --filter @serverdeck/server dev &
sleep 4

# 1. Health endpoint (excluded from auth)
curl -sf http://localhost:3001/health

# 2. /me without cookie → 401
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/auth/me)
[ "$STATUS" = "401" ] && echo "✓ /me without cookie → 401"

# 3. Logout without session → 200 (idempotent)
curl -sf -X POST http://localhost:3001/api/auth/logout -H "Content-Type: application/json"

# 4. Login with invalid creds → 401
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"host":"127.0.0.1","port":22,"username":"nobody","password":"wrongpassword"}')
[ "$STATUS" = "401" ] && echo "✓ Invalid creds → 401"

# 5. TypeScript clean
cd packages/server && npx tsc --noEmit && echo "✓ TypeScript OK"

kill %1
```

For full E2E auth flow test (requires accessible SSH server), see Plan 3 acceptance criteria.
</verification>

<success_criteria>
- `GET /health` → 200 `{"ok":true}` (auth excluded)
- `GET /api/auth/me` without cookie → 401 `{"error":"Unauthorized"}`
- `POST /api/auth/login` with invalid SSH creds → 401 `{"error":"Invalid credentials"}`
- `POST /api/auth/login` rate-limited at 11th request within 60s → 429
- `POST /api/auth/logout` → 200 `{"ok":true}` (idempotent)
- JWT payload decoded from `sd_token` contains only `sessionId`, `iat`, `exp` — no credentials
- All TypeScript compiles clean (`tsc --noEmit` exits 0 in packages/server)
</success_criteria>

<output>
Create `.planning/phases/01-auth-foundation/01-02-SUMMARY.md` when done.
</output>
