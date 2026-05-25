---
phase: 01-auth-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - pnpm-workspace.yaml
  - .npmrc
  - .gitignore
  - packages/server/package.json
  - packages/server/tsconfig.json
  - packages/server/src/index.ts
  - packages/server/src/server.ts
  - packages/web/package.json
  - packages/web/tsconfig.json
  - packages/web/tsconfig.node.json
  - packages/web/vite.config.ts
  - packages/web/index.html
  - packages/web/src/main.tsx
  - packages/web/src/App.tsx
  - packages/web/src/index.css
  - packages/web/components.json
  - packages/web/src/components/ui/button.tsx
  - packages/web/src/components/ui/card.tsx
  - packages/web/src/components/ui/input.tsx
  - packages/web/src/components/ui/label.tsx
autonomous: true
requirements:
  - AUTH-01
  - AUTH-06

must_haves:
  truths:
    - "pnpm dev at project root starts both Fastify (port 3001) and Vite (port 5173) with no errors"
    - "GET http://localhost:3001/health returns {\"ok\":true}"
    - "GET http://localhost:5173 serves the React app HTML without compile errors"
    - "shadcn/ui button, card, input, label components exist under packages/web/src/components/ui/"
    - "TypeScript compiles with no errors in both packages (tsc --noEmit)"
  artifacts:
    - path: "package.json"
      provides: "Monorepo root with pnpm workspaces + concurrently dev script"
      contains: "pnpm-workspace"
    - path: "packages/server/src/server.ts"
      provides: "Fastify 5 instance with /health route"
      exports: ["buildServer"]
    - path: "packages/web/vite.config.ts"
      provides: "Vite config with @tailwindcss/vite plugin"
      contains: "@tailwindcss/vite"
    - path: "packages/web/src/index.css"
      provides: "Tailwind v4 import + CSS custom properties for zinc dark theme"
      contains: "@import \"tailwindcss\""
    - path: "packages/web/src/App.tsx"
      provides: "React Router BrowserRouter with /login and / route stubs"
  key_links:
    - from: "package.json scripts.dev"
      to: "packages/server + packages/web"
      via: "concurrently + pnpm --filter"
      pattern: "concurrently"
    - from: "packages/web/src/main.tsx"
      to: "packages/web/src/App.tsx"
      via: "ReactDOM.createRoot render"
      pattern: "createRoot"
---

## Phase Goal

**As a** developer managing my own server, **I want to** have a working monorepo scaffold with both Fastify and React running end-to-end, **so that** the auth and dashboard implementation can be wired together in subsequent plans.

<objective>
Scaffold the complete ServerDeck monorepo: pnpm workspaces with packages/server (Fastify 5, TypeScript, tsx dev runner) and packages/web (React 19, Vite 8, Tailwind v4, shadcn/ui zinc dark). Both packages must start with a single `pnpm dev` from the project root.

Purpose: Establish the walking skeleton foundation — the structural container that all subsequent plans fill with auth logic and UI. Every architectural decision from SKELETON.md is locked in here (per D-01..D-22 architecture, STACK.md).

Output:
- Monorepo root with pnpm-workspace.yaml and concurrently dev script
- packages/server: Fastify 5 server with /health route, TypeScript strict mode, tsx watch
- packages/web: React 19 + Vite 8 + Tailwind v4 (@tailwindcss/vite) + shadcn/ui initialized (zinc dark) with button, card, input, label components added
- React Router v6 BrowserRouter with placeholder routes for /login and /
</objective>

