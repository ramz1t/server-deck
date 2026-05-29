import type { FastifyRequest, FastifyReply } from 'fastify'
import { getSession } from '../services/session-store.js'

const EXCLUDED_PATHS = ['/api/auth/login', '/api/auth/logout', '/api/config']

export async function verifyAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Only enforce auth on /api/* routes — static files and SPA routes must be publicly accessible
  if (!request.url.startsWith('/api/')) {
    return
  }

  // Strip query string before path comparison to avoid blocking login with ?next=... (CR-03)
  if (EXCLUDED_PATHS.includes(request.url.split('?')[0])) {
    return
  }

  try {
    await request.jwtVerify()
    const session = getSession(request.user.sessionId)
    if (!session) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
    ;(request as unknown as Record<string, unknown>)['session'] = session
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' })
  }
}
