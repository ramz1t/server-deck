# Phase 2: Container Dashboard — Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 delivers a working Docker container dashboard. The authenticated user can see all containers on Server B, and start/stop/restart them. The dashboard replaces the Phase 1 stub.

**In scope:** Container list (name, image, status badge, uptime), start/stop/restart actions with confirmation guard on destructive actions (stop), REST API for Docker operations, TanStack Query polling, shadcn UI components.

**Out of scope:** Real-time live updates (Phase 3), log streaming (Phase 4), SSH terminal (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### Docker Access Architecture
- **D-P2-01:** Docker operations are executed via SSH exec — the backend SSHes into Server B and runs `docker` CLI commands. This reuses the existing ssh2 connection pattern from auth and avoids complex dockerode socket tunneling or native module issues. Each API request opens a short-lived SSH connection.
- **D-P2-02:** Command: `docker ps -a --format '{{json .}}'` — outputs one JSON object per line (NDJSON). Each object has `ID`, `Names`, `Image`, `Status`, `State`, `CreatedAt` fields.
- **D-P2-03:** Action commands: `docker start <id>`, `docker stop <id>`, `docker restart <id>`. Container ID is validated against `/^[a-zA-Z0-9]+$/` before shell injection to prevent command injection.
- **D-P2-04:** SSH connection timeout: 10 seconds (same as auth). Per-request connections are acceptable for polling; Phase 3 will introduce persistent connections.

### API Design
- **D-P2-05:** `GET /api/containers` — returns array of ContainerInfo; protected by existing verifyAuth preHandler; reads session to get SSH credentials.
- **D-P2-06:** `POST /api/containers/:id/start`, `POST /api/containers/:id/stop`, `POST /api/containers/:id/restart` — returns `{ ok: true }`; validates :id format; returns 400 on invalid ID, 502 if SSH/docker command fails.
- **D-P2-07:** Container ID in URL params is validated with `/^[a-zA-Z0-9]{12,64}$/` — Docker IDs are 12-char short or 64-char full hex.

### Frontend Data Fetching
- **D-P2-08:** TanStack Query (`@tanstack/react-query`) for container list — `useQuery` with `refetchInterval: 5000` (5s polling). Phase 3 will replace polling with WebSocket events.
- **D-P2-09:** Mutations for start/stop/restart use `useMutation` with `onSuccess: () => queryClient.invalidateQueries(['containers'])`.
- **D-P2-10:** No Zustand for Phase 2 — TanStack Query handles all server state. Only local `useState` for confirmation dialog.

### UI Design
- **D-P2-11:** Container list rendered as cards (shadcn Card) stacked vertically on mobile. Each card: container name (bold), image (muted), status badge (green=running/blue=created/orange=paused/red=exited), uptime (muted small text), action buttons.
- **D-P2-12:** Status badge colors: `running` → green (bg-green-500/20 text-green-400 border border-green-500/30), `exited`/`dead` → muted zinc, `paused` → yellow, `created`/`restarting` → blue.
- **D-P2-13:** Actions per container: running → [Restart, Stop]; stopped/exited → [Start]; created/paused → [Start].
- **D-P2-14:** Stop action shows a shadcn AlertDialog confirmation: "Stop {name}? This will interrupt any running processes." Confirm → execute stop. Restart has no confirmation (non-destructive intent).
- **D-P2-15:** Dashboard layout: header bar with ServerDeck title, connected host, Log out button; scrollable container list below.
- **D-P2-16:** Loading state: skeleton cards (3 pulse placeholders) on initial load. Error state: inline error message with retry button.
- **D-P2-17:** shadcn components needed: Badge (already may not exist — add), AlertDialog (new), plus existing Card, Button.

### Integration
- **D-P2-18:** `request.session` is attached by `verifyAuth` preHandler (from Phase 1 `verify-auth.ts`). Container routes read `request.session` for SSH credentials.
- **D-P2-19:** `packages/server/src/types/session.ts` already defines `SessionData { host, port, username, password }`. The container routes cast `request as any` to access `.session` (same pattern as Phase 1).

</decisions>

<canonical_refs>
## Canonical References

- `.planning/phases/01-auth-foundation/01-CONTEXT.md` — Auth decisions (D-01–D-22), session structure
- `.planning/REQUIREMENTS.md` — CONT-01–06 requirements
- `.planning/ROADMAP.md` §Phase 2 — 5 success criteria
- `.planning/research/STACK.md` — TanStack Query, dockerode (we use SSH exec instead), shadcn components

</canonical_refs>
