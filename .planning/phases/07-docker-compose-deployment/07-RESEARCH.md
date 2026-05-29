# Phase 7: Docker Compose Deployment — Research

**Researched:** 2025-07-13  
**Domain:** Docker / pnpm monorepo containerization / Vite build-time env vars  
**Confidence:** HIGH

---

## Summary

Phase 7 ships the entire ServerDeck app as a single Docker image started by `docker-compose up`. The Fastify server already serves the built React SPA as static files from `@fastify/static` — so there is only **one container** needed, not a multi-container setup with a separate Nginx for the frontend. This is architecturally clean: same origin for API and SPA, no CORS config, no reverse proxy inside the compose file.

The main technical challenges are (a) Dockerizing the pnpm v9 monorepo efficiently with proper layer caching using `pnpm fetch`, (b) wiring `VITE_BASE` and `VITE_API_BASE` as Docker `ARG`s at build time (Vite bakes env vars; they cannot be injected at runtime without a separate mechanism), and (c) maintaining the relative directory structure that `@fastify/static` already expects (`packages/server/dist/` → `../../web/dist`).

**Critical discovery:** The server does **not** mount the Docker socket (`/var/run/docker.sock`). It uses SSH (`ssh2`) to run Docker commands on the host machine. Users enter their SSH credentials at login time, which are stored in an in-memory session store. This means no `docker.sock` volume is needed and the container runs without elevated Docker privileges.

**Primary recommendation:** Multi-stage Dockerfile using `pnpm fetch` for dependency caching, `pnpm --filter @serverdeck/server deploy --prod` for a clean production dep tree, and build-time ARGs for `VITE_BASE`/`VITE_API_BASE`. Single service in `docker-compose.yml`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Static SPA serving | API / Backend (Fastify) | — | `@fastify/static` already serves `packages/web/dist/`. No Nginx needed. |
| API routes (`/api/*`) | API / Backend (Fastify) | — | All business logic routes registered before static wildcard |
| WebSocket (logs, terminal, events) | API / Backend (Fastify) | — | `@fastify/websocket` handles upgrades in same Fastify process |
| SPA history-mode fallback | API / Backend (Fastify) | — | `setNotFoundHandler` serves `index.html` for non-API 404s |
| Frontend build | CDN / Static (Vite build stage) | — | Vite outputs `packages/web/dist/` consumed by Fastify at runtime |
| Environment configuration | API / Backend (env vars) | Build stage (ARG for VITE_*) | `PORT`, `JWT_SECRET`, `NODE_ENV` → runtime; `VITE_BASE`, `VITE_API_BASE` → build-time ARG |
| SSH-to-Docker-host | API / Backend | — | `docker-ssh.ts` via `ssh2`; no docker.sock required |

---

## Standard Stack

### Core (no new npm packages needed — this phase is infrastructure)

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| `node:20-alpine` | 20-alpine | Base Docker image | LTS Node.js; Alpine = minimal size (~5 MB vs ~900 MB Debian) |
| `corepack` (built-in) | built-in to Node 20 | pnpm version management in Docker | Respects `packageManager: "pnpm@9"` in root package.json |
| Docker Compose v2 | v2.39.2 (detected) | Orchestration | `docker compose` (no hyphen) is the modern CLI |
| pnpm `fetch` + `install --offline` | pnpm 9 | Layer-cached dep install | Separates dep download from source copy for cache reuse |
| `pnpm deploy` | pnpm 9 (experimental) | Production dep pruning | Creates self-contained pkg dir with only prod deps |

### No New npm Packages Required

This phase adds infrastructure files only (Dockerfile, docker-compose.yml, env changes). All runtime dependencies already exist in the project.

> **Package Legitimacy Audit:** Skipped — no new packages installed in this phase.

---

## Architecture Patterns

### System Architecture Diagram

```
docker-compose up
       │
       ▼
┌──────────────────────────────────────┐
│  Docker Container: serverdeck        │
│                                      │
│  ENTRYPOINT: node packages/server/   │
│             dist/index.js            │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │  Fastify 5 (port 3001 → 3001)  │ │
│  │                                 │ │
│  │  /api/*      → API routes       │ │
│  │  /api/ws/*   → WebSocket routes │ │
│  │  /health     → health check     │ │
│  │  /*          → @fastify/static  │ │
│  │              (packages/web/dist) │ │
│  │  404 non-api → index.html (SPA) │ │
│  └─────────────────────────────────┘ │
│                                      │
│  Build-time ARGs baked by Vite:      │
│    VITE_BASE    → base path          │
│    VITE_API_BASE → axios baseURL     │
└──────────────────────────────────────┘
       │
       │ SSH (user enters creds at login)
       ▼
   Host Docker daemon (via SSH)
   - docker ps, start, stop, logs, events
```

