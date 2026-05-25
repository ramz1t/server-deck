export interface SessionData {
  host: string
  port: number
  username: string
  password: string
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sessionId: string }
    user: { sessionId: string }
  }
}
