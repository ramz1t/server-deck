import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, X, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useTerminalSession, type TerminalStatus } from '../hooks/useTerminalSession'
import { TouchToolbar } from '../components/TouchToolbar'

// Status badge config (D-P5-21)
const STATUS_BADGE: Record<TerminalStatus, { colorClass: string; text: string }> = {
  connecting:   { colorClass: 'text-yellow-400 bg-yellow-500/10', text: 'Connecting…' },
  connected:    { colorClass: 'text-green-400 bg-green-500/10',   text: 'Connected'   },
  disconnected: { colorClass: 'text-zinc-400 bg-zinc-800',        text: 'Disconnected' },
  failed:       { colorClass: 'text-red-400 bg-red-500/10',       text: 'Failed'       },
}

export function TerminalPage() {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const { status, errorMsg, sendKey } = useTerminalSession(containerRef)

  const badge = STATUS_BADGE[status]

  return (
    <div className="h-dvh flex flex-col bg-[#09090b] overflow-hidden">
      {/* Header (D-P5-04) */}
      <header className="shrink-0 bg-[#09090b]/80 backdrop-blur border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        {/* Back button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => navigate(-1)}
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        {/* Title */}
        <h1 className="font-semibold truncate flex-1 text-zinc-100">Terminal</h1>

        {/* Connection status badge (D-P5-21) */}
        <span
          className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${badge.colorClass}`}
        >
          {badge.text}
        </span>

        {/* X close button — same as back (D-P5-02) */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => navigate(-1)}
          aria-label="Close terminal"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* Terminal area */}
      <main className="flex-1 relative overflow-hidden min-h-0">
        <div
          ref={containerRef}
          className={`w-full h-full touch-none ${status === 'connecting' ? 'opacity-0' : 'opacity-100'}`}
          style={{
            background: '#09090b',
            overflow: 'hidden',
            paddingBottom: 4,  // FitAddon subtracts padding — prevents bottom rows being clipped
          }}
          data-gramm="false"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />

        {/* Connecting overlay (D-P5-21) */}
        {status === 'connecting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090b]">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            <p className="text-zinc-400 text-sm mt-2">Connecting…</p>
          </div>
        )}

        {/* Failed state (D-P5-20) */}
        {status === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090b]">
            <div className="flex flex-col items-center gap-3 text-center p-6">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <p className="font-semibold text-red-400">Connection failed</p>
              <p className="text-sm text-zinc-400">{errorMsg}</p>
              <Button
                variant="outline"
                size="sm"
                className="h-11"
                onClick={() => navigate(0)}
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Disconnected / session ended (D-P5-19) */}
        {status === 'disconnected' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090b]/90">
            <div className="flex flex-col items-center gap-3 text-center p-6">
              <p className="font-semibold text-zinc-200">Session ended</p>
              <p className="text-sm text-zinc-400">Your SSH session was closed.</p>
              <Button
                variant="outline"
                size="sm"
                className="h-11"
                onClick={() => navigate('/terminal')}
              >
                Reconnect
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* Touch toolbar — always visible (D-P5-13) */}
      <TouchToolbar sendKey={sendKey} />
      {/* Safe area spacer for iOS home indicator */}
      <div className="shrink-0 bg-zinc-900" style={{ height: 'env(safe-area-inset-bottom)' }} />
    </div>
  )
}
