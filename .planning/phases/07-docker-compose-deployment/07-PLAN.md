---
phase: 07-docker-compose-deployment
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/web/src/lib/axios.ts
  - packages/web/vite.config.ts
  - Dockerfile
  - .dockerignore
  - docker-compose.yml
  - .env.example
autonomous: false
requirements:
  - DEPLOY-01
  - DEPLOY-02
  - DEPLOY-03

must_haves:
  truths:
    - "`docker-compose up` builds the image and starts the server without manual steps"
    - "The React SPA is served at `/` from the running container"
    - "The API responds at `/api/*` from the running container"
    - "Setting `VITE_API_BASE=http://localhost:3001` at build time sends all axios requests to that origin"
    - "Leaving `VITE_API_BASE` unset (empty) keeps axios requests same-origin (no `/api` prefix hardcoded)"
    - "`VITE_BASE` defaults to `/` and controls the Vite build base path and PWA manifest start_url/scope"
    - "`docker-compose up` exits immediately with an error if `JWT_SECRET` is not set in the environment"
  artifacts:
    - path: "Dockerfile"
      provides: "Multi-stage build producing a minimal runtime image"
      contains: "web-builder, server-builder, runtime stages"
    - path: "docker-compose.yml"
      provides: "Single-command deployment orchestration"
      contains: "VITE_BASE, VITE_API_BASE build args; JWT_SECRET with no fallback"
    - path: ".dockerignore"
      provides: "Excludes node_modules, dist/, .git, .planning from build context"
    - path: ".env.example"
      provides: "Documents all required and optional env vars with comments"
    - path: "packages/web/src/lib/axios.ts"
      provides: "Runtime-configurable API base URL"
      contains: "import.meta.env.VITE_API_BASE"
    - path: "packages/web/vite.config.ts"
      provides: "Configurable base path + PWA manifest paths"
      contains: "process.env.VITE_BASE"
  key_links:
    - from: "docker-compose.yml build.args"
      to: "Dockerfile ARG VITE_BASE / ARG VITE_API_BASE"
      via: "Docker build argument injection"
      pattern: "VITE_BASE|VITE_API_BASE"
    - from: "Dockerfile COPY --from=web-builder"
      to: "/app/packages/web/dist"
      via: "Multi-stage copy preserving relative path"
      pattern: "packages/web/dist"
    - from: "packages/server/dist/server.js __dirname"
      to: "../../web/dist"
      via: "path.join at runtime resolves to /app/packages/web/dist"
      pattern: "../../web/dist"
    - from: "docker-compose.yml environment.JWT_SECRET"
      to: "packages/server/src/index.ts fail-fast guard"
      via: "process.env.JWT_SECRET check at startup"
      pattern: "JWT_SECRET"
---

<objective>
Ship ServerDeck as a single `docker-compose up` command. Three concerns:

1. **Code changes (Wave 1)** — Two one-line edits make axios and Vite base paths runtime-configurable via env vars (per DEPLOY-02, DEPLOY-03).
2. **Docker infrastructure (Wave 2)** — A multi-stage Dockerfile, `.dockerignore`, `docker-compose.yml`, and `.env.example` make the app deployable from a single command (per DEPLOY-01).
3. **Smoke test (Wave 3)** — Verify the image builds and the running container serves the SPA at `/` and the API at `/api/*`.

Purpose: Users can self-host ServerDeck by cloning the repo, setting `JWT_SECRET` in `.env`, and running `docker-compose up`.
Output: A deployable repo with `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example` and two patched source files.
</objective>

<execution_context>
@~/.copilot/get-shit-done/workflows/execute-plan.md
@~/.copilot/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/07-docker-compose-deployment/07-RESEARCH.md
@.planning/phases/07-docker-compose-deployment/PATTERNS.md
@packages/web/src/lib/axios.ts
@packages/web/vite.config.ts
@packages/server/src/server.ts
@packages/server/src/index.ts
@package.json
@packages/server/package.json
@packages/web/package.json
</context>

<tasks>

<!-- ═══════════════════════════════════════════════════════════════════════════
     WAVE 1 — Code changes: make axios baseURL and Vite base path configurable
     ═══════════════════════════════════════════════════════════════════════════ -->

