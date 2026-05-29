import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getServerStats } from '../services/docker-ssh.js'
import type { SessionData } from '../types/session.js'

function getSession(request: FastifyRequest): SessionData {
  const session = (request as unknown as { session?: SessionData }).session
  if (!session) {
    throw new Error('session missing from request — verifyAuth did not run')
  }
  return session
}

export async function statsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = getSession(request)
    try {
      const stats = await getServerStats(session)
      return stats
    } catch (err) {
      fastify.log.error(err, 'Failed to fetch server stats')
      return reply.status(502).send({ error: 'Failed to fetch server stats' })
    }
  })
}
