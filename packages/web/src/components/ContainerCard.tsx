import * as React from 'react'
import { Loader2, ScrollText, RotateCw, Square, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface ContainerInfo {
  id: string
  shortId: string
  names: string[]
  image: string
  status: string
  state: string
  createdAt: string
}

interface ContainerCardProps {
  container: ContainerInfo
  onStart: (id: string) => void
  onStop: (id: string) => void
  onRestart: (id: string) => void
  onLogs: (id: string) => void
  isActing: boolean
}

function StateBadge({ state }: { state: string }) {
  let className = ''
  switch (state) {
    case 'running':
      className =
        'bg-green-500/15 text-green-400 border border-green-500/30 text-xs px-2 py-0.5 rounded-none'
      break
    case 'exited':
    case 'dead':
      className =
        'bg-zinc-500/15 text-zinc-400 border border-zinc-500/30 text-xs px-2 py-0.5 rounded-none'
      break
    case 'paused':
      className =
        'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 text-xs px-2 py-0.5 rounded-none'
      break
    case 'created':
    case 'restarting':
    default:
      className =
        'bg-blue-500/15 text-blue-400 border border-blue-500/30 text-xs px-2 py-0.5 rounded-none'
  }
  return <span className={className}>{state}</span>
}

export function ContainerCard({
  container,
  onStart,
  onStop,
  onRestart,
  onLogs,
  isActing,
}: ContainerCardProps) {
  const containerName = container.names[0] ?? container.shortId

  return (
    <div className="rounded-none bg-zinc-800 p-4 space-y-3">
      {/* Header: name + badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate">{containerName}</p>
          <p className="text-sm text-muted-foreground truncate mt-0.5">
            {container.image}
          </p>
        </div>
        <StateBadge state={container.state} />
      </div>

      {/* Human-readable status */}
      <p className="text-xs text-muted-foreground">{container.status}</p>

      {/* Action buttons — icon only */}
      <div className="flex justify-end gap-2">
        {/* Logs — always visible */}
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 rounded-none border-0 bg-zinc-800 hover:bg-zinc-700"
          onClick={() => onLogs(container.id)}
          aria-label="View logs"
        >
          <ScrollText className="h-4 w-4" />
        </Button>
        {container.state === 'running' && (
          <>
            {/* Restart */}
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 rounded-none border-0 bg-zinc-800 hover:bg-zinc-700"
              disabled={isActing}
              onClick={() => onRestart(container.id)}
              aria-label="Restart"
            >
              {isActing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4" />
              )}
            </Button>

            {/* Stop — guarded by AlertDialog */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 rounded-none border-0 bg-zinc-800 text-red-400 hover:bg-zinc-700 hover:text-red-400"
                  disabled={isActing}
                  aria-label="Stop"
                >
                  <Square className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Stop container?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will stop {containerName}. Any running processes will
                    be interrupted.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => onStop(container.id)}
                  >
                    Stop container
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}

        {container.state === 'restarting' && (
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 rounded-none border-0 bg-zinc-800 hover:bg-zinc-700"
            disabled
            aria-label="Restarting"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
          </Button>
        )}

        {['exited', 'dead', 'created', 'paused'].includes(container.state) && (
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 rounded-none border-0 bg-zinc-800 hover:bg-zinc-700"
            disabled={isActing}
            onClick={() => onStart(container.id)}
            aria-label="Start"
          >
            {isActing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
