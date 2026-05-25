import fastifyJwt from '@fastify/jwt'
import fastifyCookie from '@fastify/cookie'
import type { FastifyInstance } from 'fastify'

export async function registerAuthPlugins(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifyCookie)
  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET!,
    cookie: {
      cookieName: 'sd_token',
      signed: false,
    },
  })
}
