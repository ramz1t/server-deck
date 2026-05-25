import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fastifyRateLimit from '@fastify/rate-limit'
import { validateSshCredentials } from '../services/ssh-auth.js'
import { setSession, getSession, deleteSession } from '../services/session-store.js'

type LoginBody = {
  host: string
  port: number
  username: string
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
          required: ['host', 'port', 'username', 'password'],
          properties: {
            host: { type: 'string', minLength: 1 },
            port: { type: 'integer', minimum: 1, maximum: 65535 },
            username: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
      const { host, port, username, password } = request.body

      const result = await validateSshCredentials(host, port, username, password)

      if (result === 'auth_failed') {
        return reply.status(401).send({ error: 'Invalid credentials' })
      }
      if (result === 'timeout') {
        return reply.status(504).send({ error: 'Connection timed out' })
      }
      if (result === 'unreachable') {
        return reply.status(502).send({ error: 'Host unreachable' })
      }

      const sessionId = crypto.randomUUID()
      setSession(sessionId, { host, port, username, password })

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

  fastify.post('/api/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = (request.cookies as Record<string, string | undefined>)['sd_token']
      if (token) {
        // Use jwt.verify (not jwt.decode) to prevent forged cookie session deletion (CR-02)
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
    // jwtVerify already called by verifyAuth preHandler; calling it again is harmless
    // but redundant — relying on preHandler-populated request.user (IN-03 noted)
    const session = getSession(request.user.sessionId)
    if (!session) {
      return reply.status(401).send({ error: 'Session not found' })
    }
    return { ok: true, host: session.host, username: session.username }
  })
}
