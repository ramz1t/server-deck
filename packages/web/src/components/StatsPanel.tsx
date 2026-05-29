import { useQuery } from '@tanstack/react-query'
import { HardDrive, MemoryStick, Clock, FolderOpen } from 'lucide-react'
import { api } from '../lib/axios'
import { Skeleton } from './ui/skeleton'

interface ServerStats {
  disk: { filesystem: string; total: number; used: number; available: number; usePercent: number }
  ram: { total: number; used: number; available: number; usePercent: number }
  uptime: { seconds: number; human: string }
  mntSdb: Array<{ name: string; bytes: number; human: string }> | null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

async function fetchStats(): Promise<ServerStats> {
  const { data } = await api.get<ServerStats>('/stats')
  return data
}

export function StatsPanel() {
  const { data, isLoading, isError } = useQuery<ServerStats>({
    queryKey: ['stats'],
    queryFn: fetchStats,
    refetchInterval: 30_000,
    staleTime: 25_000,
  })

  if (isLoading) {
    return (
      <div className="border border-zinc-800 p-4 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-32" />
      </div>
    )
  }

  if (isError || !data) {
    return null // silent fail — stats panel is supplementary
  }

  return (
    <div className="border border-zinc-800 divide-y divide-zinc-800">
      <StatRow
        icon={<Clock className="h-4 w-4 text-muted-foreground shrink-0" />}
        label="Uptime"
        value={data.uptime.human}
      />
      <StatRow
        icon={<MemoryStick className="h-4 w-4 text-muted-foreground shrink-0" />}
        label="RAM"
        value={`${formatBytes(data.ram.used)} / ${formatBytes(data.ram.total)} (${data.ram.usePercent}%)`}
      />
      <StatRow
        icon={<HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />}
        label="Disk (/)"
        value={`${formatBytes(data.disk.used)} / ${formatBytes(data.disk.total)} (${data.disk.usePercent}%)`}
      />
      {data.mntSdb && data.mntSdb.length > 0 && (
        <div className="px-4 py-3 bg-zinc-900">
          <div className="flex items-center gap-3 mb-2">
            <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">/mnt/sdb</p>
          </div>
          <div className="space-y-1 pl-7">
            {data.mntSdb.map((entry) => (
              <div key={entry.name} className="flex items-center justify-between gap-4">
                <span className="text-xs font-mono truncate">{entry.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">{entry.human}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-zinc-900">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-mono mt-0.5 truncate">{value}</p>
      </div>
    </div>
  )
}
