# Phase 7: Docker Compose Deployment — Pattern Map

**Mapped:** 2025-01-27
**Files analyzed:** 4 (2 new, 2 modified)
**Analogs found:** 4 / 4

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `Dockerfile` (new) | config | file-I/O / build | `packages/server/tsconfig.json` + `package.json` scripts | partial — build pipeline shape |
| `docker-compose.yml` (new) | config | request-response | `packages/server/.env.example` | partial — env var declarations |
| `packages/web/src/lib/axios.ts` (modify) | utility | request-response | same file (current state) | exact — modify in place |
| `packages/web/vite.config.ts` (modify) | config | build / transform | same file (current state) | exact — modify in place |

---

## Pattern Assignments

### `Dockerfile` (new — multi-stage build)

**No existing Dockerfile in the repo.** Use patterns extracted from the existing build tooling below.

**Stage 1 — build web** relies on these facts:

*Monorepo root `package.json` (lines 1–13):*
```json
{
  "name": "serverdeck",
  "packageManager": "pnpm@9",
  "scripts": {
    "build": "pnpm --filter @serverdeck/server build && pnpm --filter @serverdeck/web build"
  }
}
```
- Package manager is **pnpm@9** — the Dockerfile must `npm install -g pnpm` (or use `corepack enable`) before running installs.
- Workspace config is `pnpm-workspace.yaml` with `packages: ["packages/*"]` — Docker `COPY` must include both `packages/web` and root manifest files.
- Web build command: `pnpm --filter @serverdeck/web build` → outputs to `packages/web/dist/`.

*`packages/web/package.json` build script (line 8):*
```json
"build": "tsc -b && vite build"
```
- Requires TypeScript compilation first, then Vite. Both run via the single `build` script.
- Accepts `VITE_*` env vars at build time (Vite bakes them into the bundle).

**Stage 2 — run server** relies on these facts:

*`packages/server/package.json` (lines 6–9):*
```json
"scripts": {
  "dev": "tsx watch src/index.ts",
  "build": "tsc",
  "start": "node dist/index.js"
}
```
- Production entrypoint: `node dist/index.js` — no `tsx` needed at runtime.
- TypeScript `outDir` is `dist/` (see `tsconfig.json` line 9).

*`packages/server/tsconfig.json` (lines 2–12):*
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "outDir": "dist",
    "rootDir": "src"
  }
}
```
- Server compiles to `packages/server/dist/` — copy that into the final image.

*`packages/server/src/server.ts` — static file path resolution (lines 14–15, 54–58):*
```typescript
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

await fastify.register(fastifyStatic, {
  root: path.join(__dirname, '../../web/dist'),
  prefix: '/',
  wildcard: false,
})
```
- **Critical for Docker:** `__dirname` resolves relative to the compiled `dist/server.js` file.
- The path `../../web/dist` walks up from `packages/server/dist/` → `packages/server/` → `packages/` → then into `web/dist`.
- In the Docker image the directory tree **must mirror** this structure, or this path will break.
- Recommended Docker WORKDIR layout: `/app/packages/server/dist/` and `/app/packages/web/dist/` so the relative path `../../web/dist` stays valid without code changes.

*`packages/server/src/index.ts` — startup / env validation (lines 1–19):*
```typescript
import 'dotenv/config'
import { buildServer } from './server.js'

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and at least 32 characters.')
  process.exit(1)
}

const port = Number(process.env.PORT ?? 3001)
await fastify.listen({ port, host: '0.0.0.0' })
```
- **Required env vars at runtime:** `JWT_SECRET` (≥32 chars, fatal if missing), `PORT` (default 3001).
- Server already binds to `0.0.0.0` — no change needed for container networking.
- `dotenv/config` loads `.env` automatically; in Docker, supply vars via `docker-compose.yml` `environment:` instead.

**Dockerfile skeleton pattern to follow:**
```dockerfile
# ── Stage 1: build web ──────────────────────────────────────
FROM node:20-alpine AS web-builder
WORKDIR /app

# Copy manifests first (layer-cache-friendly)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/web/package.json ./packages/web/

RUN corepack enable && pnpm install --frozen-lockfile --filter @serverdeck/web

COPY packages/web ./packages/web

# VITE_API_BASE baked in at build time
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=$VITE_API_BASE
RUN pnpm --filter @serverdeck/web build
# Output: /app/packages/web/dist/

# ── Stage 2: build server ────────────────────────────────────
FROM node:20-alpine AS server-builder
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json ./packages/server/

RUN corepack enable && pnpm install --frozen-lockfile --filter @serverdeck/server

COPY packages/server ./packages/server
RUN pnpm --filter @serverdeck/server build
# Output: /app/packages/server/dist/

# ── Stage 3: runtime ─────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json ./packages/server/

RUN corepack enable && pnpm install --frozen-lockfile --filter @serverdeck/server --prod

# Preserve relative path: packages/server/dist → ../../web/dist
COPY --from=server-builder /app/packages/server/dist ./packages/server/dist
COPY --from=web-builder    /app/packages/web/dist    ./packages/web/dist

