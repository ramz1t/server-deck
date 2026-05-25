import type { SessionData } from '../types/session.js'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days — matches JWT expiry

interface StoredSession {
  data: SessionData
  expiresAt: number
}

const sessionStore = new Map<string, StoredSession>()

export function setSession(sessionId: string, data: SessionData): void {
  sessionStore.set(sessionId, { data, expiresAt: Date.now() + SESSION_TTL_MS })
}

export function getSession(sessionId: string): SessionData | undefined {
  const entry = sessionStore.get(sessionId)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    sessionStore.delete(sessionId)
    return undefined
  }
  return entry.data
}

export function deleteSession(sessionId: string): void {
  sessionStore.delete(sessionId)
}
