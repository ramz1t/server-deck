import 'dotenv/config'
import { buildServer } from './server.js'

// Fail fast if JWT_SECRET is not configured (WR-01)
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.')
  process.exit(1)
}

const fastify = await buildServer()
const port = Number(process.env.PORT ?? 3001)

try {
  await fastify.listen({ port, host: '0.0.0.0' })
  fastify.log.info(`Server listening on http://localhost:${port}`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