EXPOSE 3001
CMD ["node", "packages/server/dist/index.js"]
```

---

### `docker-compose.yml` (new)

**No existing compose file in repo.** Pattern derived from `packages/server/.env.example`.

*`packages/server/.env.example` (all lines):*
```
PORT=3001
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=replace-with-a-random-32-plus-character-string
LOG_LEVEL=info
```
- These are the **exact env var names** the server reads via `dotenv/config` and `process.env.*`.
- `docker-compose.yml` must pass all three as `environment:` keys.
- `JWT_SECRET` must be ≥32 chars (enforced in `index.ts`).
- Docker socket `/var/run/docker.sock` must be mounted for `dockerode` to reach the Docker Engine.

**docker-compose.yml skeleton pattern:**
```yaml
services:
  serverdeck:
    build: .
    ports:
      - "3001:3001"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      PORT: "3001"
      JWT_SECRET: "${JWT_SECRET}"   # from host .env or shell
      LOG_LEVEL: "info"
    restart: unless-stopped
```

---

### `packages/web/src/lib/axios.ts` (modify — add `VITE_API_BASE`)

**Analog:** same file, current state.

*Current full file (lines 1–18):*
```typescript
import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
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

**Change required — line 4 only:**
```typescript
// Before:
baseURL: '/api',

// After:
baseURL: import.meta.env.VITE_API_BASE ?? '/api',
```
- `import.meta.env.VITE_API_BASE` is the Vite convention for build-time env vars (must be prefixed `VITE_`).
- Fallback `?? '/api'` preserves current dev-server behaviour (proxy rewrites `/api` to `localhost:3001`).
- All interceptor logic and `withCredentials` remain unchanged.

---

### `packages/web/vite.config.ts` (modify — add `base` option)

**Analog:** same file, current state.

*Current full file (lines 1–49):*
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({ /* ... manifest, workbox ... */ }),
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

**Change required — add `base` at the top of the config object:**
```typescript
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',   // add this line
  plugins: [ /* unchanged */ ],
  resolve: { /* unchanged */ },
  server: { /* unchanged */ },
})
```
- `process.env.VITE_BASE` is read by Node.js at build time (not by the browser), so no `VITE_` prefix restriction applies here.
- Fallback `?? '/'` keeps default behaviour when the env var is absent (local dev and most deployments).
- `vite.config.ts` already uses `import path from 'path'` and `__dirname` — no new imports needed.

---

## Shared Patterns

### Env Var Convention
**Source:** `packages/server/.env.example` + `packages/server/src/index.ts`
**Apply to:** `docker-compose.yml`, `Dockerfile` (ARG/ENV blocks)
```
# Runtime vars (server reads via process.env)
PORT=3001
JWT_SECRET=<32+ char random hex>
LOG_LEVEL=info

# Build-time vars (Vite bakes into JS bundle)
VITE_API_BASE=/api   # or https://your-server:3001/api for external access
VITE_BASE=/           # base path for asset URLs
```

### Path Resolution for Static Files
**Source:** `packages/server/src/server.ts` lines 14–15, 54–58
**Apply to:** `Dockerfile` COPY layout decisions
```typescript
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

root: path.join(__dirname, '../../web/dist')
// resolved at runtime as: {cwd}/packages/server/dist/../../web/dist
//                       = {cwd}/packages/web/dist
```
The Docker image's working directory and COPY destinations must preserve this relative path.

### Server Startup / Host Binding
**Source:** `packages/server/src/index.ts` lines 11–15
**Apply to:** `Dockerfile` EXPOSE directive, `docker-compose.yml` ports mapping
```typescript
const port = Number(process.env.PORT ?? 3001)
await fastify.listen({ port, host: '0.0.0.0' })
```
Server already binds `0.0.0.0` — no code change needed. Map `PORT:PORT` in compose.

### pnpm Workspace Build Invocation
**Source:** root `package.json` lines 7–8
**Apply to:** `Dockerfile` RUN commands
```json
"build": "pnpm --filter @serverdeck/server build && pnpm --filter @serverdeck/web build"
```
Use `--filter` flag per stage; do NOT run the root `build` script in the image (it builds both packages, preventing layer caching of each stage separately).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `Dockerfile` | config | file-I/O / build | No existing Dockerfile in repo |
| `docker-compose.yml` | config | request-response | No existing compose file in repo |

Both are specified from scratch; planner should use the skeleton patterns above (derived from existing build scripts, `tsconfig.json` outDirs, and the `@fastify/static` path resolution).

---

## Metadata

**Analog search scope:** `/packages/server/src/`, `/packages/web/`, root manifests
**Files read:** `server.ts`, `index.ts`, `axios.ts`, `vite.config.ts`, `package.json` ×3, `tsconfig.json`, `.env`, `.env.example`, `pnpm-workspace.yaml`, `.gitignore`
**Docker files found:** 0 (none exist yet)
**Pattern extraction date:** 2025-01-27
