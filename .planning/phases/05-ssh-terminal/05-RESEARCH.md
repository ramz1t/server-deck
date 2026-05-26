# Phase 5: SSH Terminal — Research

**Researched:** 2026-05-26
**Domain:** xterm.js 6 + ssh2 1.17 + Fastify 5 WebSocket + React 19
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-P5-01: "Terminal" button in sticky header on every authenticated screen. Route: `/terminal`.
- D-P5-02: Push navigation — back button or back chevron returns to dashboard.
- D-P5-03: No container-specific terminal. Always connects to server's own shell (SSH to localhost).
- D-P5-04: Full-page view. Header: back arrow, title "Terminal", connection status badge, X close button.
- D-P5-05: Terminal fills `calc(100dvh - {header height} - {toolbar height})`.
- D-P5-06: No split view. Full-screen terminal only.
- D-P5-07: Terminal container background = zinc-950 (#09090b).
- D-P5-08: Touch toolbar fixed at bottom with `env(safe-area-inset-bottom)`.
- D-P5-09: Toolbar height 44px + `env(safe-area-inset-bottom)`.
- D-P5-10: Toolbar buttons (11): Ctrl, Tab, Esc, ↑, ↓, ←, →, |, `` ` ``, ~, /.
- D-P5-11: Ctrl is a modifier: first tap arms it (active state), next toolbar tap sends ctrl sequence.
- D-P5-12: Non-Ctrl toolbar buttons write directly to xterm via `terminal.input(sequence)`.
- D-P5-13: Toolbar always visible (no dismiss).
- D-P5-14: Backend WS route: `GET /api/terminal`.
- D-P5-15: SSH config from env: `SSH_USERNAME`, `SSH_KEY_PATH`. Read at startup, fail fast if missing.
- D-P5-16: PTY shell: `conn.shell({ term: 'xterm-256color', rows: 24, cols: 80 })` as initial size.
- D-P5-17: Resize protocol: client sends `JSON.stringify({ type: 'resize', cols, rows })`. Server distinguishes via JSON.parse try/catch; non-JSON is raw PTY input.
- D-P5-18: Session teardown: `stream.destroy()` then `conn.end()` in both `ws.on('close')` AND `ws.on('error')`.
- D-P5-19: No auto-reconnect. Show "Session ended" + "Reconnect" button on close.
- D-P5-20: SSH failure: inline error with "Connection failed: {error.message}" + Retry button.
- D-P5-21: State machine: `connecting` → `connected` | `failed`.
- D-P5-22: Use `@xterm/addon-attach` (AttachAddon) for bidirectional WS data flow.
- D-P5-23: Use `@xterm/addon-fit` (FitAddon) wrapped in `requestAnimationFrame`.
- D-P5-24: xterm.js theme: zinc-950 background, zinc-200 foreground, zinc-400 cursor.
- D-P5-25: `terminal.dispose()` on component unmount — prevents WebGL context exhaustion on iOS.
- D-P5-26: Container div attributes: `autoCorrect="off" autoCapitalize="off" spellCheck={false} data-gramm="false"`.

### the agent's Discretion
- Choice of toolbar scrollability on < 375px screens.
- Exact ANSI color values for colors 0–15.
- Whether to show PTY output in the connecting/failed overlay or below it.

### Deferred Ideas (OUT OF SCOPE)
- Split view / side-by-side dashboard + terminal (v2 desktop feature)
- `docker exec` into container (future phase)
- Multiple terminal tabs (v1 out of scope)
- Terminal history persistence (future phase)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SSH-01 | User can open a web-based SSH terminal to the server | useTerminalSession hook + TerminalPage component + `/api/terminal` WS route |
| SSH-02 | Terminal connects to localhost via SSH using a pre-configured server key | `conn.connect({ host:'localhost', privateKey: fs.readFileSync(SSH_KEY_PATH) })` |
| SSH-03 | Terminal input/output streamed over WebSocket | AttachAddon bidirectional pipe; raw bytes server→client, raw input client→server |
| SSH-04 | Terminal resizes correctly when browser/keyboard changes size | ResizeObserver + FitAddon + `stream.setWindow(rows, cols, 0, 0)` |
| SSH-05 | Touch toolbar with Ctrl, Tab, Esc, arrow keys | TouchToolbar component; `terminal.input(sequence)` for each key |
| SSH-06 | SSH session cleanly terminated when user closes terminal | `stream.destroy()` + `conn.end()` in ws close/error; `terminal.dispose()` on unmount |
</phase_requirements>

---

## Summary

Phase 5 adds a full PTY-backed SSH terminal to ServerDeck. The data path is: xterm.js (browser) ↔ WebSocket ↔ Fastify WS route ↔ ssh2 Client ↔ localhost sshd. Three packages must be added to `packages/web`: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-attach`. No new packages are needed for `packages/server` — `ssh2` is already installed.

The implementation mirrors `container-logs.ts` on the backend (same WS route pattern, same teardown discipline) and `useLogStream.ts` + `LogPage.tsx` on the frontend (same WS hook pattern, same full-page layout). The key differences are: bidirectional data flow, raw binary frames instead of JSON, PTY `shell()` instead of `exec()`, and the xterm.js initialization lifecycle.

**Critical version finding:** The locked decision specifies `@xterm/xterm ^5.6.0` but no stable 5.6.x was ever released to npm. Stable versions are 5.4.0, 5.5.0, and **6.0.0**. `npm install @xterm/xterm@^5.6.0` will fail (no satisfying stable version). The correct install target is `@xterm/xterm@^6.0.0` (current stable, verified 2026-05-26).

**Primary recommendation:** Install `@xterm/xterm@^6.0.0` + `@xterm/addon-fit@^0.11.0` + `@xterm/addon-attach@^0.12.0`. Use the ssh2 key auth pattern (not session password auth). Follow the exact initialization order and teardown sequence documented below.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| PTY shell lifecycle | API/Backend (ssh2) | — | ssh2 owns Client connect, PTY open, stream teardown |
| WS ↔ PTY bidirectional pipe | API/Backend (Fastify WS route) | — | Route glues WS messages to ssh2 stream.write / stream.on('data') |
| SSH key auth config | API/Backend (server startup) | — | Env vars read at startup; fail fast if missing |
| Terminal rendering | Browser (xterm.js) | — | xterm.js owns DOM, WebGL context, ANSI rendering |
| WS ↔ terminal pipe | Browser (AttachAddon) | — | AttachAddon wires ws.onmessage → terminal.write and terminal.onData → ws.send |
| Resize calculation | Browser (FitAddon) | API/Backend (setWindow) | FitAddon measures container pixels → cols/rows; server applies to PTY |
| Resize protocol | Browser → Backend | — | Client sends JSON resize messages; server parses and calls stream.setWindow |
| Mobile toolbar | Browser (TouchToolbar) | — | Component sends escape sequences via terminal.input |
| Auth gating | API/Backend (verifyAuth preHandler) | — | JWT cookie checked before WS upgrade; same as container-logs route |
| Session teardown | API/Backend (WS route) + Browser | — | Both sides participate: server destroys stream+conn; browser disposes terminal |

---

## Standard Stack

### Core (new packages to install)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@xterm/xterm` | **6.0.0** | Browser terminal emulator | Powers VS Code integrated terminal; 20k+ stars; official Microsoft OSS [VERIFIED: npm registry] |
| `@xterm/addon-fit` | 0.11.0 | Responsive sizing (cols×rows from pixels) | Official xterm.js addon; required for mobile resize [VERIFIED: npm registry] |
| `@xterm/addon-attach` | 0.12.0 | Bidirectional WS pipe (terminal ↔ WebSocket) | Official xterm.js addon; single `loadAddon` call replaces manual ws.onmessage wiring [VERIFIED: npm registry] |

### Already Installed (no install needed)
| Library | Version | Purpose |
|---------|---------|---------|
| `ssh2` | 1.17.0 | SSH client — PTY shell spawning, resize, key auth (`packages/server`) |
| `@fastify/websocket` | 11.2.0 | Fastify WS plugin — route handler, auth hooks (`packages/server`) |
| React 19 | 19.2.6 | Component lifecycle for terminal mount/unmount (`packages/web`) |

**Installation (packages/web only):**
```bash
cd packages/web
npm install @xterm/xterm@^6.0.0 @xterm/addon-fit@^0.11.0 @xterm/addon-attach@^0.12.0
```

> ⚠️ **Version note:** The locked decisions reference `^5.6.0` but there is no stable 5.6.x release on npm. The range `^5.6.0` resolves to nothing (or a beta). Install `6.0.0` which is the current stable. See Open Questions §1.

**Version verification (run before writing installation tasks):**
```bash
npm view @xterm/xterm dist-tags        # → { latest: '6.0.0', beta: '6.1.0-beta.220' }
npm view @xterm/addon-fit dist-tags    # → { latest: '0.11.0' }
npm view @xterm/addon-attach dist-tags # → { latest: '0.12.0' }
```

---

## Package Legitimacy Audit

> slopcheck run 2026-05-26. All packages [OK].

| Package | Registry | slopcheck | Disposition |
|---------|----------|-----------|-------------|
| `@xterm/xterm` | npm | [OK] | Approved — Microsoft/xtermjs org; 6+ years |
| `@xterm/addon-fit` | npm | [OK] | Approved — official xterm.js addon |
| `@xterm/addon-attach` | npm | [OK] | Approved — official xterm.js addon |
| `ssh2` | npm | [OK] | Approved — mscdex; 10+ years; 5.8k stars |

**Packages removed due to [SLOP]:** none
**Packages flagged [SUS]:** none

---

## Backend Implementation

### Q1: ssh2 `conn.shell()` PTY API

`conn.shell(ptyOptions, callback)` — first arg is a `PseudoTtyOptions` object (or `false` to suppress PTY). The callback receives `(err: Error | undefined, stream: ClientChannel)`. `ClientChannel` is a Node.js Duplex stream.

[VERIFIED: @types/ssh2 index.d.ts in node_modules]

```typescript
// packages/server/src/routes/terminal.ts
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import type { ClientChannel } from 'ssh2'
import { Client } from 'ssh2'
import { readFileSync } from 'fs'
import { verifyAuth } from '../middleware/verify-auth.js'

// Read at module level — fail fast at startup if missing (D-P5-15)
const SSH_USERNAME = process.env.SSH_USERNAME
const SSH_KEY_PATH = process.env.SSH_KEY_PATH
if (!SSH_USERNAME || !SSH_KEY_PATH) {
  throw new Error('SSH_USERNAME and SSH_KEY_PATH must be set in environment')
}
const SSH_PRIVATE_KEY = readFileSync(SSH_KEY_PATH)  // Buffer

export const terminalRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/terminal',
    { websocket: true, preHandler: [verifyAuth] },
    (socket: WebSocket, _req) => {
      const conn = new Client()
      let stream: ClientChannel | null = null

      conn.on('ready', () => {
        // Guard: WS may have already closed while SSH was connecting
        if (socket.readyState !== 1 /* WebSocket.OPEN */) {
          conn.end()
          return
        }

        conn.shell(
          { term: 'xterm-256color', rows: 24, cols: 80 },  // initial size
          (err, shellStream) => {
            if (err) {
              try { socket.close(1011, 'SSH shell failed') } catch { /* ignore */ }
              try { conn.end() } catch { /* ignore */ }
              return
            }

            stream = shellStream

            // SSH output → WebSocket (raw bytes — NOT JSON-wrapped)
            stream.on('data', (chunk: Buffer) => {
              try { socket.send(chunk) } catch { /* socket may be closed */ }
            })

            // Merge stderr into terminal output (PTY typically merges already, but be safe)
            stream.stderr.on('data', (chunk: Buffer) => {
              try { socket.send(chunk) } catch { /* ignore */ }
            })

            // SSH shell closed → close WS
            stream.on('close', () => {
              try { conn.end() } catch { /* ignore */ }
              try { socket.close() } catch { /* ignore */ }
            })
          }
        )
      })

      // WS input → SSH stream (or resize control message)
      socket.on('message', (rawMsg: Buffer | string) => {
        const text = rawMsg instanceof Buffer ? rawMsg.toString() : rawMsg
        try {
          const msg = JSON.parse(text) as { type: string; cols: number; rows: number }
          if (msg.type === 'resize' && stream) {
            stream.setWindow(msg.rows, msg.cols, 0, 0)  // pixel height/width = 0,0
            return
          }
        } catch { /* not JSON → raw PTY input */ }
        // Write raw input to PTY stdin
        try { if (stream) stream.write(rawMsg) } catch { /* ignore */ }
      })

      conn.on('error', (err) => {
        fastify.log.error({ err }, 'terminal SSH error')
        try { conn.end() } catch { /* ignore */ }
        try { socket.close(1011, 'SSH error') } catch { /* ignore */ }
      })

      // WS closed (D-P5-18) — stream.destroy() is MANDATORY, not stream.close()
      // destroy() sends SSH_MSG_CHANNEL_CLOSE; close() alone leaks the channel
      socket.on('close', () => {
        try { if (stream) stream.destroy() } catch { /* ignore */ }
        try { conn.end() } catch { /* ignore */ }
      })

      socket.on('error', () => {
        try { if (stream) stream.destroy() } catch { /* ignore */ }
        try { conn.end() } catch { /* ignore */ }
      })

      // Connect with private key auth (D-P5-15) — NOT session password
      conn.connect({
        host: 'localhost',
        port: 22,
        username: SSH_USERNAME!,
        privateKey: SSH_PRIVATE_KEY,
        readyTimeout: 10_000,
        keepaliveInterval: 0,
      })
    }
  )
}
```

**Source:** [VERIFIED: @types/ssh2 in packages/server/node_modules, container-logs.ts pattern]

---

### Q2: ssh2 Private Key Auth

`privateKey` field in `ConnectConfig` accepts `Buffer | string` — pass the raw file contents. [VERIFIED: @types/ssh2/index.d.ts `privateKey?: Buffer | string`]

```typescript
conn.connect({
  host: 'localhost',
  port: 22,
  username: process.env.SSH_USERNAME!,
  privateKey: fs.readFileSync(process.env.SSH_KEY_PATH!),  // Buffer or string, both work
  // If key is passphrase-protected:
  // passphrase: process.env.SSH_KEY_PASSPHRASE,
  readyTimeout: 10_000,
  keepaliveInterval: 0,
})
```

**⚠️ IMPORTANT DIFFERENCE FROM EXISTING CODE:** The existing `container-logs.ts` and `docker-ssh.ts` use `session.password` (password auth from the login session). The terminal route uses **env var private key auth** (D-P5-15). Do NOT copy `password: session.password` into the terminal route. The session object is not used at all in the terminal route.

---

### Q3: Error Handling — `conn.shell()` vs `conn.connect()` errors

| Error path | Handler | Response |
|-----------|---------|----------|
| `conn.connect()` network failure | `conn.on('error', ...)` | `socket.close(1011, 'SSH error')` |
| SSH key auth rejected | `conn.on('error', ...)` — same | `socket.close(1011, 'SSH error')` |
| `conn.shell()` callback `err` | Inline `if (err)` check | `socket.close(1011, 'SSH shell failed')` + `conn.end()` |
| WS closes before `conn.on('ready')` fires | Guard in `conn.on('ready')` | `conn.end()` immediately |

```typescript
// Guard in conn.on('ready') — handles race condition:
conn.on('ready', () => {
  if (socket.readyState !== 1 /* OPEN */) {
    conn.end()  // WS already gone — don't open shell
    return
  }
  conn.shell(/* ... */)
})
```

**Client-visible error:** The browser receives WS close code 1011. The frontend `ws.onclose` handler should set `status = 'failed'` regardless of close code (any non-1000 code means error). The actual error message can be read from the WS close reason string in the `CloseEvent.reason` field.

---

### Q4: `stream.setWindow()` — resize API

```typescript
// Signature (from @types/ssh2):
stream.setWindow(rows: number, cols: number, height: number, width: number): void
```

- `rows` and `cols` are character dimensions (what the terminal uses)
- `height` and `width` are pixel dimensions — pass `0, 0` (not required for shell behavior)
- Order is `rows, cols` — **not** cols, rows. A common bug is swapping these.

```typescript
// Correct call (D-P5-17):
stream.setWindow(msg.rows, msg.cols, 0, 0)
// NOT: stream.setWindow(msg.cols, msg.rows, 0, 0)  ← wrong order
```

[VERIFIED: @types/ssh2/index.d.ts `setWindow(rows, cols, height, width)`]

---

### Q5: Zombie Prevention Pitfalls

Without proper teardown, SSH sessions outlive the WS connection. The established pattern (from `container-logs.ts`) requires **both** `stream.destroy()` AND `conn.end()`:

| Step | Method | Why |
|------|--------|-----|
| 1 | `stream.destroy()` | Sends `SSH_MSG_CHANNEL_CLOSE` + EOF to sshd; kills the PTY process (SIGPIPE/SIGHUP) |
| 2 | `conn.end()` | Closes the SSH transport connection; releases the TCP socket |

**Why not `stream.close()`?** `close()` sends only `SSH_MSG_CHANNEL_EOF` — the channel is half-closed. The server side may keep the PTY open waiting for more input. `destroy()` is unconditional teardown.

**Why not just `conn.end()`?** `conn.end()` gracefully ends the connection but may wait for the channel to close first. If the PTY is blocking, `conn.end()` may hang. `stream.destroy()` first forces the channel closed, then `conn.end()` cleans up the transport.

**Zombie scenario without teardown:** User opens terminal, runs `tail -f /var/log/syslog`, navigates away. WS closes. Without `stream.destroy()`, the `tail -f` process continues running on the server with no reader. SSH session stays in `sshd -p 22` process list indefinitely. Repeat 10 times → 10 zombie tails.

---

### Q6: Fastify 5 WebSocket `socket` Parameter Type

The `socket` parameter is `WebSocket.WebSocket` from the `ws` package (re-exported as `fastifyWebsocket.WebSocket`). [VERIFIED: @fastify/websocket/types/index.d.ts]

```typescript
import type { WebSocket } from 'ws'

// socket.on('message') delivers messages as Buffer | ArrayBuffer | Buffer[]
// In practice with @fastify/websocket, binary frames arrive as Buffer
socket.on('message', (rawMsg: Buffer | string) => {
  // Always normalize to string/Buffer before JSON.parse:
  const text = rawMsg instanceof Buffer ? rawMsg.toString() : rawMsg
  try {
    const parsed = JSON.parse(text)
    // ...
  } catch {
    // raw PTY input — send to stream as-is
    stream?.write(rawMsg)  // write original (Buffer) to preserve binary fidelity
  }
})
```

**Important:** Write `rawMsg` (the original value, possibly Buffer) to `stream.write()`, NOT `text` (the string conversion). For resize messages, string parsing is fine. For raw keystrokes, using the original Buffer avoids unnecessary re-encoding.

---

### Q7: WS Closes While SSH Connecting

The race condition: `conn.connect()` is async. If the browser closes the WS before `conn.on('ready')` fires, the handler will still fire and try to open a shell to a closed socket.

**Prevention pattern (built into Q1 code above):**
```typescript
conn.on('ready', () => {
  // Check WS state — readyState 1 = OPEN
  if (socket.readyState !== 1) {
    conn.end()  // abandon — no WS to pipe to
    return
  }
  conn.shell(/* ... */)
})
```

The `socket.on('close')` handler also fires, which calls `conn.end()` — so there may be a double `conn.end()` call. This is safe: `conn.end()` is idempotent for the ssh2 Client. Wrap all calls in `try { } catch { /* ignore */ }` as the existing codebase does.

---

### Server Registration (server.ts)

Add one import and one `await fastify.register()` call after `containerLogsRoute`:

```typescript
// packages/server/src/server.ts
import { terminalRoute } from './routes/terminal.js'      // ← add

// Inside buildServer():
await fastify.register(containerLogsRoute)
await fastify.register(terminalRoute)                     // ← add after containerLogsRoute
```

**Note:** `@fastify/websocket` is already registered first (`await fastify.register(websocket)` at line 32 of server.ts). No change to plugin registration order needed.

---

## Frontend Implementation

### Q8: xterm.js Initialization Order

The initialization must be split into two phases: **DOM mount** (synchronous in useEffect) and **WS connect** (async, after DOM is ready).

```typescript
// packages/web/src/hooks/useTerminalSession.ts
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import type { ITerminalOptions } from '@xterm/xterm'
import { AttachAddon } from '@xterm/addon-attach'
import { FitAddon } from '@xterm/addon-fit'

export type TerminalStatus = 'connecting' | 'connected' | 'disconnected' | 'failed'

export function useTerminalSession(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [status, setStatus] = useState<TerminalStatus>('connecting')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // ── Phase 1: DOM Mount ──────────────────────────────────────
    const terminal = new Terminal(XTERM_OPTIONS)
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)  // mounts into DOM div
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // ── Phase 2: WS Connect ────────────────────────────────────
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/terminal`)
    wsRef.current = ws
    ws.binaryType = 'arraybuffer'  // receive binary as ArrayBuffer for xterm compatibility

    ws.onopen = () => {
      // Wire bidirectional pipe: WS ↔ terminal
      const attachAddon = new AttachAddon(ws)
      terminal.loadAddon(attachAddon)

      // FitAddon MUST run after DOM layout — use requestAnimationFrame (D-P5-23)
      requestAnimationFrame(() => {
        fitAddon.fit()
        // Send initial size to server (D-P5-17)
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
        }
        setStatus('connected')
      })
    }

    ws.onclose = (ev) => {
      if (ev.code === 1000) {
        setStatus('disconnected')  // clean close (session ended)
      } else {
        setStatus('failed')
        setErrorMsg(ev.reason || 'Connection closed unexpectedly')
      }
    }

    ws.onerror = () => {
      setStatus('failed')
      setErrorMsg('WebSocket connection failed')
    }

    // ── Phase 3: Resize Observer ───────────────────────────────
    let rafId: number | null = null
    const observer = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        fitAddon.fit()
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
        }
      })
    })
    if (containerRef.current) observer.observe(containerRef.current)

    // ── Cleanup ────────────────────────────────────────────────
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      observer.disconnect()
      terminal.dispose()  // MUST call — prevents WebGL context exhaustion on iOS (D-P5-25)
      ws.close()          // triggers server-side stream.destroy() + conn.end() (D-P5-18)
    }
  }, [containerRef])

  // Toolbar key sender — terminal.input() triggers onData → AttachAddon → ws.send
  function sendKey(sequence: string) {
    terminalRef.current?.input(sequence)
  }

  return { status, errorMsg, sendKey }
}
```

**Initialization order summary:**
1. `new Terminal(options)` + `loadAddon(fitAddon)` — must precede `open()`
2. `terminal.open(containerRef.current)` — attaches to DOM; terminal is now renderable
3. `new WebSocket(url)` — connect async
4. `ws.onopen`: `new AttachAddon(ws)` + `terminal.loadAddon(attachAddon)` — wire pipe
5. `requestAnimationFrame(() => fitAddon.fit())` — AFTER layout, AFTER open
6. Send initial `{ type: 'resize' }` message
7. `new ResizeObserver(...)` on container — for dynamic resize

---

### Q9: xterm.js Terminal Options

```typescript
// packages/web/src/hooks/useTerminalSession.ts (or constants file)
import type { ITerminalOptions } from '@xterm/xterm'

