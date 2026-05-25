import 'dotenv/config'
import { buildServer } from './server.js'

// Fail fast if JWT_SECRET is not configured or too short (WR-01, ASVS V2.7.6)
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and at least 32 characters. Server cannot start.')
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
