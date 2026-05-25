import Fastify from 'fastify'
import { registerAuthPlugins } from './plugins/auth-plugins.js'
import { authRoutes } from './routes/auth.js'
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

  await registerAuthPlugins(fastify)

  fastify.addHook('preHandler', verifyAuth)

  await fastify.register(authRoutes)

  fastify.get('/health', async () => ({ ok: true }))

  return fastify
}
