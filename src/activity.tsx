import { useEffect, useState, type ReactNode } from "react";
import { Badge, Button, CodeBlock, ContentRenderer, Progress, Text, Timeline } from "@particle-academy/react-fancy";
import type { ButtonColor } from "@particle-academy/react-fancy";
import type { PlanEntry, ThinkingEntry, ToolEntry, TurnEntry } from "@particle-academy/fancy-chat-js";

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
    <div data-fancy-chat-thinking={entry.thinkingId ?? entry.runId} data-fancy-chat-thinking-live={entry.live ? "true" : "false"} className="flex flex-col gap-1">
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
  /**
   * Load the full output behind `outputRef`, lazily: called once, and only when the
   * row is expanded. A string is plain text; `{ text, language }` names code. The
   * result renders as text or code, never as HTML.
   */
  resolveOutput?: ToolOutputResolver;
  /** Characters of output shown, at most. Default 4000. The server bounds what it sends too. */
  maxOutputChars?: number;
  labels?: Partial<ChatLabels>;
}

export type ToolOutputResolver = (ref: string, entry: ToolEntry) => string | { text: string; language?: string | null } | Promise<string | { text: string; language?: string | null }>;

type Loaded = { status: "idle" } | { status: "loading" } | { status: "error" } | { status: "done"; text: string; language: string | null };

/** The output, as text or code. React escapes it: there is no path to HTML here. */
function ToolOutput({ text, language, failure, cut, labels }: { text: string; language: string | null; failure: boolean; cut: boolean; labels: ChatLabels }): ReactNode {
  const code = language !== null && language !== "" && language !== "text";
  return (
    <div data-fancy-chat-tool-output="" data-fancy-chat-tool-output-language={language ?? undefined} className={failure ? "rounded border border-red-200 p-2 dark:border-red-900" : undefined}>
      {code ? (
        <CodeBlock code={text} language={language as never} />
      ) : (
        <Text className={`whitespace-pre-wrap break-words font-mono text-xs ${failure ? "text-red-700 dark:text-red-400" : ""}`}>{text}</Text>
      )}
      {cut ? (
        <Text data-fancy-chat-tool-output-truncated="" className="mt-1 text-xs opacity-70">
          {labels.toolOutputTruncated}
        </Text>
      ) : null}
    </div>
  );
}

const OUTCOME_COLOR: Record<string, ButtonColor> = { running: "sky", ok: "emerald", failure: "red", refusal: "zinc" };

/**
 * A tool call: name, arguments on demand, progress while running, and a
 * result styled by outcome. Failure is red; refusal is neutral, because a tool
 * that declined did its job.
 */
