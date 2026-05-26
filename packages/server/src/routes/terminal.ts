import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import type { ClientChannel } from 'ssh2'
import { Client } from 'ssh2'
import { verifyAuth } from '../middleware/verify-auth.js'
import type { SessionData } from '../types/session.js'

function getSession(request: FastifyRequest): SessionData {
  const session = (request as unknown as { session?: SessionData }).session
  if (!session) {
    throw new Error('session missing from request — verifyAuth did not run')
  }
  return session
}

export const terminalRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/terminal',
    { websocket: true, preHandler: [verifyAuth] },
    (socket: WebSocket, req) => {
      const { host, port, username, password } = getSession(req)
      const conn = new Client()
      let stream: ClientChannel | null = null

      conn.on('ready', () => {
        // Guard for race condition: client may have disconnected during SSH handshake
        if (socket.readyState !== 1) {
          conn.end()
          return
        }

        conn.shell({ term: 'xterm-256color', rows: 24, cols: 80 }, (err, shellStream) => {
          if (err) {
            try { socket.close(1011, 'SSH shell failed') } catch { /* ignore */ }
            try { conn.end() } catch { /* ignore */ }
            return
          }

          stream = shellStream

          // Wire SSH stdout → WS
          stream.on('data', (chunk: Buffer) => {
            try { socket.send(chunk) } catch { /* ignore */ }
          })

          // Wire SSH stderr → WS
          stream.stderr.on('data', (chunk: Buffer) => {
            try { socket.send(chunk) } catch { /* ignore */ }
          })

          // Wire stream close → WS close
          stream.on('close', () => {
            try { conn.end() } catch { /* ignore */ }
            try { socket.close() } catch { /* ignore */ }
          })
        })
      })

      // Wire WS messages → PTY input / resize
      socket.on('message', (rawMsg: Buffer | string) => {
        const text: string = rawMsg instanceof Buffer ? rawMsg.toString() : (rawMsg as string)
        try {
          const msg = JSON.parse(text)
          if (msg.type === 'resize' && stream !== null) {
            stream.setWindow(msg.rows, msg.cols, 0, 0)
            return
          }
        } catch {
          // Not JSON — raw PTY input
        }
        try { if (stream) stream.write(rawMsg) } catch { /* ignore */ }
      })

      conn.on('error', (err) => {
        fastify.log.error({ err }, 'terminal SSH error')
        try { conn.end() } catch { /* ignore */ }
        try { socket.close(1011, 'SSH error') } catch { /* ignore */ }
      })

      socket.on('close', () => {
        try { if (stream) stream.destroy() } catch { /* ignore */ }
        try { conn.end() } catch { /* ignore */ }
      })

      socket.on('error', () => {
        try { if (stream) stream.destroy() } catch { /* ignore */ }
        try { conn.end() } catch { /* ignore */ }
      })

      conn.connect({
        host,
        port,
        username,
        password,
        readyTimeout: 10_000,
        keepaliveInterval: 0,
      })
    }
  )
}
