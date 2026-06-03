import * as React from "react";
import { useRef, useState } from "react";
import { Loader2, ScrollText, RotateCw, Square, Play, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ContainerInfo {
  id: string;
  shortId: string;
  names: string[];
  image: string;
  status: string;
  state: string;
  createdAt: string;
}

interface ContainerCardProps {
  container: ContainerInfo;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onLogs: (id: string) => void;
  onDelete: (id: string) => void
  isActing: boolean
}

interface ConfirmButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

function ConfirmButton({ icon, onClick, disabled, className, "aria-label": ariaLabel }: ConfirmButtonProps) {
  const [pending, setPending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressedAtRef = useRef(0);

  function handleClick() {
    if (disabled) return;
    if (pending) {
      if (Date.now() - pressedAtRef.current < 150) {
        clearTimeout(timerRef.current!);
        setPending(false);
        onClick();
      }
      // if >= 150ms the timer already reset — fall through to treat as first click
    } else {
      setPending(true);
      pressedAtRef.current = Date.now();
      timerRef.current = setTimeout(() => setPending(false), 150);
    }
  }

  return (
    <Button
      variant="outline"
      size="icon"
      className={className}
      disabled={disabled}
      onClick={handleClick}
      aria-label={ariaLabel}
    >
      {pending ? <Check className="h-4 w-4" /> : icon}
    </Button>
  );
}


function StateBadge({ state }: { state: string }) {
  let className = "";
  switch (state) {
    case "running":
      className =
        "bg-green-500/15 text-green-400 border border-green-500/30 text-xs px-2 py-0.5 rounded-none";
      break;
    case "exited":
    case "dead":
      className =
        "bg-zinc-500/15 text-zinc-400 border border-zinc-500/30 text-xs px-2 py-0.5 rounded-none";
      break;
    case "paused":
      className =
        "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 text-xs px-2 py-0.5 rounded-none";
      break;
    case "created":
    case "restarting":
    default:
      className =
        "bg-blue-500/15 text-blue-400 border border-blue-500/30 text-xs px-2 py-0.5 rounded-none";
  }
  return <span className={className}>{state}</span>;
}

export function ContainerCard({
  container,
  onStart,
  onStop,
  onRestart,
  onLogs,
  onDelete,
  isActing,
}: ContainerCardProps) {
  const containerName = container.names[0] ?? container.shortId;

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
      <div className="flex justify-end">
        {/* Logs — always visible, no confirm needed */}
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 rounded-none border-0 bg-zinc-800 hover:bg-zinc-700"
          onClick={() => onLogs(container.id)}
          aria-label="View logs"
        >
          <ScrollText className="h-4 w-4" />
        </Button>

        {container.state === "running" && (
          <>
            <ConfirmButton
              icon={isActing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              onClick={() => onRestart(container.id)}
              disabled={isActing}
              className="h-11 w-11 rounded-none border-0 bg-zinc-800 hover:bg-zinc-700"
              aria-label="Restart"
            />
            <ConfirmButton
              icon={isActing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              onClick={() => onStop(container.id)}
              disabled={isActing}
              className="h-11 w-11 rounded-none border-0 bg-zinc-800 text-red-400 hover:bg-zinc-700 hover:text-red-400"
              aria-label="Stop"
            />
          </>
        )}

        {container.state === "restarting" && (
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

        {["exited", "dead", "created", "paused"].includes(container.state) && (
          <>
            <ConfirmButton
              icon={isActing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              onClick={() => onStart(container.id)}
              disabled={isActing}
              className="h-11 w-11 rounded-none border-0 bg-zinc-800 hover:bg-zinc-700"
              aria-label="Start"
            />
            <ConfirmButton
              icon={isActing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              onClick={() => onDelete(container.id)}
              disabled={isActing}
              className="h-11 w-11 rounded-none border-0 bg-zinc-800 text-red-400 hover:bg-zinc-700 hover:text-red-400"
              aria-label="Delete"
            />
          </>
        )}
      </div>
    </div>
  );
}
