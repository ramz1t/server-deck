---
phase: 03-real-time-container-status
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/server/src/services/docker-events.ts
  - packages/server/src/routes/container-events.ts
  - packages/server/src/server.ts
  - packages/server/package.json
autonomous: true
requirements:
  - CONT-03
must_haves:
  truths:
    - "One global SSH exec (`docker events`) is open per running server process — not per WS client"
    - "Matching container events (start/stop/die/kill/restart/pause/unpause/create/destroy) trigger a listContainers SSH exec followed by broadcast to all connected WS clients"
    - "GET /api/containers/events returns 401 when no valid sd_token cookie is present"
    - "GET /api/containers/events upgrades to WebSocket when a valid sd_token cookie is present"
    - "New WS client immediately receives the current container list upon connect"
    - "SSH disconnect triggers exponential-backoff reconnect (1s→2s→4s→…→30s max)"
    - "150ms debounce coalesces rapid consecutive events (e.g. docker restart stop+start) into one listContainers call"
  artifacts:
    - path: "packages/server/src/services/docker-events.ts"
      provides: "DockerEventsManager singleton — persistent SSH exec stream, Set<WebSocket> broadcast, backoff reconnect"
      exports: ["eventsManager"]
    - path: "packages/server/src/routes/container-events.ts"
      provides: "WS route GET /api/containers/events — adds/removes clients from eventsManager"
      exports: ["containerEventsRoute"]
    - path: "packages/server/src/server.ts"
      provides: "Registers @fastify/websocket before all routes; registers containerEventsRoute"
      contains: "fastify.register(websocket)"
  key_links:
    - from: "packages/server/src/routes/container-events.ts"
      to: "packages/server/src/services/docker-events.ts"
      via: "eventsManager.addClient(socket, session) / eventsManager.removeClient(socket)"
      pattern: "eventsManager\\.addClient"
    - from: "packages/server/src/services/docker-events.ts"
      to: "packages/server/src/services/docker-ssh.ts"
      via: "listContainers(this.session) on each matching event"
      pattern: "listContainers"
    - from: "packages/server/src/server.ts"
      to: "packages/server/src/routes/container-events.ts"
      via: "await fastify.register(containerEventsRoute)"
      pattern: "containerEventsRoute"
---

<objective>
Install @fastify/websocket, implement the DockerEventsManager singleton service, add the WebSocket route at GET /api/containers/events, and register the plugin + route in server.ts.

Purpose: Establishes the server-side half of the live-push pipeline (D-P3-01 through D-P3-11). The frontend plan depends on this endpoint existing.
Output: A running Fastify server that maintains one persistent SSH `docker events` stream and broadcasts ContainerInfo[] to all authenticated WS clients on each container lifecycle event.
</objective>

