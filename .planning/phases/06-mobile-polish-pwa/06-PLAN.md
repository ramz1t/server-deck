---
phase: 06-mobile-polish-pwa
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/server/src/middleware/verify-auth.ts
  - packages/server/src/server.ts
  - packages/web/src/pages/DashboardPage.tsx
  - packages/web/src/pages/LogPage.tsx
  - packages/web/src/pages/TerminalPage.tsx
  - packages/web/package.json
  - packages/web/vite.config.ts
  - packages/web/public/icon-180.png
  - packages/web/public/icon-192.png
  - packages/web/public/icon-512.png
  - packages/web/index.html
  - packages/web/src/components/PWAInstallBanner.tsx
  - packages/web/src/pages/DashboardPage.tsx
autonomous: true
requirements: [MOBL-01, MOBL-02, MOBL-03, MOBL-04, MOBL-05]

must_haves:
  truths:
    - "GET / returns index.html (200), not 401, for unauthenticated browsers"
    - "GET /sw.js returns the Workbox service worker (200) after a production build"
    - "GET /manifest.webmanifest returns the PWA manifest JSON (200) after a production build"
    - "All header icon buttons in DashboardPage, LogPage, and TerminalPage render at h-11 w-11 (44px)"
    - "Group toggle <button> in DashboardPage has min-h-[44px]"
    - "PWAInstallBanner appears between the DashboardPage header and the container list"
    - "PWAInstallBanner does not render when display-mode is standalone (already installed)"
    - "index.html includes apple-mobile-web-app-capable, apple-touch-icon, and viewport-fit=cover"
  artifacts:
    - path: "packages/server/src/middleware/verify-auth.ts"
      provides: "Auth guard scoped to /api/* only — non-API paths return early"
      contains: "startsWith('/api')"
    - path: "packages/server/src/server.ts"
      provides: "@fastify/static serving dist/ + SPA fallback setNotFoundHandler"
      contains: "fastifyStatic"
    - path: "packages/web/public/icon-180.png"
      provides: "180×180 Apple touch icon"
    - path: "packages/web/public/icon-192.png"
      provides: "192×192 Android Chrome PWA icon"
    - path: "packages/web/public/icon-512.png"
      provides: "512×512 maskable splash icon"
    - path: "packages/web/vite.config.ts"
      provides: "VitePWA plugin config — emits sw.js and manifest.webmanifest"
      contains: "VitePWA"
    - path: "packages/web/index.html"
      provides: "iOS PWA meta tags + viewport-fit=cover + theme-color"
      contains: "apple-mobile-web-app-capable"
    - path: "packages/web/src/components/PWAInstallBanner.tsx"
      provides: "Install banner — Android deferred prompt + iOS advisory, dismiss, standalone guard"
      exports: ["PWAInstallBanner"]
  key_links:
    - from: "packages/web/src/pages/DashboardPage.tsx"
      to: "packages/web/src/components/PWAInstallBanner.tsx"
      via: "JSX rendered between <header> and <main>"
      pattern: "PWAInstallBanner"
    - from: "packages/server/src/server.ts"
      to: "packages/web/dist/"
      via: "@fastify/static root option"
      pattern: "fastifyStatic"
    - from: "packages/web/vite.config.ts"
      to: "dist/sw.js + dist/manifest.webmanifest"
      via: "VitePWA GenerateSW workbox"
      pattern: "VitePWA"
---

<objective>
Phase 6 makes ServerDeck fully usable on a 390px phone screen and installable as a PWA.

Two blocking infrastructure gaps must be closed first (Wave 1A): `@fastify/static` is registered as a dependency in server `package.json` but never called in `server.ts`, so the built frontend is never served; and the global `verifyAuth` preHandler returns 401 for every static file request — including `index.html` — because it only excludes 3 explicit `/api` paths. Until these are fixed, the production app is completely inaccessible.

In parallel (Wave 1B), seven button elements across three pages (`DashboardPage`, `LogPage`, `TerminalPage`) are `h-9` (36 px), below the Apple HIG 44 px minimum — these get targeted `h-11`/`min-h-[44px]` fixes.