const XTERM_OPTIONS: ITerminalOptions = {
  theme: {
    background:         '#09090b',  // zinc-950 (D-P5-24)
    foreground:         '#e4e4e7',  // zinc-200
    cursor:             '#a1a1aa',  // zinc-400
    cursorAccent:       '#09090b',  // zinc-950 (cursor text contrast)
    selectionBackground:'rgba(161,161,170,0.3)',
    black:        '#18181b',  // zinc-900
    brightBlack:  '#52525b',  // zinc-600
    red:          '#ef4444',  brightRed:    '#f87171',
    green:        '#22c55e',  brightGreen:  '#4ade80',
    yellow:       '#eab308',  brightYellow: '#facc15',
    blue:         '#3b82f6',  brightBlue:   '#60a5fa',
    magenta:      '#a855f7',  brightMagenta:'#c084fc',
    cyan:         '#06b6d4',  brightCyan:   '#22d3ee',
    white:        '#d4d4d8',  brightWhite:  '#fafafa',
  },
  fontFamily:   "'Menlo', 'Monaco', 'Courier New', monospace",
  fontSize:     13,
  lineHeight:   1.2,
  cursorStyle:  'block',
  cursorBlink:  true,
  scrollback:   1000,
  allowTransparency: false,
  convertEol:   true,
}
```

**Mobile-relevant options:**
- `convertEol: true` — converts `\n` to `\r\n` (PTYs expect `\r\n`; prevents cursor jumping to column 0)
- `scrollback: 1000` — reasonable buffer; larger values increase memory on mobile
- `allowTransparency: false` — keeps WebGL renderer path simple (transparency requires canvas fallback)
- `fontSize: 13` — readable on 390px screen without requiring scroll

---

### Q10: AttachAddon — WS ↔ Terminal Pipe

`AttachAddon` is fully bidirectional when constructed with `new AttachAddon(ws)` (bidirectional is the default — no option needed). [VERIFIED: npm registry + @types inference]

**What it does internally:**
- `ws.onmessage` → `terminal.write(event.data)` (server output → terminal display)
- `terminal.onData` subscription → `ws.send(data)` (user input → server)

**Consequence for toolbar keys:** Call `terminal.input(sequence)` to trigger `onData` → AttachAddon intercepts and sends via `ws.send`. Do NOT call `ws.send(sequence)` separately — that would double-send the keystroke to the PTY (you would see the character twice in the terminal). [ASSUMED — based on xterm.js/AttachAddon architecture; test required]

```typescript
// CORRECT: single send path via terminal.input → onData → AttachAddon → ws.send
function sendKey(sequence: string) {
  terminal.input(sequence)  // fires onData; AttachAddon sends to WS
}

