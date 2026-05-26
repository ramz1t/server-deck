---
phase: 05-ssh-terminal
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/server/src/routes/terminal.ts
  - packages/server/src/server.ts
  - packages/server/.env.example
autonomous: true
requirements:
  - SSH-01
  - SSH-02
  - SSH-03
  - SSH-04
  - SSH-06
must_haves:
  truths:
    - "GET /api/terminal WebSocket route exists and requires authentication (verifyAuth preHandler)"
    - "Connecting to the route opens a PTY shell on the server via SSH to localhost with privateKey auth"
    - "Raw PTY output bytes are forwarded directly to the WebSocket client (no JSON wrapping)"
    - "Resize JSON messages from the client call stream.setWindow(rows, cols, 0, 0) with ROWS first"
    - "WS close/error both call stream.destroy() then conn.end() — no zombie PTY processes"
    - "Server refuses to start if SSH_USERNAME or SSH_KEY_PATH env vars are missing"
  artifacts:
    - path: "packages/server/src/routes/terminal.ts"
      provides: "Fastify WS plugin — /api/terminal PTY proxy"
      exports: ["terminalRoute"]
    - path: "packages/server/src/server.ts"
      provides: "Route registration + env validation"
      contains: "terminalRoute"
    - path: "packages/server/.env.example"
      provides: "SSH env var documentation"
      contains: "SSH_USERNAME"
  key_links:
    - from: "packages/server/src/routes/terminal.ts"
      to: "packages/server/src/middleware/verify-auth.js"
      via: "preHandler: [verifyAuth]"
      pattern: "preHandler.*verifyAuth"
    - from: "packages/server/src/routes/terminal.ts"
      to: "localhost:22 sshd"
      via: "ssh2 Client.shell()"
      pattern: "conn\\.shell"
    - from: "packages/server/src/server.ts"
      to: "packages/server/src/routes/terminal.js"
      via: "fastify.register(terminalRoute)"
      pattern: "register.*terminalRoute"
---

## Goal

Create the backend WebSocket route that proxies a PTY shell from the server's localhost SSH daemon to the browser over WebSocket, with auth gating, resize support, and clean session teardown.

## Requirements

- **SSH-01** — User can open a web-based SSH terminal to the server
- **SSH-02** — Terminal connects to localhost via SSH using a pre-configured server key
- **SSH-03** — Terminal input and output are streamed over WebSocket
- **SSH-04** — Terminal resizes correctly when the browser window or keyboard changes size (server side: `stream.setWindow`)
- **SSH-06** — SSH session is cleanly terminated when user closes the terminal

## Tasks

### Task 1 — Create `packages/server/src/routes/terminal.ts`

**File:** `packages/server/src/routes/terminal.ts` (new file — mirrors `packages/server/src/routes/container-logs.ts`)

**Implementation:**

The file is a Fastify plugin (`FastifyPluginAsync`) following the exact same structure as `container-logs.ts`. The key differences from the logs route are: (a) uses `conn.shell()` not `conn.exec()`, (b) uses privateKey auth from env vars not `session.password`, (c) is bidirectional (WS→stream as well as stream→WS), (d) routes raw bytes not JSON-wrapped lines, (e) handles a JSON resize control message.

**Imports** (use `.js` extension on all local imports — TypeScript strict ESM project-wide convention from PATTERNS.md):

```
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import type { ClientChannel } from 'ssh2'
import { Client } from 'ssh2'
import { readFileSync } from 'fs'
import { verifyAuth } from '../middleware/verify-auth.js'
import type { SessionData } from '../types/session.js'
```