<task type="auto" tdd="false">
  <name>Task 1 (Wave 1): Patch axios.ts and vite.config.ts for runtime-configurable base paths</name>
  <files>packages/web/src/lib/axios.ts, packages/web/vite.config.ts</files>
  <action>
Make exactly three edits across two files. Do not restructure any other logic.

**File 1 — `packages/web/src/lib/axios.ts`**

Change line 4 only. Replace the hardcoded `baseURL: '/api'` with the env-driven value:

  BEFORE: `  baseURL: '/api',`
  AFTER:  `  baseURL: import.meta.env.VITE_API_BASE || '',`

Semantics: When `VITE_API_BASE` is set (e.g. `http://localhost:3001`) at build time, axios uses that origin as the base. When it is empty or unset, baseURL becomes `''` — all requests are same-origin relative paths, which is correct for the production container where the server and SPA share the same origin (DEPLOY-02). The 401-redirect interceptor and `withCredentials: true` remain untouched.

The complete file after the change must be:
```
import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '',
  withCredentials: true,
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Only redirect on 401 when NOT already on the login page — prevents
    // infinite reload (LoginPage's /me check) and swallowed login errors (CR-01)
    if (error.response?.status === 401 && window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
```

**File 2 — `packages/web/vite.config.ts`**

Make three targeted changes:

(a) Add `base: process.env.VITE_BASE ?? '/',` as the FIRST key inside `defineConfig({`. `process.env.VITE_BASE` is read by Node.js at build time; no `import.meta.env` needed here. The `?? '/'` fallback keeps local dev behaviour unchanged (DEPLOY-03).

(b) Replace `start_url: '/',` inside VitePWA manifest with `start_url: process.env.VITE_BASE ?? '/',`. This prevents the PWA from hardcoding `/` when the app is deployed at a sub-path.

(c) Replace `scope: '/',` inside VitePWA manifest with `scope: process.env.VITE_BASE ?? '/',`.

The complete file after all three changes:
```
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'ServerDeck',
        short_name: 'ServerDeck',
        description: 'Server dashboard and SSH terminal',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        start_url: process.env.VITE_BASE ?? '/',
        scope: process.env.VITE_BASE ?? '/',
        icons: [
          { src: '/icon-180.png', sizes: '180x180', type: 'image/png' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
```
  </action>
  <verify>
    <automated>cd packages/web && pnpm run build 2>&amp;1 | tail -5</automated>
  </verify>
  <done>
    - `packages/web/src/lib/axios.ts` line 4 reads `baseURL: import.meta.env.VITE_API_BASE || ''`
    - `packages/web/vite.config.ts` has `base: process.env.VITE_BASE ?? '/'` as first key in defineConfig
    - `packages/web/vite.config.ts` VitePWA manifest has `start_url: process.env.VITE_BASE ?? '/'` and `scope: process.env.VITE_BASE ?? '/'`
    - `pnpm run build` in packages/web exits 0 with no TypeScript errors
  </done>
</task>

<!-- ═══════════════════════════════════════════════════════════════════════════
     WAVE 2 — Docker infrastructure: Dockerfile, .dockerignore, compose, .env.example
     ═══════════════════════════════════════════════════════════════════════════ -->

<task type="auto">
  <name>Task 2 (Wave 2): Create Dockerfile, .dockerignore, docker-compose.yml, and .env.example</name>
  <files>Dockerfile, .dockerignore, docker-compose.yml, .env.example</files>
  <action>
Create four files at the repo root. Each is specified in full below. Do not deviate from the directory layout or the ARG/ENV ordering — both affect correctness.

---

**File 1 — `Dockerfile`** (multi-stage, node:22-alpine)

Critical layout constraint: `packages/server/src/server.ts` resolves static files via `path.join(__dirname, '../../web/dist')`. At runtime `__dirname` = `/app/packages/server/dist`. Therefore `../../web/dist` resolves to `/app/packages/web/dist`. The COPY destinations in Stage 3 MUST reproduce this exact tree.

