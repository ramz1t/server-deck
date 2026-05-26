---
phase: 05-ssh-terminal
plan: "01"
wave: 1
status: complete
commit: 1aaa6a3
---

# Phase 05 Plan 01: Backend SSH Terminal WebSocket Route — Summary

## One-liner

SSH PTY proxy WebSocket route (`/api/terminal`) using `ssh2` Client with env-var-based privateKey auth, resize support, and zombie-safe teardown.

## What Was Implemented

A new Fastify WebSocket plugin `terminalRoute` that:

1. **Validates environment at module load** — reads `SSH_USERNAME` and `SSH_KEY_PATH` from `process.env` and throws immediately if either is missing, preventing silent runtime failures.
2. **Opens a PTY shell via SSH** to `localhost:22` using `ssh2` Client with private key authentication (not session.password).
3. **Bidirectional streaming** — SSH stdout/stderr bytes forwarded directly to the WebSocket client; WebSocket messages forwarded as raw PTY input.
4. **Resize support** — JSON messages with `type: 'resize'` call `stream.setWindow(rows, cols, 0, 0)` (rows first — critical order per D-P5-17).
5. **Race condition guard** — `conn.on('ready')` checks `socket.readyState !== 1` before opening shell.
6. **Zombie-safe teardown** — `socket.on('close')` and `socket.on('error')` both call `stream.destroy()` (not `.close()`) then `conn.end()`.
7. **Auth gated** — `preHandler: [verifyAuth]` required (global hook does not cover WS upgrades in Fastify 5).

## Files Created / Modified

| File | Status | Description |
|------|--------|-------------|
| `packages/server/src/routes/terminal.ts` | Created | New PTY WebSocket route plugin |
| `packages/server/src/server.ts` | Modified | Added import + `await fastify.register(terminalRoute)` |
| `packages/server/.env.example` | Modified | Added SSH_USERNAME, SSH_KEY_PATH, SSH_KEY_PASSPHRASE docs |

## Verification Results

**TypeScript compile:** `cd packages/server && npx tsc --noEmit` → exit 0, no errors.

**Deviation auto-fixed:** TypeScript narrowing issue — ternary `rawMsg instanceof Buffer ? rawMsg.toString() : rawMsg` produced type `string | Buffer` rather than `string`, causing `TS2345` on `JSON.parse(text)`. Fixed with explicit `as string` cast: `const text: string = rawMsg instanceof Buffer ? rawMsg.toString() : (rawMsg as string)`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript type narrowing on `text` variable**
- **Found during:** Task 1, TypeScript compile verification
- **Issue:** `rawMsg instanceof Buffer ? rawMsg.toString() : rawMsg` — TypeScript does not narrow ternary result to `string`, leaving type as `string | Buffer`, which fails `JSON.parse(text)` argument check
- **Fix:** Added explicit annotation `const text: string = rawMsg instanceof Buffer ? rawMsg.toString() : (rawMsg as string)`
- **Files modified:** `packages/server/src/routes/terminal.ts`
- **Commit:** included in main commit `1aaa6a3`

All other plan specifications implemented exactly as written.

## Commit

`1aaa6a3` — feat(server): add SSH PTY terminal WebSocket route (/api/terminal)
