# Phase 6: Mobile Polish & PWA — Research

**Researched:** 2026-05-29
**Domain:** Progressive Web App (PWA), mobile CSS, Vite build tooling, Fastify static serving
**Confidence:** HIGH

---

## Summary

Phase 6 delivers five mobile requirements: responsive layout audit (MOBL-01), iOS keyboard viewport stability (MOBL-02), 44×44px tap targets across all screens (MOBL-03), autocorrect/autocapitalize disabled in terminal (MOBL-04), and full PWA installability with manifest + service worker (MOBL-05).

MOBL-02 and MOBL-04 are substantially done. MOBL-01 and MOBL-03 need targeted fixes to button heights on three pages. MOBL-05 requires the most work: installing `vite-plugin-pwa`, generating icons, adding iOS meta tags to `index.html`, and — critically — **two infrastructure gaps that block production entirely**: (1) `@fastify/static` is listed as a dependency but never registered in `server.ts`, and (2) the global `verifyAuth` preHandler will reject all static file requests (including `index.html`, `sw.js`, and the manifest) with 401 until it is scoped to `/api/*` only.

**Primary recommendation:** Split the phase into two plans — (A) infrastructure + PWA: static serving fix, auth scope fix, vite-plugin-pwa, icons, meta tags; (B) tap target audit and layout polish across DashboardPage, LogPage, and TerminalPage.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| PWA manifest + service worker generation | Frontend Build (Vite) | — | `vite-plugin-pwa` emits manifest.webmanifest and `sw.js` into `dist/`; build-time concern |
| Service worker registration | Browser / Client | — | SW registration runs in the browser via vite-plugin-pwa auto-register |
| Serving SW, manifest, icons | Backend (Fastify static) | — | Fastify's `@fastify/static` serves all `dist/` contents including `sw.js` at root scope |
| Auth bypass for static assets | Backend (Fastify middleware) | — | `verifyAuth` preHandler must skip non-`/api` routes so static files are publicly accessible |
| SPA fallback (index.html) | Backend (Fastify) | — | Not-found handler must serve `index.html` for all non-API, non-asset 404s |
| iOS viewport height (`dvh`) | Frontend Server (CSS) | — | `h-dvh` on terminal outer div; already done |
| Tap target sizing | Frontend (React + Tailwind) | — | CSS `min-h-[44px]` on interactive elements |
| iOS meta tags | Frontend HTML | — | `apple-mobile-web-app-capable`, `apple-touch-icon` in `index.html` head |

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MOBL-01 | All screens usable on 390px-wide phone (iPhone 15 baseline) | Layout audit needed: DashboardPage uses `min-h-svh` + responsive grid; LogPage uses fixed `calc(100svh - 57px)`; fix identified — no structural rework needed |
| MOBL-02 | Terminal viewport adjusts when iOS virtual keyboard appears | `h-dvh` + ResizeObserver already implemented in `TerminalPage.tsx` / `useTerminalSession.ts`; verified complete; minor `visualViewport` guard recommended as belt-and-suspenders |
| MOBL-03 | Touch targets meet 44×44px minimum | **3 pages need fixes**: DashboardPage header buttons (`h-9`=36px), LogPage back button (`h-9`=36px), TerminalPage back/close buttons (`h-9`=36px); group-toggle `<button>` needs `min-h-[44px]` |
| MOBL-04 | Autocorrect/autocapitalize disabled in terminal input | Already done: `autoCorrect="off" autoCapitalize="off" spellCheck={false}` on terminal container + `data-gramm="false"`; xterm.js v5 manages its own internal textarea independently |
| MOBL-05 | App installable as PWA (manifest + service worker stub) | Requires `vite-plugin-pwa`, icons (PNG 192/512/180), iOS meta tags in `index.html`, plus critical infrastructure: register `@fastify/static` in `server.ts` + scope `verifyAuth` to `/api/*` only |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vite-plugin-pwa` | 1.3.0 | PWA manifest + service worker generation | Zero-config PWA for Vite; uses Workbox under the hood; peer-compatible with Vite ^8 [VERIFIED: npm registry] |
| `workbox-window` | 7.4.1 | SW registration + update lifecycle in browser | Required peer dep of vite-plugin-pwa; handles SW registration, skip-waiting prompts [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@vite-pwa/assets-generator` | 1.0.2 | Generate all PWA icon sizes from a single SVG | Use if a source SVG is available; generates 192, 512, 180px PNGs automatically [VERIFIED: npm registry] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `vite-plugin-pwa` | Manual `manifest.json` + hand-written SW | Manual SW works but requires wiring Workbox or writing cache logic; vite-plugin-pwa handles hashing, precache manifest, and iOS quirks automatically |
| `@vite-pwa/assets-generator` | Manually created PNGs | Acceptable if creating a simple flat-color icon; skip the tool if you provide 3 PNG files directly |