<execution_context>
@~/.copilot/get-shit-done/workflows/execute-plan.md
@~/.copilot/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/03-real-time-container-status/03-CONTEXT.md
@.planning/phases/03-real-time-container-status/03-RESEARCH.md
@.planning/phases/03-real-time-container-status/03-PATTERNS.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install packages and create DockerEventsManager service</name>
  <files>
    packages/server/src/services/docker-events.ts
    packages/server/package.json (modified by npm install)
  </files>

  <read_first>
    - packages/server/src/services/docker-ssh.ts — full file: ssh2 Client connect options, sshExec pattern, listContainers signature and return type ContainerInfo[]
    - packages/server/src/types/session.ts — SessionData interface (host, port, username, password)
    - .planning/phases/03-real-time-container-status/03-RESEARCH.md §Pattern 3 (ssh2 long-lived exec stream), §Pattern 4 (DockerEventsManager class shape), §Pattern 5 (DockerEvent NDJSON schema)
  </read_first>

  <action>
    STEP A — Install packages (run from packages/server directory):
      npm install @fastify/websocket
      npm install --save-dev @types/ws
    Both packages are pre-audited in 03-RESEARCH.md §Package Legitimacy Audit as [OK]/Approved.

    STEP B — Create packages/server/src/services/docker-events.ts implementing DockerEventsManager.

    Imports required (all with .js extension — TypeScript ESM project):
      import { Client } from 'ssh2'
      import type { WebSocket } from 'ws'
      import { listContainers } from './docker-ssh.js'
      import type { SessionData } from '../types/session.js'

    Constants at module level:
      const BACKOFF_INITIAL_MS = 1_000
      const BACKOFF_MAX_MS = 30_000
      const DEBOUNCE_MS = 150
      const WATCHED_ACTIONS = new Set(['start','stop','die','kill','restart','pause','unpause','create','destroy'])

    DockerEvent interface (private, inside the module):
      interface DockerEvent { Type: string; Action: string }

    DockerEventsManager class — private fields:
      sshClient: Client | null = null
      session: SessionData | null = null
      clients = new Set<WebSocket>()
      reconnectTimer: ReturnType<typeof setTimeout> | null = null
      debounceTimer: ReturnType<typeof setTimeout> | null = null
      retryDelay = BACKOFF_INITIAL_MS
      isRunning = false

    Public method addClient(ws: WebSocket, session: SessionData): void
      - this.clients.add(ws)
      - void this.sendCurrentList(ws)   // D-P3-10: push list to this socket immediately
      - if (!this.isRunning):
          this.session = session
          this.retryDelay = BACKOFF_INITIAL_MS
          this.startStream()

    Public method removeClient(ws: WebSocket): void
      - this.clients.delete(ws)
      // NOTE: do NOT stop the stream when clients reach 0 — stream stays open (per D-P3-02)

    Private method startStream(): void
      - if (!this.session) return
      - this.isRunning = true
      - const client = new Client()
      - this.sshClient = client
      - let buffer = ''
      - client.on('ready', () => {
          client.exec("docker events --format '{{json .}}'", (err, stream) => {
            if (err) {
              try { client.end() } catch { /* ignore */ }
              this.scheduleReconnect()
              return
            }
            stream.on('data', (chunk: Buffer) => {
              buffer += chunk.toString()
              // NDJSON: split on \n, keep incomplete last fragment in buffer
              const lines = buffer.split('\n')
              buffer = lines.pop() ?? ''
              for (const line of lines) {
                if (line.trim()) this.handleLine(line)
              }
            })
            stream.stderr.on('data', () => { /* ignore stderr */ })
            stream.on('close', () => {
              try { client.end() } catch { /* ignore */ }
              this.scheduleReconnect()
            })
          })
        })
      - client.on('error', (err) => {
          console.error('[DockerEvents] SSH error:', err.message)
          try { client.end() } catch { /* ignore */ }
          this.scheduleReconnect()
        })
      - client.connect({
          host: this.session.host,
          port: this.session.port,
          username: this.session.username,
          password: this.session.password,
          readyTimeout: 10_000,
          keepaliveInterval: 30_000,
          keepaliveCountMax: 3,
        })

    Private method scheduleReconnect(): void
      - this.isRunning = false
      - const fireAfter = this.retryDelay  // capture before doubling (first reconnect fires at 1s)
      - this.retryDelay = Math.min(this.retryDelay * 2, BACKOFF_MAX_MS)
      - if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
      - this.reconnectTimer = setTimeout(() => { this.startStream() }, fireAfter)

    Private method handleLine(line: string): void
      - try { parse JSON line as DockerEvent } catch { return }  // skip malformed JSON
      - if (event.Type === 'container' && WATCHED_ACTIONS.has(event.Action)):
          // 150ms debounce: docker restart fires stop+start within ~100ms; coalesce into one broadcast
          if (this.debounceTimer) clearTimeout(this.debounceTimer)
          this.debounceTimer = setTimeout(() => { void this.broadcastUpdate() }, DEBOUNCE_MS)

    Private async method broadcastUpdate(): Promise<void>
      - if (!this.session || this.clients.size === 0) return
      - try:
          const containers = await listContainers(this.session)
          const payload = JSON.stringify({ type: 'containers', data: containers })
          // Snapshot clients before the await so Set mutations during listContainers don't affect iteration
          for (const ws of Array.from(this.clients)):
            if (ws.readyState === 1) ws.send(payload)   // 1 === WebSocket.OPEN
        catch: { /* SSH exec failure — next event will retry */ }

    Private async method sendCurrentList(ws: WebSocket): Promise<void>
      - if (!this.session) return
      - try:
          const containers = await listContainers(this.session)
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'containers', data: containers }))
        catch: { /* SSH not yet ready — first event will push the list */ }

    Export at bottom: export const eventsManager = new DockerEventsManager()
  </action>

  <verify>
    <automated>cd packages/server && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>

  <acceptance_criteria>
    - `packages/server/package.json` dependencies include `@fastify/websocket`
    - `packages/server/package.json` devDependencies include `@types/ws`
    - `packages/server/src/services/docker-events.ts` exists and exports `eventsManager`
    - `npx tsc --noEmit` in packages/server exits with code 0 (no TypeScript errors)
    - File contains all five WATCHED_ACTIONS: start, stop, die, kill, restart, pause, unpause, create, destroy
    - File contains NDJSON buffer logic: `buffer.split('\n')` and `lines.pop()`
    - File contains debounce timer (150ms) before broadcastUpdate
    - File contains `keepaliveInterval: 30_000` in client.connect call
    - `ws.readyState === 1` guard present before every `ws.send()` call
  </acceptance_criteria>

  <done>DockerEventsManager is fully typed, compiles without errors, and implements: one global SSH exec stream, NDJSON buffering, WATCHED_ACTIONS filtering, 150ms debounce, broadcast with readyState guard, exponential backoff reconnect (1s→30s max), and immediate list push on addClient.</done>
