import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Server,
  RefreshCw,
  AlertCircle,
  TerminalSquare,
  LogOut,
} from "lucide-react";
import { api } from "../lib/axios";
import { ContainerGroup } from "../components/ContainerGroup";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { useContainerEvents } from "../hooks/useContainerEvents";
import { PWAInstallBanner } from "../components/PWAInstallBanner";
import { StatsPanel } from "../components/StatsPanel";
import { DomainHealthWidget } from "../components/DomainHealthWidget";

interface ContainerInfo {
  id: string;
  shortId: string;
  names: string[];
  image: string;
  status: string;
  state: string;
  createdAt: string;
}

interface ContainerGroup {
  key: string;
  label: string;
  containers: ContainerInfo[];
}

type DashboardContext = { host: string; username: string; port: string };

async function fetchContainers(): Promise<ContainerInfo[]> {
  const { data } = await api.get("/containers");
  return data;
}

async function containerAction(
  id: string,
  action: "start" | "stop" | "restart",
): Promise<void> {
  await api.post(`/containers/${id}/${action}`);
}

/**
 * Group containers by Docker Compose project prefix.
 *
 * Handles two naming conventions:
 *   v2 (hyphen):    {project}-{service}-{replica}  e.g. "proj-web-1"
 *   v1 (underscore): {project}_{service} or {project}_{service}-{replica}
 *
 * After initial grouping, sub-project groups are merged into their parent.
 * e.g. "hkr-fullstack-web" merges into "hkr-fullstack" when both exist.
 */
