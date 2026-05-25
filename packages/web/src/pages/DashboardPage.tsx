import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Server, RefreshCw, AlertCircle } from 'lucide-react'
import { api } from '../lib/axios'
import { ContainerCard } from '../components/ContainerCard'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'

interface ContainerInfo {
  id: string
  shortId: string
  names: string[]
  image: string
  status: string
  state: string
  createdAt: string
}

type DashboardContext = { host: string }

async function fetchContainers(): Promise<ContainerInfo[]> {
  const { data } = await api.get('/containers')
  return data
}

async function containerAction(
  id: string,
  action: 'start' | 'stop' | 'restart',
): Promise<void> {
  await api.post(`/containers/${id}/${action}`)
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { host } = useOutletContext<DashboardContext>()
  const queryClient = useQueryClient()
  const [actingContainers, setActingContainers] = useState<Set<string>>(
    new Set(),
  )

  const {
    data: containers,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<ContainerInfo[]>({
    queryKey: ['containers'],
    queryFn: fetchContainers,
    refetchInterval: 5000,
  })

  const mutation = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string
      action: 'start' | 'stop' | 'restart'
    }) => containerAction(id, action),
    onMutate: ({ id }) => {
      setActingContainers((prev) => new Set(prev).add(id))
    },
    onSettled: (_data, _err, variables) => {
      // Always clean up acting state and refresh list — regardless of success/failure (IN-03)
      if (variables) {
        setActingContainers((prev) => {
          const next = new Set(prev)
          next.delete(variables.id)
          return next
        })
      }
      void queryClient.invalidateQueries({ queryKey: ['containers'] })
    },
  })

  function handleAction(id: string, action: 'start' | 'stop' | 'restart') {
    mutation.mutate({ id, action })
  }

  async function handleLogout() {
    try {
      await api.post('/auth/logout')
    } catch {
      // even if logout fails, redirect to login
    }
    navigate('/login')
  }

  return (
    <div className="min-h-svh flex flex-col bg-background">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-blue-500" />
            <span className="font-semibold">ServerDeck</span>
            <span className="text-muted-foreground text-sm hidden sm:inline">
              {host}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => refetch()}
              aria-label="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={handleLogout}
            >
              Log out
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile hostname below header */}
      <div className="sm:hidden px-4 pt-2 pb-0">
        <p className="text-xs text-muted-foreground">{host}</p>
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-auto px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-3">
          {/* Loading skeletons */}
          {isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-zinc-800 p-4 space-y-3"
              >
                <div className="flex justify-between">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-16" />
                </div>
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-24" />
                <div className="flex justify-end gap-2">
                  <Skeleton className="h-9 w-20" />
                </div>
              </div>
            ))}

          {/* Error state */}
          {isError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 flex flex-col items-center gap-3 text-center">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <div>
                <p className="font-semibold text-red-400">
                  Failed to load containers
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {error instanceof Error
                    ? error.message
                    : 'An unexpected error occurred'}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-11"
                onClick={() => refetch()}
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </Button>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !isError && containers && containers.length === 0 && (
            <div className="rounded-lg border border-zinc-800 p-8 flex flex-col items-center gap-2 text-center">
              <Server className="h-10 w-10 text-muted-foreground/50" />
              <p className="font-semibold">No containers</p>
              <p className="text-sm text-muted-foreground">
                No Docker containers were found on this host.
              </p>
            </div>
          )}

          {/* Container list */}
          {!isLoading &&
            !isError &&
            containers &&
            containers.map((container) => (
              <ContainerCard
                key={container.id}
                container={container}
                isActing={actingContainers.has(container.id)}
                onStart={(id) => handleAction(id, 'start')}
                onStop={(id) => handleAction(id, 'stop')}
                onRestart={(id) => handleAction(id, 'restart')}
              />
            ))}
        </div>
      </main>
    </div>
  )
}

export default DashboardPage

