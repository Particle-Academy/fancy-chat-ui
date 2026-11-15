import { useState, type ReactNode } from "react";
import { Badge, Button, CodeBlock, ContentRenderer, Progress, Text } from "@particle-academy/react-fancy";
import type { ButtonColor } from "@particle-academy/react-fancy";
import type { PlanEntry, ThinkingEntry, ToolEntry } from "@particle-academy/fancy-chat-js";

import { mergeLabels, type ChatLabels } from "./labels";

/** Controlled when `expanded` is passed; otherwise it keeps its own open state. */
function useExpanded(expanded: boolean | undefined, onExpandedChange: ((v: boolean) => void) | undefined, initial = false) {
  const [own, setOwn] = useState(initial);
  const value = expanded ?? own;
  const set = (v: boolean) => {
    if (expanded === undefined) setOwn(v);
    onExpandedChange?.(v);
  };
  return [value, set] as const;
}

export interface ThinkingBlockProps {
  entry: ThinkingEntry;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  labels?: Partial<ChatLabels>;
}

/** One merged, collapsible thinking block per run, with a live state. */
export function ThinkingBlock({ entry, expanded, onExpandedChange, labels: l }: ThinkingBlockProps): ReactNode {
  const labels = mergeLabels(l);
  const [open, setOpen] = useExpanded(expanded, onExpandedChange);
  return (
    <div data-fancy-chat-thinking={entry.runId} data-fancy-chat-thinking-live={entry.live ? "true" : "false"} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Badge color={entry.live ? "violet" : "zinc"} variant="soft" size="sm" dot={entry.live}>
          {entry.live ? labels.thinkingLive : labels.thinking}
        </Badge>
        <Button size="xs" variant="ghost" data-fancy-chat-thinking-toggle="" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? labels.hideThinking : labels.showThinking}
        </Button>
      </div>
      {open ? (
        <div data-fancy-chat-thinking-text="" className="border-l-2 border-zinc-200 pl-3 text-sm opacity-80 dark:border-zinc-700">
          <ContentRenderer value={entry.text} format="markdown" streaming={entry.live} />
        </div>
      ) : null}
    </div>
  );
}

export interface ToolRowProps {
  entry: ToolEntry;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Offered on a FAILURE only. A refusal is an expected answer, not an error to retry. */
  onRetry?: (toolCallId: string) => void;
  /** The host's lazy "show all" for the full output (`outputRef`). */
  renderOutput?: (entry: ToolEntry) => ReactNode;
  labels?: Partial<ChatLabels>;
}

const OUTCOME_COLOR: Record<string, ButtonColor> = { running: "sky", ok: "emerald", failure: "red", refusal: "zinc" };

/**
 * A tool call: name, arguments on demand, progress while running, and a
 * result styled by outcome. Failure is red; refusal is neutral, because a tool
 * that declined did its job.
 */
export function ToolRow({ entry, expanded, onExpandedChange, onRetry, renderOutput, labels: l }: ToolRowProps): ReactNode {
  const labels = mergeLabels(l);
  const [open, setOpen] = useExpanded(expanded, onExpandedChange);
  const outcome = entry.outcome ?? "running";
  const outcomeLabel = { running: labels.toolRunning, ok: labels.toolOk, failure: labels.toolFailure, refusal: labels.toolRefusal }[outcome];
  return (
    <div data-fancy-chat-tool={entry.toolCallId} data-fancy-chat-tool-name={entry.name} data-fancy-chat-tool-outcome={outcome} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge color="zinc" variant="outline" size="sm">
          {entry.name}
        </Badge>
        <Badge color={OUTCOME_COLOR[outcome] ?? "zinc"} variant={outcome === "failure" ? "solid" : "soft"} size="sm" dot={outcome === "running"}>
          {outcomeLabel}
        </Badge>
        {entry.durationMs !== null ? <Text className="text-xs">{labels.durationMs(entry.durationMs)}</Text> : null}
        <Button size="xs" variant="ghost" data-fancy-chat-tool-toggle="" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? labels.showLess : labels.showMore}
        </Button>
        {outcome === "failure" && onRetry ? (
          <Button size="xs" data-fancy-chat-tool-retry="" onClick={() => onRetry(entry.toolCallId)}>
            {labels.toolRetry}
          </Button>
        ) : null}
      </div>
      {outcome === "running" && entry.progress ? (
        <div data-fancy-chat-tool-progress="" className="flex items-center gap-2">
          <Progress value={entry.progress.fraction !== null ? Math.round(entry.progress.fraction * 100) : undefined} indeterminate={entry.progress.fraction === null} size="sm" />
          {entry.progress.text ? <Text className="text-xs">{entry.progress.text}</Text> : null}
        </div>
      ) : null}
      {open ? (
        <div data-fancy-chat-tool-args="">
          <CodeBlock code={JSON.stringify(entry.args, null, 2)} language="json" title={labels.toolArgs} />
          {renderOutput ? renderOutput(entry) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface PlanRowProps {
  entry: PlanEntry;
  labels?: Partial<ChatLabels>;
}

/** "Plan n/m · doing" with each step's status. */
export function PlanRow({ entry, labels: l }: PlanRowProps): ReactNode {
  const labels = mergeLabels(l);
  const done = entry.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const doing = entry.steps.find((s) => s.status === "running" || s.status === "held");
  return (
    <div data-fancy-chat-plan={entry.runId} className="flex flex-col gap-1 text-sm">
      <div className="flex items-center gap-2">
        <Badge color="indigo" variant="soft" size="sm">
          {labels.plan(done, entry.steps.length)}
        </Badge>
        {doing ? <Text className="text-xs">{doing.title}</Text> : null}
      </div>
      <ol className="flex flex-col gap-0.5 pl-4">
        {entry.steps.map((s) => (
          <li key={s.id} data-fancy-chat-plan-step={s.id} data-fancy-chat-plan-step-status={s.status} data-fancy-chat-plan-step-owner={s.owner}>
            {s.title}
          </li>
        ))}
      </ol>
    </div>
  );
}
