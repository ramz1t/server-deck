# Phase 7: Personal Config & Server Stats - Context

**Gathered:** 2026-05-30
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped — plan already exists)

<domain>
## Phase Boundary

Move SSH connection details (host, port, username) to server `.env` so they are never entered by
the user. Refactor the login page to show `{SSH_HOST} ServerDeck` as the heading with a
password-only form. Add a server stats panel to the dashboard (disk / RAM / uptime / /mnt/sdb
listing). Add a domain health widget that server-side checks a hardcoded list of URLs for up/down
status. Wire `VITE_API_BASE` so the frontend can be deployed against a remote API origin.

</domain>

<decisions>
## Implementation Decisions

### Auth Refactor
- SSH credentials move to `.env`: `SSH_HOST`, `SSH_PORT`, `SSH_USERNAME`
- Login body schema: `{ password }` only — no host/port/username
- Server reads env vars at login time, not from request body
- `GET /api/config` public endpoint returns `{ host }` for login heading

### Stats
- Combined SSH command with sentinel markers (`__DISK__`, `__RAM__`, `__UPTIME__`, `__MNT__`)
- 30-second module-level cache (session-agnostic, single-user personal tool)
- `free -b` for bytes; `df -B1` for 1-byte blocks (never -h)
- Domain health is server-side (avoids mixed-content / CORS browser blocks)
- Node.js built-in `fetch` with `AbortController` timeout (no new packages)

### Frontend
- `VITE_API_BASE` fallback: `import.meta.env.VITE_API_BASE || '/api'`
- `MONITORED_DOMAINS` hardcoded in `packages/web/src/config/domains.ts`
- `StatsPanel` silent-fails on error (supplementary, must not block container list)

</decisions>

<code_context>
## Existing Code Insights

- `sshExec` in `docker-ssh.ts` is module-private — `getServerStats` wraps it
- `getSession` helper is intentionally duplicated per route file (codebase pattern)
- `/api/config` must be in `EXCLUDED_PATHS` in `verify-auth.ts` AND registered in `server.ts`
- `ProtectedRoute.tsx` reads `{ host, port, username }` from `/auth/me` — do not change

</code_context>

<specifics>
## Specific Ideas

- Login heading: `{serverHost ? \`${serverHost} ServerDeck\` : 'ServerDeck'}`
- Stats display order: Uptime → RAM → Disk → /mnt/sdb
- Domain badge: green `up Nms` / red `down`

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
