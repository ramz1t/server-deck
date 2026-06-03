import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getServerStats, dockerSystemPrune } from '../services/docker-ssh.js'
import { getRequestSession } from '../middleware/verify-auth.js'

export async function statsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = getRequestSession(request)
    try {
      const stats = await getServerStats(session)
      return stats
    } catch (err) {
      fastify.log.error(err, 'Failed to fetch server stats')
      return reply.status(502).send({ error: 'Failed to fetch server stats' })
    }
  })

  fastify.post('/api/docker/prune', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = getRequestSession(request)
    try {
      const output = await dockerSystemPrune(session)
      return { output }
    } catch (err) {
      fastify.log.error(err, 'Failed to run docker system prune')
      return reply.status(502).send({ error: 'Failed to run docker system prune' })
    }
  })
}