<execution_context>
@~/.copilot/get-shit-done/workflows/execute-plan.md
@~/.copilot/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/01-auth-foundation/01-SKELETON.md
@.planning/research/STACK.md
@.planning/phases/01-auth-foundation/01-UI-SPEC.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Initialize monorepo root + packages/server scaffold</name>
  <files>
    package.json,
    pnpm-workspace.yaml,
    .npmrc,
    .gitignore,
    packages/server/package.json,
    packages/server/tsconfig.json,
    packages/server/src/index.ts,
    packages/server/src/server.ts
  </files>
  <read_first>
    - .planning/phases/01-auth-foundation/01-SKELETON.md — directory layout + stack decisions
    - .planning/research/STACK.md — exact package versions for Fastify, plugins, TypeScript tooling
  </read_first>
  <action>
    Create the monorepo root. All file paths are relative to the repository root.

    ROOT package.json: set `name` to `"serverdeck"`, `private: true`, `"packageManager": "pnpm@9"`. Add scripts: `"dev": "concurrently \"pnpm --filter @serverdeck/server dev\" \"pnpm --filter @serverdeck/web dev\""`, `"build": "pnpm --filter @serverdeck/server build && pnpm --filter @serverdeck/web build"`. Add devDependencies: `"concurrently": "^9.0.0"`.

    pnpm-workspace.yaml: single entry `packages: ["packages/*"]`.

    .npmrc: `shamefully-hoist=false` and `strict-peer-dependencies=false`.

    .gitignore: cover `node_modules/`, `dist/`, `.env`, `*.js.map`, `.DS_Store`, `packages/*/node_modules/`.

    packages/server/package.json: `name: "@serverdeck/server"`, `version: "0.1.0"`, `type: "module"`. Scripts: `"dev": "tsx watch src/index.ts"`, `"build": "tsc"`, `"start": "node dist/index.js"`. Dependencies: `"fastify": "^5.8.5"`, `"@fastify/jwt": "^10.1.0"`, `"@fastify/cookie": "^11.0.2"`, `"@fastify/rate-limit": "^10.2.0"`, `"@fastify/static": "^9.1.3"`, `"ssh2": "^1.17.0"`. DevDependencies: `"typescript": "^5.4.0"`, `"tsx": "^4.10.0"`, `"@types/node": "^20.0.0"`, `"@types/ssh2": "^1.15.0"`. Do NOT add @fastify/cors — Vite proxy handles cross-origin in dev; Fastify serves the React build in production.

    packages/server/tsconfig.json: `compilerOptions` — `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"strict": true`, `"esModuleInterop": true`, `"skipLibCheck": true`, `"outDir": "dist"`, `"rootDir": "src"`, `"declaration": true`. Include `["src/**/*"]`, exclude `["dist", "node_modules"]`.

    packages/server/src/index.ts: import `buildServer` from `./server.js` (ESM extension required). Call `buildServer()`, then call `fastify.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' })`. On error, log and `process.exit(1)`. On success, log `Server listening on http://localhost:${port}`.

    packages/server/src/server.ts: export async function `buildServer()`. Inside: `import Fastify from 'fastify'`. Create instance with `logger: { level: process.env.LOG_LEVEL ?? 'info' }`. Register a single route: `fastify.get('/health', async () => ({ ok: true }))`. Return the fastify instance. No auth, JWT, or SSH logic yet — those are added in Plan 2 by modifying this file.

    After creating all files, run `pnpm install` from the repository root to install dependencies.
  </action>
  <acceptance_criteria>
    - `packages/server/package.json` contains `"fastify": "^5.8.5"`
    - `packages/server/package.json` contains `"ssh2": "^1.17.0"`
    - `pnpm-workspace.yaml` exists and contains `packages: ["packages/*"]`
    - Running `pnpm --filter @serverdeck/server dev` starts the server without TypeScript errors
    - `curl http://localhost:3001/health` returns `{"ok":true}` with HTTP 200
    - `cd packages/server && npx tsc --noEmit` exits with code 0 (no type errors)
  </acceptance_criteria>
  <verify>
    <automated>cd packages/server && pnpm dev &amp; sleep 4 &amp;&amp; curl -sf http://localhost:3001/health | grep '"ok":true' &amp;&amp; kill %1</automated>
  </verify>
  <done>packages/server starts with tsx watch, /health returns {"ok":true}, no TypeScript errors</done>
</task>