### Recommended Project Structure (new files)

```
/ (repo root)
├── Dockerfile                    # Multi-stage build
├── docker-compose.yml            # Single-service compose
├── .dockerignore                 # Exclude node_modules, dist, .git
├── .env.example                  # Updated with VITE_BASE, VITE_API_BASE
└── packages/
    ├── server/
    │   ├── src/server.ts         # No changes needed
    │   └── ...
    └── web/
        ├── vite.config.ts        # Add base: process.env.VITE_BASE ?? '/'
        └── src/lib/axios.ts      # Add VITE_API_BASE fallback
```

### Pattern 1: pnpm Monorepo Multi-Stage Dockerfile

**What:** Five stages: base → deps (pnpm fetch) → build-web → build-server → production  
**When to use:** Always for pnpm workspace projects — separates layer-cached dep download from source copy

```dockerfile
# Source: pnpm official Docker docs / ASSUMED (pnpm.io/docker)
# ── Stage 1: Base ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

# ── Stage 2: Fetch deps (cache layer — only invalidated by lockfile change) ───
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json    ./packages/web/
RUN corepack prepare pnpm@9 --activate \
    && pnpm fetch

# ── Stage 3: Build web (Vite SPA) ─────────────────────────────────────────────
FROM deps AS build-web
COPY packages/web ./packages/web
RUN pnpm install --frozen-lockfile --offline
ARG VITE_BASE=/
ARG VITE_API_BASE=
ENV VITE_BASE=$VITE_BASE
ENV VITE_API_BASE=$VITE_API_BASE
RUN pnpm --filter @serverdeck/web build

# ── Stage 4: Build server (TypeScript compile) ────────────────────────────────
FROM deps AS build-server
COPY packages/server ./packages/server
RUN pnpm install --frozen-lockfile --offline \
    && pnpm --filter @serverdeck/server build

# ── Stage 5: Production deploy ────────────────────────────────────────────────
FROM deps AS predeploy
# pnpm deploy needs the full workspace with node_modules present
COPY packages/server ./packages/server
COPY packages/web    ./packages/web
RUN pnpm install --frozen-lockfile --offline \
    && pnpm --filter @serverdeck/server deploy --prod /deploy/server

FROM node:20-alpine AS production
WORKDIR /app

# Recreate the directory structure that server.ts expects:
# __dirname = /app/packages/server/dist/
# path.join(__dirname, '../../web/dist') = /app/packages/web/dist/  ✓
COPY --from=predeploy     /deploy/server/node_modules ./packages/server/node_modules
COPY --from=predeploy     /deploy/server/package.json ./packages/server/package.json
COPY --from=build-server  /app/packages/server/dist   ./packages/server/dist
COPY --from=build-web     /app/packages/web/dist      ./packages/web/dist

ENV NODE_ENV=production
USER node
EXPOSE 3001
CMD ["node", "packages/server/dist/index.js"]
```

**Why `pnpm fetch` in stage 2:** Downloads all packages to the virtual store (`.pnpm/`) using only `pnpm-lock.yaml`. No source files needed. The layer is reused on every build unless the lockfile changes — even if source code changes. [ASSUMED based on pnpm docs; verify at pnpm.io/cli/fetch]

**Why `pnpm deploy`:** Creates `/deploy/server/` with only production dependencies — no devDependencies in the final image. Marked "experimental" in pnpm 9 CLI help but widely used and stable. [ASSUMED]

### Pattern 2: Build-Time VITE_BASE Injection

**What:** Pass `base` as `process.env.VITE_BASE` in `vite.config.ts`  
**When to use:** When deploying at a sub-path (e.g., `/serverdeck/`)

```typescript
// packages/web/vite.config.ts — modified
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',   // ← add this line
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      // ⚠️  PWA PITFALL: start_url and scope must match VITE_BASE
      manifest: {
        start_url: process.env.VITE_BASE ?? '/',   // ← must match base
        scope:     process.env.VITE_BASE ?? '/',   // ← must match base
        // ...rest unchanged
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  // ...rest unchanged
})
```

