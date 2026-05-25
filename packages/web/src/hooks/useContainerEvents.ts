import { useEffect, useRef, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'

interface ContainerInfo {
  id: string
  shortId: string
  names: string[]
  image: string
  status: string
  state: string
  createdAt: string
}

interface WsMessage {
  type: 'containers'
  data: ContainerInfo[]
}

const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MAX_MS = 30_000

export function useContainerEvents(
  queryClient: QueryClient,
): { wsConnected: boolean; hasConnectedOnce: boolean } {
  const [wsConnected, setWsConnected] = useState(false)
  const retryDelayRef = useRef(BACKOFF_INITIAL_MS)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const hasConnectedOnce = useRef(false)

  useEffect(() => {
    let cancelled = false

    function connect() {
      if (cancelled) return
      // Derive WS URL from current page origin — handles dev proxy and prod
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/api/containers/events`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (cancelled) { ws.close(); return }
        setWsConnected(true)
        hasConnectedOnce.current = true
        retryDelayRef.current = BACKOFF_INITIAL_MS  // reset backoff on successful connect
      }

      ws.onmessage = (event) => {
        if (cancelled) return
        try {
          const msg = JSON.parse(event.data as string) as WsMessage
          if (msg.type === 'containers') {
            queryClient.setQueryData(['containers'], msg.data)
          }
        } catch { /* malformed message — ignore */ }
      }

      ws.onclose = () => {
        if (cancelled) return
        setWsConnected(false)
        // Exponential backoff reconnect (D-P3-14)
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

    // Cleanup: cancel reconnects and close the socket on unmount
    return () => {
      cancelled = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (wsRef.current) wsRef.current.close()
      setWsConnected(false)
    }
  }, [queryClient])  // queryClient is stable — effect runs once on mount

  return { wsConnected, hasConnectedOnce: hasConnectedOnce.current }
}