<task type="auto">
  <name>Task 2: Scaffold packages/web — Vite + React + Tailwind v4 + shadcn/ui + React Router stubs</name>
  <files>
    packages/web/package.json,
    packages/web/tsconfig.json,
    packages/web/tsconfig.node.json,
    packages/web/vite.config.ts,
    packages/web/index.html,
    packages/web/src/main.tsx,
    packages/web/src/App.tsx,
    packages/web/src/index.css,
    packages/web/components.json,
    packages/web/src/components/ui/button.tsx,
    packages/web/src/components/ui/card.tsx,
    packages/web/src/components/ui/input.tsx,
    packages/web/src/components/ui/label.tsx
  </files>
  <read_first>
    - .planning/phases/01-auth-foundation/01-UI-SPEC.md — design system section: CSS variable values, Tailwind v4 @theme block, shadcn init preset (zinc dark), component inventory
    - .planning/research/STACK.md — frontend versions: React 19.2.6, Vite 8.0.14, Tailwind 4.3.0, Lucide React 1.16.0
  </read_first>
  <action>
    Create packages/web. All paths relative to packages/web/ unless noted.

    package.json: `name: "@serverdeck/web"`, `private: true`, `type: "module"`. Scripts: `"dev": "vite"`, `"build": "tsc -b && vite build"`, `"preview": "vite preview"`. Dependencies: `"react": "^19.2.6"`, `"react-dom": "^19.2.6"`, `"react-router-dom": "^6.23.0"`, `"axios": "^1.7.0"`, `"lucide-react": "^1.16.0"`. DevDependencies: `"@vitejs/plugin-react": "^4.3.0"`, `"vite": "^8.0.14"`, `"typescript": "^5.4.0"`, `"@types/react": "^19.0.0"`, `"@types/react-dom": "^19.0.0"`, `"tailwindcss": "^4.3.0"`, `"@tailwindcss/vite": "^4.3.0"`.

    tsconfig.json: `"target": "ES2020"`, `"useDefineForClassFields": true`, `"lib": ["ES2020","DOM","DOM.Iterable"]`, `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"strict": true`, `"noEmit": true`, `"jsx": "react-jsx"`, `"skipLibCheck": true`. Include `["src"]`, references `[{"path":"./tsconfig.node.json"}]`.

    tsconfig.node.json: `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "Bundler"`, `"allowSyntheticDefaultImports": true`. Include `["vite.config.ts"]`.

    vite.config.ts: import `defineConfig` from `"vite"`, import `react` from `"@vitejs/plugin-react"`, import `tailwindcss` from `"@tailwindcss/vite"`. Export `defineConfig({ plugins: [tailwindcss(), react()] })`. No /api proxy yet — that is added in Plan 3 (01-PLAN-frontend-auth.md).

    index.html: standard Vite HTML template, `<title>ServerDeck</title>`, `<div id="root"></div>`, script `src="/src/main.tsx"` with `type="module"`.

    src/main.tsx: import `React` and `ReactDOM from "react-dom/client"`. Import `App from "./App"`. Import `"./index.css"`. Call `ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)`.

    src/App.tsx: import `BrowserRouter`, `Routes`, `Route` from `"react-router-dom"`. Render a `BrowserRouter` containing `Routes` with two route stubs: `<Route path="/login" element={<div>Login placeholder</div>} />` and `<Route path="/" element={<div>Dashboard placeholder</div>} />`. These stubs are replaced entirely in Plan 3 (01-PLAN-frontend-auth.md).

    src/index.css: Must start with `@import "tailwindcss";`. Then add a `@layer base` block containing the `:root` CSS custom properties exactly as specified in the UI-SPEC "Design System — Color Tokens" section. The variables to define: `--background`, `--foreground`, `--card`, `--card-foreground`, `--border`, `--input`, `--muted`, `--muted-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--destructive-foreground`, `--ring`, `--radius`. Values are exact hex/HSL values from the UI-SPEC (zinc-950 background, blue-500 primary). Also add `body { background-color: hsl(var(--background)); color: hsl(var(--foreground)); font-family: system-ui, sans-serif; }`.

    Run shadcn/ui init: from inside `packages/web`, run `npx shadcn@latest init` with these non-interactive flags or by answering prompts: style=default, base color=zinc, CSS variables=yes, Tailwind config=yes (v4), framework=Vite. This generates `components.json` with `style: "default"`, `tailwind.config: ""` (empty — Tailwind v4 has no config file), `tailwind.cssVariables: true`, `tailwind.baseColor: "zinc"`. If the CLI requires interactive input, pass `--yes` or `--defaults` and then manually adjust `components.json` to set `"tailwind": {"config":"","css":"src/index.css","baseColor":"zinc","cssVariables":true}`.

    Add shadcn components by running from `packages/web`:
    - `npx shadcn@latest add button`
    - `npx shadcn@latest add card`
    - `npx shadcn@latest add input`
    - `npx shadcn@latest add label`

    These commands write files to `src/components/ui/`. Do not manually create these files — the shadcn CLI generates them with correct Tailwind v4 class names.

    After all files are created, run `pnpm install` from `packages/web` (or from the repo root with `pnpm install` to pick up the new workspace package).
  </action>
  <acceptance_criteria>
    - `packages/web/src/index.css` starts with `@import "tailwindcss";` and contains `--primary: 217 91% 60%` (blue-500)
    - `packages/web/components.json` exists and contains `"baseColor": "zinc"`
    - `packages/web/src/components/ui/button.tsx` exists (shadcn generated)
    - `packages/web/src/components/ui/card.tsx` exists (shadcn generated)
    - `packages/web/src/components/ui/input.tsx` exists (shadcn generated)
    - `packages/web/src/components/ui/label.tsx` exists (shadcn generated)
    - `pnpm --filter @serverdeck/web dev` starts Vite on port 5173 without errors
    - `GET http://localhost:5173` returns HTML containing `<title>ServerDeck</title>`
    - `cd packages/web && npx tsc --noEmit` exits with code 0
    - `pnpm dev` from root starts BOTH server (3001) and web (5173) concurrently without errors
  </acceptance_criteria>
  <verify>
    <automated>pnpm --filter @serverdeck/web dev &amp; sleep 6 &amp;&amp; curl -sf http://localhost:5173 | grep -i "serverdeck" &amp;&amp; kill %1</automated>
  </verify>
  <done>packages/web Vite dev server runs on 5173, serves React app, shadcn components present, pnpm dev from root starts both services</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer workstation → npm registry | Package installation; supply chain risk |
