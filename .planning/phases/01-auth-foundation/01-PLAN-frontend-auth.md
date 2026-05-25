---
phase: 01-auth-foundation
plan: 03
type: execute
wave: 3
depends_on:
  - 01-PLAN-backend-auth
files_modified:
  - packages/web/src/lib/axios.ts
  - packages/web/src/pages/LoginPage.tsx
  - packages/web/src/pages/DashboardPage.tsx
  - packages/web/src/components/ProtectedRoute.tsx
  - packages/web/src/App.tsx
  - packages/web/vite.config.ts
autonomous: true
requirements:
  - AUTH-01
  - AUTH-03
  - AUTH-04

must_haves:
  truths:
    - "Visiting http://localhost:5173/login shows the ServerDeck login card with Host, Port, Username, Password fields and a blue Connect button"
    - "Submitting the login form with valid SSH credentials redirects the browser to http://localhost:5173/ and shows the dashboard stub"
    - "Visiting http://localhost:5173/ with no active session shows a loading spinner then redirects to /login"
    - "After login, refreshing http://localhost:5173/ keeps the user on the dashboard (cookie persists across refresh)"
    - "Clicking Log out on the dashboard redirects to /login; a subsequent GET /api/auth/me returns 401"
    - "Host, Port, and Username fields are pre-filled from localStorage on the login page after a prior login (agent's discretion: username is convenience pre-fill per D-09 scope)"
    - "Password field is never pre-filled"
    - "On a 390px-wide viewport, the login card has no horizontal scroll and all inputs are touchable (iOS auto-zoom prevented by text-base class)"
  artifacts:
    - path: "packages/web/src/lib/axios.ts"
      provides: "Axios instance with baseURL /api, withCredentials: true, 401 interceptor"
      exports: ["api"]
    - path: "packages/web/src/pages/LoginPage.tsx"
      provides: "4-field login form per UI-SPEC zinc dark design"
      exports: ["LoginPage"]
    - path: "packages/web/src/pages/DashboardPage.tsx"
      provides: "Dashboard stub: ServerDeck heading + Connected to {host} + Log out button"
      exports: ["DashboardPage"]
    - path: "packages/web/src/components/ProtectedRoute.tsx"
      provides: "Auth-checking route wrapper: GET /api/auth/me, spinner, Navigate to /login on 401"
      exports: ["ProtectedRoute"]
    - path: "packages/web/src/App.tsx"
      provides: "BrowserRouter with /login (public) and / (ProtectedRoute-wrapped dashboard)"
      exports: ["default App"]
    - path: "packages/web/vite.config.ts"
      provides: "Vite proxy: /api/* → http://localhost:3001"
      contains: "proxy"
  key_links:
    - from: "packages/web/src/pages/LoginPage.tsx form submit"
      to: "packages/web/src/lib/axios.ts"
      via: "api.post('/auth/login', { host, port, username, password })"
      pattern: "api.post.*auth/login"
    - from: "packages/web/src/components/ProtectedRoute.tsx"
      to: "packages/web/src/lib/axios.ts"
      via: "api.get('/auth/me')"
      pattern: "api.get.*auth/me"
    - from: "packages/web/src/pages/DashboardPage.tsx logout handler"
      to: "packages/web/src/lib/axios.ts"
      via: "api.post('/auth/logout')"
      pattern: "api.post.*auth/logout"
    - from: "packages/web/vite.config.ts proxy"
      to: "http://localhost:3001"
      via: "/api/* → target"
      pattern: "proxy.*api"
---

<objective>
Implement the complete frontend authentication experience: Axios client with withCredentials and 401 interceptor, the login page per the approved UI-SPEC (4 fields, zinc dark card, localStorage persistence, loading/error states), the protected route wrapper, the dashboard stub, and the Vite /api proxy. After this plan, the full E2E walking skeleton is operational: login form → SSH auth → cookie → protected dashboard → logout → back to /login.

Purpose: Delivers AUTH-01 (login form), AUTH-03 (session persists via ProtectedRoute calling /me on every mount), and AUTH-04 (logout button + cookie clear). Completes the Phase 1 walking skeleton end-to-end.