**Installation (web package):**
```bash
cd packages/web
npm install -D vite-plugin-pwa workbox-window
# If using assets-generator:
npm install -D @vite-pwa/assets-generator
```

**Version verification (confirmed):**
```
vite-plugin-pwa  → 1.3.0  (2026-05-05)
workbox-window   → 7.4.1
workbox-build    → 7.4.1
@vite-pwa/assets-generator → 1.0.2
```

---

## Package Legitimacy Audit

| Package | Registry | slopcheck | Disposition |
|---------|----------|-----------|-------------|
| `vite-plugin-pwa` | npm | [OK] | Approved |
| `workbox-window` | npm | [OK] | Approved |
| `@vite-pwa/assets-generator` | npm | [OK] | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (iOS Safari / Chrome)
  │
  │  GET /                        ← @fastify/static serves dist/index.html
  │  GET /sw.js                   ← @fastify/static serves dist/sw.js (Workbox SW)
  │  GET /manifest.webmanifest    ← @fastify/static serves dist/manifest.webmanifest
  │  GET /icon-*.png              ← @fastify/static serves dist/icon-*.png
  │
  ▼
Fastify (server.ts)
  │
  ├─ verifyAuth preHandler  ──── skips if !url.startsWith('/api')  ◄── FIX NEEDED
  │
  ├─ @fastify/static  ──────────── root: packages/web/dist/
  │    └─ setNotFoundHandler  ──── serves index.html for non-/api 404s (SPA fallback)
  │
  └─ /api/* routes  ────────────── all protected by verifyAuth

Build pipeline (Vite)
  vite-plugin-pwa ──► dist/sw.js (Workbox GenerateSW)
                  ──► dist/manifest.webmanifest
                  ──► dist/icon-192.png, dist/icon-512.png
```

### Recommended Project Structure (new/changed files only)

```
packages/web/
├── public/
│   ├── icon-180.png          # apple-touch-icon (180×180 for iOS home screen)
│   ├── icon-192.png          # Android Chrome PWA icon
│   └── icon-512.png          # Splash/maskable icon
├── index.html                # Add PWA meta tags + apple-touch-icon link
└── vite.config.ts            # Add VitePWA() plugin

packages/server/src/
└── server.ts                 # Register @fastify/static + SPA fallback + fix verifyAuth scope
```

---

### Pattern 1: `vite-plugin-pwa` Configuration

**What:** Drop `VitePWA()` into `vite.config.ts`; plugin emits `sw.js` and `manifest.webmanifest` into `dist/` at build time and auto-registers the SW at runtime.

**When to use:** Any Vite SPA that needs PWA installability.

```typescript
// packages/web/vite.config.ts
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
      // Source: vite-plugin-pwa docs — includeAssets copies files from public/ into dist/
      includeAssets: ['icon-180.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'ServerDeck',
        short_name: 'ServerDeck',       // max ~12 chars for iOS home screen label
        description: 'Server dashboard and SSH terminal',
        theme_color: '#09090b',          // zinc-950 — matches app background
        background_color: '#09090b',     // shown during launch/splash
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',    // 'maskable' enables Android adaptive icon
          },
        ],
      },
      workbox: {
        // Cache app shell (JS, CSS, HTML) — offline stub only, not API data
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [],              // no runtime caching — SW is offline shell only
      },
      devOptions: {
        enabled: false,                  // don't run SW in dev (breaks HMR)
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true, ws: true },
    },
  },
})
```

> **Source:** [ASSUMED] — based on vite-plugin-pwa README patterns. Verify final API against `node_modules/vite-plugin-pwa/README.md` after install.

---

### Pattern 2: iOS PWA Meta Tags in `index.html`

**What:** Safari ignores `display: standalone` from the manifest on some iOS versions. These meta tags are the iOS-specific PWA API.

```html
<!-- packages/web/index.html — add to <head> -->
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<!-- viewport-fit=cover: allows content to extend under iPhone notch/home bar -->

<!-- PWA manifest (vite-plugin-pwa emits this file) -->
<link rel="manifest" href="/manifest.webmanifest" />

<!-- iOS home screen install support -->
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<!-- black-translucent: status bar overlays content; matches dark app theme -->
<meta name="apple-mobile-web-app-title" content="ServerDeck" />
<link rel="apple-touch-icon" href="/icon-180.png" />
<!-- 180×180px required for iOS retina home screen icon -->

<title>ServerDeck</title>
```

> **Source:** [ASSUMED] — standard iOS PWA meta tags from Apple's web developer documentation. The `apple-mobile-web-app-capable` pattern has been stable since iOS 9.

---

### Pattern 3: Fastify Static Serving + Auth Fix

**What:** Register `@fastify/static` (already in package.json) in `server.ts`, fix `verifyAuth` to only gate `/api/*`, and add SPA fallback.

**Critical finding:** `verifyAuth` is a global `preHandler` with `EXCLUDED_PATHS = ['/api/auth/login', ...]`. Without a fix, it will return 401 for every static file request (including `index.html` and `sw.js`) from unauthenticated browsers. The login page itself will be inaccessible.

```typescript
// packages/server/src/middleware/verify-auth.ts — CHANGE
const EXCLUDED_PATHS = ['/api/auth/login', '/api/auth/logout', '/health']

export async function verifyAuth(request, reply) {
  // Only enforce auth on API routes; static files (SPA, SW, manifest) are public
  if (!request.url.startsWith('/api')) return  // ← ADD THIS LINE

  if (EXCLUDED_PATHS.includes(request.url.split('?')[0])) return
  // ... rest unchanged
}
```

```typescript
// packages/server/src/server.ts — ADD (after registerAuthPlugins, before route registration)
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIST = path.join(__dirname, '../../../web/dist')

await fastify.register(fastifyStatic, {
  root: WEB_DIST,
  prefix: '/',
  wildcard: false,          // disable wildcard so /api/* isn't swallowed by static serving
})

// SPA fallback: serve index.html for any non-API 404 (React Router handles client routing)
fastify.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api')) {
    return reply.code(404).send({ error: 'Not Found' })
  }
  return reply.sendFile('index.html')
})
```

> **Source:** [ASSUMED] — based on `@fastify/static` v9 README patterns. The `wildcard: false` option is important so `/api/containers` is not interpreted as a static file path.

---

### Pattern 4: Tap Target Fix

**What:** Apple HIG and WCAG require interactive elements to be ≥ 44×44 CSS px. The shadcn `size="sm"` variant is `h-9` (36px) and `size="icon"` is `h-10` (40px) — both below the threshold.

**Affected elements (confirmed by code audit):**

| File | Element | Current | Fix |
|------|---------|---------|-----|
| `DashboardPage.tsx:183` | Refresh icon button | `h-9 w-9` (36px) | `h-11 w-11` |
| `DashboardPage.tsx:192` | Terminal button | `h-9` | `h-11` |
| `DashboardPage.tsx:197` | Log out button | `h-9` | `h-11` |
| `DashboardPage.tsx:277-305` | Group toggle `<button>` | no height | `min-h-[44px]` |
| `LogPage.tsx:66` | Back icon button | `h-9 w-9` (36px) | `h-11 w-11` |
| `TerminalPage.tsx:31` | Back icon button | `h-9 w-9` (36px) | `h-11 w-11` |
| `TerminalPage.tsx:52` | Close icon button | `h-9 w-9` (36px) | `h-11 w-11` |

**Already correct:** ContainerCard action buttons (`min-h-[44px] h-11` ✓), TouchToolbar buttons (`h-[44px] min-w-[44px]` ✓), error/retry buttons in TerminalPage (`h-11` ✓), LogPage resume button (`min-h-[44px]` ✓).

**Fix pattern:**
```tsx
// Before:
<Button variant="ghost" size="icon" className="h-9 w-9 shrink-0">
// After:
<Button variant="ghost" size="icon" className="h-11 w-11 shrink-0">

// For header sm buttons:
// Before: className="h-9"
// After:  className="h-11"

// For group toggle native button:
// Add: min-h-[44px] to className
```

---

### Pattern 5: Icon Generation (Simple Approach)

**What:** Create a 512×512 PNG icon, then either use `@vite-pwa/assets-generator` to resize to all required sizes, or create them manually.

**Simple approach (no tooling):** Create `icon-512.png`, `icon-192.png`, `icon-180.png` as separate files in `packages/web/public/`. A dark terminal/server icon matches the app theme.

**With assets-generator:**
```bash
# Create packages/web/public/logo.svg (source SVG)
# Then run:
cd packages/web
npx @vite-pwa/assets-generator --preset minimal --source public/logo.svg
# Generates: pwa-192x192.png, pwa-512x512.png, apple-touch-icon.png, etc.
```

> **Source:** [ASSUMED] — based on @vite-pwa/assets-generator v1.x CLI usage.

---

### Anti-Patterns to Avoid

- **Don't register `@fastify/static` without `wildcard: false`** — without this, Fastify's static handler intercepts `/api/containers` as a file path, causing 404s for API routes that haven't been registered yet in the Fastify lifecycle.
- **Don't enable `devOptions.enabled: true` in vite-plugin-pwa during development** — the SW intercepts all HMR requests and breaks hot reload. Keep it disabled in dev.
- **Don't put auth meta tags (JWT debug info) in the PWA manifest** — the manifest is publicly accessible without auth; only include display metadata.
- **Don't use `display: fullscreen`** — on iOS, `fullscreen` is not supported and falls back to `browser` mode (defeats the purpose). Use `standalone`.
- **Don't set `start_url` to anything other than `"/"` for a React Router SPA** — `start_url` must match the SW `scope`. A mismatch causes installability to fail silently.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Service worker caching logic | Custom fetch interceptors, cache.put/match | `vite-plugin-pwa` (Workbox GenerateSW) | Workbox handles cache versioning, update detection, stale-while-revalidate; manual SW breaks on hash-named Vite output files |
| PWA icon sizes | ImageMagick scripts, Canvas | `@vite-pwa/assets-generator` or manual PNGs | Icon generation from SVG is a 1-line CLI call; not worth custom tooling |
| SW registration/update UX | Manual `navigator.serviceWorker.register()` | `vite-plugin-pwa` `autoUpdate` mode | Handles skip-waiting, page reload on update, registration errors |

**Key insight:** The only custom code needed is the `vite.config.ts` plugin config and the `index.html` meta tags. Everything else (SW generation, manifest emission, registration) is handled by `vite-plugin-pwa`.

---

## Common Pitfalls

### Pitfall 1: `verifyAuth` blocks static files (critical)
**What goes wrong:** After registering `@fastify/static`, every browser request for `index.html`, `sw.js`, `manifest.webmanifest`, and icons returns `401 Unauthorized` JSON from the global `preHandler`. The app is completely inaccessible.
**Why it happens:** `EXCLUDED_PATHS` only lists 3 specific API paths; all other paths (including `/`) hit the JWT verification which fails for unauthenticated browsers.
**How to avoid:** Add `if (!request.url.startsWith('/api')) return` as the first line of `verifyAuth`.
**Warning signs:** Browser DevTools shows `401` on `GET /` with JSON body `{"error":"Unauthorized"}`.

### Pitfall 2: SW scope mismatch breaks installability
**What goes wrong:** PWA install banner never appears; Chrome DevTools → Application → Manifest shows "Service worker not controlling page".
**Why it happens:** If `start_url` in manifest doesn't match the SW scope (both should be `/`), or the SW is served from a subpath, the browser refuses to install.
**How to avoid:** Keep `start_url: "/"`, `scope: "/"`, and ensure SW is served at `/sw.js` (which `vite-plugin-pwa` + `@fastify/static` do automatically).
**Warning signs:** Chrome DevTools Application tab shows "Start URL not within scope" warning.

### Pitfall 3: iOS Safari doesn't use SW for offline without explicit cache
**What goes wrong:** App installs on iOS but shows blank screen or network error when offline.
**Why it happens:** `workbox.runtimeCaching: []` (our config) means only precached assets are available offline.
**How to avoid:** The `globPatterns: ['**/*.{js,css,html,...}']` precache covers the full app shell. This is intentional — we don't want to cache API responses. Verify that `index.html` is included in the precache manifest (check `dist/sw.js` after build).
**Warning signs:** `dist/sw.js` contains an empty `precacheAndRoute([])` call.