> **Note:** `process.env` is available in `vite.config.ts` at build time — it runs in Node.js context, not browser. No `import.meta.env` needed in the config file itself.

### Pattern 3: VITE_API_BASE in axios.ts

**What:** Conditionally set `baseURL` from build-time env var, fallback to same-origin `/api`  
**When to use:** When the frontend needs to talk to a separate API server (non-same-origin)

```typescript
// packages/web/src/lib/axios.ts — modified
import axios from 'axios'

export const api = axios.create({
  // DEPLOY-02: empty/unset → same-origin '/api' (prod Docker)
  //            full URL  → explicit base (dev with separate API server)
  baseURL: import.meta.env.VITE_API_BASE || '/api',
  withCredentials: true,
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
```

> **Why build-time is correct here:** In the prod Docker image, Fastify serves both API and SPA on the same origin — `VITE_API_BASE` should always be empty for prod. Runtime injection (window.__CONFIG__) adds latency and complexity with no benefit for this architecture. Build-time baking is the standard Vite approach. [ASSUMED — no runtime-injection pattern needed]

### Pattern 4: docker-compose.yml

```yaml
# docker-compose.yml (repo root)
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        # VITE_* are build-time ARGs — they bake into the frontend JS bundle.
        # Change these requires a rebuild (docker compose build).
        VITE_API_BASE: ${VITE_API_BASE:-}
        VITE_BASE: ${VITE_BASE:-/}
    ports:
      - "${PORT:-3001}:3001"
    environment:
      # Runtime env vars for the Fastify server process
      NODE_ENV: production
      PORT: 3001
      JWT_SECRET: ${JWT_SECRET}
      LOG_LEVEL: ${LOG_LEVEL:-info}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

> **No volumes** — the app is stateless. SSH credentials are held in-memory session store; a container restart requires users to log in again, which is intentional.  
> **No docker.sock mount** — the app connects to Docker via SSH, not via the Docker socket.

### Pattern 5: .dockerignore

```
node_modules
packages/*/node_modules
packages/*/dist
.git
.planning
*.md
.env*
!.env.example
```

### Anti-Patterns to Avoid

- **Runtime env subst for VITE vars:** Attempting to inject `VITE_API_BASE` at container startup via `sed`/`envsubst` on the built JS bundle is fragile (minified/hashed filenames), error-prone, and unnecessary for this single-origin architecture. Don't do it.
- **Separate Nginx container:** The Fastify server already handles static file serving via `@fastify/static`. Adding Nginx creates an extra hop, port management overhead, and no benefit for a single-user app.
- **Mounting source into container at runtime:** `volumes: - ./packages/web/dist:/app/packages/web/dist` defeats the purpose of the multi-stage build. Build artifacts belong in the image.
- **`RUN npm install` in production stage:** Always use the dep artifacts from the build stages. Running a fresh install in production bypasses the `--frozen-lockfile` guarantee.
- **Not setting `NODE_ENV=production`:** The auth route sets `cookie.secure` based on `NODE_ENV === 'production'`. Without this, cookies are insecure (`Secure: false`) even when running behind TLS.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SPA serving + API routing | Custom router or Nginx | `@fastify/static` (already in place) | Already implemented; `setNotFoundHandler` handles SPA fallback correctly |
| pnpm dep isolation for Docker | Custom `rsync`/`cp` scripts for node_modules | `pnpm --filter X deploy --prod` | Handles workspace protocol links, peer deps, prod-only filtering automatically |
| VITE var runtime injection | `sed` on minified JS files | Build-time `ARG`/`ENV` in Dockerfile | Vite's `import.meta.env` is a compile-time transform; post-build injection is unreliable |
| Layer caching for deps | Copy everything in one COPY | `pnpm fetch` (lockfile-only layer) | Separates dep download from code for cache reuse on every code-only rebuild |

**Key insight:** This phase is 90% configuration. The code changes needed (axios.ts, vite.config.ts) are 2-line additions. The complexity is in the Dockerfile layer ordering and pnpm workspace awareness.

---

## Current Codebase State (What Needs to Change)

### files/changes required

| File | Current State | Required Change | Why |
|------|---------------|-----------------|-----|
| `packages/web/src/lib/axios.ts` | `baseURL: '/api'` hardcoded | `baseURL: import.meta.env.VITE_API_BASE \|\| '/api'` | DEPLOY-02 |
| `packages/web/vite.config.ts` | No `base` config (defaults to `/`) | Add `base: process.env.VITE_BASE ?? '/'` + update PWA `start_url`/`scope` | DEPLOY-03 |
| `Dockerfile` | Does not exist | Create multi-stage Dockerfile (see Pattern 1) | DEPLOY-01 |
| `docker-compose.yml` | Does not exist | Create with build args + env vars (see Pattern 4) | DEPLOY-01 |
| `.dockerignore` | Does not exist | Create (see Pattern 5) | Build performance |
| `.env.example` (root or server) | Only has `PORT`, `JWT_SECRET`, `LOG_LEVEL` | Add `VITE_BASE=/`, `VITE_API_BASE=` with comments | Developer ergonomics |

### What Does NOT Need to Change

- `packages/server/src/server.ts` — static path `path.join(__dirname, '../../web/dist')` works correctly with the Docker directory structure in Pattern 1.
- `packages/server/src/index.ts` — already binds to `0.0.0.0`, reads `PORT` from env.
- Auth cookie — `secure: isSecure` already uses `NODE_ENV === 'production'` which will be set in docker-compose.

---

## Common Pitfalls

### Pitfall 1: pnpm Workspace node_modules Not Found in Docker

**What goes wrong:** Running `pnpm install` in Docker without copying the workspace manifests for ALL packages causes "workspace package not found" errors. With `shamefully-hoist=false` (active in this project), each package has its own `node_modules` and there's no global hoisting fallback.

**Why it happens:** pnpm needs `pnpm-workspace.yaml` and all `packages/*/package.json` files before it can resolve workspace dependencies. If only one package's manifest is copied, the workspace graph is incomplete.

**How to avoid:** Copy all workspace manifests before `pnpm fetch`:
```dockerfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json    ./packages/web/
```

**Warning signs:** `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` during Docker build.

### Pitfall 2: Static File Path Broken in Docker

**What goes wrong:** Server starts but all non-API routes return 404; frontend never loads.

**Why it happens:** `server.ts` resolves `@fastify/static` root as `path.join(__dirname, '../../web/dist')`. If the production image's directory structure doesn't preserve the relative layout (`packages/server/dist/` alongside `packages/web/dist/`), the path resolves to a non-existent directory. The `@fastify/static` plugin silently succeeds but serves nothing.

**How to avoid:** In the production stage, always copy web dist to `./packages/web/dist` and server dist to `./packages/server/dist` relative to `WORKDIR /app`.

**Warning signs:** Server starts, `/health` returns `{"ok":true}`, but `GET /` returns 404 instead of HTML.

### Pitfall 3: VITE_BASE Not Wired Through PWA Manifest

**What goes wrong:** App works at sub-path (`/serverdeck/`) but PWA install fails; service worker intercepts incorrect routes; `navigateFallback` doesn't trigger.

**Why it happens:** `VitePWA` manifest `start_url` and `scope` are hardcoded to `'/'` in the current config. When `base` is `/serverdeck/`, the PWA manifest must also specify `start_url: '/serverdeck/'` and `scope: '/serverdeck/'`.

**How to avoid:** Parameterize both:
```typescript
VitePWA({
  manifest: {
    start_url: process.env.VITE_BASE ?? '/',
    scope:     process.env.VITE_BASE ?? '/',
```

**Warning signs:** PWA installs but opens to `404`; or browser console shows service worker scope mismatch.

### Pitfall 4: `VITE_*` Vars Not Passed as ARG (only as ENV)

**What goes wrong:** `VITE_API_BASE` and `VITE_BASE` are set in docker-compose `environment:` but not in `build.args:`. They're present at runtime but absent during `vite build`, so `import.meta.env.VITE_API_BASE` is `undefined` in the browser.

**Why it happens:** Docker `environment:` sets variables for the running container. Docker `build.args:` (mapped to Dockerfile `ARG`) sets them during the build step. Vite runs at build time — it needs ARGs, not ENV.

**How to avoid:** Always declare Vite vars in **both** places in docker-compose:
```yaml
build:
  args:
    VITE_API_BASE: ${VITE_API_BASE:-}   # ← for vite build
    VITE_BASE: ${VITE_BASE:-/}
# environment: only has server-side vars (NODE_ENV, PORT, JWT_SECRET, etc.)
```

**Warning signs:** App builds without error but axios uses `undefined` as baseURL; network requests go to `undefinedAPI/containers`.

### Pitfall 5: `corepack prepare` Needs Network in Build Stage

**What goes wrong:** `corepack prepare pnpm@9 --activate` fails if the Docker build is run in an air-gapped/CI environment without network access.

**Why it happens:** `corepack prepare` downloads the specified package manager from the internet if not cached.

**How to avoid:** Use `RUN npm install -g pnpm@9` as fallback, or pre-cache corepack in a separate layer. Alternatively, use the `--offline` flag with a pre-downloaded pnpm binary. For most users, `corepack prepare` works fine.

**Warning signs:** `ECONNREFUSED` or `ENOTFOUND` during `RUN corepack prepare`.

### Pitfall 6: `pnpm deploy` Is Marked "Experimental"

**What goes wrong:** In future pnpm versions, `pnpm deploy` behavior might change.

**Why it happens:** The command is marked experimental in the pnpm 9 CLI help output.

**How to avoid:** If `pnpm deploy` causes issues, fallback strategy: in the production stage, copy server `node_modules` from the build stage and run `pnpm prune --prod` (or just accept the extra devDep size). Alternatively:
```dockerfile
COPY --from=build-server /app/packages/server/node_modules ./packages/server/node_modules
# devDeps will be present but unused; ~30-50 MB extra in image
```

---

## Code Examples

### Complete Dockerfile

```dockerfile
# Source: [ASSUMED] — synthesized from pnpm Docker docs and project structure

# ── Stage 1: Base ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable

# ── Stage 2: Fetch (lockfile-only cache layer) ────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json    ./packages/web/
RUN corepack prepare pnpm@9 --activate \
    && pnpm fetch

# ── Stage 3: Build Vite SPA ───────────────────────────────────────────────────
FROM deps AS build-web
COPY packages/web ./packages/web
RUN pnpm install --frozen-lockfile --offline
ARG VITE_BASE=/
ARG VITE_API_BASE=
ENV VITE_BASE=$VITE_BASE
ENV VITE_API_BASE=$VITE_API_BASE
RUN pnpm --filter @serverdeck/web build

# ── Stage 4: Compile TypeScript server ───────────────────────────────────────
FROM deps AS build-server
COPY packages/server ./packages/server
RUN pnpm install --frozen-lockfile --offline \
    && pnpm --filter @serverdeck/server build

# ── Stage 5: Production deploy prune ─────────────────────────────────────────
FROM deps AS predeploy
COPY packages/server ./packages/server
COPY packages/web    ./packages/web
RUN pnpm install --frozen-lockfile --offline \
    && pnpm --filter @serverdeck/server deploy --prod /deploy/server

# ── Stage 6: Final production image ──────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Recreate structure expected by server.ts static path:
#   __dirname         = /app/packages/server/dist/
#   ../../web/dist    = /app/packages/web/dist/  ✓
COPY --from=predeploy    /deploy/server/node_modules ./packages/server/node_modules
COPY --from=predeploy    /deploy/server/package.json ./packages/server/package.json
COPY --from=build-server /app/packages/server/dist   ./packages/server/dist
COPY --from=build-web    /app/packages/web/dist      ./packages/web/dist

ENV NODE_ENV=production
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "packages/server/dist/index.js"]
```

### docker-compose.yml

```yaml
# Source: [ASSUMED] — based on Docker Compose v2 spec

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        # These bake into the Vite bundle at build time.
        # Rebuilding is required to change them.
        VITE_API_BASE: ${VITE_API_BASE:-}
        VITE_BASE: ${VITE_BASE:-/}
    ports:
      - "${PORT:-3001}:3001"
    environment:
      # Server runtime config
      NODE_ENV: production
      PORT: 3001
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}
      LOG_LEVEL: ${LOG_LEVEL:-info}
    restart: unless-stopped
    # No volumes needed — app is stateless.
    # SSH credentials are in-memory; docker.sock is NOT needed.
```

### .dockerignore

```
# Source: [ASSUMED]
node_modules
packages/*/node_modules
packages/*/dist
.git
.planning
*.log
.env
.env.local
```

### Updated vite.config.ts (VITE_BASE only — minimal change)

```typescript
// Source: [ASSUMED] — Vite docs on base config + process.env in config files
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',    // ← ADDED for DEPLOY-03
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
        start_url: process.env.VITE_BASE ?? '/',   // ← UPDATED (was hardcoded '/')
        scope:     process.env.VITE_BASE ?? '/',   // ← UPDATED (was hardcoded '/')
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

### Updated axios.ts (VITE_API_BASE — one-line change)

```typescript
// Source: current codebase + DEPLOY-02 requirement
import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',  // ← CHANGED (was hardcoded '/api')
  withCredentials: true,
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `docker-compose` (v1, Python) | `docker compose` (v2, Go, built-in) | 2022 | No hyphen; comes with Docker Desktop; v1 EOL 2023 |
| `npm install` in Dockerfile | `pnpm fetch` + `pnpm install --offline` | ~2022 | Separates network layer from build layer for cache |
| Copying all node_modules to prod | `pnpm deploy --prod` or `npm prune --prod` | ~2023 | Smaller final image (no devDeps) |
| Hard-coded Vite `base: '/'` | `base: process.env.VITE_BASE ?? '/'` | pnpm v3+ / Vite v3+ | Runtime-configurable sub-path deployment |

**Deprecated/outdated:**
- `docker-compose` (v1 hyphenated): EOL — use `docker compose` v2
- `RUN npm install` in production Dockerfiles: replaced by copy-from-build-stage pattern
- `COPY . .` before `pnpm install`: defeats layer caching — copy lockfile first, install, then copy source

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pnpm fetch` downloads to virtual store without node_modules, enabling lockfile-only cache layer | Pattern 1, Pitfall 1 | Would need fallback: `COPY . . && pnpm install --frozen-lockfile` |
| A2 | `pnpm --filter X deploy --prod` creates a self-contained directory suitable for production | Pattern 1 (predeploy stage) | Would need to copy node_modules directly + run `pnpm prune --prod` |
| A3 | `corepack prepare pnpm@9 --activate` works without network access in most CI environments | Pitfall 5 | Fallback: `RUN npm install -g pnpm@9` |
| A4 | `process.env.VITE_BASE` is readable in `vite.config.ts` (Node.js context, not browser) | Pattern 2 | No risk — Vite config always runs in Node.js, `process.env` is always available |
| A5 | `VitePWA` `manifest.start_url` accepts `process.env.*` at config time | Pattern 2, Pitfall 3 | Would need `loadEnv()` call in vite.config.ts |

---

## Open Questions

1. **Sub-path deployment and @fastify/static prefix**
   - What we know: `@fastify/static` is registered with `prefix: '/'`
   - What's unclear: If `VITE_BASE` is `/serverdeck/`, static assets (icons, etc.) are served at `/serverdeck/icon-180.png` by Vite. But `@fastify/static` serves them at `/icon-180.png`. The Fastify static prefix may need to match `VITE_BASE`.
   - Recommendation: For Phase 7 scope, `VITE_BASE` defaults to `/` — sub-path is an edge case. Document that changing `VITE_BASE` to a non-root path also requires changing `@fastify/static`'s `prefix` option in `server.ts`. If sub-path is a firm requirement, scope this into the plan.

2. **pnpm deploy and ESM package.json `"type": "module"`**
   - What we know: `packages/server/package.json` has `"type": "module"`. `pnpm deploy` copies `package.json` to the deploy dir.
   - What's unclear: Whether pnpm deploy preserves the `node_modules/.pnpm` symlink structure needed by ESM imports.
   - Recommendation: Test the production container manually after first build: `docker compose run app node packages/server/dist/index.js`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Building + running the container | ✓ | 28.4.0 | — |
| Docker Compose v2 | `docker compose up` | ✓ | v2.39.2 | — |
| pnpm | Build stage in Dockerfile (via corepack) | ✓ | 9.15.9 | `npm install -g pnpm@9` |
| Node.js 20 LTS | Production base image | ✓ (host: v24.8.0) | 20.x in image | — |
| corepack | pnpm version pinning in Docker | ✓ (built into Node 20) | — | `npm install -g pnpm@9` |

**Missing dependencies with no fallback:** None.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Manual smoke testing (no automated test infra found for this phase) |
| Config file | n/a |
| Quick run command | `docker compose build && docker compose up -d && curl -f http://localhost:3001/health` |
| Full suite command | `docker compose up -d && curl http://localhost:3001/ \| grep -q "ServerDeck"` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEPLOY-01 | `docker compose up` starts the app | smoke | `docker compose up -d && sleep 3 && curl -sf http://localhost:3001/health` | ❌ Wave 0 |
| DEPLOY-01 | Frontend is served at `/` | smoke | `curl -sf http://localhost:3001/ \| grep -q 'ServerDeck'` | ❌ Wave 0 |
| DEPLOY-02 | Empty `VITE_API_BASE` → axios uses `/api` | build-time verify | `docker compose build; grep -r "VITE_API_BASE" packages/web/dist/ \| wc -l` | ❌ Wave 0 |
| DEPLOY-03 | `VITE_BASE` controls Vite base path | smoke | `VITE_BASE=/test/ docker compose build && curl http://localhost:3001/test/` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `docker compose build --no-cache` (build test)
- **Per wave merge:** Full smoke test sequence above
- **Phase gate:** All smoke tests green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `Dockerfile` — does not exist yet (Wave 0 creates it)
- [ ] `docker-compose.yml` — does not exist yet (Wave 0 creates it)
- [ ] `.dockerignore` — does not exist yet (Wave 0 creates it)

---

## Security Domain

Security enforcement is enabled (`security_enforcement: true`, ASVS Level 1).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No (existing, unchanged) | — |
| V3 Session Management | No (existing) | — |
| V4 Access Control | No (existing) | — |
| V5 Input Validation | No (no new inputs) | — |
| V6 Cryptography | No | — |
| V14 Configuration | **Yes** | Secrets via env var, not baked into image |

### V14 — Configuration Security

| Pattern | Risk | Mitigation |
|---------|------|------------|
| `JWT_SECRET` in docker-compose.yml | Secrets in compose file committed to git | Use `${JWT_SECRET:?...}` interpolation; never hardcode; `.env` in `.gitignore` |
| VITE vars baked into JS bundle | `VITE_API_BASE` visible in browser JS | Acceptable — it's a URL (not a secret); `VITE_*` vars are always public |
| `NODE_ENV=production` | Cookie `secure` flag depends on it | Set in `environment:` — auth route sets `secure: true` only in production |
| Running as root in container | Container escape risk | `USER node` in Dockerfile's production stage |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret in Docker image layer | Information disclosure | `JWT_SECRET` passed via `environment:` at runtime, never in `ARG`/`ENV` in Dockerfile |
| Container running as root | Privilege escalation | `USER node` in production stage |
| Sensitive env in build args | Build-time ARGs visible in `docker history` | Only `VITE_*` (non-secret) are ARGs; `JWT_SECRET` is runtime-only |

> **Note:** `JWT_SECRET` must NEVER be a Docker `ARG` or `ENV` in the Dockerfile — `docker history` exposes ARG values. Always pass it via `docker-compose.yml` `environment:` using `${JWT_SECRET}` interpolation from a `.env` file that is gitignored. [ASSUMED — standard Docker security practice]

---

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** — `packages/server/src/server.ts`, `packages/web/vite.config.ts`, `packages/web/src/lib/axios.ts`, `packages/server/src/index.ts`, `packages/server/src/routes/auth.ts` — direct code inspection
- **pnpm CLI** — `pnpm deploy --help` output (v9.15.9 confirmed locally)
- **Docker CLI** — `docker --version`, `docker compose version` (confirmed locally)
- **Vite docs** — [ASSUMED: vitejs.dev/guide/build#public-base-path] — `base` config, `process.env` in vite.config.ts

### Secondary (MEDIUM confidence)
- **pnpm Docker documentation** — [ASSUMED: pnpm.io/docker] — `pnpm fetch` pattern for layer caching
- **Docker best practices** — `USER node`, `.dockerignore`, multi-stage build pattern [ASSUMED: docs.docker.com/build/building/best-practices]

### Tertiary (LOW confidence)
- `pnpm deploy` stability in production — marked "experimental" in CLI; widely used in practice [ASSUMED]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; existing Fastify/Vite/pnpm stack confirmed via codebase
- Architecture: HIGH — single-container approach confirmed by codebase (no docker.sock, static via Fastify)
- Dockerfile patterns: MEDIUM — pnpm fetch/deploy pattern is ASSUMED (not verified against official docs in this session)
- Pitfalls: HIGH — static path issue verified by reading server.ts; PWA pitfall verified by reading vite.config.ts; NODE_ENV pitfall verified by reading auth.ts

**Research date:** 2025-07-13  
**Valid until:** 2025-10-01 (pnpm deploy is experimental; check pnpm changelog if issues arise)
