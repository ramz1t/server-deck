import { useState, useEffect } from 'react'
import { Download, X } from 'lucide-react'
import { Button } from './ui/button'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isIOS, setIsIOS] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    // Check if already installed (standalone mode)
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches)

    // Check if already dismissed this session
    if (localStorage.getItem('pwa-install-dismissed') === 'true') {
      setDismissed(true)
    }

    // Detect iOS (no deferred prompt API)
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    setIsIOS(ios)

    // Listen for Android Chrome install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    }
  }, [])

  function handleInstall() {
    if (!deferredPrompt) return
    void deferredPrompt.prompt()
    void deferredPrompt.userChoice.then(() => {
      setDeferredPrompt(null)
    })
  }

  function handleDismiss() {
    localStorage.setItem('pwa-install-dismissed', 'true')
    setDismissed(true)
  }

  // Don't render if: already installed, dismissed, or no install mechanism available
  if (isStandalone || dismissed) return null
  if (!deferredPrompt && !isIOS) return null

  return (
    <div className="h-12 bg-secondary border-b border-border flex items-center gap-3 px-4 shrink-0">
      <Download className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-[13px] text-foreground flex-1">
        {isIOS
          ? "Tap Share ↑ then 'Add to Home Screen'"
          : 'Install ServerDeck for quick access'}
      </span>
      {!isIOS && deferredPrompt && (
        <Button size="sm" variant="default" className="h-11 px-3 text-xs shrink-0" onClick={handleInstall}>
          Install
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11 shrink-0"
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
