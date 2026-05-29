import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, AlertCircle } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useTerminalSession, type TerminalStatus } from '../hooks/useTerminalSession'
import { TouchToolbar } from '../components/TouchToolbar'

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
    <div className="flex-1 flex flex-col min-h-0 bg-[#09090b] overflow-hidden">
      {/* Status bar */}
      <div className="shrink-0 border-b border-zinc-800 px-4 py-1.5 flex items-center justify-end">
        <span className={`text-xs px-2 py-0.5 ${badge.colorClass}`}>
          {badge.text}
        </span>
      </div>

      {/* Terminal area */}
      <main className="flex-1 relative overflow-hidden min-h-0">
        <div
          ref={containerRef}
          className={`terminal-container w-full h-full touch-none ${status === 'connecting' ? 'opacity-0' : 'opacity-100'}`}
          style={{ background: '#09090b', overflow: 'hidden' }}
          data-gramm="false"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />

        {status === 'connecting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090b]">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            <p className="text-zinc-400 text-sm mt-2">Connecting…</p>
          </div>
        )}

        {status === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090b]">
            <div className="flex flex-col items-center gap-3 text-center p-6">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <p className="font-semibold text-red-400">Connection failed</p>
              <p className="text-sm text-zinc-400">{errorMsg}</p>
              <Button variant="outline" size="sm" className="h-11" onClick={() => navigate(0)}>
                Retry
              </Button>
            </div>
          </div>
        )}

        {status === 'disconnected' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090b]/90">
            <div className="flex flex-col items-center gap-3 text-center p-6">
              <p className="font-semibold text-zinc-200">Session ended</p>
              <p className="text-sm text-zinc-400">Your SSH session was closed.</p>
              <Button variant="outline" size="sm" className="h-11" onClick={() => navigate('/terminal')}>
                Reconnect
              </Button>
            </div>
          </div>
        )}
      </main>

      <TouchToolbar sendKey={sendKey} />
      <div className="shrink-0 bg-zinc-900" style={{ height: 'env(safe-area-inset-bottom)' }} />
    </div>
  )
}
