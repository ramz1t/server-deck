import { buildServer } from './server.js'

const fastify = await buildServer()
const port = Number(process.env.PORT ?? 3001)

try {
  await fastify.listen({ port, host: '0.0.0.0' })
  fastify.log.info(`Server listening on http://localhost:${port}`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
