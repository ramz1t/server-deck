import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import type { ClientChannel } from 'ssh2'
import { Client } from 'ssh2'
import { readFileSync } from 'fs'
import { verifyAuth } from '../middleware/verify-auth.js'
import type { SessionData } from '../types/session.js'

function getSession(request: FastifyRequest): SessionData {
  const session = (request as unknown as { session?: SessionData }).session
  if (!session) {
    // Should never happen — verifyAuth preHandler always runs first
    throw new Error('session missing from request — verifyAuth did not run')
  }
  return session
}

// Read SSH env vars — validated lazily inside the route handler so missing vars
// don't crash the whole server (Docker dashboard still works without SSH configured)
const SSH_USERNAME = process.env.SSH_USERNAME
const SSH_KEY_PATH = process.env.SSH_KEY_PATH
const SSH_PRIVATE_KEY: Buffer | null = SSH_KEY_PATH ? (() => {
  try { return readFileSync(SSH_KEY_PATH) } catch { return null }
})() : null

export const terminalRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/terminal',
    { websocket: true, preHandler: [verifyAuth] },
    (socket: WebSocket, _req) => {
      // Fail at connection time with a clear message rather than crashing the server
      if (!SSH_USERNAME || !SSH_PRIVATE_KEY) {
        socket.send('SSH_USERNAME and SSH_KEY_PATH are not configured on the server.\r\n')
        socket.close(1011, 'SSH not configured')
        return
      }

      const conn = new Client()
      let stream: ClientChannel | null = null

      conn.on('ready', () => {
        // Guard for race condition: client may have disconnected during SSH handshake (Q7)
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
        // Normalize to string for JSON parse attempt
        const text: string = rawMsg instanceof Buffer ? rawMsg.toString() : (rawMsg as string)
        try {
          const msg = JSON.parse(text)
          if (msg.type === 'resize' && stream !== null) {
            // ROWS first, then COLS (D-P5-17 — critical order)
            stream.setWindow(msg.rows, msg.cols, 0, 0)
            return
          }
        } catch {
          // Not JSON — treat as raw PTY input
        }
        // Write rawMsg (original Buffer) to preserve binary fidelity (Q6)
        try { if (stream) stream.write(rawMsg) } catch { /* ignore */ }
      })

      conn.on('error', (err) => {
        fastify.log.error({ err }, 'terminal SSH error')
        try { conn.end() } catch { /* ignore */ }
        try { socket.close(1011, 'SSH error') } catch { /* ignore */ }
      })

      // Teardown on WS close — stream.destroy() sends SSH_MSG_CHANNEL_CLOSE
      // which kills the PTY; stream.close() alone leaks the channel (D-P5-18)
      socket.on('close', () => {
        try { if (stream) stream.destroy() } catch { /* ignore */ }
        try { conn.end() } catch { /* ignore */ }
      })

      socket.on('error', () => {
        try { if (stream) stream.destroy() } catch { /* ignore */ }
        try { conn.end() } catch { /* ignore */ }
      })

      // conn.connect() called LAST — all event handlers must be registered first
      conn.connect({
        host: 'localhost',
        port: 22,
        username: SSH_USERNAME!,
        privateKey: SSH_PRIVATE_KEY!,
        readyTimeout: 10_000,
        keepaliveInterval: 0,
      })
    }
  )
}