```dockerfile
# ── Stage 1: build web ──────────────────────────────────────────────────────
FROM node:22-alpine AS web-builder
WORKDIR /app

# Copy manifests first for layer-cache efficiency
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/web/package.json ./packages/web/

RUN corepack enable && pnpm install --frozen-lockfile --filter @serverdeck/web

# Copy source after deps so source changes don't invalidate the install layer
COPY packages/web ./packages/web

# VITE_* vars are BUILD-TIME only — must be ARGs passed via docker-compose build.args
ARG VITE_BASE=/
ARG VITE_API_BASE=
ENV VITE_BASE=$VITE_BASE
ENV VITE_API_BASE=$VITE_API_BASE

RUN pnpm --filter @serverdeck/web build
# Output: /app/packages/web/dist/

# ── Stage 2: build server ────────────────────────────────────────────────────
FROM node:22-alpine AS server-builder
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json ./packages/server/

RUN corepack enable && pnpm install --frozen-lockfile --filter @serverdeck/server

COPY packages/server ./packages/server

RUN pnpm --filter @serverdeck/server build
# Output: /app/packages/server/dist/

# ── Stage 3: minimal runtime ─────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Install production deps only (no devDependencies)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json ./packages/server/

RUN corepack enable && pnpm install --frozen-lockfile --filter @serverdeck/server --prod

# Preserve the relative path packages/server/dist/../../web/dist = packages/web/dist
COPY --from=server-builder /app/packages/server/dist ./packages/server/dist
COPY --from=web-builder    /app/packages/web/dist    ./packages/web/dist

EXPOSE 3001

CMD ["node", "packages/server/dist/index.js"]
```

---

**File 2 — `.dockerignore`**

Keeps the build context small by excluding files that must not be copied into any build stage. Note: `packages/web/dist` and `packages/server/dist` are excluded from the context because each stage rebuilds them from source; if they were present they would only bloat context size.

```
# Dependencies — never copy host node_modules into the image
node_modules
packages/*/node_modules

# Build outputs — each Dockerfile stage rebuilds from source
packages/*/dist

# Version control and planning artefacts
.git
.gitignore
.planning

# Local env files — secrets must NOT enter the image layer
.env
.env.local
.env.*.local

# Editor and OS noise
.DS_Store
*.log
```

---

**File 3 — `docker-compose.yml`**

Key security rule: `JWT_SECRET` has NO default (no `:-` fallback). Docker Compose will print
"variable JWT_SECRET is not set" and refuse to start if it is unset, providing fast failure
rather than a silent empty-secret vulnerability (per threat T-07-01).

`VITE_*` vars are build ARGs (baked into the JS bundle at `docker-compose build` time), NOT
runtime `environment:` entries. Passing them under `environment:` would have no effect on
the already-built JS bundle.

