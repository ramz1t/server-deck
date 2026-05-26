import { useState } from 'react'

export interface TouchToolbarProps {
  sendKey: (sequence: string) => void
  className?: string
}

// Toolbar key definitions — 11 buttons in order (D-P5-10)
const TOOLBAR_KEYS = [
  { label: 'Tab',  sequence: '\t',      ariaLabel: 'Tab' },
  { label: 'Esc',  sequence: '\x1b',    ariaLabel: 'Escape' },
  { label: '↑',    sequence: '\x1b[A',  ariaLabel: 'Arrow Up' },
  { label: '↓',    sequence: '\x1b[B',  ariaLabel: 'Arrow Down' },
  { label: '←',    sequence: '\x1b[D',  ariaLabel: 'Arrow Left' },
  { label: '→',    sequence: '\x1b[C',  ariaLabel: 'Arrow Right' },
  { label: '|',    sequence: '\x7c',    ariaLabel: 'Pipe' },
  { label: '`',    sequence: '\x60',    ariaLabel: 'Backtick' },
  { label: '~',    sequence: '\x7e',    ariaLabel: 'Tilde' },
  { label: '/',    sequence: '\x2f',    ariaLabel: 'Slash' },
] as const

const BASE_BTN =
  'h-[44px] min-w-[44px] px-3 flex items-center justify-center ' +
  'text-zinc-300 text-sm font-mono rounded-md shrink-0 ' +
  'hover:bg-zinc-700 active:bg-zinc-600 transition-colors ' +
  'select-none touch-manipulation'

export function TouchToolbar({ sendKey, className }: TouchToolbarProps) {
  const [ctrlActive, setCtrlActive] = useState(false)

  function handleKey(sequence: string) {
    if (ctrlActive) {
      // Apply Ctrl modifier: single-char sequences use charCode & 0x1f (ASCII ctrl codes).
      // Multi-char sequences (arrows, Esc) are sent as-is — Ctrl+arrow isn't meaningful in PTY.
      const modified =
        sequence.length === 1
          ? String.fromCharCode(sequence.charCodeAt(0) & 0x1f)
          : sequence
      sendKey(modified)
      setCtrlActive(false)
    } else {
      sendKey(sequence)
    }
  }

  function handleCtrl() {
    setCtrlActive((prev) => !prev)
  }

  return (
    <div
      className={[
        'fixed bottom-0 left-0 right-0 h-[44px] pb-[env(safe-area-inset-bottom)]',
        'bg-zinc-900 border-t border-zinc-800 z-20 flex items-center overflow-x-auto',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
        scrollbarWidth: 'none',
      } as React.CSSProperties}
    >
      {/* Ctrl modifier button — first in order (D-P5-10) */}
      <button
        type="button"
        aria-label="Control"
        aria-pressed={ctrlActive}
        onClick={handleCtrl}
        className={[
          BASE_BTN,
          ctrlActive
            ? 'bg-blue-500/20 text-blue-400 ring-2 ring-blue-500/60 ring-inset'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        Ctrl
      </button>

      {/* Remaining 10 keys */}
      {TOOLBAR_KEYS.map(({ label, sequence, ariaLabel }) => (
        <button
          key={label}
          type="button"
          aria-label={ariaLabel}
          onClick={() => handleKey(sequence)}
          className={BASE_BTN}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
