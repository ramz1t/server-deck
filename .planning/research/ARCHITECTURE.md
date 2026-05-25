# Architecture Patterns

**Project:** ServerDeck
**Domain:** Self-hosted server dashboard (Docker monitoring + SSH terminal)
**Researched:** 2025-01-25
**Confidence:** HIGH — verified against dockerode, ssh2, xterm.js, and Socket.IO official docs

---

## Recommended Architecture

One Node.js process. Express handles HTTP + auth. Socket.IO (on the same HTTP server)
handles all real-time channels. Dockerode talks to the Unix socket. ssh2 connects to
localhost:22. React is served as a static build from Express.

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser (React SPA)                     │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Auth / Login│  │Container List│  │ SSH Terminal       │  │
│  │              │  │& Log Viewer  │  │ (xterm.js)         │  │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬─────────┘  │
│         │  REST            │ Socket.IO           │ Socket.IO  │
└─────────┼──────────────────┼─────────────────────┼───────────┘
          │ HTTPS            │ WSS (same conn)      │ WSS
          ▼                  ▼                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Node.js Process                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │               Express HTTP Server                    │    │
│  │  POST /api/auth/login                                │    │
│  │  GET  /api/containers          (JWT required)        │    │
│  │  POST /api/containers/:id/start|stop|restart         │    │
│  │  GET  /static/*                (React build)         │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                         │ shares httpServer                  │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │               Socket.IO Server                       │    │
│  │  Namespace /          → container events room        │    │
│  │  Room container:{id}:logs → log streaming            │    │
│  │  Namespace /terminal  → SSH session per socket       │    │
│  │  Middleware: validates JWT on every connection       │    │
│  └──────┬─────────────────────────┬────────────────────┘    │
│         │                         │                          │
│  ┌──────▼──────────┐   ┌──────────▼────────────────────┐    │
│  │  Docker Service │   │        SSH Service             │    │
│  │  (dockerode)    │   │        (ssh2)                  │    │
│  │                 │   │                                │    │
│  │ - listContainers│   │ - new Client() per terminal    │    │
│  │ - start/stop/   │   │ - connects to localhost:22     │    │
│  │   restart       │   │ - allocates PTY                │    │
│  │ - logs stream   │   │ - bridges stream ↔ socket      │    │
│  │ - events stream │   │ - handles resize               │    │
│  └──────┬──────────┘   └──────────┬────────────────────┘    │
│         │                         │                          │
└─────────┼─────────────────────────┼────────────────────────-┘
          │                         │
          ▼                         ▼
  /var/run/docker.sock         localhost:22 (sshd)
  (Docker daemon)              (same server)
```

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **Express Router** | HTTP REST endpoints, static file serving | Auth Middleware, Docker Service |
| **Auth Module** | Credential validation, JWT issue/verify | Express (middleware), Socket.IO (middleware) |
| **Socket.IO Server** | Multiplexed real-time channels, auth gating | Docker Service, SSH Service, React clients |
| **Docker Service** | Dockerode wrapper — list, control, stream | `/var/run/docker.sock`, Socket.IO |
| **SSH Service** | ssh2 wrapper — PTY lifecycle per session | `localhost:22`, Socket.IO per socket |
| **React SPA** | UI rendering, state management | Express (REST), Socket.IO (real-time) |

**Key boundary rule:** The Docker Service and SSH Service are the only components that
touch system resources (Docker socket, sshd). Nothing else accesses them directly.
All access must go through these services, which enforce auth at the Socket.IO layer.

---

## Data Flow

### Auth Flow

```
1. Browser → POST /api/auth/login { username, password }
2. Auth Module compares against env vars (DASH_USER / DASH_PASS)
3. On match: sign JWT (HS256, secret from env, 24h expiry)
4. Response: Set-Cookie: token=<jwt>; HttpOnly; Secure; SameSite=Strict
            + JSON { token } for programmatic use

5. All REST requests: cookie sent automatically (or Authorization: Bearer <jwt>)
6. Auth middleware verifies JWT on every protected route → 401 on failure

7. Socket.IO connect: { auth: { token } } passed in handshake
8. io.use() middleware verifies JWT → disconnect on failure
   (no auth = no real-time data, even if they bypass REST)
```

**Storage recommendation:** httpOnly cookie — survives refresh, immune to XSS.
Fall back to `sessionStorage` if cookie is not viable on mobile (it is).

---

### Container Status Flow (Event-Driven)

```
INITIAL LOAD:
  React mounts → GET /api/containers
               ← [{ id, name, state, status, image }]  (full snapshot)
  React connects Socket.IO → joins room 'containers'

REAL-TIME UPDATES:
  Docker daemon emits event (start/stop/die/kill/restart)
       ↓
  docker.getEvents() stream (opened once at server startup)
       ↓
  Docker Service parses: { Type:'container', Action, Actor.ID }
       ↓
  io.to('containers').emit('container:event', { id, action, state })
       ↓
  React: update single container in local state (no full re-fetch)

CONTAINER ACTIONS (start/stop/restart):
  React → POST /api/containers/:id/start
        → Docker Service: container.start()
        ← 200 OK  (Docker event stream confirms the state change separately)
  The resulting Docker event drives UI update — no need to return new state
```

**Polling vs events:** Use `docker.getEvents()` stream (event-driven). Do NOT poll
`listContainers` on a timer — it's wasteful and creates race conditions. The events
stream is persistent; reconnect it on error with exponential backoff.

---

### Log Streaming Flow

```
React opens log panel:
  socket.emit('logs:subscribe', { containerId })

Server handler:
  container.logs({ follow: true, stdout: true, stderr: true, tail: 100 })
  container.modem.demuxStream(stream, stdoutPassThrough, stderrPassThrough)
  stdoutPassThrough.on('data') → socket.emit('logs:data', { line, stream:'stdout' })
  stderrPassThrough.on('data') → socket.emit('logs:data', { line, stream:'stderr' })
  
  Track: activeLogStreams.set(socket.id + containerId, stream)

React receives:
  socket.on('logs:data', ({ line, stream }) → append to log buffer

React closes log panel:
  socket.emit('logs:unsubscribe', { containerId })
  Server: stream.destroy(), activeLogStreams.delete(...)

Socket disconnects unexpectedly:
  socket.on('disconnect') → destroy ALL streams for that socket.id
  (prevents Docker stream leaks)
```

---

### SSH Terminal Flow

```
React opens terminal page:
  xterm.js Terminal instance created, attached to DOM div
  socket = io('/terminal', { auth: { token } })

Server /terminal namespace:
  io.of('/terminal').use(jwtMiddleware)  ← auth gate
  
  socket.on('connect') →
    ssh2 Client: conn.connect({ host:'localhost', port:22, username, privateKey })
    conn.on('ready') → conn.shell({ term:'xterm-256color' }, (err, stream) => {
      stream.on('data') → socket.emit('terminal:output', data.toString())
      stream.on('close') → socket.disconnect()
      activeSSHSessions.set(socket.id, { conn, stream })
    })

xterm.js onData → socket.emit('terminal:input', data)
  Server: stream.write(data)

xterm.js onResize({ cols, rows }) → socket.emit('terminal:resize', { cols, rows })
  Server: stream.setWindow(rows, cols, rows * 8, cols * 8)

socket.on('disconnect') →
  conn.end(), stream.end()
  activeSSHSessions.delete(socket.id)
```

**SSH credentials for localhost:** Use the server's own SSH key pair (read from disk at
startup, path configured via env var `SSH_KEY_PATH`). Never store a password. The app
runs as the same user who owns the key, so this is a self-connection with the user's
own identity.

---

## Single-Process Layout (File Structure)

```
src/
  server/
    index.ts          ← Creates httpServer, attaches Express + Socket.IO, starts listeners
    auth/
      middleware.ts   ← JWT verify for Express routes
      routes.ts       ← POST /api/auth/login
    docker/
      service.ts      ← Dockerode singleton, exports listContainers, control, streams
      routes.ts       ← GET /api/containers, POST /api/containers/:id/action
      socket.ts       ← Socket.IO event handlers for Docker namespace
    ssh/
      service.ts      ← ssh2 Client factory
      socket.ts       ← Socket.IO /terminal namespace handlers + session lifecycle
    config.ts         ← Env var loading (DASH_USER, DASH_PASS, JWT_SECRET, SSH_KEY_PATH)
  client/
    src/
      components/
        ContainerList.tsx
        LogViewer.tsx
        Terminal.tsx
      hooks/
        useSocket.ts
        useContainers.ts
      auth/
        LoginPage.tsx
        AuthContext.tsx
```

---

## Real-Time Channel Design

**Use Socket.IO over raw WebSocket** — it provides:
- Automatic reconnection (critical for mobile networks dropping)
- Auth middleware at namespace level
- Room-based broadcasting for log subscriptions

**Three multiplexed channels over one WS connection:**

| Channel | Type | Direction | Data |
|---------|------|-----------|------|
| `/` namespace, `containers` room | Container events | Server → Client | `{id, action, state}` |
| `/` namespace, per subscription | Log streaming | Server → Client | `{line, stream}` |
| `/terminal` namespace | SSH I/O + resize | Bidirectional | raw strings + resize JSON |

**Important:** All three share one physical WebSocket connection (Socket.IO multiplexes
namespaces). Mobile browsers handle one WebSocket well; avoid creating separate raw WS
connections for logs and terminal.

---

## Security Boundaries

```
Internet
    │ HTTPS only (TLS at reverse proxy — nginx/Caddy)
    ▼
┌─────────────────────────────────────────────────┐
│  Exposed surface:                               │
│  • POST /api/auth/login  (rate-limited)         │
│  • All other routes: JWT required               │
│  • Socket.IO: JWT validated at handshake        │
└──────────────────┬──────────────────────────────┘
                   │ Internal (never exposed)
┌──────────────────▼──────────────────────────────┐
│  Protected resources:                           │
│  • /var/run/docker.sock  (Unix socket only)     │
│  • localhost:22 (SSH, internal only)            │
│  • JWT_SECRET, DASH_PASS (env vars only)        │
└─────────────────────────────────────────────────┘
```

**What is NOT exposed:**
- Docker socket is never directly accessible via API (always proxied through Docker Service)
- SSH port 22 does not need to be open to the internet — the Node.js process connects internally
- No database — no SQL injection surface
- No file upload — no path traversal surface

**Key security rules:**
1. Rate-limit `/api/auth/login` (e.g., 5 attempts / 15 min per IP)
2. JWT secret in `JWT_SECRET` env var — never hardcoded
3. httpOnly cookie prevents XSS token theft
4. SameSite=Strict cookie prevents CSRF
5. Validate all container IDs from client before passing to Docker API (reject non-hex IDs)
6. Destroy SSH sessions and log streams immediately on socket disconnect (prevent runaway processes)

---

## Suggested Build Order

Dependencies must be respected — each phase unblocks the next.

```
Phase 1 — Auth Foundation (no other phase is safe without this)
  └─ Config loading (env vars)
  └─ JWT issue + verify
  └─ POST /api/auth/login
  └─ Auth middleware (Express + Socket.IO)
  └─ React login page + token storage

Phase 2 — Container REST (requires auth)
  └─ Docker service (dockerode, /var/run/docker.sock)
  └─ GET /api/containers
  └─ POST /api/containers/:id/start|stop|restart
  └─ React container list (static, no real-time yet)

Phase 3 — Real-Time Container Status (requires Phase 2 + Socket.IO setup)
  └─ Socket.IO server setup (shares httpServer)
  └─ Socket.IO auth middleware
  └─ docker.getEvents() stream → Socket.IO broadcast
  └─ React: Socket.IO client, live status updates

Phase 4 — Log Streaming (requires Phase 3)
  └─ logs:subscribe / logs:unsubscribe socket handlers
  └─ Log stream lifecycle (create/destroy/leak prevention)
  └─ React: LogViewer component with xterm.js or simple pre

Phase 5 — SSH Terminal (requires Phase 1, independent of 2-4)
  └─ SSH service (ssh2, localhost connection)
  └─ /terminal Socket.IO namespace
  └─ PTY allocation + stream bridge
  └─ React: xterm.js Terminal component + resize handling

Phase 6 — Polish (mobile UX, error states, reconnection)
  └─ Mobile-first layout (Tailwind)
  └─ Socket.IO reconnection handling in React
  └─ Error boundaries for Docker/SSH failures
```

**Why this order:**
- Auth first: no phase should ship without it
- Container REST before real-time: validate Docker access works before adding Socket.IO complexity
- SSH is independent of Docker features — can be built in parallel with Phase 3-4 in practice
- Phase 6 is pure UX — no new backend work, safe to defer

---

## Pitfalls to Avoid

| Trap | Why it hurts | Correct approach |
|------|-------------|-----------------|
| Polling `listContainers` every N seconds | Race conditions, wasted CPU, stale data | Use `docker.getEvents()` stream |
| Opening new WebSocket per feature | Multiple connections, bad on mobile | One Socket.IO connection, multiple namespaces/rooms |
| Storing JWT in localStorage | XSS can steal token, full account takeover | httpOnly cookie |
| Not cleaning up log streams on disconnect | Memory leak + container `logs` processes accumulate | `socket.on('disconnect')` cleanup handler |
| Not cleaning up SSH connections on disconnect | `ssh2` connections leak, server accumulates sessions | Same — cleanup in disconnect handler |
| Exposing raw Docker socket errors to client | Leaks internal container IDs, image names | Sanitize all Docker API errors before returning |
| Hardcoding credentials for localhost SSH | Brittle, insecure | Use server's SSH key via `SSH_KEY_PATH` env var |

---

## Sources

- **Dockerode events/logs/streams:** https://github.com/apocas/dockerode (Context7 verified, HIGH confidence)
- **ssh2 PTY/shell:** https://github.com/mscdex/ssh2 (Context7 verified, HIGH confidence)
- **xterm.js WebSocket PTY integration:** https://xtermjs.org (Context7 verified, HIGH confidence)
- **Socket.IO auth middleware + rooms:** https://socket.io/docs/v4/ (Context7 verified, HIGH confidence)
- **Reference implementations:** Portainer (Go + Angular), Dockge (Node + Vue), Yacht (Python + Vue) — patterns cross-verified with docs
