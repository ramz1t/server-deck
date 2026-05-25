---
phase: 03
slug: real-time-container-status
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-25
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | TypeScript + node:test (built-in, no extra install needed) |
| **Config file** | `packages/server/tsconfig.json` |
| **Quick run command** | `cd packages/server && npx tsc --noEmit` |
| **Full suite command** | `cd packages/server && npx tsc --noEmit && cd ../web && npx tsc --noEmit` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd packages/server && npx tsc --noEmit`
- **After every plan wave:** Run both `tsc --noEmit` checks (server + web)
- **Before `/gsd-verify-work`:** Full suite must be green

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-T1 | backend-ws | 1 | CONT-03 | T-03-02 | DockerEventsManager reconnects on SSH disconnect; no per-client stream opened | compile | `cd packages/server && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 03-01-T2 | backend-ws | 1 | CONT-03 | T-03-01 | WS upgrade rejected (401) for unauthenticated request; client Set cleaned up on disconnect | compile | `cd packages/server && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 03-02-T1 | frontend-ws | 2 | CONT-03 | — | WS hook opens connection on mount, cleans up on unmount, disables polling while connected | compile | `cd packages/web && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 03-02-T2 | frontend-ws | 2 | CONT-03 | — | DashboardPage shows reconnecting indicator when WS disconnected; polling resumes | compile | `cd packages/web && npx tsc --noEmit` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Phase 3 uses TypeScript compile checks as the primary automated gate. No additional test file stubs are required for Wave 0 — the compile check validates all type contracts end-to-end.

- [x] TypeScript strict mode already configured (`tsconfig.json` in both packages)
- [ ] `packages/server/src/services/docker-events.ts` — new file; compile check validates types
- [ ] `packages/server/src/routes/container-events.ts` — new file; compile check validates route types
- [ ] `packages/web/src/hooks/useContainerEvents.ts` — new file; compile check validates hook types

*Existing infrastructure covers all phase requirements — no new test framework needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Container badge updates within 2s of `docker stop <id>` from CLI | CONT-03 SC-1/SC-2 | Requires live Docker daemon on Server B + SSH connectivity | 1. Open dashboard in browser. 2. Run `docker stop <any-running-container>` on Server B CLI. 3. Observe badge changes to stopped within 2 seconds. |
| One global events stream (no per-client accumulation) | CONT-03 SC-3 | Requires server-side log inspection | 1. Open dashboard in 2 browser tabs. 2. Check server logs — should show only ONE "DockerEventsManager: stream opened" log line total, not two. |
| WS reconnects after server restart | D-P3-02 | Requires controlled server restart | 1. Open dashboard. 2. Restart Node.js server process. 3. Observe "reconnecting…" indicator then auto-reconnect within ~30s. |
| Polling fallback when WS is down | D-P3-13 | Requires network interruption simulation | 1. Open dashboard. 2. Block WS port in firewall or kill server. 3. Observe polling resumes (container list still refreshes every 5s). |
