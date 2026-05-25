import * as React from 'react'
import { Loader2 } from 'lucide-react'
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
        'bg-green-500/15 text-green-400 border border-green-500/30 text-xs px-2 py-0.5 rounded-full'
      break
    case 'exited':
    case 'dead':
      className =
        'bg-zinc-500/15 text-zinc-400 border border-zinc-500/30 text-xs px-2 py-0.5 rounded-full'
      break
    case 'paused':
      className =
        'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 text-xs px-2 py-0.5 rounded-full'
      break
    case 'created':
    case 'restarting':
    default:
      className =
        'bg-blue-500/15 text-blue-400 border border-blue-500/30 text-xs px-2 py-0.5 rounded-full'
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
    <div className="rounded-lg border border-zinc-800 bg-card p-4 space-y-3">
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

      {/* Action buttons */}
      <div className="flex justify-end gap-2">
        {/* Logs — always visible regardless of container state (D-P4-01) */}
        <Button
          variant="ghost"
          size="sm"
          className="min-h-[44px] h-11"
          onClick={() => onLogs(container.id)}
        >
          Logs
        </Button>
        {container.state === 'running' && (
          <>
            {/* Restart */}
            <Button
              variant="outline"
              size="sm"
              className="min-h-[44px] h-11"
              disabled={isActing}
              onClick={() => onRestart(container.id)}
            >
              {isActing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Restart
            </Button>

            {/* Stop — guarded by AlertDialog */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[44px] h-11 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                  disabled={isActing}
                >
                  Stop
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
            size="sm"
            className="min-h-[44px] h-11"
            disabled
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Restarting...
          </Button>
        )}

        {['exited', 'dead', 'created', 'paused'].includes(container.state) && (
          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px] h-11"
            disabled={isActing}
            onClick={() => onStart(container.id)}
          >
            {isActing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Start
          </Button>
        )}
      </div>
    </div>
  )
}