Wave 2 builds on the working static server: `vite-plugin-pwa` adds service worker + manifest generation, three PNG icons are created, `index.html` gains iOS PWA meta tags, and a `PWAInstallBanner` component is wired into `DashboardPage` between the header and the container list.

MOBL-01, MOBL-02, MOBL-04 are already implemented in previous phases; this plan closes MOBL-03 and MOBL-05 and verifies the others.

Purpose: Ship a polished, installable v1.2 milestone that works as a first-class mobile app.

Output: Working production serving pipeline, all tap targets ≥ 44 px, installable PWA with manifest + SW + icons + install banner.
</objective>

<execution_context>
@~/.copilot/get-shit-done/workflows/execute-plan.md
@~/.copilot/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/06-mobile-polish-pwa/06-RESEARCH.md
@.planning/phases/06-mobile-polish-pwa/06-UI-SPEC.md
</context>

---

## Wave Structure

| Wave | Tasks | Can Run In Parallel | Depends On |
|------|-------|---------------------|------------|
| 1A | Task 1, Task 2 — infra fixes (server package) | Yes, with Wave 1B | — |
| 1B | Task 3, Task 4 — tap target fixes (web pages) | Yes, with Wave 1A | — |
| 2 | Task 5, Task 6 — PWA build + install banner | Sequential after Wave 1A | Task 1 + Task 2 must be done |

Execute Wave 1A and Wave 1B simultaneously. Start Wave 2 only after both Wave 1A tasks are complete (static server must be working before testing PWA assets).

---

<tasks>

<!-- ═══════════════════════════════════════════════════════ -->
<!-- WAVE 1A — Infrastructure (server package)              -->
<!-- ═══════════════════════════════════════════════════════ -->