| browser → Vite dev server | Development only; not exposed to internet |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-SC | Tampering | npm package install (fastify, ssh2, react, vite, etc.) | mitigate | All packages verified via Context7 in STACK.md with GitHub stars and last-commit dates. Executor must cross-reference package names against `npmjs.com/package/{name}` before installing — confirm download counts are in millions/week range for core packages. |
</threat_model>

<verification>
Run from project root after both tasks complete:

```bash
# 1. Both services start
pnpm dev &
sleep 6

# 2. Backend health check
curl -sf http://localhost:3001/health | grep '"ok":true'

# 3. Frontend serves HTML
curl -sf http://localhost:5173 | grep -i 'serverdeck'

# 4. shadcn components generated
ls packages/web/src/components/ui/{button,card,input,label}.tsx

# 5. TypeScript clean in both packages
(cd packages/server && npx tsc --noEmit) && (cd packages/web && npx tsc --noEmit)

kill %1
```

All five checks must pass.
</verification>

<success_criteria>
- `pnpm dev` from repository root starts Fastify on :3001 and Vite on :5173 without errors
- `curl http://localhost:3001/health` → `{"ok":true}` HTTP 200
- `curl http://localhost:5173` → HTML with `<title>ServerDeck</title>`
- `packages/web/src/components/ui/{button,card,input,label}.tsx` all exist
- `packages/web/src/index.css` contains `@import "tailwindcss"` and zinc dark CSS variables
- TypeScript strict compilation passes in both packages (exit code 0)
</success_criteria>

<output>
Create `.planning/phases/01-auth-foundation/01-01-SUMMARY.md` when done.
</output>
