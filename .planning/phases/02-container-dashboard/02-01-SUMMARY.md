---
phase: 2
plan: 01
subsystem: backend
tags: [docker, ssh, rest-api, containers]
dependency_graph:
  requires: [01-auth-foundation]
  provides: [container-list-api, container-action-api]
  affects: [packages/server]
tech_stack:
  added: []
  patterns: [ssh-exec-helper, fastify-route-plugin]
key_files:
  created:
    - packages/server/src/services/docker-ssh.ts
    - packages/server/src/routes/containers.ts
  modified:
    - packages/server/src/server.ts
decisions:
  - Used ssh2 Client per-request (no connection pooling) for simplicity and correctness in Phase 2; pooling deferred to a later phase if needed
  - Container ID validated with /^[a-zA-Z0-9]{12,64}$/ regex before interpolation into shell command to prevent injection
  - stderr from docker commands silently ignored; only exit code determines success/failure
metrics:
  duration: "143 seconds"
  completed_date: "2026-05-25"
  tasks_completed: 3
  files_created: 2
  files_modified: 1
---

# Phase 2 Plan 01: Docker SSH Service + Container REST Routes Summary

**One-liner:** SSH-backed Docker service with per-request `ssh2` connections and Fastify route plugin exposing GET /api/containers and POST /api/containers/:id/{start,stop,restart}.

## What Was Built

### `packages/server/src/services/docker-ssh.ts`
- `sshExec()` — async SSH exec helper using `ssh2` Client; opens a new connection per call, streams stdout, rejects on non-zero exit code
- `listContainers()` — runs `docker ps -a --no-trunc --format '{{json .}}'`, parses NDJSON into `ContainerInfo[]`
- `startContainer()`, `stopContainer()`, `restartContainer()` — thin wrappers around `sshExec`
- `isValidContainerId()` — validates container IDs against `/^[a-zA-Z0-9]{12,64}$/` to prevent shell injection

### `packages/server/src/routes/containers.ts`
- `GET /api/containers` — calls `listContainers`, returns array; 502 on SSH/Docker failure
- `POST /api/containers/:id/start|stop|restart` — validates ID, calls appropriate action; 400 on bad ID, 502 on failure

### `packages/server/src/server.ts`
- Added `import { containerRoutes }` and `fastify.register(containerRoutes)` after auth routes

## Verification

- ✅ `npx tsc --noEmit` — 0 errors
- ✅ `GET /api/containers` → 401 (auth gate active)
- ✅ `POST /api/containers/abc/start` → 401 (auth gate active)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The service performs real SSH connections; no mock data or placeholder values.

## Self-Check: PASSED

- ✅ `packages/server/src/services/docker-ssh.ts` — exists
- ✅ `packages/server/src/routes/containers.ts` — exists
- ✅ `packages/server/src/server.ts` — modified with containerRoutes import + register
- ✅ Commit `43a7ee6` — exists in git log