</task>

<task type="auto">
  <name>Task 2: Create WS route and register plugin in server.ts</name>
  <files>
    packages/server/src/routes/container-events.ts
    packages/server/src/server.ts
  </files>

  <read_first>
    - packages/server/src/routes/containers.ts — full file: FastifyInstance plugin shape, getSession() helper pattern, session type cast idiom
    - packages/server/src/server.ts — full file: existing import block, registerAuthPlugins + addHook + route registration order
    - packages/server/src/middleware/verify-auth.ts — confirm it attaches session to request as `(request as unknown as Record<string,unknown>)['session']`
    - .planning/phases/03-real-time-container-status/03-RESEARCH.md §Pattern 1 (@fastify/websocket registration), §Pattern 2 (TypeScript types)
  </read_first>

  <action>
    STEP A — Create packages/server/src/routes/container-events.ts:

    Imports (all .js extensions):
      import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
      import type { WebSocket } from 'ws'
      import { eventsManager } from '../services/docker-events.js'
      import type { SessionData } from '../types/session.js'

    Copy getSession helper verbatim from containers.ts (same pattern, same comment):
      function getSession(request: FastifyRequest): SessionData {
        const session = (request as unknown as { session?: SessionData }).session
        if (!session) {
          throw new Error('session missing from request — verifyAuth did not run')
        }
        return session
      }

    Export the route plugin:
      export const containerEventsRoute: FastifyPluginAsync = async (fastify) => {
        fastify.get(
          '/api/containers/events',
          { websocket: true },
          (socket: WebSocket, req: FastifyRequest) => {
            const session = getSession(req)
            eventsManager.addClient(socket, session)
            socket.on('close', () => {
              eventsManager.removeClient(socket)
            })
          }
        )
      }

    NOTE: Belt-and-suspenders auth — add explicit `preHandler: [verifyAuth]` in the WS route options
    in addition to the global hook. The global `fastify.addHook('preHandler', verifyAuth)` fires for
    all routes, but Fastify's encapsulation model for plugin-scoped routes could theoretically differ.
    The per-route preHandler costs nothing and eliminates any ambiguity (per RESEARCH.md Open Question
    1 resolution). Import `verifyAuth` from '../middleware/verify-auth.js' in container-events.ts and
    pass `{ websocket: true, preHandler: [verifyAuth] }` as the route options object.

    STEP B — Modify packages/server/src/server.ts:

    Add two imports to the existing import block (after the existing four imports):
      import websocket from '@fastify/websocket'
      import { containerEventsRoute } from './routes/container-events.js'

    Add `await fastify.register(websocket)` IMMEDIATELY BEFORE `await registerAuthPlugins(fastify)`.
    @fastify/websocket MUST be registered first — before any route registrations and before the preHandler hook.

    The final plugin/hook/route registration order in buildServer() must be:
      1. await fastify.register(websocket)         ← NEW (must be first)
      2. await registerAuthPlugins(fastify)
      3. fastify.addHook('preHandler', verifyAuth)
      4. await fastify.register(authRoutes)
      5. await fastify.register(containerRoutes)
      6. await fastify.register(containerEventsRoute)  ← NEW (after other routes)
      7. fastify.get('/health', ...)
  </action>

  <verify>
    <automated>cd packages/server && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>

  <acceptance_criteria>
    - `packages/server/src/routes/container-events.ts` exists and exports `containerEventsRoute`
    - `packages/server/src/server.ts` imports `websocket` from `'@fastify/websocket'`
    - `packages/server/src/server.ts` imports `containerEventsRoute` from `'./routes/container-events.js'`
    - `await fastify.register(websocket)` appears BEFORE `await registerAuthPlugins(fastify)` in server.ts
    - `await fastify.register(containerEventsRoute)` appears AFTER `await fastify.register(containerRoutes)` in server.ts
    - `npx tsc --noEmit` in packages/server exits with code 0
    - Route file uses `{ websocket: true }` in the get() options object
    - Route file calls `eventsManager.addClient(socket, session)` and `eventsManager.removeClient(socket)` in the `close` handler
  </acceptance_criteria>

  <done>server.ts registers @fastify/websocket as the first plugin, containerEventsRoute is registered after other routes, TypeScript compiles cleanly, and the WS route correctly delegates client lifecycle to eventsManager.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser → Fastify WS upgrade | Cookie-bearing HTTP Upgrade request — untrusted until verifyAuth hook validates JWT |
