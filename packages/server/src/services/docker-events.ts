import { Client } from 'ssh2'
import type { WebSocket } from 'ws'
import { listContainers } from './docker-ssh.js'
import type { SessionData } from '../types/session.js'

const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MAX_MS = 30_000
const DEBOUNCE_MS = 150
const WATCHED_ACTIONS = new Set([
  'start', 'stop', 'die', 'kill', 'restart', 'pause', 'unpause', 'create', 'destroy',
])

interface DockerEvent {
  Type: string
  Action: string
}

class DockerEventsManager {
  private sshClient: Client | null = null
  private session: SessionData | null = null
  private clients = new Set<WebSocket>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = BACKOFF_INITIAL_MS
  private isRunning = false

  addClient(ws: WebSocket, session: SessionData): void {
    this.clients.add(ws)
    void this.sendCurrentList(ws)
    if (!this.isRunning) {
      this.session = session
      this.retryDelay = BACKOFF_INITIAL_MS
      this.startStream()
    }
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws)
    // NOTE: stream stays open even at 0 clients (per D-P3-02)
  }

  private startStream(): void {
    if (!this.session) return
    this.isRunning = true
    const client = new Client()
    this.sshClient = client
    let buffer = ''

    client.on('ready', () => {
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

    client.on('error', (err) => {
      console.error('[DockerEvents] SSH error:', err.message)
      try { client.end() } catch { /* ignore */ }
      this.scheduleReconnect()
    })

    client.connect({
      host: this.session.host,
      port: this.session.port,
      username: this.session.username,
      password: this.session.password,
      readyTimeout: 10_000,
      keepaliveInterval: 30_000,
      keepaliveCountMax: 3,
    })
  }

  private scheduleReconnect(): void {
    this.isRunning = false
    const fireAfter = this.retryDelay  // capture before doubling (first reconnect fires at 1s)
    this.retryDelay = Math.min(this.retryDelay * 2, BACKOFF_MAX_MS)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => { this.startStream() }, fireAfter)
  }

  private handleLine(line: string): void {
    let event: DockerEvent
    try {
      event = JSON.parse(line) as DockerEvent
    } catch {
      return  // skip malformed JSON
    }
    if (event.Type === 'container' && WATCHED_ACTIONS.has(event.Action)) {
      // 150ms debounce: docker restart fires stop+start within ~100ms; coalesce into one broadcast
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => { void this.broadcastUpdate() }, DEBOUNCE_MS)
    }
  }

  private async broadcastUpdate(): Promise<void> {
    if (!this.session || this.clients.size === 0) return
    try {
      const containers = await listContainers(this.session)
      const payload = JSON.stringify({ type: 'containers', data: containers })
      // Snapshot clients before await so Set mutations during listContainers don't affect iteration
      for (const ws of Array.from(this.clients)) {
        if (ws.readyState === 1) ws.send(payload)  // 1 === WebSocket.OPEN
      }
    } catch {
      // SSH exec failure — next Docker event will retry
    }
  }

  private async sendCurrentList(ws: WebSocket): Promise<void> {
    if (!this.session) return
    try {
      const containers = await listContainers(this.session)
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'containers', data: containers }))
    } catch {
      // SSH not yet ready — first event will push the list
    }
  }
}

export const eventsManager = new DockerEventsManager()