// WRONG: double send
function sendKey(sequence: string) {
  terminal.input(sequence)  // AttachAddon sends it
  ws.send(sequence)         // sends AGAIN → double keypress on server
}
```

**AttachAddon disposal:** Call `attachAddon.dispose()` before `terminal.dispose()` in cleanup. This unsubscribes the `onData` handler, preventing a write-to-closed-socket error after the WS is gone.

---

### Q11: ResizeObserver for iOS Keyboard

iOS Safari fires layout changes (changing `dvh`) when the virtual keyboard appears. With `height: calc(100dvh - ...)`, the container div shrinks when the keyboard opens.

```typescript
const observer = new ResizeObserver((entries) => {
  // ResizeObserver fires synchronously before paint in some browsers.
  // Wrap in RAF to avoid calling fitAddon.fit() during layout (causes 0×0 calculation).
  requestAnimationFrame(() => {
    fitAddon.fit()
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'resize',
        cols: terminalRef.current!.cols,
        rows: terminalRef.current!.rows,
      }))
    }
  })
})
observer.observe(containerRef.current!)
```

**iOS keyboard sequence of events:**
1. User taps inside terminal → keyboard opens
2. `dvh` recalculates (iOS 16+) → container div shrinks
3. ResizeObserver fires → RAF → `fitAddon.fit()` → new cols/rows → resize JSON sent
4. Server calls `stream.setWindow(rows, cols, 0, 0)` → PTY resizes
5. Output re-flows to new width

**Key iOS requirement:** Use `height: calc(100dvh - var(--terminal-header-height) - var(--toolbar-height))` on the container div (not `svh` or `vh`). `dvh` is the only unit that reflects the keyboard-adjusted visible height on iOS 16+. [ASSUMED — based on extensive iOS Safari research documented in STATE.md and PITFALLS.md]

---

### Q12: Cleanup Order in useEffect Return

```typescript
return () => {
  // 1. Stop ResizeObserver (prevents new RAF/fit calls during teardown)
  if (rafId) cancelAnimationFrame(rafId)
  observer.disconnect()

  // 2. Dispose terminal BEFORE closing WS
  //    terminal.dispose() removes WebGL context, DOM listeners, onData handler
  //    If WS is still open when dispose runs, AttachAddon may try to send — that's fine,
  //    dispose() handles it gracefully
  terminal.dispose()  // ← D-P5-25: MUST be called; prevents WebGL context exhaustion on iOS

  // 3. Close WS last — triggers server-side cleanup (stream.destroy + conn.end)
  ws.close()
}
```

**Why `terminal.dispose()` before `ws.close()`:** `terminal.dispose()` removes the `onData` subscription that AttachAddon added. This prevents AttachAddon from trying to `ws.send()` after the terminal is disposed. If WS were closed first, AttachAddon might still receive a terminal data event and try to send on a closed socket — harmless but noisy.

**iOS WebGL context limit:** iOS Safari limits WebGL contexts per page to ~8. Each `terminal.open()` creates a WebGL context. Without `terminal.dispose()`, navigating Terminal → Dashboard → Terminal 8+ times will exhaust the limit and xterm.js falls back to the Canvas renderer (or fails silently). This is a real production bug on mobile.

---

### Q13: iOS WebKit-Specific Bugs

| Bug | Mitigation | Implementation |
|-----|-----------|----------------|
| Autocorrect corrupts terminal input | `autoCorrect="off" autoCapitalize="off" spellCheck={false} data-gramm="false"` on container div | D-P5-26: apply to the `<div ref={containerRef}>` element |
| Keyboard pushes viewport (100vh bug) | Use `dvh` units + ResizeObserver fit | D-P5-05: `height: calc(100dvh - ...)` |
| WebGL context exhaustion | `terminal.dispose()` on unmount | D-P5-25 |
| Zoom on input focus | xterm.js manages its own focus model — no `<input>` element to trigger zoom | No action needed |
| Touch scroll conflict with terminal scroll | `touch-action: none` on terminal container (`touch-none` Tailwind class) | Add to container div |
| Page scroll while typing | Terminal container gets `overflow: hidden` (FitAddon constrains to exact size) | Handled by FitAddon |
| Tap to focus not working | `xterm.js` handles its own focus via a hidden textarea; container div doesn't need `tabIndex` | No action needed for desktop; on mobile, first tap may open keyboard |

**Note on autocorrect:** xterm.js 5.x+ sets these attributes on its internal `<textarea>`. But React re-rendering the container div may strip custom attributes applied to a parent. The D-P5-26 attributes should be on the container `<div>` (parent), not inside xterm's internal elements. [ASSUMED — xterm.js sets its own textarea attrs; parent div attrs are belt-and-suspenders for Grammarly and browser-level autocorrect]

---

## Component Architecture

### File Structure

```
packages/
├── server/src/
│   └── routes/
│       └── terminal.ts           ← new WS route (mirrors container-logs.ts)
└── web/src/
    ├── hooks/
    │   └── useTerminalSession.ts ← new WS+xterm hook (mirrors useLogStream.ts)
    ├── pages/
    │   └── TerminalPage.tsx      ← new full-page component (mirrors LogPage.tsx)
    └── components/
        └── TouchToolbar.tsx      ← new mobile toolbar component