Note: `SessionData` import is only for the `getSession` helper (copied verbatim from container-logs.ts); it is NOT used in `conn.connect()` for this route — this route uses env var auth, NOT session.password (D-P5-15, critical research finding #2).

**Module-level env var validation** (D-P5-15 — fail fast at startup, not at connection time):

Read `process.env.SSH_USERNAME` and `process.env.SSH_KEY_PATH` at module load. If either is absent, throw an Error immediately: `'SSH_USERNAME and SSH_KEY_PATH must be set in environment'`. Read the private key file into a Buffer with `readFileSync(SSH_KEY_PATH)` at module level — this also fails fast if the path is wrong.

**`getSession` helper** — copy verbatim from `container-logs.ts` lines 9–16 (project-wide convention; appears in three route files). Even though `session` is not used in `conn.connect()`, the helper is present for structural consistency and may be used in future.

**Route definition:**

```
export const terminalRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/terminal',
    { websocket: true, preHandler: [verifyAuth] },
    (socket: WebSocket, _req) => { ... }
  )
}
```

`preHandler: [verifyAuth]` is MANDATORY (D-P5-14) — global `addHook('preHandler', verifyAuth)` does NOT cover WebSocket upgrades in Fastify 5 (critical research finding #6).

**Handler body:**

Declare `const conn = new Client()` and `let stream: ClientChannel | null = null` at the top of the handler.

`conn.on('ready', ...)`:
  - Guard for race condition (Q7): if `socket.readyState !== 1` (WebSocket.OPEN), call `conn.end()` and return immediately. This prevents opening a shell when the client disconnected during SSH handshake.
  - Call `conn.shell({ term: 'xterm-256color', rows: 24, cols: 80 }, (err, shellStream) => { ... })` — initial PTY size (D-P5-16); actual size follows via resize message.
  - In the callback: if `err`, close socket with code 1011 and call `conn.end()`, then return.
  - Assign `stream = shellStream`.
  - Wire SSH→WS: `stream.on('data', (chunk: Buffer) => { try { socket.send(chunk) } catch {} })`
  - Wire stderr→WS: `stream.stderr.on('data', (chunk: Buffer) => { try { socket.send(chunk) } catch {} })`
  - Wire stream close: `stream.on('close', () => { try { conn.end() } catch {} ; try { socket.close() } catch {} })`

`socket.on('message', (rawMsg: Buffer | string) => { ... })`:
  - Normalize to string: `const text = rawMsg instanceof Buffer ? rawMsg.toString() : rawMsg`
  - Try `JSON.parse(text)`. If parsed object has `type === 'resize'` and stream is not null: call `stream.setWindow(msg.rows, msg.cols, 0, 0)` — **ROWS FIRST, then COLS** (D-P5-17, critical research finding #3; wrong order is a common bug). Then return.
  - catch block (not JSON → raw PTY input): `try { if (stream) stream.write(rawMsg) } catch {}` — write `rawMsg` (original Buffer), not `text` (string), to preserve binary fidelity (Q6).

`conn.on('error', (err) => { ... })`:
  - `fastify.log.error({ err }, 'terminal SSH error')`
  - `try { conn.end() } catch {}`
  - `try { socket.close(1011, 'SSH error') } catch {}`

`socket.on('close', () => { ... })` (D-P5-18 — zombie prevention):
  - `try { if (stream) stream.destroy() } catch {}` — `stream.destroy()` NOT `stream.close()`; destroy sends SSH_MSG_CHANNEL_CLOSE which kills the PTY; close() alone leaks the channel.
  - `try { conn.end() } catch {}`

`socket.on('error', () => { ... })`:
  - Same body as `socket.on('close')` — `stream.destroy()` then `conn.end()`.

`conn.connect(...)` (called LAST, after all event handlers are registered):
  ```
  conn.connect({
    host: 'localhost',
    port: 22,
    username: SSH_USERNAME,
    privateKey: SSH_PRIVATE_KEY,
    readyTimeout: 10_000,
    keepaliveInterval: 0,
  })
  ```
  Note: do NOT use `session.password` here — this route uses key-based auth (D-P5-15, critical research finding #2). `SSH_USERNAME` and `SSH_PRIVATE_KEY` are the module-level constants read at startup.

---

### Task 2 — Register route in `packages/server/src/server.ts` and update `packages/server/.env.example`

**Files modified:**
- `packages/server/src/server.ts` (modify — 2 lines added)
- `packages/server/.env.example` (modify — 3 lines added)

**`server.ts` changes:**

Add one import after the existing `containerLogsRoute` import (line 7):
```
import { terminalRoute } from './routes/terminal.js'
```

Add one register call after the existing `containerLogsRoute` registration (line 41):
```
await fastify.register(terminalRoute)
```

Do NOT change plugin registration order; `@fastify/websocket` is already registered first at line 32. No other changes to `server.ts` are needed.

**`.env.example` changes:**

Append to `packages/server/.env.example` (do not remove existing entries PORT, JWT_SECRET, LOG_LEVEL):

```
# SSH Terminal (Phase 5)
# Username on this server that has an SSH key configured for localhost access
SSH_USERNAME=your-username
# Path to the private key file used to authenticate (no passphrase, or set SSH_KEY_PASSPHRASE)
SSH_KEY_PATH=/home/your-username/.ssh/id_ed25519
# SSH_KEY_PASSPHRASE=  # Uncomment and set if your key has a passphrase
```

## Verification

1. **TypeScript compile** — `cd packages/server && npx tsc --noEmit` must exit 0 with no errors in `routes/terminal.ts` or `server.ts`.

2. **Route registered** — Start the server with valid `SSH_USERNAME` and `SSH_KEY_PATH` env vars set; `curl -s http://localhost:3001/health` returns `{"ok":true}`.

3. **Startup fail-fast** — Start the server without `SSH_USERNAME` set; the process should crash with `Error: SSH_USERNAME and SSH_KEY_PATH must be set in environment`.

4. **Auth gating** — `wscat -c ws://localhost:3001/api/terminal` (no cookie) should receive a close frame (not an open connection). Verify with: `node -e "const ws = new (require('ws'))('ws://localhost:3001/api/terminal'); ws.on('close', (code) => { console.log('closed:', code); process.exit(0); })"` — expects close code 401 or similar rejection.

5. **SSH proxy (manual)** — With a valid session cookie and sshd running on localhost: connect with a WS client, send a keystroke buffer (`echo "hello"`), and verify the PTY response bytes arrive back. Confirming in Phase frontend integration test is acceptable.

6. **Zombie prevention** — Open a WS connection to `/api/terminal`, let the shell start, then close the WS connection. Run `ps aux | grep sshd` — no new `sshd` worker processes should accumulate after repeated connect/disconnect cycles.

## Dependencies

- None (Wave 1 — no prior plans required)
- `ssh2` package already installed in `packages/server` (confirmed in RESEARCH.md)
- `@fastify/websocket` already registered in `server.ts` line 32 (no change needed)
