# Domain Pitfalls — ServerDeck

**Domain:** Self-hosted server dashboard — Docker management + web SSH terminal + mobile UX  
**Researched:** 2025-01-25  
**Sources:** OWASP Docker Security Cheat Sheet, OWASP Node.js Security Cheat Sheet, Context7 (dockerode, ssh2, xterm.js official docs), official library READMEs

---

## Critical Pitfalls

Mistakes that cause security breaches, data loss, or complete rewrites.

---

### Pitfall 1: Docker Socket Access = Unrestricted Root

**What goes wrong:**  
The Docker UNIX socket (`/var/run/docker.sock`) is equivalent to unrestricted root access on the host. OWASP explicitly states: "Giving someone access to it is equivalent to giving unrestricted root access to your host." If a single API endpoint is unprotected — including WebSocket upgrade handlers — an unauthenticated caller can start/stop/delete containers, mount host filesystem, or exec into privileged containers to escape to the host OS.

**Why it happens:**  
Auth middleware is added to REST routes but forgotten on the WebSocket upgrade handler. Or a CSRF vulnerability lets an authenticated browser be used as a proxy. The Node.js process has a socket it trusts unconditionally, so any code path that reaches dockerode has full power.

**Consequences:**  
Full host compromise. Attacker can mount `/:/host` into a container and become root on the server.

**Prevention:**
- Authenticate **every** request before it reaches any dockerode call — including WebSocket upgrade events
- Validate session token in the HTTP Upgrade request (header or cookie) before accepting the WebSocket connection
- Add rate limiting to login (`express-rate-limit`: 5 attempts / 15 min window)
- Never allow the Docker socket file path to be user-configurable

**Warning signs:**
- Any route handler that calls dockerode without first checking `req.session` / `req.user`
- WebSocket upgrade code that accepts connections without an auth check
- Docker socket mounted as a volume in the ServerDeck container itself (self-referential risk)

**Phase:** Auth + core API setup (Phase 1/2)

---

### Pitfall 2: WebSocket Endpoints Are Not Authenticated

**What goes wrong:**  
REST endpoints get auth middleware, but the WebSocket upgrade (`ws://host/terminal`, `ws://host/logs/:id`) is handled separately in Node.js and doesn't automatically go through Express middleware. Both the SSH terminal and log-streaming WebSockets are forgotten.

**Why it happens:**  
WebSocket upgrades are HTTP `101 Switching Protocols` requests that happen before the socket is handed off to the `ws` library. Express middleware only runs if the upgrade is wired through it explicitly.

**Consequences:**  
Unauthenticated remote shell access to the server. Anyone who can reach the port gets a terminal.

**Prevention:**
```javascript
// WRONG — no auth check
wss.on('connection', (ws) => { openSSHSession(ws); });

// CORRECT — verify session in the 'upgrade' event before handing to ws
server.on('upgrade', (req, socket, head) => {
  if (!isValidSession(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
```

**Warning signs:**  
Using `new WebSocketServer({ server })` without any session validation in `connection` handler.

**Phase:** SSH terminal implementation (Phase 2/3)

---

### Pitfall 3: SSH Connection Not Closed When WebSocket Disconnects

**What goes wrong:**  
When a user closes the browser tab or loses network connectivity, the WebSocket `close` event fires on the server but the `ssh2` `Client` connection is never terminated. The SSH session stays open indefinitely. With multiple connect/disconnect cycles, the server accumulates zombie SSH sessions.

**Why it happens:**  
`ssh2` requires explicit `conn.end()` call. There is no automatic cleanup when the WebSocket closes.

**Consequences:**  
Server's SSH daemon accumulates idle sessions. If the user has started a long-running command in the shell (e.g., `tail -f`), it continues running with no one watching it. Eventually PAM login limits can be hit.

**Prevention:**
```javascript
ws.on('close', () => {
  conn.end();       // terminate SSH connection
  stream.close();   // close shell stream
});

ws.on('error', () => {
  conn.end();
  stream.close();
});

// Also handle SSH-side close
conn.on('close', () => {
  if (ws.readyState === WebSocket.OPEN) ws.close();
});
```

