import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HardDrive, MemoryStick, Container, Trash2, Network } from "lucide-react";
import { api } from "../lib/axios";
import { Skeleton } from "./ui/skeleton";
import { Button } from "./ui/button";

interface ServerStats {
  disk: {
    filesystem: string;
    total: number;
    used: number;
    available: number;
    usePercent: number;
  };
  ram: { total: number; used: number; available: number; usePercent: number };
  uptime: { seconds: number; human: string };
  mntSdb: Array<{
    name: string;
    bytes: number;
    human: string;
    modifiedAt: number | null;
  }> | null;
  mntSdbDisk: {
    total: number;
    used: number;
    available: number;
    usePercent: number;
  } | null;
  dockerDf: {
    images: {
      total: number;
      active: number;
      size: string;
      reclaimable: string;
    };
    containers: {
      total: number;
      active: number;
      size: string;
      reclaimable: string;
    };
    volumes: {
      total: number;
      active: number;
      size: string;
      reclaimable: string;
    };
    buildCache: {
      total: number;
      active: number;
      size: string;
      reclaimable: string;
    };
  } | null;
  nginxRoutes: Array<{ path: string; port: number; ws: boolean }> | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatRelativeTime(epochSecs: number): string {
  const diffSecs = Math.floor((Date.now() - epochSecs * 1000) / 1000);
  if (diffSecs < 60) return "just now";
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

async function fetchStats(): Promise<ServerStats> {
  const { data } = await api.get<ServerStats>("/stats");
  return data;
}

export function StatsPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<ServerStats>({
    queryKey: ["stats"],
    queryFn: fetchStats,
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const pruneMutation = useMutation({
    mutationFn: () => api.post("/docker/prune"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  if (isLoading) {
    return (
      <div className="border border-zinc-800 p-4 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }

  if (isError || !data) {
    return null; // silent fail — stats panel is supplementary
  }

  return (
    <div className="border border-zinc-800 divide-y divide-zinc-800">
      <StatRow
        icon={
          <MemoryStick className="h-4 w-4 text-muted-foreground shrink-0" />
        }
        label="RAM"
        value={`${formatBytes(data.ram.used)} / ${formatBytes(data.ram.total)} (${data.ram.usePercent}%)`}
      />
      <StatRow
        icon={
          <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />
        }
        label="Disk (/)"
        value={`${formatBytes(data.disk.used)} / ${formatBytes(data.disk.total)} (${data.disk.usePercent}%)`}
      />
      {data.mntSdbDisk && (
        <StatRow
          icon={
            <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />
          }
          label="Disk (/mnt/sdb)"
          value={`${formatBytes(data.mntSdbDisk.used)} / ${formatBytes(data.mntSdbDisk.total)} (${data.mntSdbDisk.usePercent}%)`}
        />
      )}
      {data.mntSdb && data.mntSdb.length > 0 && (
        <div className="px-4 py-3 bg-zinc-900">
          <div className="space-y-1 pl-7">
            {data.mntSdb.map((entry) => (
              <div key={entry.name} className="flex items-center gap-2">
                <span className="text-xs font-mono truncate flex-1">
                  {entry.name}
                </span>
                <span className="text-xs text-muted-foreground/60 w-16 text-right shrink-0">
                  {entry.modifiedAt !== null
                    ? formatRelativeTime(entry.modifiedAt)
                    : ""}
                </span>
                <span className="text-xs text-muted-foreground w-16 text-right shrink-0">
                  {entry.human}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.dockerDf && (
        <>
          <div className="flex items-center justify-between px-4 py-2 bg-zinc-900">
            <div className="flex items-center gap-3">
              <Container className="h-4 w-4 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground">Docker</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-none text-red-400 hover:bg-red-500/10 hover:text-red-400"
              onClick={() => pruneMutation.mutate()}
              disabled={pruneMutation.isPending}
              title="docker system prune -f"
              aria-label="Clear unused Docker data"
            >
              <Trash2
                className={`h-3.5 w-3.5 ${pruneMutation.isPending ? "animate-pulse" : ""}`}
              />
            </Button>
          </div>
          <div className="px-4 py-2 bg-zinc-900 space-y-1 pl-11">
            {(
              [
                ["Images", data.dockerDf.images],
                ["Containers", data.dockerDf.containers],
                ["Volumes", data.dockerDf.volumes],
                ["Build cache", data.dockerDf.buildCache],
              ] as const
            ).map(([label, row]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground/70 w-24 shrink-0">
                  {label}
                </span>
                <span className="text-xs font-mono flex-1">{row.size}</span>
                {row.reclaimable !== "0B" && row.reclaimable !== "0 B" && (
                  <span className="text-xs text-yellow-500/70 shrink-0">
                    ↓ {row.reclaimable}
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {data.nginxRoutes && data.nginxRoutes.length > 0 && (
        <>
          <div className="flex items-center gap-3 px-4 py-2 bg-zinc-900">
            <Network className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">Nginx routes</p>
          </div>
          <div className="px-4 py-2 bg-zinc-900 space-y-1 pl-11">
            {data.nginxRoutes.map((r) => (
              <div key={r.path + r.port} className="flex items-center gap-2">
                <span className="text-xs font-mono text-zinc-300 flex-1 truncate">{r.path}</span>
                {r.ws && (
                  <span className="text-xs text-blue-400/70 shrink-0">WS</span>
                )}
                <span className="text-xs font-mono text-muted-foreground shrink-0">:{r.port}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-zinc-900">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-mono mt-0.5 truncate">{value}</p>
      </div>
    </div>
  );
}
