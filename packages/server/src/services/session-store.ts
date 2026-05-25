import type { SessionData } from '../types/session.js'

export const sessionStore = new Map<string, SessionData>()

export function setSession(sessionId: string, data: SessionData): void {
  sessionStore.set(sessionId, data)
}

export function getSession(sessionId: string): SessionData | undefined {
  return sessionStore.get(sessionId)
}

export function deleteSession(sessionId: string): void {
  sessionStore.delete(sessionId)
}
