import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import type { ClientChannel } from 'ssh2'
import { Client } from 'ssh2'
import { verifyAuth } from '../middleware/verify-auth.js'
import type { SessionData } from '../types/session.js'
import { isValidContainerId } from '../services/docker-ssh.js'

function getSession(request: FastifyRequest): SessionData {
  const session = (request as unknown as { session?: SessionData }).session
  if (!session) {
    // Should never happen — verifyAuth preHandler always runs first
    throw new Error('session missing from request — verifyAuth did not run')
  }
  return session
}

export const containerLogsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { id: string } }>(
    '/api/containers/:id/logs',
    { websocket: true, preHandler: [verifyAuth] },
    (socket: WebSocket, req) => {
      const { id } = req.params

      // Validate container ID before opening SSH (D-P4-09, T-04-02)
      if (!isValidContainerId(id)) {
        socket.close(1008, 'Invalid container ID')
        return
      }

      const session = getSession(req)
      const conn = new Client()
      let stream: ClientChannel | null = null

      conn.on('ready', () => {
        conn.exec(`docker logs --follow --tail 200 ${id} 2>&1`, (err, execStream) => {
          if (err) {
            try { socket.close(1011, 'SSH exec failed') } catch { /* ignore */ }
            try { conn.end() } catch { /* ignore */ }
            return
          }

          stream = execStream
          let buffer = ''

          stream.on('data', (chunk: Buffer) => {
            buffer += chunk.toString()
            const lines = buffer.split('\n')
            // Keep incomplete last fragment in buffer
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              const trimmed = line.trimEnd()
              if (trimmed === '') continue
              try {
                socket.send(JSON.stringify({ type: 'log', line: trimmed }))
              } catch {
                // Socket may have closed mid-stream — ignore
              }
            }
          })

          stream.on('close', () => {
            try { conn.end() } catch { /* ignore */ }
            try { socket.close() } catch { /* ignore */ }
          })
        })
      })

      conn.on('error', (err) => {
        fastify.log.error({ err }, 'container-logs SSH error')
        try { conn.end() } catch { /* ignore */ }
        try { socket.close(1011, 'SSH error') } catch { /* ignore */ }
      })

      // Teardown on WS close — stream.destroy() is CRITICAL for LOGS-04
      // destroy() sends both stream EOF and SSH_MSG_CHANNEL_CLOSE so the
      // remote `docker logs` process gets SIGPIPE and terminates. close() alone
      // skips the EOF signal and leaks the SSH channel.
      socket.on('close', () => {
        try { if (stream) stream.destroy() } catch { /* ignore */ }
        try { conn.end() } catch { /* ignore */ }
      })

      conn.connect({
        host: session.host,
        port: session.port,
        username: session.username,
        password: session.password,
        readyTimeout: 10_000,
        keepaliveInterval: 0,
      })
    }
  )
}