**Warning signs:**  
`conn.end()` only called inside the "user typed `exit`" code path, not in the WebSocket close handler.

**Phase:** SSH terminal implementation (Phase 2/3)

---

### Pitfall 4: Log Stream Memory Leak (follow: true Not Destroyed)

**What goes wrong:**  
`container.logs({ follow: true, ... })` returns a stream that stays open until explicitly destroyed. If the user navigates away or the WebSocket closes without destroying the stream, the Node.js process holds an open HTTP connection to the Docker daemon indefinitely — one per container log view.

**Why it happens:**  
Dockerode's log stream is a Node.js `Readable`; it does not self-terminate when the container stops (it waits for more data). It needs explicit destruction.

**Consequences:**  
Over time, file descriptor leaks, memory growth proportional to containers viewed, and eventual exhaustion of available Docker API connections.

**Prevention:**
```javascript
container.logs({ follow: true, stdout: true, stderr: true }, (err, logStream) => {
  if (err) return;
  
  // Demux the multiplexed stream (CRITICAL for non-TTY containers — see Pitfall 7)
  container.modem.demuxStream(logStream, stdoutPassthrough, stderrPassthrough);

  // Clean up when client disconnects
  ws.on('close', () => {
    logStream.destroy();  // ← required, not optional
  });

  logStream.on('end', () => {
    ws.close();
  });
});
```

**Warning signs:**  
`logStream` variable scoped to request but never destroyed. `ws.on('close', ...)` handler missing or only closing the WebSocket.

**Phase:** Container log streaming (Phase 2/3)

---

### Pitfall 5: Docker Event Stream Also Leaks

**What goes wrong:**  
`docker.getEvents()` returns a persistent stream that emits container lifecycle events (start, stop, die, etc.). This stream is commonly used for real-time container status updates. If it's opened per-client WebSocket connection (instead of once globally), or if the global stream is not cleaned up on app shutdown, multiple event listeners accumulate.

**Why it happens:**  
Treating the Docker events stream like a per-request resource rather than a shared application-level resource.

**Prevention:**
- Open **one** Docker events stream per app instance (not per WebSocket client)
- Broadcast events to all connected WebSocket clients via a pub/sub emitter
- Handle `stream.on('error', ...)` to reconnect if the Docker daemon restarts

**Warning signs:**  
`docker.getEvents()` called inside WebSocket `connection` handler.

**Phase:** Real-time container status (Phase 2)

---

### Pitfall 6: Session Security — Token in URL for WebSocket Auth

