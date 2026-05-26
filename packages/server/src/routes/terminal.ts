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

// Module-level env var validation — fail fast at startup (D-P5-15)
const SSH_USERNAME = process.env.SSH_USERNAME
const SSH_KEY_PATH = process.env.SSH_KEY_PATH

if (!SSH_USERNAME || !SSH_KEY_PATH) {
  throw new Error('SSH_USERNAME and SSH_KEY_PATH must be set in environment')
}

const SSH_PRIVATE_KEY: Buffer = readFileSync(SSH_KEY_PATH)

export const terminalRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/terminal',
    { websocket: true, preHandler: [verifyAuth] },
    (socket: WebSocket, _req) => {
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
        username: SSH_USERNAME,
        privateKey: SSH_PRIVATE_KEY,
        readyTimeout: 10_000,
        keepaliveInterval: 0,
      })
    }
  )
}
