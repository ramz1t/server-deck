import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import { eventsManager } from '../services/docker-events.js'
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

export const containerEventsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/containers/events',
    { websocket: true, preHandler: [verifyAuth] },
    (socket: WebSocket, req: FastifyRequest) => {
      const session = getSession(req)
      eventsManager.addClient(socket, session)
      socket.on('close', () => {
        eventsManager.removeClient(socket)
      })
    }
  )
}
