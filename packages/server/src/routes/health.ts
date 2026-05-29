import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

interface HealthBody {
  urls: string[]
}

interface DomainResult {
  url: string
  up: boolean
  latencyMs: number | null
}

async function checkUrl(url: string): Promise<DomainResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  const start = Date.now()
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    })
    clearTimeout(timer)
    const latencyMs = Date.now() - start
    // Any response below 500 counts as "up" — 4xx means reachable
    return { url, up: response.status < 500, latencyMs }
  } catch {
    clearTimeout(timer)
    return { url, up: false, latencyMs: null }
  }
}

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: HealthBody }>(
    '/api/health/domains',
    {
      schema: {
        body: {
          type: 'object',
          required: ['urls'],
          properties: {
            urls: {
              type: 'array',
              maxItems: 20,
              items: {
                type: 'string',
                // SSRF guard: only http:// and https:// are permitted (STATS-05 personal tool)
                pattern: '^https?://',
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: HealthBody }>, reply: FastifyReply) => {
      const { urls } = request.body
      try {
        const results = await Promise.all(urls.map(checkUrl))
        return { results }
      } catch (err) {
        fastify.log.error(err, 'Domain health check failed')
        return reply.status(500).send({ error: 'Health check failed' })
      }
    }
  )
}