**What goes wrong:**  
A common workaround for WebSocket auth (since browsers can't send custom headers on WebSocket upgrade) is passing the session token as a query param: `ws://host/terminal?token=abc`. This token then appears in server logs, browser history, and HTTP Referer headers.

**Why it happens:**  
WebSocket API (`new WebSocket(url)`) doesn't support custom headers.

**Prevention:**
- Use **cookies** for session management (they are sent automatically on WebSocket upgrade)
- If using JWT, validate it in the first WebSocket message (send auth frame before opening terminal)
- Set session cookie with `httpOnly: true`, `secure: true`, `sameSite: 'strict'`

```javascript
// Session cookie setup
app.use(session({
  secret: process.env.SESSION_SECRET,  // must be crypto-random, not 'secret'
  cookie: { 
    httpOnly: true, 
    secure: true,   // requires HTTPS — enforce this
    sameSite: 'strict'
  },
  resave: false,
  saveUninitialized: false
}));
```

**Warning signs:**  
WebSocket URL constructed with `?token=...` or `?sessionId=...` query parameter.

**Phase:** Auth implementation (Phase 1)

---

### Pitfall 7: Multiplexed Docker Stream Sent Raw to Client (Binary Garbage)

**What goes wrong:**  
Docker log streams for non-TTY containers are **multiplexed** — each chunk is prefixed with an 8-byte header indicating stream type (stdout=1, stderr=2) and payload length. If you pipe this stream directly to a WebSocket without demultiplexing, the client receives binary garbage (the frame headers appear as garbled characters before every log line).

**Why it happens:**  
The dockerode README and examples both show `modem.demuxStream()` for non-TTY containers, but it's easy to miss the TTY vs non-TTY distinction. TTY containers (interactive shells) use raw streams; non-TTY containers use the multiplexed framing.

**Consequences:**  
Log output appears corrupted with strange characters at line beginnings. Difficult to diagnose because it looks like an encoding issue.

**Prevention:**
```javascript
// Check if container uses TTY
const containerInfo = await container.inspect();
const hasTty = containerInfo.Config.Tty;

container.logs({ follow: true, stdout: true, stderr: true }, (err, stream) => {
  if (hasTty) {
    // Raw stream — pipe directly
    stream.on('data', (chunk) => ws.send(chunk.toString()));
  } else {
    // Multiplexed stream — must demux
    const stdout = new stream.PassThrough();
    const stderr = new stream.PassThrough();
    container.modem.demuxStream(stream, stdout, stderr);
    stdout.on('data', (chunk) => ws.send(chunk.toString()));
    stderr.on('data', (chunk) => ws.send(chunk.toString()));
  }
});
```

**Warning signs:**  
Log output in UI shows lines starting with `\x01\x00\x00\x00\x00\x00\x00` or similar binary prefix characters.

**Phase:** Container log streaming (Phase 2/3)

---

## Moderate Pitfalls

Mistakes that cause user-facing bugs, poor UX, or require significant rework.

---

### Pitfall 8: Terminal Resize Not Propagated to SSH PTY

**What goes wrong:**  
xterm.js reports its own dimensions (columns × rows) when fit to its container. But the SSH PTY on the server doesn't know about these dimensions unless explicitly told. The default PTY size is 80×24. On mobile, the actual terminal might be 45×20 or similar, causing every command output to wrap at column 80 and produce garbled output.

**Why it happens:**  
Developers wire up xterm.js output to WebSocket correctly but forget to forward resize events. The xterm.js `onResize` event fires when `fitAddon.fit()` runs.

**Consequences:**  
Command output wraps incorrectly. `htop`, `vim`, `nano` look broken. Tab completion shows wrong column alignment.

**Prevention:**
```javascript
// xterm.js side
terminal.onResize(({ cols, rows }) => {
  ws.send(JSON.stringify({ type: 'resize', cols, rows }));
});

// Server side — when resize message received
ssh2Stream.setWindow(rows, cols, 0, 0);

// Also send initial size when shell opens
conn.shell({ term: 'xterm-256color', rows: initialRows, cols: initialCols }, ...);
```

**Warning signs:**  
Shell PTY opened without `rows`/`cols` options, or no WebSocket message handler for resize events.

**Phase:** SSH terminal implementation (Phase 2/3)

---

### Pitfall 9: iOS Safari Viewport Height / Virtual Keyboard Layout

**What goes wrong:**  
On iOS Safari, `100vh` includes the browser chrome (URL bar + toolbar). When the virtual keyboard opens, the visible area shrinks significantly, but CSS `100vh` doesn't update. The terminal container either gets cut off by the keyboard or overflows below the visible area. The `resize` event also fires when the keyboard opens/closes, triggering a storm of terminal resize events.

**Why it happens:**  
CSS `100vh` on iOS historically meant the full viewport including hidden browser UI. The keyboard appearance also changes `window.innerHeight` but not `vh` units.

**Consequences:**  
Terminal is partially obscured by keyboard on iPhone. Users can't see what they're typing. Rapid resize events cause terminal to flicker.

**Prevention:**
- Use `dvh` (dynamic viewport height) units instead of `vh` for the terminal container: `height: 100dvh`
- As fallback, use JavaScript: set terminal container height to `window.innerHeight` and update on resize
- **Debounce** the resize handler: `fitAddon.fit()` should run at most once per 100ms
- Test specifically on iPhone Safari — it behaves differently from Chrome on Android

```css
/* Modern approach — dvh has good iOS 15.4+ support */
.terminal-container {
  height: 100dvh;
}
```

```javascript
// Debounced resize
const debouncedFit = debounce(() => fitAddon.fit(), 100);
window.addEventListener('resize', debouncedFit);
```

**Warning signs:**  
Terminal layout uses `height: 100vh` in CSS. No debounce on resize handler.

**Phase:** Mobile UI implementation (Phase 3)

---

### Pitfall 10: Mobile Keyboard Autocorrect / Autocapitalize Corrupts Terminal Input

**What goes wrong:**  
iOS and Android browsers apply autocorrect, autocapitalize, and spellcheck to text input. When the user types in an xterm.js terminal, the browser may silently capitalize the first letter (breaking shell commands like `ls`), suggest replacements (corrupting flags like `-la`), or add apostrophes to words like `don't`.

**Why it happens:**  
xterm.js creates a hidden `<textarea>` for mobile input. Older versions didn't set the necessary attributes to disable autocorrect. Even if xterm handles this, React re-rendering can strip attributes.

**Consequences:**  
Commands typed on mobile are silently corrupted before being sent to the SSH session. The user sees `Ls -la` instead of `ls -la` and can't understand why commands fail.

**Prevention:**
- Modern xterm.js (5.x) sets `autocorrect="off" autocapitalize="none" autocomplete="off" spellcheck="false"` on its textarea. Verify this is preserved.
- Do not re-render or replace the xterm.js container element after terminal initialization (destroys textarea attributes)
- Test on real iOS device — emulators don't reproduce keyboard autocorrect behavior

**Warning signs:**  
Any React state update that causes the terminal container `div` to unmount/remount. Testing only on desktop browser.

**Phase:** Mobile UI implementation (Phase 3)

---

### Pitfall 11: xterm.js FitAddon Called Before DOM Layout

**What goes wrong:**  
`fitAddon.fit()` measures the container element's computed dimensions to calculate how many columns and rows fit. If called before the container is rendered in the DOM, or before CSS layout has been computed (e.g., synchronously on component mount), the container reports `0×0` and the terminal initializes with 0 columns — producing a completely broken display.

**Why it happens:**  
In React, `useEffect` runs synchronously after paint, but if the terminal container is inside a conditional render, tab panel, or animation that hasn't laid out yet, dimensions are still 0.

**Prevention:**
```javascript
useEffect(() => {
  const term = new Terminal({ ... });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(containerRef.current);
  
  // Use requestAnimationFrame to ensure layout is complete
  requestAnimationFrame(() => {
    fitAddon.fit();
  });
  
  return () => term.dispose();  // ← always dispose
}, []);
```

**Warning signs:**  
`fitAddon.fit()` called synchronously in `useEffect` without `requestAnimationFrame`. Terminal displays 0 rows or is invisible.

**Phase:** SSH terminal implementation (Phase 2/3)

---

### Pitfall 12: No Tail Limit on Initial Log Fetch

**What goes wrong:**  
Calling `container.logs({ stdout: true, stderr: true })` without a `tail` limit fetches **all logs since the container started**. A busy container (nginx, a database) may have gigabytes of logs. This blocks the Docker daemon, consumes large amounts of memory, and sends megabytes over the WebSocket before anything appears in the UI.

**Prevention:**
```javascript
// Always tail on initial fetch
container.logs({ 
  stdout: true, 
  stderr: true, 
  tail: 200,        // ← required
  timestamps: true  // ← useful for debugging
}, callback);

// Then start streaming from 'now'
container.logs({ 
  follow: true, 
  stdout: true, 
  stderr: true,
  since: Date.now() / 1000  // ← only new logs
}, streamCallback);
```

**Warning signs:**  
`container.logs()` call without `tail` option. Large initial payload in browser network tab.

**Phase:** Container log streaming (Phase 2/3)

---

### Pitfall 13: SSH Host Key Not Verified (MITM Risk for Non-localhost)

**What goes wrong:**  
By default, `ssh2` does not verify the server's host key. The `hostVerifier` option is optional, so connections silently succeed even against an unexpected server. For `localhost` connections, the risk is low (you'd need to be root to intercept). But if the server address is ever configurable or not strictly `127.0.0.1`, this is a real MITM vector.