### Pitfall 4: `size="icon"` buttons are 40px, not 44px
**What goes wrong:** Passing `size="icon"` to shadcn `<Button>` gives `h-10 w-10` (40px) — 4px short of the 44px HIG target.
**Why it happens:** shadcn's default `icon` size was designed for desktop; 40px is common in desktop UI patterns.
**How to avoid:** Override with explicit `className="h-11 w-11"` (44px) on icon buttons. Already done correctly on ContainerCard; apply same pattern to header buttons.
**Warning signs:** A button with only `size="icon"` and no height override in a page header.

### Pitfall 5: `@fastify/static` wildcard swallows API routes
**What goes wrong:** `GET /api/containers` returns a 404 "file not found" error from the static plugin instead of hitting the containers route handler.
**Why it happens:** Without `wildcard: false`, `@fastify/static` registers a `GET /*` route that matches before API routes if `@fastify/static` is registered before the API routes in `server.ts`.
**How to avoid:** Pass `wildcard: false` to `@fastify/static`, and register static serving before API routes. The static plugin will only serve files that actually exist in `dist/`; everything else falls through to route handlers.
**Warning signs:** API calls in DevTools show `Content-Type: text/html` responses (sending `index.html` for 404s) instead of JSON.

### Pitfall 6: iOS keyboard viewport — `dvh` vs `100vh` (already solved)
**What goes wrong:** On iOS Safari, `100vh` doesn't account for the collapsible browser chrome, causing the terminal to be clipped or the page to scroll unexpectedly when the keyboard opens.
**Why it happens:** `vh` is frozen at the maximum viewport height on iOS; `dvh` (dynamic viewport height) updates as the viewport changes.
**How to avoid:** Already done — `TerminalPage.tsx` uses `h-dvh` and `useTerminalSession.ts` has a `ResizeObserver` with RAF debounce on the terminal container. No changes needed.
**Warning signs:** Terminal doesn't fill the screen on iOS after keyboard opens.

