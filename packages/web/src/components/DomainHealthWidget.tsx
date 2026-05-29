import { useQuery } from "@tanstack/react-query";
import { Globe, RefreshCw, ExternalLink } from "lucide-react";
import { api } from "../lib/axios";
import { Button } from "./ui/button";
import { MONITORED_DOMAINS } from "../config/domains";

interface DomainResult {
  url: string;
  up: boolean;
  latencyMs: number | null;
}

interface SubGroup {
  key: string;
  label: string;
  entries: Array<{ result: DomainResult; displayLabel: string }>;
}

interface DomainGroup {
  domain: string;
  subGroups: SubGroup[];
}

async function fetchDomainHealth(): Promise<DomainResult[]> {
  const { data } = await api.post<{ results: DomainResult[] }>(
    "/health/domains",
    {
      urls: [...MONITORED_DOMAINS],
    },
  );
  return data.results;
}

function getBaseDomain(url: string): string {
  const { hostname } = new URL(url);
  const parts = hostname.split(".");
  return parts.slice(-2).join(".");
}

function groupResults(results: DomainResult[]): DomainGroup[] {
  // Bucket by base domain
  const byDomain = new Map<string, DomainResult[]>();
  for (const r of results) {
    const key = getBaseDomain(r.url);
    if (!byDomain.has(key)) byDomain.set(key, []);
    byDomain.get(key)!.push(r);
  }

  const groups: DomainGroup[] = [];

  for (const [domain, domainResults] of byDomain) {
    // Check if all entries share the same hostname — if so sub-group by first path segment
    const hostnames = new Set(
      domainResults.map((r) => new URL(r.url).hostname),
    );
    const singleHost = hostnames.size === 1;

    const subGroupMap = new Map<
      string,
      Array<{ result: DomainResult; displayLabel: string }>
    >();

    for (const r of domainResults) {
      const parsed = new URL(r.url);
      const segments = parsed.pathname.split("/").filter(Boolean);

      let subKey: string;
      let displayLabel: string;

      if (singleHost) {
        // Sub-group by first path segment; label is remaining path
        subKey = segments[0] ?? "__root__";
        const remaining =
          segments.length > 1 ? "/" + segments.slice(1).join("/") : "/";
        displayLabel = remaining;
      } else {
        // Sub-group by subdomain; label is the path (or '/')
        const hostname = parsed.hostname;
        const base = domain;
        subKey =
          hostname.slice(0, hostname.length - base.length - 1) || hostname;
        displayLabel = parsed.pathname === "/" ? "/" : parsed.pathname;
      }

      if (!subGroupMap.has(subKey)) subGroupMap.set(subKey, []);
      subGroupMap.get(subKey)!.push({ result: r, displayLabel });
    }

    const subGroups: SubGroup[] = [];
    for (const [key, entries] of subGroupMap) {
      const label = key === "__root__" ? "/" : key;
      subGroups.push({ key, label, entries });
    }

    groups.push({ domain, subGroups });
  }

  return groups;
}

function StatusBadge({
  up,
  latencyMs,
}: {
  up: boolean;
  latencyMs: number | null;
}) {
  if (up) {
    return (
      <span className="bg-green-500/15 text-green-400 border border-green-500/30 text-xs px-2 py-0.5 rounded-none shrink-0">
        {latencyMs !== null ? `${latencyMs}ms` : "up"}
      </span>
    );
  }
  return (
    <span className="bg-red-500/15 text-red-400 border border-red-500/30 text-xs px-2 py-0.5 rounded-none shrink-0">
      down
    </span>
  );
}

export function DomainHealthWidget() {
  const { data, isLoading, refetch, isFetching } = useQuery<DomainResult[]>({
    queryKey: ["domain-health"],
    queryFn: fetchDomainHealth,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });

  if ((MONITORED_DOMAINS as readonly string[]).length === 0) return null;

  const groups = data ? groupResults(data) : [];

  return (
    <div className=" divide-y divide-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Domains</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-none"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh domain health checks"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      {isLoading && (
        <div className="px-4 py-3 text-xs text-muted-foreground bg-zinc-900">
          Checking…
        </div>
      )}

      <div className="divide-y divide-zinc-800/0 flex flex-col">
        {groups.map((group) => (
          <div key={group.domain} className="flex flex-col">
            {/* Domain group header */}
            <div className="pl-3 pb-1 pt-5">
              <span className="text-xs font-bold text-muted-foreground/70 uppercase tracking-wider">
                {group.domain}
              </span>
            </div>

            {group.subGroups.map((sub) => {
              const isSingleEntry =
                sub.entries.length === 1 && sub.entries[0].displayLabel === "/";
              return (
                <div key={sub.key} className="bg-zinc-900">
                  {/* Sub-group header */}
                  {!isSingleEntry && (
                    <div className="px-3 py-1 flex items-center gap-1.5 bg-zinc-800/40">
                      <span className="text-xs text-zinc-400 font-mono font-semibold">
                        {sub.label}
                      </span>
                    </div>
                  )}

                  {sub.entries.map(({ result, displayLabel }) => (
                    <a
                      key={result.url}
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between px-3 py-2 hover:bg-zinc-800/50 transition-colors group"
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-mono text-zinc-300 truncate">
                          {isSingleEntry ? sub.label : displayLabel}
                        </span>
                        <ExternalLink className="h-3 w-3 text-zinc-600 group-hover:text-zinc-400 shrink-0 transition-colors" />
                      </span>
                      <StatusBadge
                        up={result.up}
                        latencyMs={result.latencyMs}
                      />
                    </a>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
