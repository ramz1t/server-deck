import { useRef, useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../components/ui/button'
import { useLogStream } from '../hooks/useLogStream'
import Convert from 'ansi-to-html'

// Instantiate once at module level — avoids re-creating on every render
// escapeXML: true is MANDATORY for XSS safety (D-P4-10, T-04-07):
// prevents malicious container log output from injecting HTML via dangerouslySetInnerHTML
const converter = new Convert({ escapeXML: true, stream: true })

export function LogPage() {
  const { containerId } = useParams<{ containerId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const containerName =
    (location.state as { name?: string } | null)?.name ?? (containerId?.slice(0, 12) ?? 'unknown')

  const { lines, connected } = useLogStream(containerId ?? '')

  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const [showResume, setShowResume] = useState(false)

  // Scroll to bottom on initial mount
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // Auto-scroll to bottom when new lines arrive (only when auto-scroll is enabled)
  useEffect(() => {
    if (!autoScrollRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollTop >= el.scrollHeight - el.clientHeight - 50
    autoScrollRef.current = atBottom
    setShowResume(!atBottom)
  }

  function resumeAutoScroll() {
    autoScrollRef.current = true
    setShowResume(false)
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // Convert ANSI codes to HTML once per lines change — memoised to avoid re-converting every render
  const htmlLines = useMemo(
    () =>
      lines.map((line) => {
        try {
          return converter.toHtml(line)
        } catch {
          // Binary or malformed data — skip the line (T-04-08)
          return ''
        }
      }),
    [lines],
  )

  return (
    <div className="min-h-svh flex flex-col bg-black">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={() => navigate('/')}
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="font-semibold truncate flex-1">{containerName}</span>
        {connected ? (
          <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full shrink-0">
            live
          </span>
        ) : (
          <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full shrink-0">
            disconnected
          </span>
        )}
      </header>

      {/* Log scroll area */}
      <main className="flex-1 relative overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto"
          style={{ height: 'calc(100svh - 57px)' }}
        >
          <pre className="font-mono text-sm text-zinc-200 whitespace-pre-wrap break-words bg-zinc-950 px-4 py-3 min-h-full">
            {htmlLines.map((html, i) => (
              <div
                key={i}
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ))}
          </pre>
        </div>

        {/* Floating resume button — appears when user scrolls up (D-P4-13) */}
        {showResume && (
          <button
            type="button"
            onClick={resumeAutoScroll}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-zinc-800 text-zinc-200 text-sm px-4 py-2 rounded-full shadow-lg border border-zinc-700 hover:bg-zinc-700 transition-colors min-h-[44px]"
          >
            ↓ Resume
          </button>
        )}
      </main>
    </div>
  )
}
