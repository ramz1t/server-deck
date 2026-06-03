import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import {
  listContainers,
  startContainer,
  stopContainer,
  restartContainer,
  deleteContainer,
  isValidContainerId,
} from '../services/docker-ssh.js'
import { getRequestSession } from '../middleware/verify-auth.js'

type ActionParams = { id: string }

export async function containerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/containers', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = getRequestSession(request)
    try {
      const containers = await listContainers(session)
      return containers
    } catch (err) {
      fastify.log.error(err, 'Failed to list containers')
      return reply.status(502).send({ error: 'Failed to connect to Docker on target server' })
    }
  })

  for (const action of ['start', 'stop', 'restart'] as const) {
    fastify.post<{ Params: ActionParams }>(
      `/api/containers/:id/${action}`,
      async (request: FastifyRequest<{ Params: ActionParams }>, reply: FastifyReply) => {
        const { id } = request.params
        if (!isValidContainerId(id)) {
          return reply.status(400).send({ error: 'Invalid container ID' })
        }
        const session = getRequestSession(request)
        try {
          if (action === 'start') await startContainer(session, id)
          else if (action === 'stop') await stopContainer(session, id)
          else await restartContainer(session, id)
          return { ok: true }
        } catch (err) {
          fastify.log.error(err, `Failed to ${action} container ${id}`)
          return reply.status(502).send({ error: `Failed to ${action} container` })
        }
      }
    )
  }

  fastify.delete<{ Params: ActionParams }>(
    '/api/containers/:id',
    async (request: FastifyRequest<{ Params: ActionParams }>, reply: FastifyReply) => {
      const { id } = request.params
      if (!isValidContainerId(id)) {
        return reply.status(400).send({ error: 'Invalid container ID' })
      }
      const session = getRequestSession(request)
      try {
        await deleteContainer(session, id)
        return { ok: true }
      } catch (err) {
        fastify.log.error(err, `Failed to delete container ${id}`)
        return reply.status(502).send({ error: 'Failed to delete container' })
      }
    }
  )
}