---

## Code Examples

### Complete `index.html` with PWA meta tags

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />

    <!-- PWA manifest (generated by vite-plugin-pwa) -->
    <link rel="manifest" href="/manifest.webmanifest" />

    <!-- iOS PWA install support -->
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="ServerDeck" />
    <link rel="apple-touch-icon" href="/icon-180.png" />

    <!-- Theme color (Chrome address bar, Android task switcher) -->
    <meta name="theme-color" content="#09090b" />

    <title>ServerDeck</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### Fastify `server.ts` static serving (complete addition)

```typescript
// Source: @fastify/static v9 README [ASSUMED]
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'url'
import path from 'path'

// ── In buildServer(), after registerAuthPlugins, before API route registration ──

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_DIST = path.resolve(__dirname, '../../../web/dist')

await fastify.register(fastifyStatic, {
  root: WEB_DIST,
  prefix: '/',
  wildcard: false,   // don't register GET /* — let API routes take precedence
})

// SPA fallback — must be last, after all routes
fastify.setNotFoundHandler((_req, reply) => {
  if (_req.url.startsWith('/api')) {
    return reply.code(404).send({ error: 'Not Found' })
  }
  return reply.sendFile('index.html')
})
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual `manifest.json` + hand-written `sw.js` | `vite-plugin-pwa` (Workbox) | ~2021 | Eliminates cache-bust bugs on Vite hash-named output |
| `100vh` for full-height layouts | `100dvh` / `h-dvh` | iOS 15.4+ (2022) | Fixes terminal clipping when iOS browser chrome collapses/expands |
| `<meta name="apple-mobile-web-app-capable">` only for iOS PWA | `apple-mobile-web-app-capable` + SW registration (iOS 16.4+) | iOS 16.4 (2023) | iOS 16.4+ supports full SW-based PWA; earlier iOS only gets add-to-home-screen without SW |

**Deprecated/outdated:**
- `xworkbox-precaching` manual import: replaced by `vite-plugin-pwa`'s `GenerateSW` mode which generates the whole SW file.
- `navigator.serviceWorker.register()` manual call: `vite-plugin-pwa` with `registerType: 'autoUpdate'` handles this in the injected virtual module.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `vite-plugin-pwa` `VitePWA({ manifest: {...}, workbox: {...} })` config shape is correct for v1.3.0 | Pattern 1 | Config may have changed; verify against installed package README after `npm install` |
| A2 | `@fastify/static` `wildcard: false` prevents it from capturing `/api/*` routes | Pattern 3 | If wrong, API calls return 404; check @fastify/static v9 docs for the correct option name |
| A3 | `reply.sendFile('index.html')` is the correct method for SPA fallback in @fastify/static v9 | Pattern 3 | May be `reply.sendFile('index.html', { root: WEB_DIST })` — check docs |
| A4 | iOS 16.4+ shows PWA install prompt when SW is registered | Summary | If wrong, iOS users can still add to home screen but without SW; app still installable |
| A5 | `@vite-pwa/assets-generator` CLI command is `@vite-pwa/assets-generator --preset minimal --source` | Pattern 5 | Minor; verify from package README after install |
| A6 | xterm.js v6 (installed as `^6.0.0`) handles `autocorrect`/`autocapitalize` on its internal textarea automatically | Phase Req MOBL-04 | If wrong, physical keyboard on iOS may still trigger autocorrect in terminal; test on device |

---

## Open Questions

1. **Does the existing Vite proxy config need updating for the SW route in dev?**
   - What we know: The proxy only forwards `/api` requests. The SW is not active in dev (`devOptions.enabled: false`).
   - What's unclear: Whether any test of the production SW path is needed in dev.
   - Recommendation: Keep `devOptions.enabled: false`; test SW in a production build preview (`vite preview` or against the Fastify server serving `dist/`).

2. **`@fastify/static` `wildcard: false` exact behavior with SPA fallback**
   - What we know: [ASSUMED] `wildcard: false` disables the catch-all `GET /*` route.
   - What's unclear: Whether `setNotFoundHandler` fires for unmatched routes when static files aren't found, or whether a different fallback mechanism is needed.
   - Recommendation: Test with `curl -s http://localhost:3001/unknown-route` after implementing and verify it returns `index.html` content.

---

## Environment Availability

| Dependency | Required By | Available | Fallback |
|------------|------------|-----------|----------|
| Node.js | All | ✓ (project running) | — |
| `vite-plugin-pwa` | MOBL-05 | needs install | — |
| `workbox-window` | MOBL-05 | needs install | — |
| Icon files (PNG) | MOBL-05 | ✗ (not in public/) | Create manually or via assets-generator |
| `packages/web/dist/` | Static serving | ✗ (needs `pnpm build`) | Run build as part of verify step |

**Missing dependencies with no fallback:**
- Icon PNGs must exist before `vite build` succeeds (vite-plugin-pwa errors if `includeAssets` files are missing from `public/`).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected — no vitest.config, no test files |
| Config file | None |
| Quick run command | N/A |
| Full suite command | N/A |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MOBL-01 | 390px layout usable | manual | visual inspection in DevTools device emulation | N/A |
| MOBL-02 | iOS keyboard viewport | manual | test on iOS device (emulators don't reproduce) | N/A |
| MOBL-03 | 44px tap targets | manual | DevTools accessibility audit + visual check | N/A |
| MOBL-04 | Autocorrect disabled | manual | type in terminal on iOS device | N/A |
| MOBL-05 | PWA installable | manual | Chrome DevTools Application → Manifest → Installability | N/A |

### Wave 0 Gaps
- No test infrastructure exists for this phase. All validations are manual/visual. No Wave 0 setup needed.

*(Manual-only: mobile layout, touch behavior, and PWA installability cannot be meaningfully automated in a CI/unit test context without real device testing infrastructure.)*

---

## Security Domain

> `security_enforcement: true`, ASVS level 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no — no new auth logic | existing JWT cookie unchanged |
| V3 Session Management | no — sessions unchanged | existing |
| V4 Access Control | **yes** — static file serving must NOT expose auth-protected API data | `verifyAuth` scoped to `/api/*` only; manifest/SW/icons are display metadata only, no secrets |
| V5 Input Validation | no — no new inputs | existing |
| V6 Cryptography | no | existing |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| PWA manifest disclosing server info | Information Disclosure | Manifest fields contain only UI metadata (`name`, `icons`, `theme_color`) — no hostnames, no JWT secrets, no API endpoints |
| SW caching stale auth state | Elevation of Privilege | SW only precaches static assets (JS/CSS/HTML), not API responses — no auth tokens are cached |
| Static files served to unauthenticated users | Information Disclosure | Acceptable — the React SPA bundle itself contains no secrets; secrets (JWT, SSH keys) are backend-only |

---

## Sources

### Primary (HIGH confidence)
- `npm view vite-plugin-pwa` — version 1.3.0, peer deps verified
- `npm view workbox-window version` — 7.4.1 verified
- `npm view workbox-build version` — 7.4.1 verified
- `slopcheck install vite-plugin-pwa workbox-window @vite-pwa/assets-generator` — all [OK]
- Codebase inspection — `server.ts`, `TerminalPage.tsx`, `DashboardPage.tsx`, `LogPage.tsx`, `ContainerCard.tsx`, `TouchToolbar.tsx`, `verify-auth.ts` — all read directly

### Secondary (MEDIUM confidence)
- `package.json` dependency audit — `@fastify/static` is listed but not registered in `server.ts` — confirmed gap via source inspection

### Tertiary (LOW confidence — see Assumptions Log)
- [ASSUMED] `vite-plugin-pwa` configuration API shape for v1.3.0
- [ASSUMED] `@fastify/static` `wildcard: false` option behavior
- [ASSUMED] iOS 16.4+ PWA install prompt behavior with SW registration
- [ASSUMED] `apple-mobile-web-app-capable` meta tag pattern (stable since iOS 9 but not verified against current Apple docs)

---

## Metadata

**Confidence breakdown:**
- What needs doing (gap analysis): HIGH — confirmed by direct code inspection
- Standard stack (vite-plugin-pwa): HIGH — verified on npm registry, slopcheck OK
- Configuration syntax (vite-plugin-pwa, @fastify/static): LOW–MEDIUM — assumed from training; must verify after install
- Tap target audit: HIGH — confirmed by inspecting every interactive element

**Research date:** 2026-05-29
**Valid until:** 2026-06-29 (libraries are stable; PWA standards don't change frequently)
