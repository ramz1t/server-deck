import Fastify from 'fastify'

export async function buildServer() {
  const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' }
  })

  fastify.get('/health', async () => ({ ok: true }))

  return fastify
}
