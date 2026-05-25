import { useEffect, useRef, useState } from 'react'

const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MAX_MS = 30_000

export function useLogStream(containerId: string): { lines: string[]; connected: boolean } {
  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const retryDelayRef = useRef(BACKOFF_INITIAL_MS)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let cancelled = false

    function connect() {
      if (cancelled) return
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/api/containers/${containerId}/logs`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (cancelled) { ws.close(); return }
        setConnected(true)
        retryDelayRef.current = BACKOFF_INITIAL_MS
      }

      ws.onmessage = (event) => {
        if (cancelled) return
        try {
          const msg = JSON.parse(event.data as string) as { type: string; line: string }
          if (msg.type === 'log') {
            setLines((prev) => {
              const next = [...prev, msg.line]
              // 5000-line cap — drop oldest lines on overflow (D-P4-15)
              return next.length > 5000 ? next.slice(next.length - 5000) : next
            })
          }
        } catch { /* malformed message — ignore */ }
      }

      ws.onclose = () => {
        if (cancelled) return
        setConnected(false)
        // Exponential backoff reconnect
        const delay = retryDelayRef.current
        retryDelayRef.current = Math.min(delay * 2, BACKOFF_MAX_MS)
        reconnectTimerRef.current = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        // onclose fires after onerror — reconnect is handled in onclose
        ws.close()
      }
    }

    connect()

    // Cleanup: triggers server-side stream.destroy() via WS close (LOGS-04)
    return () => {
      cancelled = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (wsRef.current) wsRef.current.close()
      setConnected(false)
    }
  }, [containerId])

  return { lines, connected }
}
