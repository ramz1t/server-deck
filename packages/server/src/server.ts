import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import fastifyStatic from '@fastify/static'
import path from 'path'
import { fileURLToPath } from 'url'
import { registerAuthPlugins } from './plugins/auth-plugins.js'
import { authRoutes } from './routes/auth.js'
import { containerRoutes } from './routes/containers.js'
import { containerEventsRoute } from './routes/container-events.js'
import { containerLogsRoute } from './routes/container-logs.js'
import { terminalRoute } from './routes/terminal.js'
import { statsRoutes } from './routes/stats.js'
import { healthRoutes } from './routes/health.js'
import { verifyAuth } from './middleware/verify-auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
  await fastify.register(statsRoutes)
  await fastify.register(healthRoutes)
  await fastify.register(containerEventsRoute)
  await fastify.register(containerLogsRoute)
  await fastify.register(terminalRoute)

  fastify.get('/health', async () => ({ ok: true }))

  // Serve built frontend — registered AFTER api routes so wildcard doesn't catch /api/*
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, '../../web/dist'),
    prefix: '/',
    wildcard: false,
  })

  // SPA fallback — serve index.html for all non-api routes
  fastify.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      reply.status(404).send({ error: 'Not found' })
    } else {
      reply.sendFile('index.html')
    }
  })

  return fastify
}