**Prevention:**
- For connecting to `localhost`/`127.0.0.1` only (as in ServerDeck's design): document the assumption explicitly in code
- If SSH target ever becomes configurable: implement first-connect TOFU (Trust On First Use), store host key fingerprint, verify on subsequent connections — same pattern as OpenSSH `~/.ssh/known_hosts`

```javascript
conn.connect({
  host: '127.0.0.1',
  // For localhost: acceptable to skip hostVerifier
  // If host becomes configurable, add:
  // hostVerifier: (key) => verifyAgainstStoredFingerprint(key)
});
```

**Warning signs:**  
SSH target host is read from user input or config file without validation.

**Phase:** SSH terminal implementation (Phase 2/3)

---

### Pitfall 14: No SSH Reconnect / Keepalive → Silent Dead Sessions

**What goes wrong:**  
SSH connections can go "dead" — the network path drops, the server becomes unresponsive — without either side being notified. From the browser's perspective, the WebSocket is open and the terminal looks active, but typed input disappears silently.

**Why it happens:**  
TCP connections don't have application-level heartbeats by default. The OS-level `TCP_KEEPALIVE` may take 2 hours to detect a dead connection.

**Prevention:**
```javascript
conn.connect({
  host: '127.0.0.1',
  keepaliveInterval: 10000,   // send keepalive every 10s
  keepaliveCountMax: 3,       // disconnect after 3 missed keepalives (30s)
  readyTimeout: 10000         // fail fast if initial connection hangs
});

conn.on('error', (err) => {
  ws.send(JSON.stringify({ type: 'error', message: 'SSH connection lost' }));
  ws.close();
});
```

**Warning signs:**  
`keepaliveInterval` not set. No `conn.on('error', ...)` handler. No visual indicator in UI when connection is lost.

**Phase:** SSH terminal implementation (Phase 2/3)

---

### Pitfall 15: Brute-Force Attack on Login Endpoint

**What goes wrong:**  
A single-user self-hosted app with username/password auth exposed to the internet will be brute-forced by automated scanners within hours. Without rate limiting, an attacker can try millions of passwords.

**Why it happens:**  
Personal tools are built without adversarial mindset. "It's just for me" — but the login page is public.

**Prevention:**
```javascript
import rateLimit from 'express-rate-limit';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,                      // 5 attempts per IP
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/auth/login', loginLimiter, handleLogin);
```

**Warning signs:**  
No rate limiting middleware on `POST /auth/login`. No account lockout mechanism.

**Phase:** Auth implementation (Phase 1)

---

### Pitfall 16: Terminal Instance Not Disposed on React Component Unmount

**What goes wrong:**  
xterm.js `Terminal` objects hold references to DOM elements, WebGL contexts, and event listeners. If the React component unmounts (user navigates back to dashboard) without calling `terminal.dispose()`, these resources leak. On mobile, WebGL context limits are low (typically 8–16 contexts per page on iOS), causing subsequent terminal opens to fail silently.

**Why it happens:**  
`terminal.open()` is called in `useEffect`, but cleanup is forgotten or `terminal.dispose()` is not called in the return function.

**Consequences:**  
iOS: "Unable to initialize WebGL renderer" after opening terminal a few times. Desktop: memory grows with each terminal navigation.

**Prevention:**
```javascript
useEffect(() => {
  const terminal = new Terminal({ ... });
  terminal.open(containerRef.current);
  
  return () => {
    terminal.dispose();  // ← always, in every code path
  };
}, []);
```

**Warning signs:**  
`new Terminal()` in `useEffect` without `return () => terminal.dispose()`. WebGL errors in console after navigating away and back.

**Phase:** SSH terminal implementation (Phase 2/3)

---

## Minor Pitfalls

Smaller issues that cause confusion or waste debugging time.

---

### Pitfall 17: Docker Container IDs Truncated vs Full

**What goes wrong:**  
Docker container IDs are 64-character hex strings. The Docker CLI shows 12-character truncated versions. The API returns full IDs. If you store or compare truncated IDs, operations like `docker.getContainer(id)` may fail or match wrong containers when using the short form.

**Prevention:** Always use full 64-character IDs internally. Display truncated (12 chars) in the UI only.

**Phase:** Container list implementation (Phase 2)

---

### Pitfall 18: Container Status Polling Race Condition

**What goes wrong:**  
After sending `container.start()` or `container.stop()`, the operation is asynchronous. If you immediately re-fetch container status (`container.inspect()`), the container may still report the old status. The UI flickers or shows incorrect state.

**Prevention:** Listen to Docker events stream for `start`/`stop`/`die` events to update state reactively, rather than polling after mutations. Or add a brief delay and re-fetch once.

**Phase:** Container management (Phase 2)

---

### Pitfall 19: ANSI Escape Codes in Log Output Break Plain Text Display

**What goes wrong:**  
If you display raw container logs in a `<pre>` tag or similar HTML element (not in xterm.js), ANSI color codes appear as literal text: `\u001b[32mINFO\u001b[0m`. Logs from many applications (Node.js servers, databases, etc.) include color codes.

**Prevention:** 
- Render logs in xterm.js (handles ANSI natively)  
- OR strip ANSI codes server-side with a library like `strip-ansi` before sending to a plain text display

**Phase:** Container log streaming (Phase 2/3)

---

### Pitfall 20: No HTTPS Warning in Deployment

**What goes wrong:**  
Session cookies with `secure: true` are silently dropped over HTTP. The app will appear to work (login completes) but session isn't persisted — every request is unauthenticated. This is confusing because no error is thrown.

**Prevention:**
- Check `process.env.NODE_ENV` and warn at startup if HTTPS is not configured
- Document clearly: "This app must run behind a TLS-terminating reverse proxy (e.g., nginx + Let's Encrypt or Caddy)"
- Alternatively, generate a self-signed cert at startup for development mode

**Warning signs:**  
Login succeeds but every subsequent request redirects back to login. Session cookie visible in DevTools with `Secure` flag but transmitted over `http://`.

**Phase:** Auth implementation + deployment docs (Phase 1/Final)

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Auth / login route | No rate limiting → brute force (P15) | Add `express-rate-limit` on `/auth/login` from day 1 |
| Auth / sessions | Token in WebSocket URL (P6), no HTTPS (P20) | Cookie-based sessions, document HTTPS requirement |
| WebSocket setup | WS endpoints not authenticated (P2) | Add auth in HTTP `upgrade` event handler |
| Docker integration | Socket = root access (P1) | Auth check before every dockerode call |
| Docker log streaming | Multiplexed stream not demuxed (P7), memory leak (P4) | Always inspect TTY flag, always destroy stream on close |
| Docker events | Event stream per client (P5) | One global events stream, broadcast to clients |
| SSH terminal | Conn not closed on WS close (P3), no keepalive (P14) | ws.on('close') calls conn.end(); set keepaliveInterval |
| SSH terminal | PTY size not propagated (P8) | Forward xterm.js onResize to ssh2 setWindow() |
| SSH terminal | Terminal not disposed (P16) | useEffect cleanup calls terminal.dispose() |
| Mobile terminal | iOS 100vh keyboard issue (P9) | Use `dvh` units, debounce resize |
| Mobile terminal | Autocorrect corrupts input (P10) | Test on real iOS device; verify xterm textarea attributes |
| Mobile terminal | FitAddon before layout (P11) | Wrap fitAddon.fit() in requestAnimationFrame |
| Log display | No tail limit (P12) | Always pass `tail: 200` on initial fetch |
| Log display | ANSI codes in HTML display (P19) | Use xterm.js for logs or strip-ansi |

---

## Sources

| Source | Confidence | URL |
|--------|-----------|-----|
| OWASP Docker Security Cheat Sheet | HIGH | https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Docker_Security_Cheat_Sheet.md |
| OWASP Node.js Security Cheat Sheet | HIGH | https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Nodejs_Security_Cheat_Sheet.md |
| dockerode official README | HIGH | https://github.com/apocas/dockerode |
| ssh2 official README (mscdex) | HIGH | https://github.com/mscdex/ssh2 |
| xterm.js official docs | HIGH | https://xtermjs.org/docs/ |
| Context7 — dockerode streams/exec | HIGH | context7.com/apocas/dockerode |
| Context7 — ssh2 connection lifecycle | HIGH | context7.com/mscdex/ssh2 |
| Context7 — xterm.js FitAddon, dispose | HIGH | context7.com/websites/xtermjs |