`PORT` in `environment:` is always `3001` (the container's internal port). The host-side
port mapping (`${PORT:-3001}:3001`) lets the operator remap the host port without changing
the container's listen port.

```yaml
services:
  app:
    build:
      context: .
      args:
        VITE_BASE: ${VITE_BASE:-/}
        VITE_API_BASE: ${VITE_API_BASE:-}
    ports:
      - "${PORT:-3001}:3001"
    environment:
      NODE_ENV: production
      PORT: 3001
      JWT_SECRET: ${JWT_SECRET}
      SESSION_MAX_AGE_HOURS: ${SESSION_MAX_AGE_HOURS:-24}
      LOG_LEVEL: ${LOG_LEVEL:-info}
    restart: unless-stopped
```

---

**File 4 — `.env.example`**

This file is committed to the repo (not git-ignored). Users copy it to `.env` and fill in secrets.

```bash
# ── Runtime env vars (server reads these at startup) ─────────────────────────

# REQUIRED: JWT signing secret. Must be ≥32 characters. Server exits immediately if absent.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=

# Port the container exposes on the host. Container always listens internally on 3001.
PORT=3001

# Session lifetime in hours (default: 24)
SESSION_MAX_AGE_HOURS=24

# Fastify log level: trace | debug | info | warn | error | fatal (default: info)
LOG_LEVEL=info

# ── Build-time vars (Vite bakes these into the JS bundle — rebuild image to change) ──

# API base URL for axios. Leave empty for same-origin prod requests (server serves SPA
# and API together). Set to a full origin+path for cross-origin access, e.g.:
#   VITE_API_BASE=http://192.168.1.10:3001
# Note: if set, all axios calls go to that origin with NO /api prefix added automatically.
# The value is baked into the image at `docker-compose build` time via a Docker ARG.
VITE_API_BASE=

# Vite base path. Defaults to /. Change only if hosting the app at a sub-path, e.g.:
#   VITE_BASE=/serverdeck/
# This also controls the PWA manifest start_url and scope.
# The value is baked into the image at `docker-compose build` time via a Docker ARG.
VITE_BASE=/
```
  </action>
  <verify>
    <automated>
# Verify all four files exist at repo root
test -f Dockerfile &amp;&amp; test -f .dockerignore &amp;&amp; test -f docker-compose.yml &amp;&amp; test -f .env.example &amp;&amp; echo "All four files present"

# Verify Dockerfile has all three stage markers
grep -c "AS web-builder\|AS server-builder\|FROM node:22-alpine$" Dockerfile

# Verify JWT_SECRET has no fallback (must be exactly ${JWT_SECRET} with no :-)
grep "JWT_SECRET" docker-compose.yml | grep -v ":-" | grep -v "^#"

# Verify VITE_* vars appear only under build.args (not under environment:)
grep -A 20 "environment:" docker-compose.yml | grep -v "VITE_"
    </automated>
  </verify>
  <done>
    - `Dockerfile` exists with three stages: `web-builder`, `server-builder`, and a runtime stage using `node:22-alpine`
    - Stage 3 COPY destinations are `./packages/server/dist` and `./packages/web/dist` (preserving the `../../web/dist` relative path)
    - `.dockerignore` excludes `node_modules`, `packages/*/dist`, `.git`, `.env`
    - `docker-compose.yml` `JWT_SECRET: ${JWT_SECRET}` has no `:-` fallback
    - `VITE_BASE` and `VITE_API_BASE` appear under `build.args` only, not under `environment:`
    - `.env.example` documents JWT_SECRET, PORT, SESSION_MAX_AGE_HOURS, LOG_LEVEL, VITE_API_BASE, VITE_BASE with comments
  </done>
</task>

<!-- ═══════════════════════════════════════════════════════════════════════════
     WAVE 3 — Smoke test: build the image and verify the running container
     ═══════════════════════════════════════════════════════════════════════════ -->

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3 (Wave 3): Docker build and container smoke test</name>
  <what-built>
    Wave 1 patched axios.ts and vite.config.ts. Wave 2 created Dockerfile, .dockerignore,
    docker-compose.yml, and .env.example. This checkpoint verifies the full stack builds
    and runs correctly inside Docker.
  </what-built>
  <how-to-verify>
    Before starting: ensure Docker Desktop (or Docker Engine) is running on your machine.

    **Step 1 — Copy .env.example and fill in JWT_SECRET:**
    ```bash
    cp .env.example .env
    # Edit .env and set JWT_SECRET to a 32+ character random string, e.g.:
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    echo "JWT_SECRET=$JWT_SECRET" >> .env
    ```

    **Step 2 — Build the image (no-cache to exercise all stages):**
    ```bash
    docker compose build --no-cache
    ```
    Expected: build completes without errors. You should see three stage outputs:
    `[web-builder]`, `[server-builder]`, and the final runtime stage.

    **Step 3 — Start the container:**
    ```bash
    docker compose up -d
    ```
    Expected: container starts, no immediate exits.

    **Step 4 — Verify the API health endpoint:**
    ```bash
    curl -sf http://localhost:3001/health
    ```
    Expected output: `{"ok":true}`

    **Step 5 — Verify the SPA is served at `/`:**
    ```bash
    curl -sI http://localhost:3001/ | head -3
    ```
    Expected: `HTTP/1.1 200 OK` and `content-type: text/html`

    **Step 6 — Verify a protected API route returns 401 (not 404, not 500):**
    ```bash
    curl -sf http://localhost:3001/api/containers || echo "exit $?"
    ```
    Expected: HTTP 401 (unauthenticated access correctly rejected).

    **Step 7 — Verify fail-fast on missing JWT_SECRET:**
    ```bash
    JWT_SECRET= docker compose up 2>&1 | head -10
    ```
    Expected: compose either refuses to start (variable not set error) or the server process
    exits immediately with `FATAL: JWT_SECRET must be set`.

    **Step 8 — Tear down:**
    ```bash
    docker compose down
    ```

    **Optional — test VITE_API_BASE build arg:**
    ```bash
    VITE_API_BASE=http://192.168.1.1:3001 docker compose build --no-cache
    docker compose up -d
    # Open http://localhost:3001 in browser, open DevTools → Network
    # All XHR/fetch requests should target http://192.168.1.1:3001 (not same-origin)
    docker compose down
    ```
  </how-to-verify>
  <resume-signal>
    Type "approved" if all six curl checks passed and the image built successfully.
    Describe any failures in detail so the executor can diagnose.
  </resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Host shell → docker-compose.yml | Operator-supplied env vars (JWT_SECRET, PORT) enter the container via compose environment block |
| Build context → Dockerfile | Source files and lockfile enter the image; secrets must not be in context |
| Container → host network | Container exposes port 3001; operator controls host-side port mapping |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation |
|-----------|----------|-----------|-------------|------------|
| T-07-01 | Tampering | `JWT_SECRET` in `docker-compose.yml` | mitigate | `JWT_SECRET: ${JWT_SECRET}` with **no** `:-` fallback; compose variable interpolation fails fast if unset, and `index.ts` startup guard (`process.exit(1)` if length < 32) provides a second layer |
| T-07-02 | Info Disclosure | `.env` file in build context | mitigate | `.dockerignore` excludes `.env`, `.env.local`, `.env.*.local`; secrets never enter an image layer |
| T-07-03 | Info Disclosure | `VITE_API_BASE` / `VITE_BASE` baked into JS bundle | accept | These are not secrets — they are public base URLs. Baking them into the bundle is the standard Vite pattern. No PII or credentials involved |
| T-07-04 | Elevation of Privilege | Docker socket | accept | Per RESEARCH.md finding 1: server communicates via ssh2 (not docker.sock); no socket mount needed; no privileged container |
| T-07-SC | Tampering | pnpm install in Dockerfile | mitigate | All stages use `--frozen-lockfile` (no spontaneous lockfile changes); no new runtime packages added to `package.json` in this phase — existing lockfile is authoritative |
</threat_model>

<verification>
After all three tasks complete, the following must all be true:

1. `grep "import.meta.env.VITE_API_BASE" packages/web/src/lib/axios.ts` — exits 0
2. `grep "VITE_BASE" packages/web/vite.config.ts | wc -l` — returns 3 (base:, start_url:, scope:)
3. `grep "AS web-builder" Dockerfile` — exits 0
4. `grep "AS server-builder" Dockerfile` — exits 0
5. `grep "node:22-alpine$" Dockerfile` — exits 0 (runtime stage uses 22-alpine with no alias)
6. `grep "JWT_SECRET" docker-compose.yml | grep -v ":-" | grep -v "^#"` — returns exactly one line (`JWT_SECRET: ${JWT_SECRET}`)
7. `grep "VITE_" docker-compose.yml` — all matches are under `build.args:`, none under `environment:`
8. `docker compose build --no-cache` exits 0 (with `JWT_SECRET` set)
9. `curl -sf http://localhost:3001/health` returns `{"ok":true}` after `docker compose up -d`
10. `curl -sI http://localhost:3001/` returns HTTP 200 with `content-type: text/html`
</verification>

<success_criteria>
- `docker-compose up` (with `JWT_SECRET` in `.env`) builds the image and starts ServerDeck; no manual steps beyond setting secrets (DEPLOY-01)
- The React SPA is served at `http://localhost:3001/` and the API at `http://localhost:3001/api/*`
- `VITE_API_BASE=http://host:3001 docker compose build` bakes the external origin into the axios base URL; unset `VITE_API_BASE` results in same-origin requests (DEPLOY-02)
- `VITE_BASE=/sub/ docker compose build` sets the Vite base path and PWA manifest `start_url`/`scope` to `/sub/`; unset defaults to `/` (DEPLOY-03)
- Starting compose without `JWT_SECRET` fails immediately — no silent insecure startup
</success_criteria>

<output>
Create `.planning/phases/07-docker-compose-deployment/07-01-SUMMARY.md` when done.
</output>