Output:
- `src/lib/axios.ts` — Axios instance (D-14)
- `src/pages/LoginPage.tsx` — full login form per UI-SPEC (D-08, D-09, D-10, D-11)
- `src/pages/DashboardPage.tsx` — dashboard stub (D-11, D-13)
- `src/components/ProtectedRoute.tsx` — auth wrapper (D-12, D-13)
- `src/App.tsx` — final React Router setup replacing Plan 1 stubs (D-12)
- `vite.config.ts` — /api proxy added (dev-only, enables withCredentials without CORS)
</objective>

<execution_context>
@~/.copilot/get-shit-done/workflows/execute-plan.md
@~/.copilot/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/01-auth-foundation/01-SKELETON.md
@.planning/phases/01-auth-foundation/01-CONTEXT.md
@.planning/phases/01-auth-foundation/01-UI-SPEC.md
@.planning/research/STACK.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Axios client + Vite proxy + login page per UI-SPEC</name>
  <files>
    packages/web/src/lib/axios.ts,
    packages/web/vite.config.ts,
    packages/web/src/pages/LoginPage.tsx
  </files>
  <read_first>
    - .planning/phases/01-auth-foundation/01-UI-SPEC.md — FULL DOCUMENT. Read every section before writing LoginPage.tsx. Pay special attention to: "Login Page — Full Layout Spec", "Card Content — Form Fields" (exact input attrs), "Error Message Area", "Submit Button", "Interaction States", "Mobile-Specific Contracts" (text-base override, min-h-svh), "Accessibility Contracts" (role=alert, aria-busy, aria-label for toggle), "Copywriting Contract" (exact copy strings)
    - .planning/phases/01-auth-foundation/01-CONTEXT.md — D-09 (localStorage keys: sd_host, sd_port; password never stored), D-10 (error messages: generic "Invalid credentials"), D-11 (redirect to / on success), D-14 (401 interceptor)
  </read_first>
  <action>
    All paths relative to `packages/web/`. Install `axios` if not already in node_modules: `pnpm --filter @serverdeck/web add axios`.

    **src/lib/axios.ts**
    Import `axios` from `"axios"`. Create and export `const api = axios.create({ baseURL: '/api', withCredentials: true })` (D-14 — withCredentials sends the sd_token httpOnly cookie on every request; baseURL '/api' combines with Vite proxy to reach http://localhost:3001/api/*). Add a response interceptor: `api.interceptors.response.use((response) => response, (error) => { if (error.response?.status === 401) { window.location.href = '/login'; } return Promise.reject(error); })`. The `window.location.href` redirect is intentional — it fully resets React state, preventing stale auth state from persisting in memory (D-14).

    **vite.config.ts** (update the file created in Plan 1)
    Add a `server.proxy` configuration inside `defineConfig`: `server: { proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } } }`. Keep the existing `plugins: [tailwindcss(), react()]` array. The proxy forwards all `/api/*` requests from the Vite dev server (port 5173) to Fastify (port 3001) without CORS issues, enabling cookies to be set correctly (`withCredentials: true` works because the browser sees the same origin).

    **src/pages/LoginPage.tsx**
    This is the most detailed file in this task. Implement exactly as specified in UI-SPEC. Key requirements:

    Imports: `useState`, `useEffect` from react; `useNavigate` from `react-router-dom`; `api` from `../lib/axios`; `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent` from `../components/ui/card`; `Input` from `../components/ui/input`; `Label` from `../components/ui/label`; `Button` from `../components/ui/button`; `Server`, `Eye`, `EyeOff`, `Loader2`, `AlertCircle` from `lucide-react`.

    State: `host` (string, init from `localStorage.getItem('sd_host') ?? ''`), `port` (string, init from `localStorage.getItem('sd_port') ?? '22'`), `username` (string, init from `localStorage.getItem('sd_username') ?? ''`), `password` (string, init `''` — never pre-filled per D-09), `showPassword` (boolean, false), `isLoading` (boolean, false), `error` (string | null, null).

    On mount useEffect: call `api.get('/auth/me').then(() => navigate('/', { replace: true })).catch(() => {})` — if already authenticated, skip the login page (per UI-SPEC "already authenticated" guard). The .catch is intentional (not authenticated = expected, stay on /login).

    Form submit handler `handleSubmit(e: React.FormEvent)`: call `e.preventDefault()`. Set `isLoading = true`, `error = null`.     Persist to localStorage: `localStorage.setItem('sd_host', host)`, `localStorage.setItem('sd_port', port)` — per D-09. `localStorage.setItem('sd_username', username)` — agent's discretion: username is convenience pre-fill, not sensitive (D-09 only mandates host/port; password is NEVER stored). Do NOT store password. Call `api.post('/auth/login', { host, port: Number(port), username, password })`. On success: `navigate('/')`. On error: check `error.response?.status`. If 401: set error to `"Invalid credentials. Check your host, port, and try again."` (exact copy from UI-SPEC). If 429: set error to `"Too many attempts. Wait a minute and try again."`. Otherwise (network/timeout): set error to `"Connection timed out. Verify host and port are reachable."`. Always set `isLoading = false` in finally.

    Layout structure (must match UI-SPEC exactly):
    - Outer div: `className="min-h-svh flex items-center justify-center bg-background px-4"`
    - `Card` with `className="w-full max-w-sm"`
    - `CardHeader` with `className="space-y-1 pb-4"`: inner div with `className="flex items-center gap-2"` containing `<Server size={20} className="text-primary" />` and `<CardTitle className="text-2xl font-bold">ServerDeck</CardTitle>`; then `<CardDescription>Connect to your server</CardDescription>`
    - `CardContent`: `<form onSubmit={handleSubmit}>` with `<div className="space-y-4">`
    - Four field groups each as `<div className="space-y-1.5">` containing `<Label htmlFor="...">` and `<Input id="..." className="text-base" ...>` (text-base is MANDATORY on all inputs — prevents iOS auto-zoom per UI-SPEC Mobile-Specific Contracts)
    - Host input: `type="text"`, `placeholder="192.168.1.100"`, `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}`, `autoComplete="url"`, `disabled={isLoading}`, `value={host}`, `onChange={(e) => setHost(e.target.value)}`
    - Port input: `type="text"`, `inputMode="numeric"`, `pattern="[0-9]*"`, `autoComplete="off"`, `disabled={isLoading}`, `value={port}`, `onChange={(e) => setPort(e.target.value)}`
    - Username input: `type="text"`, `placeholder="ubuntu"`, `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}`, `autoComplete="username"`, `disabled={isLoading}`, `value={username}`, `onChange={(e) => setUsername(e.target.value)}`
    - Password field wrapper: `<div className="relative">`. Input: `type={showPassword ? "text" : "password"}`, `autoComplete="current-password"`, `className="text-base pr-11"`, `disabled={isLoading}`, `value={password}`, `onChange={(e) => setPassword(e.target.value)}`. Toggle Button: `type="button"`, `variant="ghost"`, `size="icon"`, `className="absolute right-0 top-0 h-11 w-11"`, `onClick={() => setShowPassword(!showPassword)}`, `aria-label={showPassword ? "Hide password" : "Show password"}`, `aria-pressed={showPassword}`. Toggle icon: `{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}`
    - Error area: `{error && <p className="text-sm text-destructive flex items-center gap-1.5" role="alert"><AlertCircle size={14} />{error}</p>}` — use `role="alert"` for screen reader announcement (UI-SPEC Accessibility Contracts)
    - Submit Button: `type="submit"`, `className="w-full h-11"`, `disabled={isLoading}`, `aria-busy={isLoading}`. Content: when `isLoading` show `<><Loader2 size={16} className="animate-spin mr-2" />Connecting…</>`, otherwise show `"Connect"`
  </action>
  <acceptance_criteria>
    - `packages/web/src/lib/axios.ts` exports `api` with `withCredentials: true` and `baseURL: '/api'`
    - `packages/web/src/lib/axios.ts` has a 401 interceptor that calls `window.location.href = '/login'`
    - `packages/web/vite.config.ts` contains `proxy: { '/api': { target: 'http://localhost:3001' } }`
    - `packages/web/src/pages/LoginPage.tsx` imports `Server`, `Eye`, `EyeOff`, `Loader2`, `AlertCircle` from `lucide-react`
    - `packages/web/src/pages/LoginPage.tsx` contains `min-h-svh` on the outer wrapper (iOS viewport fix)
    - `packages/web/src/pages/LoginPage.tsx` contains `className="text-base"` on all four Input elements (iOS auto-zoom prevention — MANDATORY per UI-SPEC)
    - `packages/web/src/pages/LoginPage.tsx` contains `role="alert"` on the error paragraph
    - `packages/web/src/pages/LoginPage.tsx` contains `aria-busy={isLoading}` on the submit Button
    - `packages/web/src/pages/LoginPage.tsx` persists `sd_host`, `sd_port`, `sd_username` to localStorage on submit
    - `packages/web/src/pages/LoginPage.tsx` does NOT call `localStorage.setItem` with password as value
    - `cd packages/web && npx tsc --noEmit` exits with code 0
    - Vite dev server compiles LoginPage.tsx without errors
    - Visiting http://localhost:5173/login renders the login card (visual check in Task 2)
  </acceptance_criteria>
  <verify>
    <automated>cd packages/web &amp;&amp; npx tsc --noEmit &amp;&amp; echo "TS OK" &amp;&amp; grep -c "text-base" src/pages/LoginPage.tsx &amp;&amp; grep -c "role=\"alert\"" src/pages/LoginPage.tsx</automated>
  </verify>
  <done>Axios client configured, Vite proxy wired, LoginPage implements full UI-SPEC spec with no TypeScript errors</done>
</task>

<task type="auto">
  <name>Task 2: ProtectedRoute + DashboardPage stub + App.tsx final routing</name>
  <files>
    packages/web/src/components/ProtectedRoute.tsx,
    packages/web/src/pages/DashboardPage.tsx,
    packages/web/src/App.tsx
  </files>
  <read_first>
    - .planning/phases/01-auth-foundation/01-UI-SPEC.md — "Screen 2: / — Dashboard Stub" section (layout, content, loading state), "Protected Route (Dashboard Stub) States" in Interaction States, Copywriting Contract (dashboard heading, sub-line "Connected to {host}", logout button "Log out")
    - .planning/phases/01-auth-foundation/01-CONTEXT.md — D-12 (React Router v6 routes), D-13 (ProtectedRoute: GET /api/auth/me, spinner, 401 → /login), D-11 (post-logout redirect to /login), D-14 (401 interceptor already in axios.ts)
  </read_first>
  <action>
    All paths relative to `packages/web/src/`. Create three files.

    **components/ProtectedRoute.tsx**
    Import `useState`, `useEffect` from react; `Outlet`, `Navigate` from `react-router-dom`; `Loader2` from `lucide-react`; `api` from `../lib/axios`. Define type `AuthState = 'loading' | 'authenticated' | 'unauthenticated'`.

    State: `authState` (AuthState, init `'loading'`), `host` (string, init `''`).

    On mount useEffect (runs once): call `api.get('/auth/me')`. On success response: extract `host` from `response.data.host`, set `host` state, set `authState = 'authenticated'`. On error: set `authState = 'unauthenticated'`.

    Render: if `authState === 'loading'`: return `<div className="min-h-svh flex items-center justify-center"><Loader2 size={40} className="animate-spin text-muted-foreground" /></div>` — full-viewport spinner, no content flash (D-13). If `authState === 'unauthenticated'`: return `<Navigate to="/login" replace />`. If `authState === 'authenticated'`: return `<Outlet context={{ host }} />` — passes host down to child routes via React Router outlet context.

    **pages/DashboardPage.tsx**
    Import `useNavigate` from `react-router-dom`; `useOutletContext` from `react-router-dom`; `api` from `../lib/axios`; `Button` from `../components/ui/button`.

    Outlet context type: `type DashboardContext = { host: string }`. Call `const { host } = useOutletContext<DashboardContext>()`.

    Logout handler `handleLogout`: call `await api.post('/auth/logout')`. Then call `navigate('/login')` (D-11). Wrap in try/catch — even if the logout API call fails, still navigate to /login (the cookie was likely already invalid).

    Layout (per UI-SPEC Screen 2): outer div `className="min-h-svh flex flex-col items-center justify-center gap-6 bg-background"`. Inside: `<h1 className="text-2xl font-bold">ServerDeck</h1>`. Then `<p className="text-muted-foreground">Connected to {host}</p>`. Then `<Button variant="outline" onClick={handleLogout}>Log out</Button>` with `className` including `h-11` (44px touch target per MOBL-03).

    **src/App.tsx** (replace the Plan 1 stub entirely)
    Import `BrowserRouter`, `Routes`, `Route` from `"react-router-dom"`. Import `LoginPage` from `"./pages/LoginPage"`. Import `DashboardPage` from `"./pages/DashboardPage"`. Import `ProtectedRoute` from `"./components/ProtectedRoute"`.

    Export default function `App()`. Render: `<BrowserRouter><Routes><Route path="/login" element={<LoginPage />} /><Route path="/" element={<ProtectedRoute />}><Route index element={<DashboardPage />} /></Route></Routes></BrowserRouter>`. The nested structure means `/` renders ProtectedRoute (which calls /api/auth/me), and if authenticated it renders `<Outlet>` which is `DashboardPage` (D-12). Any 401 from Axios interceptor OR from ProtectedRoute redirects to /login.
  </action>
  <acceptance_criteria>
    - `packages/web/src/components/ProtectedRoute.tsx` calls `api.get('/auth/me')` on mount
    - `packages/web/src/components/ProtectedRoute.tsx` renders `<Loader2 size={40} className="animate-spin text-muted-foreground" />` during `authState === 'loading'`
    - `packages/web/src/components/ProtectedRoute.tsx` renders `<Navigate to="/login" replace />` when `authState === 'unauthenticated'`
    - `packages/web/src/components/ProtectedRoute.tsx` renders `<Outlet context={{ host }} />` when authenticated
    - `packages/web/src/pages/DashboardPage.tsx` shows "Connected to {host}" where host comes from outlet context
    - `packages/web/src/pages/DashboardPage.tsx` has a "Log out" Button that calls `api.post('/auth/logout')` then `navigate('/login')`
    - `packages/web/src/App.tsx` has `<Route path="/" element={<ProtectedRoute />}>` with `<Route index element={<DashboardPage />} />` nested inside
    - `packages/web/src/App.tsx` has `<Route path="/login" element={<LoginPage />} />`
    - `cd packages/web && npx tsc --noEmit` exits with code 0
    - With both pnpm dev services running: `GET http://localhost:5173/` (no cookie) → browser redirects to /login within 1-2 seconds (after /api/auth/me returns 401)
    - After successful login: browser is at `http://localhost:5173/` and shows "ServerDeck" heading and "Connected to {host}"
    - After clicking Log out: browser is at `http://localhost:5173/login`
  </acceptance_criteria>
  <verify>
    <automated>cd packages/web &amp;&amp; npx tsc --noEmit &amp;&amp; echo "TS OK" &amp;&amp; grep -c "Navigate.*login" src/components/ProtectedRoute.tsx &amp;&amp; grep -c "auth/logout" src/pages/DashboardPage.tsx</automated>
  </verify>
  <done>
    ProtectedRoute gates the dashboard behind /api/auth/me; DashboardPage shows host and logout button; App.tsx routes are final; full E2E walking skeleton operational
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser localStorage → login form | Untrusted (can be tampered by user). Only host/port/username pre-filled — no credentials stored |
| login form → POST /api/auth/login | Password travels over HTTPS (enforced by Secure cookie + production TLS) |
| sd_token httpOnly cookie → browser | JS cannot read or exfiltrate the cookie (httpOnly flag) |
| ProtectedRoute → /api/auth/me | Any invalid/expired cookie gets 401 → redirect; session cannot be forged |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-01 | Information Disclosure | localStorage persistence | mitigate | Only `sd_host`, `sd_port`, `sd_username` stored in localStorage. Password is NEVER stored (D-09). localStorage values are convenience pre-fill, not auth material. |
| T-03-02 | Information Disclosure | XSS → session token theft | mitigate | `sd_token` cookie is `httpOnly: true` — JavaScript cannot read it via `document.cookie` or any API. XSS cannot exfiltrate the token. |
| T-03-03 | Spoofing | CSRF attack against logout | accept | `SameSite=Strict` cookie prevents cross-site requests from including the cookie. Logout is idempotent and causes no data loss. Risk accepted. |
| T-03-04 | Elevation of Privilege | Client-side route bypass | mitigate | ProtectedRoute calls `GET /api/auth/me` on every mount — client-side navigation to `/` does not bypass auth. The server is the authoritative check. |
| T-03-05 | Information Disclosure | Axios 401 interceptor redirect | accept | `window.location.href = '/login'` on any 401 fully resets page state. Does not leak information. |
| T-03-SC | Tampering | npm install (axios, react-router-dom, lucide-react) | mitigate | Packages verified as industry-standard. Executor confirms on npmjs.com before install. |
</threat_model>

<verification>
Full end-to-end walking skeleton verification. Both services must be running (`pnpm dev`).

```bash
# Start all services
pnpm dev &
sleep 8  # Allow both services to start

# 1. TypeScript clean across both packages
(cd packages/server && npx tsc --noEmit) && echo "✓ Server TS clean"
(cd packages/web && npx tsc --noEmit) && echo "✓ Web TS clean"

# 2. Backend health
curl -sf http://localhost:3001/health | grep '"ok":true' && echo "✓ Health OK"

# 3. Frontend serves app
curl -sf http://localhost:5173 | grep -i 'serverdeck' && echo "✓ Frontend serves app"

# 4. Vite proxy forwards /api requests
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/api/auth/me)
[ "$STATUS" = "401" ] && echo "✓ Vite proxy working (got 401 from backend)"

# 5. Login form fields present in source
grep -c "sd_host\|sd_port\|sd_username" packages/web/src/pages/LoginPage.tsx && echo "✓ localStorage keys present"
grep -c "text-base" packages/web/src/pages/LoginPage.tsx && echo "✓ iOS zoom fix applied"
grep -c "role=\"alert\"" packages/web/src/pages/LoginPage.tsx && echo "✓ Error area accessible"

kill %1
```

**Manual E2E verification** (requires an accessible SSH server):
1. Open http://localhost:5173/ → should redirect to /login (ProtectedRoute + /api/auth/me → 401)
2. On /login: fill Host (SSH server IP), Port (22), Username, Password → click Connect
3. Observe: loading spinner on button during SSH handshake (1-3s)
4. Observe: redirect to / showing "ServerDeck" + "Connected to {host}"
5. Refresh: still on / (cookie persists session — AUTH-03)
6. Click "Log out": redirects to /login
7. Navigate to /: redirects to /login (session cleared — AUTH-04)
8. Submit wrong credentials: shows "Invalid credentials. Check your host, port, and try again." inline

All 8 manual steps must pass for the walking skeleton to be considered complete.
</verification>

<success_criteria>
- `GET http://localhost:5173/` (unauthenticated) → redirects to /login within 2s
- `GET http://localhost:5173/login` → renders login card with Host, Port, Username, Password, Connect button
- Login with valid SSH creds → redirects to /, shows "Connected to {host}"
- Browser refresh at / → user stays on / (AUTH-03: cookie persists)
- Logout → browser at /login; next visit to / → redirected back to /login (AUTH-04)
- TypeScript compiles clean in both packages
- All four shadcn components imported and used in LoginPage with no console errors
- iOS viewport fix confirmed: all four Input elements have `className="text-base"` (prevents auto-zoom on iOS Safari)
</success_criteria>

<output>
Create `.planning/phases/01-auth-foundation/01-03-SUMMARY.md` when done.
</output>