<task type="auto">
  <name>Task 1 [Wave 1A]: Scope verifyAuth to /api/* only</name>
  <files>packages/server/src/middleware/verify-auth.ts</files>
  <action>
    Open `packages/server/src/middleware/verify-auth.ts`. The current implementation checks `EXCLUDED_PATHS` (three specific paths) and then runs JWT verification. Any request that is NOT in `EXCLUDED_PATHS` — including `GET /`, `GET /sw.js`, `GET /manifest.webmanifest`, and all static assets — hits the JWT check and returns 401 for unauthenticated browsers.

    Add one guard as the FIRST line of the `verifyAuth` function body (before the `EXCLUDED_PATHS` check):

    ```
    if (!request.url.startsWith('/api')) return
    ```

    This makes all non-API routes public. The existing `EXCLUDED_PATHS` array (`/api/auth/login`, `/api/auth/logout`, `/health`) remains unchanged below — it still exempts those specific API paths from JWT verification. No other changes to this file.

    The `/health` path is a special case: it currently bypasses auth via `EXCLUDED_PATHS`. With the new guard, `/health` is no longer `/api`-prefixed so it is already public — but leaving `/health` in `EXCLUDED_PATHS` is harmless (the first guard returns early before reaching the array check).
  </action>
  <verify>
    <automated>grep -n "startsWith('/api')" packages/server/src/middleware/verify-auth.ts</automated>
  </verify>
  <done>The guard `if (!request.url.startsWith('/api')) return` is the first statement in the `verifyAuth` function body. The file still compiles (run `cd packages/server && npx tsc --noEmit` to confirm).</done>
</task>

<task type="auto">
  <name>Task 2 [Wave 1A]: Register @fastify/static + SPA fallback in server.ts</name>
  <files>packages/server/src/server.ts</files>
  <action>
    Open `packages/server/src/server.ts`. The `@fastify/static` package is already in `packages/server/package.json` but is never imported or registered. Add it now.

    Add to the top-level imports (alongside existing imports):
    - `import fastifyStatic from '@fastify/static'`
    - `import { fileURLToPath } from 'url'`
    - `import path from 'path'`

    Note: `path` may already be imported — check and add only if missing. `fileURLToPath` and `url` are Node built-ins.

    Inside `buildServer()`, after `await registerAuthPlugins(fastify)` and before the first `await fastify.register(authRoutes)`, add:

    1. Compute the `dist/` path. Server source compiles to `packages/server/dist/` and the web build goes to `packages/web/dist/`. From `packages/server/dist/server.js`, the relative path to `packages/web/dist/` is `../../web/dist`. Use:
       ```
       const __filename = fileURLToPath(import.meta.url)
       const __dirname = path.dirname(__filename)
       const WEB_DIST = path.resolve(__dirname, '../../web/dist')
       ```

    2. Register the static plugin with `wildcard: false` so that Fastify's static handler only serves files that actually exist in `dist/` and does NOT register a catch-all `GET /*` route that would intercept API routes:
       ```
       await fastify.register(fastifyStatic, {
         root: WEB_DIST,
         prefix: '/',
         wildcard: false,
       })
       ```

    3. After ALL route registrations (after `terminalRoute` and the `/health` GET), add the SPA fallback. This must be last so API routes are registered first:
       ```
       fastify.setNotFoundHandler((_req, reply) => {
         if (_req.url.startsWith('/api')) {
           return reply.code(404).send({ error: 'Not Found' })
         }
         return reply.sendFile('index.html')
       })
       ```

    The final registration order in `buildServer()` must be:
    1. `fastify.addContentTypeParser(...)` — existing
    2. `await fastify.register(websocket)` — existing
    3. `await registerAuthPlugins(fastify)` — existing
    4. `await fastify.register(fastifyStatic, { ... })` — NEW (here)
    5. `fastify.addHook('preHandler', verifyAuth)` — existing
    6. All route registrations — existing
    7. `fastify.get('/health', ...)` — existing
    8. `fastify.setNotFoundHandler(...)` — NEW (here, must be last)

    Do NOT use `wildcard: true` (the default) — that registers `GET /*` which swallows API requests before route handlers run.
  </action>
  <verify>
    <automated>cd packages/server && npx tsc --noEmit 2>&amp;1 | head -20</automated>
  </verify>
  <done>
    `server.ts` imports `fastifyStatic` and registers it with `wildcard: false` before route handlers. `setNotFoundHandler` is the last statement. TypeScript compiles without errors (`npx tsc --noEmit` exits 0).

    Manual smoke test after building: `cd packages/web &amp;&amp; npm run build`, then start the server and `curl http://localhost:3001/` should return the index.html HTML document, not `{"error":"Unauthorized"}`.
  </done>
</task>

<!-- ═══════════════════════════════════════════════════════ -->
<!-- WAVE 1B — Tap Target Fixes (web pages)                 -->
<!-- ═══════════════════════════════════════════════════════ -->

<task type="auto">
  <name>Task 3 [Wave 1B]: Fix DashboardPage.tsx header tap targets (MOBL-03)</name>
  <files>packages/web/src/pages/DashboardPage.tsx</files>
  <action>
    Four elements in `DashboardPage.tsx` are below the 44 px minimum. Make exactly these changes (line numbers are approximate — read the file to confirm):

    **Change 1 — Refresh icon button (~line 183):**
    Current: `className="h-9 w-9"`
    Replace with: `className="h-11 w-11"`
    (This is the `<Button variant="ghost" size="icon">` wrapping `<RefreshCw />`.)

    **Change 2 — Terminal nav button (~line 192):**
    Current: `className="h-9"`
    Replace with: `className="h-11"`
    (This is `<Button variant="outline" size="sm">` that calls `navigate('/terminal')`.)

    **Change 3 — Log out button (~line 197):**
    Current: `className="h-9"`
    Replace with: `className="h-11"`
    (This is `<Button variant="outline" size="sm" onClick={handleLogout}>`)

    **Change 4 — Group toggle `<button>` (~line 277–305):**
    The native `<button type="button">` that toggles group expansion currently has `className="w-full flex items-center gap-2 pt-2 pb-1 text-left group"`. Add `min-h-[44px]` to that className string. Result: `className="w-full flex items-center gap-2 pt-2 pb-1 text-left group min-h-[44px]"`.

    Do NOT change any other button in this file. ContainerCard action buttons (`min-h-[44px] h-11`) and the error/retry button (`h-11`) are already correct — leave them as-is.

    Exact pattern to match per UI-SPEC (06-UI-SPEC.md Component Sizing Contract section):
    - All header icon buttons: `h-11 w-11 shrink-0`
    - Sm buttons: `h-11` only (width is auto for text buttons)
    - Group toggle: `min-h-[44px]` added to existing className
  </action>
  <verify>
    <automated>grep -n "h-9" packages/web/src/pages/DashboardPage.tsx</automated>
  </verify>
  <done>
    `grep -n "h-9"` in `DashboardPage.tsx` returns zero lines that are interactive element declarations (skeleton placeholder `h-9 w-20` in the loading state is a visual decoration, not an interactive element — it is acceptable to leave). All four target elements now meet 44 px. The file compiles: `cd packages/web &amp;&amp; npx tsc --noEmit` exits 0.
  </done>
</task>

<task type="auto">
  <name>Task 4 [Wave 1B]: Fix LogPage.tsx + TerminalPage.tsx tap targets (MOBL-03)</name>
  <files>packages/web/src/pages/LogPage.tsx, packages/web/src/pages/TerminalPage.tsx</files>
  <action>
    Three elements across two files are below the 44 px minimum. Make exactly these changes:

    **LogPage.tsx — Back button (~line 66):**
    Current: `className="h-9 w-9 shrink-0"`
    Replace with: `className="h-11 w-11 shrink-0"`
    (The `<Button variant="ghost" size="icon">` wrapping `<ArrowLeft />` in the sticky header.)

    **TerminalPage.tsx — Back button (~line 31):**
    Current: `className="h-9 w-9 shrink-0"`
    Replace with: `className="h-11 w-11 shrink-0"`
    (The `<Button variant="ghost" size="icon">` wrapping `<ArrowLeft />` that calls `navigate(-1)`.)

    **TerminalPage.tsx — Close button (~line 52):**
    Current: `className="h-9 w-9 shrink-0"`
    Replace with: `className="h-11 w-11 shrink-0"`
    (The `<Button variant="ghost" size="icon">` wrapping `<X />` that also calls `navigate(-1)`.)

    Do NOT change any other elements in these files. The TerminalPage error/retry buttons (`h-11`) and LogPage resume button (`min-h-[44px]`) are already correct.

    Per UI-SPEC 06-UI-SPEC.md, the icon inside the button stays `h-4 w-4` or `h-5 w-5` — only the Button wrapper changes height.
  </action>
  <verify>
    <automated>grep -n "h-9" packages/web/src/pages/LogPage.tsx packages/web/src/pages/TerminalPage.tsx</automated>
  </verify>
  <done>
    `grep -n "h-9"` across both files returns zero lines. Both files compile: `cd packages/web &amp;&amp; npx tsc --noEmit` exits 0.
  </done>
</task>

<!-- ═══════════════════════════════════════════════════════ -->
<!-- WAVE 2 — PWA (depends on Wave 1A)                      -->
<!-- Run after Task 1 and Task 2 are complete.              -->
<!-- ═══════════════════════════════════════════════════════ -->

<task type="auto">
  <name>Task 5 [Wave 2]: Install vite-plugin-pwa, configure VitePWA, create icons, update index.html (MOBL-05)</name>
  <files>
    packages/web/package.json,
    packages/web/vite.config.ts,
    packages/web/public/icon-180.png,
    packages/web/public/icon-192.png,
    packages/web/public/icon-512.png,
    packages/web/index.html
  </files>
  <action>
    This task has four sub-steps executed in sequence.

    **Step A — Install packages:**
    ```
    cd packages/web
    npm install -D vite-plugin-pwa workbox-window @vite-pwa/assets-generator
    ```
    All three packages are in the legitimacy audit in RESEARCH.md with [OK] verdict. `vite-plugin-pwa` v1.3.0, `workbox-window` v7.4.1.

    **Step B — Create a source SVG icon for icon generation:**
    Create `packages/web/public/logo.svg` — a simple dark-theme terminal/server icon:
    - 512×512 viewBox
    - Background rect: fill `#09090b` (zinc-950)
    - A `>_` prompt symbol in white (`#fafafa`), centered, keeping all content within the inner 80% safe zone (56px margin on each side from the 512px edge)
    - Use a clean SVG with no external references

    Minimal SVG that satisfies the icon contract from UI-SPEC:
    ```xml
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
      <rect width="512" height="512" fill="#09090b"/>
      <!-- chevron: > -->
      <polyline points="168,196 228,256 168,316" fill="none" stroke="#fafafa" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>
      <!-- underscore: _ -->
      <line x1="244" y1="316" x2="344" y2="316" stroke="#fafafa" stroke-width="28" stroke-linecap="round"/>
    </svg>
    ```

    **Step C — Generate PNG icons from the SVG:**
    Run the assets generator to produce all three required sizes:
    ```
    cd packages/web
    npx @vite-pwa/assets-generator --preset minimal --source public/logo.svg
    ```
    This generates files into `packages/web/public/`. After generation, verify the three required files exist and rename/copy as needed:
    - The generator may output `pwa-192x192.png` → rename to `icon-192.png`
    - The generator may output `pwa-512x512.png` → rename to `icon-512.png`
    - The generator may output `apple-touch-icon.png` (180×180) → rename to `icon-180.png`

    If the generator output filenames differ, check `packages/web/public/` after the run and rename accordingly. Target names must be exactly: `icon-180.png`, `icon-192.png`, `icon-512.png`.

    If the assets generator fails (e.g., missing sharp dependency), fall back to creating the PNGs using Node.js Canvas or by writing the SVG and converting with Vite's build. As a last resort, create placeholder 192×192 and 512×512 PNGs using a minimal Node.js script that writes a solid `#09090b` square with the `>_` text using the `canvas` npm package (install as devDep if needed). The icons must be valid PNG files — browsers reject SVG in the `icons` manifest array.

    **Step D — Configure VitePWA in vite.config.ts:**
    Replace the current `vite.config.ts` content with:
    ```typescript
    import { defineConfig } from 'vite'
    import react from '@vitejs/plugin-react'
    import tailwindcss from '@tailwindcss/vite'
    import { VitePWA } from 'vite-plugin-pwa'
    import path from 'path'

    export default defineConfig({
      plugins: [
        tailwindcss(),
        react(),
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['icon-180.png', 'icon-192.png', 'icon-512.png'],
          manifest: {
            name: 'ServerDeck',
            short_name: 'ServerDeck',
            description: 'Server dashboard and SSH terminal',
            theme_color: '#09090b',
            background_color: '#09090b',
            display: 'standalone',
            start_url: '/',
            scope: '/',
            icons: [
              { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
              {
                src: 'icon-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any maskable',
              },
            ],
          },
          workbox: {
            globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
            runtimeCaching: [],
          },
          devOptions: {
            enabled: false,
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

    **Step E — Update index.html with PWA meta tags:**
    Replace the current `index.html` `<head>` contents with (keep `<body>` unchanged):
    ```html
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />

      <!-- PWA manifest (generated by vite-plugin-pwa at build time) -->
      <link rel="manifest" href="/manifest.webmanifest" />

      <!-- iOS PWA install support -->
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="apple-mobile-web-app-title" content="ServerDeck" />
      <link rel="apple-touch-icon" href="/icon-180.png" />

      <!-- Theme color for Chrome address bar and Android task switcher -->
      <meta name="theme-color" content="#09090b" />

      <title>ServerDeck</title>
    </head>
    ```

    Note: The existing `<link rel="icon" type="image/svg+xml" href="/vite.svg" />` is removed — `vite.svg` is a Vite default placeholder. The favicon is now handled by `icon-192.png` and the `apple-touch-icon`. If a `favicon.ico` is desired, add a 32×32 PNG as `favicon.ico` to `public/` and add `<link rel="icon" href="/favicon.ico" />` — but this is optional and not required by MOBL-05.

    The `viewport-fit=cover` in the viewport meta tag is required for `env(safe-area-inset-*)` CSS values to work correctly on iPhones with a notch/home indicator. This was previously missing — adding it here satisfies the contract noted in UI-SPEC (MOBL-02 section).
  </action>
  <verify>
    <automated>cd packages/web &amp;&amp; npm run build 2>&amp;1 | tail -20 &amp;&amp; ls dist/sw.js dist/manifest.webmanifest dist/icon-192.png dist/icon-512.png 2>&amp;1</automated>
  </verify>
  <done>
    `npm run build` exits 0. `dist/sw.js`, `dist/manifest.webmanifest`, `dist/icon-192.png`, `dist/icon-512.png` all exist in the build output. `packages/web/public/icon-180.png`, `icon-192.png`, `icon-512.png` all exist as valid PNG files. `vite.config.ts` contains `VitePWA`. `index.html` contains `apple-mobile-web-app-capable` and `viewport-fit=cover`.
  </done>
</task>

<task type="auto">
  <name>Task 6 [Wave 2]: Create PWAInstallBanner component + wire into DashboardPage (MOBL-05)</name>
  <files>
    packages/web/src/components/PWAInstallBanner.tsx,
    packages/web/src/pages/DashboardPage.tsx
  </files>
  <action>
    **Step A — Create PWAInstallBanner.tsx:**

    Create `packages/web/src/components/PWAInstallBanner.tsx`.

    The component handles three states per UI-SPEC (06-UI-SPEC.md PWA Install Banner section):
    1. **Standalone / already installed:** `window.matchMedia('(display-mode: standalone)').matches === true` → return null (do not render).
    2. **Android Chrome:** `beforeinstallprompt` event captured in a ref → show banner with "Install ServerDeck for quick access" text and an "Install" `<Button>` that calls `deferredPrompt.prompt()`.
    3. **iOS Safari:** `/iphone|ipad|ipod/i.test(navigator.userAgent)` + not standalone → show banner with "Tap Share ↑ then 'Add to Home Screen'" text (no Install button — iOS has no deferred prompt API).
    4. **Dismissed:** user taps ✕ → hide for the session (useState dismissed flag, no localStorage).

    Banner appearance per UI-SPEC:
    - Outer div: `flex items-center gap-3 h-12 px-4 bg-secondary border-b border-border`
    - Left icon: `<Download className="h-4 w-4 text-muted-foreground shrink-0" />` from lucide-react
    - Text span: `flex-1 text-[13px] text-foreground` — conditional content (Android vs iOS copy)
    - Install button (Android only): `<Button size="sm" variant="default" className="h-8 px-3 text-xs shrink-0">Install</Button>`
    - Dismiss button: `<Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Dismiss install prompt"><X className="h-4 w-4" /></Button>`

    Note: The Install button at `h-8` (32 px) is intentionally below 44 px per UI-SPEC — the full 48 px banner row provides the tap zone. Do NOT increase it to h-11.

    State logic:
    - `const [dismissed, setDismissed] = useState(false)` — session-only dismiss
    - `const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)` — typed with a local interface
    - `const [showIOS, setShowIOS] = useState(false)` — set on mount if iOS + not standalone
    - `useEffect` on mount: check standalone (`window.matchMedia('(display-mode: standalone)').matches`), detect iOS (`/iphone|ipad|ipod/i.test(navigator.userAgent)`), add `window.addEventListener('beforeinstallprompt', handler)`
    - `BeforeInstallPromptEvent` is not in the standard TypeScript lib — declare a local interface at the top of the file:
      ```typescript
      interface BeforeInstallPromptEvent extends Event {
        prompt(): Promise<void>
        readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
      }
      ```
    - Install button click: call `deferredPrompt.prompt()`, then `await deferredPrompt.userChoice`, then `setDeferredPrompt(null)` to hide the banner after the native prompt is shown.

    Render condition: do NOT render if `dismissed === true`, or if standalone, or if neither `deferredPrompt` nor `showIOS` is truthy. In other words, only render when there is something actionable to show.

    Copywriting (exact, per UI-SPEC):
    - Android text: `"Install ServerDeck for quick access"`
    - iOS text: `"Tap Share ↑ then 'Add to Home Screen'"`
    - Install button label: `"Install"`
    - Dismiss aria-label: `"Dismiss install prompt"`

    **Step B — Wire into DashboardPage.tsx:**

    Import `PWAInstallBanner` at the top of `DashboardPage.tsx`:
    ```typescript
    import { PWAInstallBanner } from '../components/PWAInstallBanner'
    ```

    Place `<PWAInstallBanner />` immediately after the closing `</header>` tag and before the `{/* Mobile: user@host below header */}` div. The result should be:

    ```
    </header>

    <PWAInstallBanner />

    {/* Mobile: user@host below header */}
    ```

    This places the banner between the sticky header and the content area, matching the UI-SPEC placement contract ("between the dashboard page header row and the container list").

    Do NOT add PWAInstallBanner to App.tsx — it is dashboard-specific per UI-SPEC. The banner is only relevant on the main screen, not on LogPage or TerminalPage.
  </action>
  <verify>
    <automated>cd packages/web &amp;&amp; npx tsc --noEmit 2>&amp;1 | head -30</automated>
  </verify>
  <done>
    `packages/web/src/components/PWAInstallBanner.tsx` exists and exports `PWAInstallBanner`. `DashboardPage.tsx` imports and renders `&lt;PWAInstallBanner /&gt;` between `&lt;/header&gt;` and the mobile subtitle div. TypeScript compiles without errors. `npm run build` succeeds (verify after Task 5's build output confirms vite-plugin-pwa is working).

    Behavioral acceptance:
    - On a desktop browser: banner is hidden (no `beforeinstallprompt`, not iOS).
    - On Android Chrome (DevTools → Application → Manifest → "Add to home screen"): banner appears with "Install ServerDeck for quick access" and an Install button.
    - Already installed (DevTools → Application → Service Workers → Standalone mode): banner is hidden.
    - Tapping ✕: banner disappears for the session.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser → Fastify | All HTTP/WS requests; static files are now public (intentional) |
| Service worker → Fastify API | SW intercepts fetch; runtime caching is disabled, so API calls pass through uncached |
| PWA manifest | Publicly readable JSON; contains only display metadata, no secrets |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-06-01 | Information Disclosure | `verify-auth.ts` scope change | mitigate | Guard is `!startsWith('/api')` — all `/api/*` routes remain protected; static files intentionally public (no auth data in static assets) |
| T-06-02 | Tampering | `@fastify/static` wildcard:false | mitigate | `wildcard: false` prevents static handler from swallowing `/api/*` routes; API routes registered before `setNotFoundHandler` take precedence |
| T-06-03 | Elevation of Privilege | Service worker caching | accept | `runtimeCaching: []` — SW only precaches static build artifacts (JS/CSS/HTML/PNG), not API responses. No auth tokens or Docker data are ever cached. SW scope is `/` but cannot escalate beyond what the origin already allows. |
| T-06-04 | Information Disclosure | PWA manifest.webmanifest | accept | Manifest contains only app metadata (name, icons, display mode, start_url). No credentials, server addresses, or session data. Publicly accessible by design (required for PWA installability). |
| T-06-05 | Spoofing | beforeinstallprompt + deferredPrompt.prompt() | accept | The install prompt is a browser-controlled native dialog. The app can only trigger it, not spoof it. User always sees the legitimate browser install UI. |
| T-06-SC | Tampering | npm install (vite-plugin-pwa, workbox-window, @vite-pwa/assets-generator) | mitigate | All three packages verified [OK] in RESEARCH.md Package Legitimacy Audit (2026-05-29). Install proceeds without blocking checkpoint. |
</threat_model>

<verification>
## Phase 6 Acceptance Checks

Run these after all six tasks complete and `npm run build` succeeds:

### Infra (Wave 1A)
```bash
# Auth scope fix — must contain the /api guard
grep -n "startsWith('/api')" packages/server/src/middleware/verify-auth.ts

# Static plugin registered
grep -n "fastifyStatic" packages/server/src/server.ts

# SPA fallback registered
grep -n "setNotFoundHandler" packages/server/src/server.ts
```

### Tap Targets (Wave 1B)
```bash
# No h-9 on interactive elements in page headers
grep -n "h-9" packages/web/src/pages/DashboardPage.tsx
grep -n "h-9" packages/web/src/pages/LogPage.tsx
grep -n "h-9" packages/web/src/pages/TerminalPage.tsx

# Group toggle has min-h-[44px]
grep -n "min-h-\[44px\]" packages/web/src/pages/DashboardPage.tsx
```

### PWA Build (Wave 2)
```bash
cd packages/web && npm run build

# Verify generated files
ls -la dist/sw.js dist/manifest.webmanifest dist/icon-192.png dist/icon-512.png

# Verify manifest content
cat dist/manifest.webmanifest | python3 -m json.tool | grep -E '"name"|"display"|"start_url"'

# Verify index.html meta tags
grep -n "apple-mobile-web-app-capable\|viewport-fit=cover\|theme-color" index.html

# Verify PWAInstallBanner component exists
ls packages/web/src/components/PWAInstallBanner.tsx

# TypeScript compiles clean
cd packages/web && npx tsc --noEmit
cd packages/server && npx tsc --noEmit
```

### MOBL requirements verified
- **MOBL-01**: All screens full-width at 390px — no structural changes needed (confirmed in RESEARCH.md audit); DashboardPage `min-h-svh`, LogPage `min-h-svh`, TerminalPage `h-dvh` — all correct.
- **MOBL-02**: Terminal viewport — `h-dvh` + `ResizeObserver` + RAF debounce already in place from Phase 5. `viewport-fit=cover` added to `index.html` in Task 5 completes this.
- **MOBL-03**: All header icon buttons `h-11 w-11` (Tasks 3 + 4). Group toggle `min-h-[44px]` (Task 3).
- **MOBL-04**: `autoCorrect="off" autoCapitalize="off" spellCheck={false} data-gramm="false"` on terminal container already present in TerminalPage.tsx — verify with `grep -n "autoCorrect" packages/web/src/pages/TerminalPage.tsx`.
- **MOBL-05**: manifest + SW + icons + iOS meta tags + install banner (Tasks 5 + 6).
</verification>

<success_criteria>
Phase 6 is complete when:

1. **Production serving works:** `curl http://localhost:3001/` returns `text/html` (index.html), not `{"error":"Unauthorized"}`.
2. **Static assets are served:** `curl http://localhost:3001/sw.js` returns JavaScript; `curl http://localhost:3001/manifest.webmanifest` returns JSON with `"name":"ServerDeck"`.
3. **API routes still protected:** `curl http://localhost:3001/api/containers` returns `401 Unauthorized` (not index.html, not a 404 from static).
4. **Tap targets:** `grep -c "h-9" packages/web/src/pages/{DashboardPage,LogPage,TerminalPage}.tsx` — the count reflects only non-interactive decorative elements (skeleton placeholders), not button class strings.
5. **PWA manifest valid:** Chrome DevTools → Application → Manifest shows no errors; `start_url`, `icons`, `display: standalone` all present.
6. **iOS meta tags:** `grep "apple-mobile-web-app-capable" packages/web/index.html` returns the meta tag.
7. **Install banner renders:** On DashboardPage, `<PWAInstallBanner />` is present in the component tree between `</header>` and the container list. TypeScript compiles clean.
8. **Build succeeds:** `cd packages/web && npm run build` exits 0 with `dist/sw.js` and `dist/manifest.webmanifest` emitted.
</success_criteria>

<output>
When all tasks are complete, create `.planning/phases/06-mobile-polish-pwa/06-01-SUMMARY.md` using the summary template at `@~/.copilot/get-shit-done/templates/summary.md`.

Key items to record in the summary:
- The `verify-auth.ts` change (single guard line) and why it was critical
- The `@fastify/static` registration pattern used (`wildcard: false`, `setNotFoundHandler` placement)
- Icon generation approach used (assets-generator or fallback)
- `vite-plugin-pwa` version and config shape that worked
- Any deviations from RESEARCH.md assumptions (A1–A6)
</output>