```

**Modified files:**
- `packages/server/src/server.ts` — add `terminalRoute` import + register
- `packages/web/src/App.tsx` — add `<Route path="terminal" element={<TerminalPage />} />`
- `packages/web/src/pages/DashboardPage.tsx` — add Terminal button to sticky header

### TerminalPage Layout Skeleton

```tsx
// packages/web/src/pages/TerminalPage.tsx
export function TerminalPage() {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const { status, errorMsg, sendKey } = useTerminalSession(containerRef)

  return (
    <div className="min-h-dvh flex flex-col bg-[#09090b]">
      <header className="sticky top-0 z-10 bg-[#09090b]/80 backdrop-blur border-b border-zinc-800 px-4 py-3 flex items-center gap-3"
              style={{ '--terminal-header-height': '57px' } as React.CSSProperties}>
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                onClick={() => navigate(-1)} aria-label="Back to dashboard">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="font-semibold flex-1 truncate">Terminal</h1>
        <ConnectionBadge status={status} />
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                onClick={() => navigate(-1)} aria-label="Close terminal">
          <X className="h-4 w-4" />
        </Button>
      </header>

      <main className="flex-1 relative overflow-hidden">
        {/* Connecting overlay */}
        {status === 'connecting' && <ConnectingOverlay />}
        {/* Failed overlay */}
        {status === 'failed' && <FailedOverlay message={errorMsg} onRetry={() => navigate(0)} />}

        {/* xterm.js mount point — always rendered (opacity-0 when not connected) */}
        <div
          ref={containerRef}
          className="w-full touch-none"
          style={{
            height: 'calc(100dvh - var(--terminal-header-height, 57px) - var(--toolbar-height, calc(44px + env(safe-area-inset-bottom))))',
            background: '#09090b',
            opacity: status === 'connected' ? 1 : 0,
          }}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-gramm="false"
        />
      </main>

      <TouchToolbar onKey={sendKey} />
    </div>
  )
}
```

---

## Known Pitfalls

### Pitfall 1: `@xterm/xterm ^5.6.0` — No Stable Release Exists
**What goes wrong:** Running `npm install @xterm/xterm@^5.6.0` fails or installs a beta (5.6.0-beta.143). The range has no satisfying stable version.
**Why it happens:** The locked decision was written before 6.0.0 was released, expecting a stable 5.6.0 that never shipped.
**Fix:** Install `@xterm/xterm@^6.0.0`. Stable versions: 5.4.0, 5.5.0, **6.0.0** (current).
**Confidence:** HIGH [VERIFIED: npm registry, `npm view @xterm/xterm versions`]

---

### Pitfall 2: Terminal Route Uses Env Key Auth, Not Session Password Auth
**What goes wrong:** Copying `conn.connect()` from `container-logs.ts` or `docker-ssh.ts` will include `password: session.password`. The terminal route uses `privateKey: SSH_PRIVATE_KEY` from env.
**Why it happens:** All existing SSH connections in this codebase use session password auth. The terminal route is the only key-auth connection.
**Fix:** See Q2 code above. Do NOT include `password` field. Read `SSH_USERNAME` and `SSH_KEY_PATH` from environment at module load time.

---

### Pitfall 3: `setWindow(rows, cols, ...)` — Argument Order
**What goes wrong:** PTY resizes to the wrong dimensions. A 120-column terminal behaves as if it has 24 columns.
**Why it happens:** The type signature is `setWindow(rows, cols, height, width)` — rows first, then cols. It's backwards from CSS (width × height).
**Fix:** `stream.setWindow(msg.rows, msg.cols, 0, 0)` — always double-check the argument order.
**Confidence:** HIGH [VERIFIED: @types/ssh2]

---

### Pitfall 4: `stream.close()` Instead of `stream.destroy()` on WS Close
**What goes wrong:** SSH zombie sessions accumulate. PTY processes on the server run indefinitely.
**Why it happens:** `stream.close()` sends EOF but not `SSH_MSG_CHANNEL_CLOSE`. The server-side PTY may wait for more input.
**Fix:** Always use `stream.destroy()` in `ws.on('close')` and `ws.on('error')`. This is already the pattern in `container-logs.ts`.

---

### Pitfall 5: Double-Sending Toolbar Keystrokes
**What goes wrong:** Each toolbar key press sends the character twice to the PTY. The user sees double characters in the terminal.
**Why it happens:** Calling both `terminal.input(sequence)` AND `ws.send(sequence)` for toolbar keys. `terminal.input()` fires `onData`, which AttachAddon intercepts and sends via `ws.send()`. Calling `ws.send()` separately adds a second copy.
**Fix:** Use `terminal.input(sequence)` only for toolbar keys. AttachAddon handles the WS send automatically. [ASSUMED — verify during implementation]

---

### Pitfall 6: `fitAddon.fit()` Called Before DOM Layout
**What goes wrong:** Terminal initializes with 0 columns, displays blank.
**Why it happens:** `fitAddon.fit()` is called synchronously in `useEffect`, before the browser has computed the container's layout dimensions.
**Fix:** Always wrap in `requestAnimationFrame(() => fitAddon.fit())` (D-P5-23). For the initial fit, also ensure `terminal.open(containerRef.current)` has been called first.

---

### Pitfall 7: WS Closed Before SSH Ready — Dangling `conn.end()` Calls
**What goes wrong:** Multiple `conn.end()` calls, possible ECONNRESET log spam.
**Why it happens:** `ws.on('close')` fires → calls `conn.end()`. Later, `conn.on('ready')` fires (SSH is slow) → guard calls `conn.end()` again. Two concurrent `conn.end()` calls.
**Fix:** All `conn.end()` and `stream.destroy()` calls are wrapped in `try { } catch { /* ignore */ }`, which is the existing project pattern. Double-calling is harmless — the connection is already closed.

---

### Pitfall 8: Raw PTY Input Written as String Instead of Buffer
**What goes wrong:** Binary escape sequences get corrupted. Arrow keys, function keys, or special characters stop working.
**Why it happens:** Converting `rawMsg.toString()` and then writing the string back loses byte-level fidelity for multi-byte sequences.
**Fix:** For non-resize messages, write `rawMsg` (the original Buffer/string from the WS message) directly to `stream.write(rawMsg)`. Only convert to string for JSON.parse.

---

### Pitfall 9: iOS `100vh` / `svh` — Keyboard Overlap
**What goes wrong:** Virtual keyboard covers the bottom of the terminal. User cannot see what they're typing.
**Why it happens:** CSS `100vh` and `100svh` include the keyboard area on iOS. Container doesn't shrink when keyboard appears.
**Fix:** Use `height: calc(100dvh - ...)`. `dvh` (dynamic viewport height) reflects the current visible height including keyboard state on iOS 16+.

---

### Pitfall 10: Global `verifyAuth` Hook Does NOT Fire on WS Upgrades in Fastify 5
**What goes wrong:** Terminal WebSocket is accessible without authentication.
**Why it happens:** `fastify.addHook('preHandler', verifyAuth)` fires for REST routes but NOT for WebSocket upgrade handlers in Fastify 5 + @fastify/websocket. [VERIFIED: packages/server/src/routes/container-logs.ts pattern + 05-PATTERNS.md]
**Fix:** Always include `preHandler: [verifyAuth]` in the WS route options:
```typescript
fastify.get('/api/terminal', { websocket: true, preHandler: [verifyAuth] }, handler)
```

---

### Pitfall 11: `terminal.open()` Called Twice
**What goes wrong:** xterm.js throws "Terminal already open" or creates duplicate WebGL contexts.
**Why it happens:** React StrictMode runs `useEffect` twice in development. If `terminal.open(container)` is inside a `useEffect` with no cleanup (no `terminal.dispose()` in return), the second mount call fails.
**Fix:** Always return `terminal.dispose()` in the `useEffect` cleanup. StrictMode mount → unmount → mount will call `dispose()` between the two mounts, allowing the second `open()` to succeed.

---

## Security Domain

> `security_enforcement: true`, ASVS Level 1 (from config.json)

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | JWT cookie verified by `verifyAuth` preHandler on WS route |
| V3 Session Management | Yes | httpOnly JWT cookie; same session model as all other routes |
| V4 Access Control | Yes | `verifyAuth` ensures only authenticated users reach `/api/terminal` |
| V5 Input Validation | Partial | Resize message: JSON.parse + field access; raw PTY input is passed through (intentional) |
| V6 Cryptography | No | Key file at rest; Node.js fs.readFileSync; no custom crypto |

### SSH Key File Security (Q14)

```bash
# Required file permissions
chmod 600 $SSH_KEY_PATH  # owner read/write only

