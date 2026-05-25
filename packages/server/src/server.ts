import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { registerAuthPlugins } from './plugins/auth-plugins.js'
import { authRoutes } from './routes/auth.js'
import { containerRoutes } from './routes/containers.js'
import { containerEventsRoute } from './routes/container-events.js'
import { containerLogsRoute } from './routes/container-logs.js'
import { verifyAuth } from './middleware/verify-auth.js'

export async function buildServer() {
  const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  })

  // Allow empty JSON body (e.g. POST /logout with Content-Type: application/json and no body)
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      if (body === '') {
        done(null, {})
        return
      }
      try {
        done(null, JSON.parse(body as string))
      } catch (e) {
        done(e as Error, undefined)
      }
    }
  )

  await fastify.register(websocket)

  await registerAuthPlugins(fastify)

  fastify.addHook('preHandler', verifyAuth)

  await fastify.register(authRoutes)
  await fastify.register(containerRoutes)
  await fastify.register(containerEventsRoute)
  await fastify.register(containerLogsRoute)

  fastify.get('/health', async () => ({ ok: true }))

  return fastify
}