export function ToolRow({ entry, expanded, onExpandedChange, onRetry, renderOutput, resolveOutput, maxOutputChars = 4000, labels: l }: ToolRowProps): ReactNode {
  const labels = mergeLabels(l);
  const [open, setOpen] = useExpanded(expanded, onExpandedChange);
  const outcome = entry.outcome ?? "running";
  const [loaded, setLoaded] = useState<Loaded>({ status: "idle" });
  const ref = entry.outputRef;
  useEffect(() => {
    if (!open || !resolveOutput || !ref || loaded.status !== "idle") return;
    let live = true;
    setLoaded({ status: "loading" });
    Promise.resolve()
      .then(() => resolveOutput(ref, entry))
      .then(
        (r) => {
          if (!live) return;
          if (typeof r === "string") setLoaded({ status: "done", text: r, language: null });
          else if (r && typeof r.text === "string") setLoaded({ status: "done", text: r.text, language: typeof r.language === "string" ? r.language : null });
          else setLoaded({ status: "error" });
        },
        () => {
          if (live) setLoaded({ status: "error" });
        },
      );
    return () => {
      live = false;
    };
    // The entry object may be re-created on every projection; the ref is the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ref, resolveOutput]);

  const full = loaded.status === "done" ? loaded : null;
  // `?? null`: an entry from a fancy-chat-js before 0.1.0's output fields has neither.
  const text = full ? full.text : (entry.output ?? null);
  const language = full ? full.language : (entry.outputLanguage ?? null);
  const failure = outcome === "failure";
  // A failure's own words show without expanding; an ok result shows when expanded.
  const showOutput = text !== null && (failure || open);
  const shown = text !== null && text.length > maxOutputChars ? text.slice(0, maxOutputChars) : text;
  const cut = text !== null && (text.length > maxOutputChars || (entry.truncated && !full));
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
        {entry.durationMs !== null ? (
          // `durationExact: false`: the backend bounded the time rather than measuring it.
          <Text className="text-xs" data-fancy-chat-tool-duration="" data-fancy-chat-tool-duration-exact={entry.durationExact === false ? "false" : "true"}>
            {entry.durationExact === false ? labels.durationAtMost(labels.durationMs(entry.durationMs)) : labels.durationMs(entry.durationMs)}
          </Text>
        ) : null}
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
      {showOutput && shown !== null ? <ToolOutput text={shown} language={language} failure={failure} cut={cut} labels={labels} /> : null}
      {open && loaded.status === "loading" ? (
        <Text data-fancy-chat-tool-output-loading="" className="text-xs opacity-70">
          {labels.toolOutputLoading}
        </Text>
      ) : null}
      {open && loaded.status === "error" ? (
        <Text data-fancy-chat-tool-output-error="" className="text-xs text-red-600">
          {labels.toolOutputError}
        </Text>
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
  /** A held step's link to the approval it waits on (scroll the thread there). */
  onShowApproval?: (approvalId: string) => void;
  labels?: Partial<ChatLabels>;
}

/** "Plan n/m · doing" with each step's status. */
export function PlanRow({ entry, onShowApproval, labels: l }: PlanRowProps): ReactNode {
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
            {s.status === "held" && s.approvalId && onShowApproval ? (
              <Button size="xs" variant="ghost" className="ms-2" data-fancy-chat-plan-step-approval={s.approvalId} onClick={() => onShowApproval(s.approvalId as string)}>
                {labels.heldOnApproval}
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export type ActivityEntry = ThinkingEntry | ToolEntry;

const isTool = (e: ActivityEntry): e is ToolEntry => "toolCallId" in e;

export interface ActivityTimelineProps {
  /** A stable id, usually the run id. */
  id: string;
  /** One run's consecutive thinking and tool entries, in order. */
  entries: readonly ActivityEntry[];
  /** While anything is still running the timeline is expanded; once it settles, it collapses to its summary. */
  running: boolean;
  /** Controlled when passed. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Passed to every ToolRow: `resolveOutput`, `maxOutputChars`, `onRetry`. */
  toolRowProps?: Pick<ToolRowProps, "resolveOutput" | "maxOutputChars" | "onRetry" | "renderOutput">;
  labels?: Partial<ChatLabels>;
}

const TONE: Record<string, "brand" | "emerald" | "red" | "zinc" | "sky"> = { neutral: "zinc", running: "sky", ok: "emerald", failure: "red", refusal: "zinc" };

/**
 * A run's activity on react-fancy's Timeline: expanded while running, then
 * collapsed to a summary such as "3 tool calls · 4.2 s · 1 failed".
 */
export function ActivityTimeline({ id, entries, running, expanded, onExpandedChange, toolRowProps, labels: l }: ActivityTimelineProps): ReactNode {
  const labels = mergeLabels(l);
  // Uncontrolled, it follows `running` until the reader toggles it.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = expanded ?? toggled ?? running;
  const set = (v: boolean) => {
    if (expanded === undefined) setToggled(v);
    onExpandedChange?.(v);
  };
  const tools = entries.filter(isTool);
  const totalMs = tools.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
  const failedTools = tools.filter((t) => t.outcome === "failure");
  const failed = failedTools.length;
  const exact = tools.every((t) => t.durationMs === null || t.durationExact !== false);
  const summary = labels.activitySummary(tools.length, (totalMs / 1000).toFixed(1), failed, exact);
  return (
    <div data-fancy-chat-activity={id} data-fancy-chat-activity-expanded={open ? "true" : "false"} data-fancy-chat-activity-running={running ? "true" : "false"} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge color={failed > 0 ? "red" : running ? "sky" : "zinc"} variant="soft" size="sm" dot={running}>
          <span data-fancy-chat-activity-summary="">{summary}</span>
        </Badge>
        <Button size="xs" variant="ghost" data-fancy-chat-activity-toggle="" aria-expanded={open} onClick={() => set(!open)}>
          {open ? labels.hideActivity : labels.showActivity}
        </Button>
      </div>
      {!open && failedTools.length > 0 ? (
        // Collapsed, a failure still shows: its row, whose failure text needs no expanding.
        <div data-fancy-chat-activity-failures="" className="flex flex-col gap-1">
          {failedTools.map((t) => (
            <ToolRow key={t.toolCallId} entry={t} {...toolRowProps} labels={l} />
          ))}
        </div>
      ) : null}
      {open ? (
        // Not animated: an animated item stays hidden until it scrolls into view, and a
        // chat's activity must be readable the moment it lands (and in a virtual list).
        <Timeline animated={false}>
          {entries.map((e) => {
            const tone = isTool(e) ? (e.outcome ?? "running") : "neutral";
            return (
              <Timeline.Item key={isTool(e) ? `tool:${e.toolCallId}` : `thinking:${e.thinkingId ?? e.runId}`} color={TONE[tone] ?? "zinc"} active={tone === "running"}>
                <div data-fancy-chat-activity-item="" data-fancy-chat-activity-tone={tone}>
                  {isTool(e) ? <ToolRow entry={e} {...toolRowProps} labels={l} /> : <ThinkingBlock entry={e} labels={l} />}
                </div>
              </Timeline.Item>
            );
          })}
        </Timeline>
      ) : null}
    </div>
  );
}

export interface ModelErrorProps {
  turn: TurnEntry;
  /** Retry the failed turn. Without it, the error shows with no Retry. */
  onRetry?: (turnId: string) => void;
  labels?: Partial<ChatLabels>;
}

/**
 * A turn the model could not finish: its reason and Retry. A refusal is an
 * answer, not an error: it shows neutral, with no Retry. Anything else renders nothing.
 */
export function ModelError({ turn, onRetry, labels: l }: ModelErrorProps): ReactNode {
  const labels = mergeLabels(l);
  if (turn.state !== "settled" || (turn.outcome !== "failed" && turn.outcome !== "refused")) return null;
  const failed = turn.outcome === "failed";
  return (
    <div data-fancy-chat-turn-error={turn.turnId} data-fancy-chat-turn-error-tone={failed ? "failure" : "neutral"} role="status" className="flex flex-wrap items-center gap-2 text-sm">
      <Badge color={failed ? "red" : "zinc"} variant="soft" size="sm">
        {failed ? labels.turnFailed(turn.reason) : labels.turnRefused}
      </Badge>
      {failed && onRetry ? (
        <Button size="xs" data-fancy-chat-turn-retry="" onClick={() => onRetry(turn.turnId)}>
          {labels.turnRetry}
        </Button>
      ) : null}
    </div>
  );
}
