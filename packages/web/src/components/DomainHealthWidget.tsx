import { useQuery } from '@tanstack/react-query'
import { Globe, RefreshCw } from 'lucide-react'
import { api } from '../lib/axios'
import { Button } from './ui/button'
import { MONITORED_DOMAINS } from '../config/domains'

interface DomainResult {
  url: string
  up: boolean
  latencyMs: number | null
}

async function fetchDomainHealth(): Promise<DomainResult[]> {
  const { data } = await api.post<{ results: DomainResult[] }>('/health/domains', {
    urls: [...MONITORED_DOMAINS],
  })
  return data.results
}

function StatusBadge({ up, latencyMs }: { up: boolean; latencyMs: number | null }) {
  if (up) {
    return (
      <span className="bg-green-500/15 text-green-400 border border-green-500/30 text-xs px-2 py-0.5 rounded-none">
        {latencyMs !== null ? `up ${latencyMs}ms` : 'up'}
      </span>
    )
  }
  return (
    <span className="bg-red-500/15 text-red-400 border border-red-500/30 text-xs px-2 py-0.5 rounded-none">
      down
    </span>
  )
}

export function DomainHealthWidget() {
  const { data, isLoading, refetch, isFetching } = useQuery<DomainResult[]>({
    queryKey: ['domain-health'],
    queryFn: fetchDomainHealth,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  })

  // Early return AFTER hooks — React Rules of Hooks requires all hooks to be called unconditionally
  if ((MONITORED_DOMAINS as readonly string[]).length === 0) return null

  return (
    <div className="border border-zinc-800">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Domains</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-none"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh domain health checks"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {isLoading && (
        <div className="px-4 py-3 text-xs text-muted-foreground">Checking…</div>
      )}

      {data?.map((result) => (
        <div
          key={result.url}
          className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 last:border-0"
        >
          <span className="text-sm font-mono truncate">{result.url}</span>
          <StatusBadge up={result.up} latencyMs={result.latencyMs} />
        </div>
      ))}
    </div>
  )
}
