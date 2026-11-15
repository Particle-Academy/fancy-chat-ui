import { useEffect, useState, type ReactNode } from "react";
import { Badge, Button, Progress, Text } from "@particle-academy/react-fancy";
import { undoWindow, type UndoEntry } from "@particle-academy/fancy-chat-js";

import { mergeLabels, type ChatLabels } from "./labels";

export interface UndoCountdownProps {
  entry: UndoEntry;
  /** The human reverts. Return a Promise to hold the button until it settles. */
  onRevert?: (actionId: string) => void | Promise<unknown>;
  /** A fixed clock (ms) for tests or a host-driven tick. Without it the countdown ticks itself. */
  now?: number;
  /** Tick interval when it keeps its own clock. Default 250. */
  tickMs?: number;
  /** The window's full length, for the bar. Without it the bar is hidden. */
  totalMs?: number;
  labels?: Partial<ChatLabels>;
}

/**
 * An undo window: what can be taken back, and for how long. The server commits
 * at the deadline and refuses a late revert, so the countdown is a display:
 * it never decides on its own that a revert still lands.
 */
export function UndoCountdown({ entry, onRevert, now: fixedNow, tickMs = 250, totalMs, labels: l }: UndoCountdownProps): ReactNode {
  const labels = mergeLabels(l);
  const [ownNow, setOwnNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (fixedNow !== undefined || entry.state !== "open") return;
    const id = setInterval(() => setOwnNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [fixedNow, entry.state, tickMs]);
  const now = fixedNow ?? ownNow;
  const { remainingMs, canRevert } = undoWindow(entry, now);
  const seconds = Math.ceil(remainingMs / 1000);

  const revert = () => {
    if (!onRevert || busy || !canRevert) return;
    setBusy(true);
    const r = onRevert(entry.actionId);
    if (r && typeof (r as Promise<unknown>).then === "function") (r as Promise<unknown>).then(() => setBusy(false), () => setBusy(false));
    else setBusy(false);
  };

  return (
    <div data-fancy-chat-undo={entry.actionId} data-fancy-chat-undo-state={entry.state} data-fancy-chat-undo-remaining={remainingMs} className="flex flex-wrap items-center gap-2 text-sm">
      <Badge color={entry.state === "reverted" ? "zinc" : entry.state === "committed" ? "emerald" : "amber"} variant="soft" size="sm">
        {entry.state === "open" ? labels.undoOpen(seconds) : entry.state === "committed" ? labels.undoCommitted : labels.undoReverted}
      </Badge>
      <Text>{entry.label}</Text>
      {entry.state === "open" && totalMs ? <Progress value={Math.max(0, Math.min(100, Math.round((remainingMs / totalMs) * 100)))} size="sm" /> : null}
      {entry.state === "open" && onRevert ? (
        <Button size="xs" data-fancy-chat-undo-revert="" disabled={!canRevert || busy} onClick={revert}>
          {labels.undoRevert}
        </Button>
      ) : null}
    </div>
  );
}