| Fastify → SSH Server B | Server-controlled SSH exec command — no user input interpolated into `docker events` command |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-01 | Spoofing | GET /api/containers/events (WS upgrade) | mitigate | Global `fastify.addHook('preHandler', verifyAuth)` fires before WS handshake — returns HTTP 401 if JWT missing or invalid (per D-P3-08; verified: @fastify/websocket README confirms preHandler runs before upgrade) |
| T-03-02 | Denial of Service | DockerEventsManager.broadcastUpdate | mitigate | 150ms debounce coalesces rapid event bursts (e.g., docker restart emits stop+start ~100ms apart) into a single listContainers SSH exec — limits exec frequency |
| T-03-03 | Denial of Service | Set<WebSocket> client accumulation | mitigate | `socket.on('close')` removes ws from Set; `ws.readyState === 1` guard prevents sending to half-closed sockets; stale sockets do not accumulate |
| T-03-04 | Information Disclosure | WS broadcast to all clients | accept | Single-user personal tool (per PROJECT.md) — no multi-user isolation required; all WS clients are authenticated by the same session |
| T-03-05 | Tampering | SSH exec command in docker-events.ts | accept | `docker events --format '{{json .}}'` is a hardcoded string literal — no user input interpolated; no injection vector |
| T-03-SC | Tampering | npm install @fastify/websocket, @types/ws | mitigate | Both packages pre-audited in 03-RESEARCH.md Package Legitimacy Audit as [OK]/Approved — @fastify/websocket is official Fastify org package, @types/ws is DefinitelyTyped |
</threat_model>

<verification>
After both tasks complete, verify end-to-end backend behavior:

1. Build succeeds: `cd packages/server && npx tsc --noEmit` exits 0
2. Server starts without errors: `cd packages/server && npm run dev` shows no crash on boot
3. Health check responds: `curl -s http://localhost:3001/health` returns `{"ok":true}`
4. Unauthenticated WS upgrade is rejected: `curl -s -i -N -H "Upgrade: websocket" -H "Connection: Upgrade" http://localhost:3001/api/containers/events` returns HTTP 401 (not HTTP 101)
</verification>

<success_criteria>
- @fastify/websocket and @types/ws are installed in packages/server
- DockerEventsManager compiles and exports eventsManager singleton with: one global SSH exec stream, NDJSON buffer, WATCHED_ACTIONS filter, 150ms debounce, broadcast with OPEN guard, exponential backoff reconnect
- GET /api/containers/events returns 401 without valid cookie; upgrades to WebSocket with valid cookie
- server.ts registers @fastify/websocket before all other plugins and routes
- `npx tsc --noEmit` passes with zero errors
</success_criteria>

<output>
Create `.planning/phases/03-real-time-container-status/03-01-SUMMARY.md` when done
</output>
