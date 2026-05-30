import { useEffect, useRef, useState } from 'react'
import { Terminal, type ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { AttachAddon } from '@xterm/addon-attach'

export type TerminalStatus = 'connecting' | 'connected' | 'disconnected' | 'failed'

const XTERM_OPTIONS: ITerminalOptions = {
  theme: {
    background: '#09090b',              // zinc-950 (D-P5-07, D-P5-24)
    foreground: '#e4e4e7',              // zinc-200
    cursor: '#a1a1aa',                  // zinc-400
    cursorAccent: '#09090b',
    selectionBackground: 'rgba(161,161,170,0.3)',
    black: '#18181b',   brightBlack: '#52525b',
    red: '#ef4444',     brightRed: '#f87171',
    green: '#22c55e',   brightGreen: '#4ade80',
    yellow: '#eab308',  brightYellow: '#facc15',
    blue: '#3b82f6',    brightBlue: '#60a5fa',
    magenta: '#a855f7', brightMagenta: '#c084fc',
    cyan: '#06b6d4',    brightCyan: '#22d3ee',
    white: '#d4d4d8',   brightWhite: '#fafafa',
  },
  fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
  fontSize: 13,
  lineHeight: 1.2,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 1000,
  allowTransparency: true,
  convertEol: true,
}

export function useTerminalSession(containerRef: React.RefObject<HTMLDivElement | null>): {
  status: TerminalStatus
  errorMsg: string | null
  sendKey: (sequence: string) => void
} {
  const [status, setStatus] = useState<TerminalStatus>('connecting')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    // Guard: container must be in DOM
    if (!containerRef.current) return

    // ── Phase 1: DOM mount (synchronous) ──────────────────────────────────
    const terminal = new Terminal(XTERM_OPTIONS)
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)          // load FitAddon BEFORE open()
    terminal.open(containerRef.current)   // attaches xterm to DOM
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // ── Phase 2: WS connect (async) ───────────────────────────────────────
    const apiBase = import.meta.env.VITE_API_BASE as string | undefined
    let wsUrl: string
    if (apiBase) {
      // Derive WS URL from VITE_API_BASE (e.g. https://api.example.com → wss://api.example.com/api/terminal)
      const base = apiBase.replace(/\/+$/, '')
      wsUrl = base.replace(/^http/, 'ws') + '/api/terminal'
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      wsUrl = `${protocol}//${window.location.host}/api/terminal`
    }
    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'         // receive binary frames as ArrayBuffer
    wsRef.current = ws

    // AttachAddon declared at outer useEffect scope so cleanup can reference it (D-P5-22)
    let attachAddon: AttachAddon | null = null

    ws.onopen = () => {
      attachAddon = new AttachAddon(ws)   // creates bidirectional pipe
      terminal.loadAddon(attachAddon)     // wires WS messages → terminal.write and terminal.onData → ws.send

      requestAnimationFrame(() => {       // D-P5-23 — prevent pre-layout fit call
        fitAddon.fit()
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
        }
        setStatus('connected')
      })
    }

    ws.onclose = (ev) => {
      if (ev.code === 1000) {
        setStatus('disconnected')         // clean close — session ended normally
      } else {
        setStatus('failed')
        setErrorMsg(ev.reason || 'Connection closed unexpectedly')   // D-P5-20
      }
    }

    ws.onerror = () => {
      setStatus('failed')
      setErrorMsg('WebSocket connection failed')
    }

    // ── Phase 3: ResizeObserver (D-P5-23, SSH-04) ─────────────────────────
    let rafId: number | null = null

    const observer = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        fitAddon.fit()
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
        }
      })
    })
    observer.observe(containerRef.current)

    // ── Cleanup — order is critical (D-P5-25, Q12) ───────────────────────
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      observer.disconnect()
      attachAddon?.dispose()    // unsubscribe onData before terminal is disposed
      terminal.dispose()        // MUST come before ws.close() — prevents iOS WebGL exhaustion
      ws.close()                // triggers server stream.destroy() + conn.end()
    }
  }, [containerRef])

  function sendKey(sequence: string) {
    // Use terminal.input() ONLY — NOT ws.send() separately.
    // AttachAddon's onData subscription handles the WS direction.
    // Calling ws.send() separately would double-send the keystroke (Q10).
    terminalRef.current?.input(sequence)
  }

  return { status, errorMsg, sendKey }
}