# Validate at startup
import { statSync } from 'fs'
const mode = statSync(SSH_KEY_PATH!).mode & 0o777
if (mode !== 0o600) {
  fastify.log.warn(`SSH key ${SSH_KEY_PATH} has permissions ${mode.toString(8)} — expected 600`)
  // Warn but don't fail; ssh2 will still use the key
}
```

**Note:** Unlike the `ssh` CLI client, the `ssh2` Node.js library does NOT enforce key file permissions. The check is advisory. However, it's a best practice to validate and warn at startup so operators notice misconfigured keys in logs.

### CSRF Protection (Q15)

No additional CSRF protection is needed beyond the JWT cookie auth. Reasons:
1. The JWT cookie is `SameSite: strict` (from auth setup) — cross-origin WS upgrade requests will NOT include the cookie.
2. WebSocket connections from other origins are blocked by browser SOP (different origin = no automatic cookie send for strict cookies).
3. `@fastify/websocket` with `preHandler: [verifyAuth]` validates the cookie on the WS upgrade request.

No custom CSRF token required. The cookie-based auth is sufficient. [VERIFIED: existing auth plugin setup in packages/server]

### Threat Model

| Threat | STRIDE | Mitigation |
|--------|--------|-----------|
| Unauthenticated terminal access | Elevation of Privilege | `preHandler: [verifyAuth]` on `/api/terminal` route |
| Session fixation via URL token | Information Disclosure | JWT in httpOnly cookie, never in URL; WS URL has no token param |
| SSH zombie processes | Denial of Service | `stream.destroy()` + `conn.end()` in both WS close and error handlers |
| Terminal injection via resize message | Tampering | Resize message only sets PTY dimensions; no shell injection possible |
| Private key exposure in logs | Information Disclosure | Never log `privateKey` value; only log `SSH_KEY_PATH` (the path) |
| Key file world-readable | Information Disclosure | Validate 600 permissions at startup; warn in logs |

---

## Validation Architecture

> `workflow.nyquist_validation: true` in config.json

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected — no test config in either package |
| Config file | None — Wave 0 must create |
| Quick run command | `npm test` (needs setup) |
| Full suite command | `npm test` (needs setup) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SSH-01 | Terminal page renders and shows connecting state | unit | `vitest run src/pages/TerminalPage.test.tsx` | ❌ Wave 0 |
| SSH-02 | Terminal WS route authenticates via JWT cookie | integration | `vitest run src/routes/terminal.test.ts` | ❌ Wave 0 |
| SSH-03 | Raw bytes flow from PTY to WS client | integration | mock ssh2 stream; verify socket.send called | ❌ Wave 0 |
| SSH-04 | Resize JSON triggers stream.setWindow() | unit | mock stream; send resize msg; verify setWindow args | ❌ Wave 0 |
| SSH-05 | TouchToolbar sends correct escape sequences | unit | render toolbar; fire click; verify terminal.input called with `\x03` etc. | ❌ Wave 0 |
| SSH-06 | ws.on('close') calls stream.destroy() + conn.end() | unit | mock WS close; verify both teardown calls | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** not automated (no test framework set up yet)
- **Per wave merge:** full suite once Wave 0 creates test infrastructure
- **Phase gate:** Manual verification on real device (iOS Safari) + automated unit tests

### Wave 0 Gaps
- [ ] `packages/server/src/routes/terminal.test.ts` — WS route teardown, auth, resize (SSH-02, SSH-04, SSH-06)
- [ ] `packages/web/src/hooks/useTerminalSession.test.ts` — cleanup order, resize observer (SSH-01)
- [ ] `packages/web/src/components/TouchToolbar.test.tsx` — escape sequences (SSH-05)
- [ ] Test framework: `vitest` (web) + `vitest` or `node:test` (server) — no testing dependencies detected in either package.json

**Manual verification checklist (required for phase gate — cannot be automated):**
1. Open terminal on real iOS device (Safari) — verify keyboard appears, viewport adjusts, characters typed correctly
2. Navigate away and back 10 times — verify no WebGL context exhaustion (terminal still renders)
3. SSH connection failure simulation — verify "Connection failed" UI shows with retry button
4. Run `vim` and `htop` — verify terminal resize propagates (tools fill available columns)
5. Close browser tab mid-session — verify no zombie SSH sessions in `who` or `ps aux | grep sshd`

---

## Environment Availability

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| Node.js | Both packages | ✓ (darwin) | From project environment |
| npm | Package install | ✓ | `packages/server/package-lock.json` present |
| ssh2 ^1.17.0 | Server route | ✓ 1.17.0 | Already in packages/server/package.json |
| @fastify/websocket ^11.2.0 | WS route | ✓ 11.2.0 | Already in packages/server/package.json |
| @xterm/xterm ^6.0.0 | Web package | ✗ | Not yet installed — Wave 0 install task |
| @xterm/addon-fit ^0.11.0 | Web package | ✗ | Not yet installed — Wave 0 install task |
| @xterm/addon-attach ^0.12.0 | Web package | ✗ | Not yet installed — Wave 0 install task |
| SSH_USERNAME env var | Server startup | ✗ | Not in .env.example — must add |
| SSH_KEY_PATH env var | Server startup | ✗ | Not in .env.example — must add |
| localhost sshd (port 22) | SSH connection | Unknown | Deployment requirement; not testable in dev without actual SSH setup |

**Missing dependencies with no fallback:**
- `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-attach` — required installs in Wave 0
- `SSH_USERNAME` and `SSH_KEY_PATH` env vars — server will throw at startup without them (D-P5-15 fail-fast requirement)

**Missing dependencies with fallback:**
- localhost sshd — dev/test can mock the ssh2 `Client` for unit tests

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `terminal.input(sequence)` fires `onData`, which AttachAddon intercepts to send via WS | Q10 (toolbar keys) | Double-send if wrong — toolbar keystrokes appear twice in PTY |
| A2 | xterm.js 6.0.0 has the same `Terminal`, `FitAddon`, `AttachAddon` API as 5.x | Standard Stack | API differences would require code changes during implementation |
| A3 | iOS 16+ `dvh` units correctly reflect keyboard-adjusted viewport without JS workarounds | Q11 (iOS resize) | Terminal obscured by keyboard on older iOS — would need `visualViewport` API fallback |
| A4 | Parent div `autoCorrect="off"` on terminal container prevents autocorrect bleeding through | Q13 (iOS bugs) | Commands silently capitalized on mobile — would need xterm.js internal attrs investigation |
| A5 | Fastify 5 global `addHook('preHandler')` does not fire on WS upgrades | Pitfall 10 | If wrong, `preHandler: [verifyAuth]` in route options is redundant but not harmful |

---

## Open Questions

1. **`^5.6.0` vs `^6.0.0` version alignment**
   - What we know: `npm view @xterm/xterm versions` shows stable releases 5.4.0, 5.5.0, 6.0.0. No stable 5.6.x exists.
   - What's unclear: Whether the locked decision intended 5.5.0 (which would be `^5.5.0`) or intended to track the latest stable (which is now 6.0.0).
   - Recommendation: **Use `^6.0.0`** (current stable). The API is compatible. The locked decision `^5.6.0` must be updated to `^6.0.0`. Flag this for user confirmation if needed.

2. **SSH key passphrase support**
   - What we know: `ConnectConfig.passphrase` is an optional field. `SSH_KEY_PATH` env var is required (D-P5-15) but `SSH_KEY_PASSPHRASE` is not mentioned.
   - What's unclear: Whether the deployment key will be passphrase-protected.
   - Recommendation: Read an optional `SSH_KEY_PASSPHRASE` env var; pass it only if set. Fail gracefully with a clear error if the key requires a passphrase but none is provided.

3. **Test framework selection**
   - What we know: Neither `packages/server` nor `packages/web` has a test framework configured.
   - Recommendation: Add `vitest` to both packages (consistent with Vite build tooling in `packages/web`). Covers unit + integration needs.

---

## Sources

### Primary (HIGH confidence)
- `@types/ssh2/index.d.ts` in `packages/server/node_modules` — `shell()`, `setWindow()`, `ConnectConfig`, `PseudoTtyOptions` type signatures
- `@fastify/websocket/types/index.d.ts` in `packages/server/node_modules` — `WebsocketHandler` signature, socket type
- `packages/server/src/routes/container-logs.ts` — WS route pattern, teardown discipline
- `packages/server/src/services/docker-ssh.ts` — ssh2 Client connect pattern
- `packages/server/src/server.ts` — plugin registration order
- `packages/web/src/hooks/useLogStream.ts` — WS hook lifecycle pattern
- `packages/web/src/pages/LogPage.tsx` — full-page layout pattern
- `.planning/phases/05-ssh-terminal/05-CONTEXT.md` — all 26 locked decisions
- `.planning/phases/05-ssh-terminal/05-UI-SPEC.md` — component tree, xterm options, color values
- `.planning/phases/05-ssh-terminal/05-PATTERNS.md` — file-to-analog mapping

### Secondary (MEDIUM confidence)
- `.planning/research/PITFALLS.md` — iOS viewport pitfalls, WebGL context exhaustion, resize propagation
- `.planning/research/STACK.md` — original stack research (note: based on Socket.IO/Express, adapted to Fastify/raw WS)
- `.planning/STATE.md` — locked decisions: `@fastify/websocket` auth gap, FitAddon timing, terminal dispose

### Registry Verification (HIGH confidence)
- `npm view @xterm/xterm dist-tags` → `{ latest: '6.0.0' }` — verified 2026-05-26
- `npm view @xterm/addon-fit dist-tags` → `{ latest: '0.11.0' }` — verified 2026-05-26
- `npm view @xterm/addon-attach dist-tags` → `{ latest: '0.12.0' }` — verified 2026-05-26
- `slopcheck install @xterm/xterm @xterm/addon-fit @xterm/addon-attach ssh2` → all `[OK]` — verified 2026-05-26

---

## Metadata

**Confidence breakdown:**
- Backend (ssh2 API): HIGH — verified against @types/ssh2 in node_modules and existing container-logs.ts pattern
- Frontend (xterm.js): HIGH for structure (UI-SPEC.md + PATTERNS.md); MEDIUM for AttachAddon/onData interaction (A1 assumed)
- iOS pitfalls: MEDIUM — documented in prior research and STATE.md; requires real-device validation
- Package versions: HIGH — verified via npm registry 2026-05-26

**Research date:** 2026-05-26
**Valid until:** 2026-06-26 (xterm.js and ssh2 are stable; Fastify 5 API is stable)
