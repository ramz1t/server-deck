import type { FastifyPluginAsync } from 'fastify'
import { Client } from 'ssh2'
import { verifyAuth, getRequestSession } from '../middleware/verify-auth.js'
import { isValidContainerId } from '../services/docker-ssh.js'

export const containerLogsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { id: string }; Querystring: { tail?: string } }>(
    '/api/containers/:id/logs',
    { preHandler: [verifyAuth] },
    async (req, reply) => {
      const { id } = req.params
      const tail = Math.min(parseInt(req.query.tail ?? '200', 10) || 200, 2000)

      if (!isValidContainerId(id)) {
        return reply.code(400).send({ error: 'Invalid container ID' })
      }

      const session = getRequestSession(req)

      const lines = await new Promise<string[]>((resolve, reject) => {
        const conn = new Client()
        let output = ''

        conn.on('ready', () => {
          conn.exec(`docker logs --tail ${tail} ${id} 2>&1`, (err, stream) => {
            if (err) {
              conn.end()
              return reject(err)
            }
            stream.on('data', (chunk: Buffer) => { output += chunk.toString() })
            stream.on('close', () => {
              conn.end()
              const result = output
                .split('\n')
                .map((l) => l.trimEnd())
                .filter((l) => l !== '')
              resolve(result)
            })
          })
        })

        conn.on('error', (err) => {
          fastify.log.error({ err }, 'container-logs SSH error')
          reject(err)
        })

        conn.connect({
          host: session.host,
          port: session.port,
          username: session.username,
          password: session.password,
          readyTimeout: 10_000,
          keepaliveInterval: 0,
        })
      })

      return reply.send({ lines })
    }
  )
}