function groupContainersByProject(
  containers: ContainerInfo[],
): ContainerGroup[] {
  const namedGroups = new Map<string, ContainerInfo[]>();
  const standalone: ContainerInfo[] = [];

  for (const c of containers) {
    const name = c.names[0] ?? c.shortId;

    // v2: {project}-{service}-{replica}
    const v2Match = name.match(/^(.+)-[^-]+-\d+$/);
    if (v2Match) {
      const key = v2Match[1];
      if (!namedGroups.has(key)) namedGroups.set(key, []);
      namedGroups.get(key)!.push(c);
      continue;
    }

    // v1: {project}_{service} or {project}_{service}-{replica}
    const underscoreIdx = name.indexOf("_");
    if (underscoreIdx > 0) {
      const key = name.slice(0, underscoreIdx);
      if (!namedGroups.has(key)) namedGroups.set(key, []);
      namedGroups.get(key)!.push(c);
      continue;
    }

    standalone.push(c);
  }

  // Merge sub-project groups into their parent.
  // e.g. "hkr-fullstack-web" → "hkr-fullstack" when both keys exist.
  const keys = [...namedGroups.keys()];
  for (const key of keys) {
    if (!namedGroups.has(key)) continue; // already merged
    const parent = keys
      .filter((k) => k !== key && key.startsWith(k + "-"))
      .sort((a, b) => b.length - a.length)[0]; // longest matching parent wins
    if (parent && namedGroups.has(parent)) {
      for (const c of namedGroups.get(key)!) {
        namedGroups.get(parent)!.push(c);
      }
      namedGroups.delete(key);
    }
  }

  const result: ContainerGroup[] = [];

  for (const [key, items] of namedGroups) {
    // Single-container "groups" aren't really groups — demote to standalone
    if (items.length < 2) {
      standalone.push(...items);
    } else {
      result.push({ key, label: key, containers: items });
    }
  }

  // Sort named groups alphabetically
  result.sort((a, b) => a.label.localeCompare(b.label));

  // All standalone containers go into one group at the end
  if (standalone.length > 0) {
    standalone.sort((a, b) =>
      (a.names[0] ?? a.shortId).localeCompare(b.names[0] ?? b.shortId),
    );
    result.push({
      key: "__standalone__",
      label: "Other",
      containers: standalone,
    });
  }

  return result;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { host, username, port } = useOutletContext<DashboardContext>();
  const queryClient = useQueryClient();
  const { wsConnected, hasConnectedOnce } = useContainerEvents(queryClient);
  const [actingContainers, setActingContainers] = useState<Set<string>>(
    new Set(),
  );

  const {
    data: containers,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<ContainerInfo[]>({
    queryKey: ["containers"],
    queryFn: fetchContainers,
    refetchInterval: wsConnected ? false : 5000,
  });

  const mutation = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: "start" | "stop" | "restart";
    }) => containerAction(id, action),
    onMutate: ({ id }) => {
      setActingContainers((prev) => new Set(prev).add(id));
    },
    onSettled: (_data, _err, variables) => {
      if (variables) {
        setActingContainers((prev) => {
          const next = new Set(prev);
          next.delete(variables.id);
          return next;
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["containers"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/containers/${id}`),
    onMutate: (id) => {
      setActingContainers((prev) => new Set(prev).add(id));
    },
    onSettled: (_data, _err, id) => {
      if (id) {
        setActingContainers((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["containers"] });
    },
  });

  function handleAction(id: string, action: "start" | "stop" | "restart") {
    mutation.mutate({ id, action });
  }

  function handleLogs(id: string) {
    const container = containers?.find((c) => c.id === id);
    navigate(`/logs/${id}`, {
      state: { name: container?.names[0] ?? id.slice(0, 12) },
    });
  }

  async function handleLogout() {
    try {
      await api.post("/auth/logout");
    } catch {
      // even if logout fails, redirect to login
    }
    navigate("/login");
  }

  const groups = containers ? groupContainersByProject(containers) : [];
  const namedGroupCount = groups.filter(
    (g) => !g.key.startsWith("__standalone__"),
  ).length;
  const hasStandalone = groups.some((g) => g.key.startsWith("__standalone__"));
  const showGroupHeaders =
    namedGroupCount > 1 || (namedGroupCount >= 1 && hasStandalone);

  return (
    <div className="min-h-svh flex flex-col bg-background">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between max-w-screen-2xl mx-auto px-2">
          <div className="flex items-center gap-2 min-w-0">
            <Server className="h-5 w-5 text-blue-500 shrink-0" />
            <div className="grid gap-0.5">
              <span className="font-semibold shrink-0">ServerDeck</span>
              <div className="sm:hidden">
                <p className="text-[8px] text-muted-foreground">
                  {username}@{host}:{port}
                </p>
              </div>
            </div>
            <span className="text-muted-foreground text-sm truncate hidden sm:inline pl-5">
              {username}@{host}:{port}
            </span>
          </div>
          {!wsConnected && hasConnectedOnce && (
            <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 shrink-0">
              reconnecting…
            </span>
          )}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-none"
              onClick={() => refetch()}
              aria-label="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 rounded-none"
              onClick={() => navigate("/terminal")}
              aria-label="Terminal"
            >
              <TerminalSquare className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 rounded-none border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
              onClick={handleLogout}
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* PWA install banner — between header and content */}
      <PWAInstallBanner />

      {/* Main content */}
      <main className="flex-1 overflow-auto px-4 py-4">
        <div className="max-w-screen-2xl mx-auto space-y-3">
          {/* Server stats */}
          <StatsPanel />

          {/* Domain health */}
          <DomainHealthWidget />

          {/* Loading skeletons */}
          {isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="border border-zinc-800 p-4 space-y-3">
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
            <div className="border border-red-500/30 bg-red-500/10 p-4 flex flex-col items-center gap-3 text-center">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <div>
                <p className="font-semibold text-red-400">
                  Failed to load containers
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {error instanceof Error
                    ? error.message
                    : "An unexpected error occurred"}
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
            <div className="border border-zinc-800 p-8 flex flex-col items-center gap-2 text-center">
              <Server className="h-10 w-10 text-muted-foreground/50" />
              <p className="font-semibold">No containers</p>
              <p className="text-sm text-muted-foreground">
                No Docker containers were found on this host.
              </p>
            </div>
          )}

          {/* Grouped container list */}
          {!isLoading &&
            !isError &&
            groups.map((group) => (
              <ContainerGroup
                key={group.key}
                groupKey={group.key}
                label={group.label}
                containers={group.containers}
                showHeader={showGroupHeaders}
                actingContainers={actingContainers}
                onStart={(id) => handleAction(id, "start")}
                onStop={(id) => handleAction(id, "stop")}
                onRestart={(id) => handleAction(id, "restart")}
                onLogs={handleLogs}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            ))}
        </div>
      </main>
    </div>
  );
}

export default DashboardPage;
