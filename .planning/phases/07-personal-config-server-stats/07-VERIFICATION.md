---
phase: 07-personal-config-server-stats
status: human_needed
verified_at: 2026-05-30
---

# Phase 7 Verification: Personal Config & Server Stats

## Automated Checks ✅

| Check | Result |
|-------|--------|
| Server TS compiles cleanly | ✅ `npx tsc --noEmit` exits 0 |
| Web build succeeds | ✅ `pnpm run build` exits 0 (built in 2.37s) |
| SSH env guards in index.ts | ✅ 3 guards (SSH_HOST, SSH_USERNAME, SSH_PORT) |
| /api/config in EXCLUDED_PATHS | ✅ present in verify-auth.ts |
| auth.ts: password-only schema | ✅ `required: ['password']` only |
| auth.ts: GET /api/config endpoint | ✅ co-located in authRoutes |
| getServerStats exported | ✅ ServerStats interface + getServerStats function |
| statsRoutes + healthRoutes registered | ✅ 4 references in server.ts (2 imports + 2 registers) |
| VITE_API_BASE fallback in axios.ts | ✅ `import.meta.env.VITE_API_BASE \|\| '/api'` |
| LoginPage: serverHost + /config fetch | ✅ 3 references found |
| StatsPanel + DomainHealthWidget in Dashboard | ✅ 4 references (2 imports + 2 usages) |
| .env.example files both present | ✅ SSH vars + VITE_API_BASE documented |

## Human Verification Needed

<human_verification>
These items require a running server with valid SSH credentials to verify:

1. **Server startup guard**: Run `node packages/server/src/index.js` WITHOUT SSH_HOST set — should print FATAL and exit immediately.

2. **GET /api/config unauthenticated**: `curl -s http://localhost:3001/api/config` — should return `{"host":"<SSH_HOST>"}` with no cookie.

3. **Password-only login**: `curl -s -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -d '{"password":"<pass>"}'` — should succeed with `{"ok":true}`.

4. **Login page heading**: Open browser at `/login` — heading should show `{SSH_HOST} ServerDeck` not just `ServerDeck`.

5. **Stats panel visible on dashboard**: After logging in, dashboard should show Uptime / RAM / Disk stats above container groups.

6. **Domain health widget**: Dashboard should show domain health badges checking the URLs in `packages/web/src/config/domains.ts`.
</human_verification>

## Requirements Coverage

| Requirement | Status |
|-------------|--------|
| CONF-01: SSH credentials in .env, server exits on missing | ✅ |
| CONF-02: /api/config public endpoint, password-only login | ✅ |
| CONF-03: VITE_API_BASE build-time config | ✅ |
| STATS-01: GET /api/stats with disk data | ✅ |
| STATS-02: RAM usage in stats | ✅ |
| STATS-03: Server uptime in stats | ✅ |
| STATS-04: /mnt/sdb structure in stats | ✅ |
| STATS-05: Domain health check widget | ✅ |
