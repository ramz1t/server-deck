import { useState } from "react";
import { Layers, ChevronRight } from "lucide-react";
import { ContainerCard } from "./ContainerCard";

interface ContainerInfo {
  id: string;
  shortId: string;
  names: string[];
  image: string;
  status: string;
  state: string;
  createdAt: string;
}

interface ContainerGroupProps {
  groupKey: string;
  label: string;
  containers: ContainerInfo[];
  showHeader: boolean;
  actingContainers: Set<string>;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onLogs: (id: string) => void;
}

export function ContainerGroup({
  groupKey,
  label,
  containers,
  showHeader,
  actingContainers,
  onStart,
  onStop,
  onRestart,
  onLogs,
}: ContainerGroupProps) {
  const isStandalone = groupKey === "__standalone__";
  const [expanded, setExpanded] = useState(true);

  const runningCount = containers.filter((c) => c.state === "running").length;
  const totalCount = containers.length;
  const allRunning = runningCount === totalCount;
  const someRunning = runningCount > 0;

  return (
    <div className="bg-zinc-900 rounded-none p-3">
      {/* Standalone "Other" header — non-collapsible */}
      {showHeader && isStandalone && (
        <div className="flex items-center gap-2 pt-2 pb-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Other
          </span>
          <div className="flex-1 h-px bg-zinc-800" />
        </div>
      )}

      {/* Named group header — collapsible */}
      {showHeader && !isStandalone && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-2 pt-2 pb-1 text-left group min-h-[44px]"
          aria-expanded={expanded}
        >
          <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex-1">
            {label}
          </span>
          <span
            className={[
              "text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded",
              allRunning
                ? "text-green-400 bg-green-500/10"
                : someRunning
                  ? "text-yellow-400 bg-yellow-500/10"
                  : "text-red-400 bg-red-500/10",
            ].join(" ")}
          >
            {runningCount}/{totalCount}
          </span>
          <ChevronRight
            className={[
              "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 shrink-0",
              expanded ? "rotate-90" : "",
            ].join(" ")}
          />
        </button>
      )}

      {/* Animated container grid */}
      <div
        className={`grid transition-all duration-300 ease-in-out pt-3 ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pt-1">
            {containers.map((container) => (
              <ContainerCard
                key={container.id}
                container={container}
                isActing={actingContainers.has(container.id)}
                onStart={onStart}
                onStop={onStop}
                onRestart={onRestart}
                onLogs={onLogs}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
