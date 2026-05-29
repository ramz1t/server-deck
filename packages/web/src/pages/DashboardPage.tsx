import { useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Server, RefreshCw, AlertCircle, Layers, ChevronRight } from 'lucide-react'
import { api } from '../lib/axios'
import { ContainerCard } from '../components/ContainerCard'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { useContainerEvents } from '../hooks/useContainerEvents'
import { PWAInstallBanner } from '../components/PWAInstallBanner'

interface ContainerInfo {
  id: string
  shortId: string
  names: string[]
  image: string
  status: string
  state: string
  createdAt: string
}

interface ContainerGroup {
  key: string
  label: string
  containers: ContainerInfo[]
}

type DashboardContext = { host: string; username: string }

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

/**
 * Group containers by Docker Compose project prefix.
 * Docker Compose v2 names: {project}-{service}-{replica}
 * e.g. "proj1-web-1", "proj1-db-1" → group "proj1"
 * Containers that don't match the pattern are treated as standalone.
 */
function groupContainersByProject(containers: ContainerInfo[]): ContainerGroup[] {
  const namedGroups = new Map<string, ContainerInfo[]>()
  const standalone: ContainerInfo[] = []

  for (const c of containers) {
    const name = c.names[0] ?? c.shortId
    const match = name.match(/^(.+)-[^-]+-\d+$/)
    if (match) {
      const key = match[1]
      if (!namedGroups.has(key)) namedGroups.set(key, [])
      namedGroups.get(key)!.push(c)
    } else {
      standalone.push(c)
    }
  }

  const result: ContainerGroup[] = []

  for (const [key, items] of namedGroups) {
    result.push({ key, label: key, containers: items })
  }

  // Sort named groups alphabetically
  result.sort((a, b) => a.label.localeCompare(b.label))

  // All standalone containers go into one group at the end
  if (standalone.length > 0) {
    standalone.sort((a, b) =>
      (a.names[0] ?? a.shortId).localeCompare(b.names[0] ?? b.shortId),
    )
    result.push({ key: '__standalone__', label: 'Other', containers: standalone })
  }

  return result
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { host, username } = useOutletContext<DashboardContext>()
  const queryClient = useQueryClient()
  const { wsConnected, hasConnectedOnce } = useContainerEvents(queryClient)
  const [actingContainers, setActingContainers] = useState<Set<string>>(new Set())

  const {
    data: containers,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<ContainerInfo[]>({
    queryKey: ['containers'],
    queryFn: fetchContainers,
    refetchInterval: wsConnected ? false : 5000,
  })

  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'stop' | 'restart' }) =>
      containerAction(id, action),
    onMutate: ({ id }) => {
      setActingContainers((prev) => new Set(prev).add(id))
    },
    onSettled: (_data, _err, variables) => {
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

  function handleLogs(id: string) {
    const container = containers?.find((c) => c.id === id)
    navigate(`/logs/${id}`, {
      state: { name: container?.names[0] ?? id.slice(0, 12) },
    })
  }

  async function handleLogout() {
    try {
      await api.post('/auth/logout')
    } catch {
      // even if logout fails, redirect to login
    }
    navigate('/login')
  }

  const groups = containers ? groupContainersByProject(containers) : []
  const namedGroupCount = groups.filter((g) => !g.key.startsWith('__standalone__')).length
  const hasStandalone = groups.some((g) => g.key.startsWith('__standalone__'))
  const showGroupHeaders = namedGroupCount > 1 || (namedGroupCount >= 1 && hasStandalone)

  // collapsedGroups tracks which groups are explicitly collapsed; empty set = all expanded
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  function isExpanded(key: string): boolean {
    if (key === '__standalone__') return true
    return !collapsedGroups.has(key)
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="min-h-svh flex flex-col bg-background">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between max-w-screen-2xl mx-auto px-2">
          <div className="flex items-center gap-2 min-w-0">
            <Server className="h-5 w-5 text-blue-500 shrink-0" />
            <span className="font-semibold shrink-0">ServerDeck</span>
            <span className="text-muted-foreground text-sm truncate hidden sm:inline">
              {username}@{host}
            </span>
          </div>
          {!wsConnected && hasConnectedOnce && (
            <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full shrink-0">
              reconnecting…
            </span>
          )}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              onClick={() => refetch()}
              aria-label="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-11"
              onClick={() => navigate('/terminal')}
            >
              Terminal
            </Button>
            <Button variant="outline" size="sm" className="h-11" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        </div>
      </header>

      {/* PWA install banner — between header and content */}
      <PWAInstallBanner />

      {/* Mobile: user@host below header */}
      <div className="sm:hidden px-4 pt-2 pb-0">
        <p className="text-xs text-muted-foreground">{username}@{host}</p>
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-auto px-4 py-4">
        <div className="max-w-screen-2xl mx-auto space-y-3">

          {/* Loading skeletons */}
          {isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-zinc-800 p-4 space-y-3">
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
                <p className="font-semibold text-red-400">Failed to load containers</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {error instanceof Error ? error.message : 'An unexpected error occurred'}
                </p>
              </div>
              <Button variant="outline" size="sm" className="h-11" onClick={() => refetch()}>
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

          {/* Grouped container list */}
          {!isLoading && !isError && groups.map((group) => {
            const isStandalone = group.key === '__standalone__'
            const expanded = isExpanded(group.key)
            const runningCount = group.containers.filter((c) => c.state === 'running').length
            const totalCount = group.containers.length
            const allRunning = runningCount === totalCount
            const someRunning = runningCount > 0

            return (
              <div key={group.key} className="border border-zinc-700 rounded-xl p-3">
                {showGroupHeaders && isStandalone && (
                  <div className="flex items-center gap-2 pt-2 pb-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Other
                    </span>
                    <div className="flex-1 h-px bg-zinc-800" />
                  </div>
                )}
                {showGroupHeaders && !isStandalone && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="w-full flex items-center gap-2 pt-2 pb-1 text-left group min-h-[44px]"
                    aria-expanded={expanded}
                  >
                    <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex-1">
                      {group.label}
                    </span>
                    <span
                      className={[
                        'text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded',
                        allRunning
                          ? 'text-green-400 bg-green-500/10'
                          : someRunning
                          ? 'text-yellow-400 bg-yellow-500/10'
                          : 'text-red-400 bg-red-500/10',
                      ].join(' ')}
                    >
                      {runningCount}/{totalCount}
                    </span>
                    <ChevronRight
                      className={[
                        'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 shrink-0',
                        expanded ? 'rotate-90' : '',
                      ].join(' ')}
                    />
                  </button>
                )}
                {expanded && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {group.containers.map((container) => (
                      <ContainerCard
                        key={container.id}
                        container={container}
                        isActing={actingContainers.has(container.id)}
                        onStart={(id) => handleAction(id, 'start')}
                        onStop={(id) => handleAction(id, 'stop')}
                        onRestart={(id) => handleAction(id, 'restart')}
                        onLogs={handleLogs}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}

        </div>
      </main>
    </div>
  )
}

export default DashboardPage
