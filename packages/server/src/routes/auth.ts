import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fastifyRateLimit from '@fastify/rate-limit'
import { setSession, getSession, deleteSession } from '../services/session-store.js'

type LoginBody = {
  password: string
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifyRateLimit, { global: false })

  fastify.post<{ Body: LoginBody }>(
    '/api/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['password'],
          properties: {
            password: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
      const { password } = request.body
      const portalPass = process.env.PORTAL_PASS
      if (!portalPass) {
        fastify.log.error('PORTAL_PASS env var is not set')
        return reply.status(500).send({ error: 'Server misconfigured' })
      }

      if (password !== portalPass) {
        return reply.status(401).send({ error: 'Invalid credentials' })
      }

      const host = process.env.SSH_HOST!
      const port = Number(process.env.SSH_PORT ?? 22)
      const username = process.env.SSH_USERNAME!
      const sshPassword = process.env.SSH_PASSWORD ?? ''

      const sessionId = crypto.randomUUID()
      setSession(sessionId, { host, port, username, password: sshPassword })

      const token = fastify.jwt.sign({ sessionId }, { expiresIn: '7d' })

      const isSecure = process.env.NODE_ENV === 'production' || process.env.HTTPS === 'true'
      reply.setCookie('sd_token', token, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60,
        path: '/',
      })

      return reply.send({ ok: true })
    }
  )

  // GET /api/config — public (no auth); returns SSH_HOST for the login page heading (CONF-02)
  fastify.get('/api/config', async () => ({
    host: process.env.SSH_HOST ?? '',
  }))

  fastify.post('/api/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = (request.cookies as Record<string, string | undefined>)['sd_token']
      if (token) {
        const payload = await fastify.jwt.verify<{ sessionId: string }>(token)
        if (payload?.sessionId) {
          deleteSession(payload.sessionId)
        }
      }
    } catch {
      // Ignore invalid/expired tokens on logout — always clear the cookie
    }

    reply.clearCookie('sd_token', { path: '/' })
    return { ok: true }
  })

  fastify.get('/api/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = getSession(request.user.sessionId)
    if (!session) {
      return reply.status(401).send({ error: 'Session not found' })
    }
    return { ok: true, host: session.host, port: session.port, username: session.username }
  })
}
