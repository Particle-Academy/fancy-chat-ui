import { useMemo, useState, type ReactNode } from "react";
import { Button, ChatMessage, VirtualList } from "@particle-academy/react-fancy";
import type { ChatMessageData } from "@particle-academy/react-fancy";
import { type AnswerDraft, type ApprovalRecord, type MessageEntry, type Part, type Row, type ThreadState, type ToolEntry } from "@particle-academy/fancy-chat-js";

import { actionableIn } from "./actionable";
import { ApprovalCard, type ApprovalCardProps, type ApprovalDecisionInput } from "./ApprovalCard";
import { ActivityTimeline, ModelError, PlanRow, ThinkingBlock, ToolRow, type ActivityEntry, type ToolOutputResolver } from "./activity";
import { mergeLabels, type ChatLabels } from "./labels";
import { HiddenHitl, PartView, type PartViewProps } from "./PartView";
import type { SurfaceProfile } from "./profile";
import { UndoCountdown } from "./UndoCountdown";
import { QuestionForm, type QuestionAnswerInput } from "./QuestionForm";
import { QuickReplies, quickRepliesHidden, type QuickReply } from "./QuickReplies";

/** What a custom approval renderer gets besides the record. */
export interface ApprovalRenderContext {
  /** Whether this is THE actionable item: the same rule the default card gets. */
  actionable: boolean;
  /** The host's `onDecide`. A no-op, with `actionable` false, when the host passed none. */
  onDecide: ApprovalCardProps["onDecide"];
  /** The thread's labels, with the host's overrides merged in. */
  labels: ChatLabels;
}

export type ApprovalRenderer = (record: ApprovalRecord, ctx: ApprovalRenderContext) => ReactNode | undefined;

export interface AgentThreadProps {
  /** The projected rows (fancy-chat-js `rowsOf`), oldest first. */
  rows: readonly Row[];
  /** The projected state the rows came from; HITL rows read their records from it. */
  state: ThreadState;
  /** Controlled follow-the-latest. A reader scrolling up asks to turn it off. */
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
  /** Deep link: scroll to this row id (follow is turned off). */
  scrollToId?: string | null;
  onScrollToIdResolved?: (id: string, landed: boolean) => void;
  onLoadEarlier?: () => void;
  hasEarlier?: boolean;
  height?: number | string;
  estimateRowHeight?: number;
  /** Roles aligned as the viewer's own. Default ["user"]. */
  ownRoles?: string[];
  /** A message's time, for the header. Rows carry none; the host knows when they arrived. */
  timeOf?: (message: MessageEntry) => string | number | undefined;
  /** The human decides an approval. Without it, approval cards are read-only. */
  onDecide?: (input: ApprovalDecisionInput) => void | Promise<unknown>;
  /** Controlled answer drafts, keyed by question id. */
  questionDrafts?: Record<string, AnswerDraft>;
  onQuestionDraftChange?: (questionId: string, draft: AnswerDraft) => void;
  onAnswer?: (input: QuestionAnswerInput) => void | Promise<unknown>;
  /** HITL kinds this surface may act on (a surface profile's `hitl.actionable`). Default both. */
  actionableKinds?: ("approval" | "question")[];
  /** Controlled open state for thinking blocks and tool rows, keyed by row id. */
  expanded?: Record<string, boolean>;
  onExpandedChange?: (rowId: string, expanded: boolean) => void;
  onRetryTool?: (toolCallId: string) => void;
  partViewProps?: Omit<PartViewProps, "part" | "streaming" | "renderHitl">;
  /** Replace how a row renders. Return undefined to fall back to the default. */
  renderRow?: (row: Row) => ReactNode | undefined;
  /**
   * Replace just the approval card, in approval rows and in message parts.
   * `undefined` keeps the default ApprovalCard; `null` renders nothing for that
   * approval (its data-* handle stays, hidden); anything else replaces the card.
   * Presentation only: decide through `ctx.onDecide`.
   */
  renderApproval?: ApprovalRenderer;
  labels?: Partial<ChatLabels>;
  className?: string;
  /** The surface profile: which part kinds render in full and which HITL kinds this surface acts on. */
  profile?: SurfaceProfile;
  /**
   * Edit and resend, branch policy (the default): superseded branches are hidden
   * unless this is on. Controlled when `onShowBranchesChange` is passed.
   */
  showBranches?: boolean;
  onShowBranchesChange?: (show: boolean) => void;
  /** Offer Edit on the viewer's own live messages. The host fills the composer and sends with `supersedes`. */
  onEdit?: (message: MessageEntry) => void;
  /** Revert an undoable action (the human only; the server refuses a late revert). */
  onRevertUndo?: (actionId: string) => void | Promise<unknown>;
  /** A held plan step's link to its approval. */
  onShowApproval?: (approvalId: string) => void;
  /** A fixed clock (ms) for undo countdowns. Without it they tick themselves. */
  now?: number;
  /** Load a tool result's full output behind `outputRef`, lazily, when its row is expanded. */
  resolveToolOutput?: ToolOutputResolver;
  /** The host's own view of a tool's output, shown in an expanded row (ToolRow `renderOutput`). */
  renderToolOutput?: (entry: ToolEntry) => ReactNode;
  /** Characters of tool output shown per row. Default 4000. */
  maxToolOutputChars?: number;
  /** `rows` (the default): one row per thinking block and tool call. `timeline`: a run's consecutive activity in one ActivityTimeline. */
  activity?: "rows" | "timeline";
  /** Retry the newest turn when it failed. The failure shows either way. Default: `chat.retry`. */
  onRetryTurn?: (turnId: string) => void;
  /**
   * The `useAgentThread` result (or anything with its `retry`): defaults Retry on a
   * failed turn to `chat.retry`, which re-sends that turn's original message.
   */
  chat?: { retry?: (turnId: string) => Promise<unknown> };
  /**
   * Quick replies (controlled): chips under the agent's last reply. Pass
   * `chat.suggestions`. Shown only with `onSuggest`, and never while a turn is
   * running or a human decision is pending.
   */
  suggestions?: readonly QuickReply[];
  /** A pick: fill the composer (`suggestionDraft`) or send it (`chat.sendSuggestion`). Never a decision. */
  onSuggest?: (suggestion: QuickReply) => void;
  /** Hide the chips for the host's own decision states (an approval-queue modal, say). Controlled. */
  suggestionsHidden?: boolean;
}

type ListRow = { id: string; row: Row | null; group?: ActivityEntry[] };

const EARLIER_ID = "__fancy_chat_earlier__";

/**
 * The thread, on ONE windowing and follow model: react-fancy's VirtualList,
 * which is virtualised, a `role="log"`, follows the tail under control, breaks
 * follow on a reader's scroll, and keeps the reader's place when earlier rows
 * are prepended. Messages render through react-fancy's ChatMessage with their
 * typed parts in its `body` slot.
 */
export function AgentThread(props: AgentThreadProps): ReactNode {
  const {
    rows,
    state,
    follow,
    onFollowChange,
    scrollToId,
    onScrollToIdResolved,
    onLoadEarlier,
    hasEarlier = true,
    height = "100%",
    estimateRowHeight = 72,
    ownRoles = ["user"],
    timeOf,
    onDecide,
    questionDrafts,
    onQuestionDraftChange,
    onAnswer,
    actionableKinds: actionableKindsProp,
    expanded,
    onExpandedChange,
    onRetryTool,
    partViewProps,
    renderRow,
    renderApproval: renderApprovalProp,
    className,
    profile,
    onEdit,
    onRevertUndo,
    onShowApproval,
    now,
    resolveToolOutput,
    renderToolOutput,
    maxToolOutputChars,
    activity = "rows",
    onRetryTurn,
    chat,
    suggestions,
    onSuggest,
    suggestionsHidden,
  } = props;
  const chatRetry = chat?.retry;
  const retryTurn = onRetryTurn ?? (chatRetry ? (turnId: string) => void chatRetry(turnId) : undefined);
  const actionableKinds = actionableKindsProp ?? profile?.hitl?.actionable ?? ["approval", "question"];
  const [ownShowBranches, setOwnShowBranches] = useState(false);
  const showBranches = props.onShowBranchesChange ? (props.showBranches ?? false) : (props.showBranches ?? ownShowBranches);
  const setShowBranches = (v: boolean) => (props.onShowBranchesChange ? props.onShowBranchesChange(v) : setOwnShowBranches(v));
  const partProps = profile?.parts ? { ...partViewProps, allowedKinds: profile.parts } : partViewProps;
  const labels = mergeLabels(props.labels);
  const [unseen, setUnseen] = useState(0);
  const [ownDrafts, setOwnDrafts] = useState<Record<string, AnswerDraft>>({});
  const drafts = questionDrafts ?? ownDrafts;

  // The store mutates `state` IN PLACE (invariant 7), so its identity never changes
  // while a thread is open, and a memo keyed on it is computed once, when the thread
  // opens. `rows` is the change signal instead: the store projects a new array on
  // every event it applies. actionableIn is a scan of the HITL rows, cheap enough to
  // run on every render, so it is not memoised at all: an approval that lands on a
  // later poll or SSE frame must become actionable in the thread that is open.
  const actionableId = actionableIn(state, actionableKinds);

  /** Row id -> the superseded message whose branch it belongs to (the message itself included). */
  const branchOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of state.branches ?? []) {
      map.set(b.supersededId, b.supersededId);
      for (const id of b.rowIds) if (!map.has(id)) map.set(id, b.supersededId);
    }
    return map;
  }, [state, rows]); // eslint-disable-line react-hooks/exhaustive-deps -- rows is the change signal; see above
  const branchToggleAt = useMemo(() => new Map((state.branches ?? []).map((b) => [b.byId, b.supersededId])), [state, rows]); // eslint-disable-line react-hooks/exhaustive-deps -- rows is the change signal; see above

  const items = useMemo<ListRow[]>(() => {
    const visible = rows
      .filter((r) => !(r.kind === "message" && r.retracted))
      .filter((r) => showBranches || !branchOf.has(r.id))
      .reduce<ListRow[]>((out, r) => {
        // Timeline mode: a run's consecutive thinking and tool rows become one item.
        if (activity === "timeline" && (r.kind === "thinking" || r.kind === "tool")) {
          const run = r.runId ?? "_";
          const last = out[out.length - 1];
          const lastRun = last?.group ? (last.group[0] as ActivityEntry).runId ?? "_" : null;
          if (last?.group && lastRun === run) {
            last.group.push(r);
            return out;
          }
          out.push({ id: `activity:${r.id}`, row: null, group: [r] });
          return out;
        }
        out.push({ id: r.id, row: r });
        return out;
      }, []);
    return onLoadEarlier && hasEarlier ? [{ id: EARLIER_ID, row: null }, ...visible] : visible;
  }, [rows, onLoadEarlier, hasEarlier, showBranches, branchOf, activity]);

  const lastTurn = state.turns.length > 0 ? state.turns[state.turns.length - 1] : undefined;

  // One call per approval per render: the collapse check below and the row both read it.
  const approvalResults = new Map<string, ReactNode | undefined>();
  // The one actionable rule, for the default card and a custom renderer alike.
  const isApprovalActionable = (approvalId: string) => !!onDecide && actionableId === approvalId;
  const customApproval = (record: ApprovalRecord): ReactNode | undefined => {
    if (!renderApprovalProp) return undefined;
    if (!approvalResults.has(record.approvalId)) {
      approvalResults.set(
        record.approvalId,
        renderApprovalProp(record, {
          actionable: isApprovalActionable(record.approvalId),
          onDecide: onDecide ?? (() => {}),
          labels,
        }),
      );
    }
    return approvalResults.get(record.approvalId);
  };

  const renderApproval = (approvalId: string) => {
    const record = state.approvals.find((a) => a.approvalId === approvalId);
    if (!record) return null;
    const actionable = isApprovalActionable(approvalId);
    const custom = customApproval(record);
    if (custom !== undefined) {
      // A replaced card no longer carries the handle itself, so the wrapper does.
      const handle = {
        "data-fancy-chat-approval": record.approvalId,
        "data-fancy-chat-approval-state": record.state,
        "data-fancy-chat-approval-actionable": actionable && record.state === "pending" ? "true" : "false",
      };
      return custom === null ? <HiddenHitl {...handle} /> : <div {...handle}>{custom}</div>;
    }
    return (
      <ApprovalCard
        record={record}
        actionable={actionable}
        onDecide={onDecide ?? (() => {})}
        labels={props.labels}
        partViewProps={partProps}
      />
    );
  };

  const approvalIsNull = (approvalId: string) => {
    const record = state.approvals.find((a) => a.approvalId === approvalId);
    return !!record && customApproval(record) === null;
  };

  /**
   * Whether a row has nothing left to show because the host's renderApproval
   * returned null. Such a row must leave the VirtualList: the list ignores a
   * measured height of 0, so a hidden row would keep its last height as a blank gap.
   */
  const isCollapsed = (item: ListRow): boolean => {
    const row = item.row;
    if (!renderApprovalProp || !row || (row.kind !== "approval" && row.kind !== "message")) return false;
    if (renderRow?.(row) !== undefined) return false;
    if (row.kind === "approval") return approvalIsNull(row.approvalId);
    // A message collapses only when its approvals were all it had to show.
    if (row.parts.length === 0 || row.open.length > 0 || row.superseded || row.author?.kind === "human" || branchToggleAt.has(row.id)) return false;
    if ((row.delivery && row.delivery !== "sent" && row.delivery !== "delivered") || partProps?.renderers?.approval) return false;
    if (partProps?.allowedKinds && !partProps.allowedKinds.includes("approval")) return false;
    return row.parts.every((part) => part.kind === "approval" && approvalIsNull(String(part.approvalId)));
  };

  const renderQuestion = (questionId: string) => {
    const record = state.questions.find((q) => q.questionId === questionId);
    if (!record) return null;
    return (
      <QuestionForm
        question={record}
        draft={drafts[questionId] ?? { values: {}, notes: {} }}
        onDraftChange={(d) => (onQuestionDraftChange ? onQuestionDraftChange(questionId, d) : setOwnDrafts((all) => ({ ...all, [questionId]: d })))}
        onSubmit={onAnswer ?? (() => {})}
        actionable={!!onAnswer && actionableId === questionId}
        labels={props.labels}
      />
    );
  };

  const renderHitl = (part: Part) =>
    part.kind === "approval" ? renderApproval(String(part.approvalId)) : part.kind === "question" ? renderQuestion(String(part.questionId)) : null;

  const renderMessage = (m: MessageEntry) => {
    const streaming = m.open.length > 0;
    const status: ChatMessageData["status"] =
      m.delivery === "failed" ? "failed" : m.delivery === "sending" ? "pending" : streaming ? "streaming" : "sent";
    const message: ChatMessageData = {
      id: m.id,
      role: m.role,
      ...(m.author ? { author: { name: m.author.label ?? m.author.id } } : {}),
      content: "",
      createdAt: timeOf?.(m) ?? "",
      status,
    };
    const body = (
      <div className="flex flex-col gap-2">
        {m.parts.map((part) => (
          <PartView key={part.id} {...partProps} part={part} streaming={m.open.includes(part.id)} renderHitl={renderHitl} labels={props.labels} />
        ))}
      </div>
    );
    return (
      <div
        data-fancy-chat-message={m.id}
        data-fancy-chat-delivery={m.delivery ?? undefined}
        data-fancy-chat-superseded={m.superseded ? "true" : "false"}
        data-fancy-chat-turn={m.turnId ?? undefined}
        data-fancy-chat-branch={branchOf.get(m.id)}
        className={m.superseded ? "opacity-60" : undefined}
      >
        <ChatMessage
          message={message}
          ownRoles={ownRoles}
          body={body}
          actions={
            onEdit && m.author?.kind === "human" && ownRoles.includes(m.role) && !m.superseded && !m.retracted ? (
              <Button size="xs" variant="ghost" data-fancy-chat-edit={m.id} onClick={() => onEdit(m)}>
                {labels.edit}
              </Button>
            ) : undefined
          }
          labels={{ pending: labels.delivery.sending ?? "Sending", failed: labels.delivery.failed ?? "Not sent" }}
        />
        {branchToggleAt.has(m.id) ? (
          <Button size="xs" variant="ghost" data-fancy-chat-branch-toggle={branchToggleAt.get(m.id)} aria-pressed={showBranches} onClick={() => setShowBranches(!showBranches)}>
            {showBranches ? labels.hideEarlierVersion : labels.showEarlierVersion}
          </Button>
        ) : null}
        {m.delivery && m.delivery !== "sent" && m.delivery !== "delivered" && m.delivery !== "sending" && m.delivery !== "failed" ? (
          <div data-fancy-chat-delivery-label="" className="mt-0.5 text-xs opacity-70">
            {labels.delivery[m.delivery] ?? m.delivery}
          </div>
        ) : null}
        {m.superseded ? <div className="mt-0.5 text-xs opacity-70">{labels.superseded}</div> : null}
      </div>
    );
  };

  const toolRowProps = {
    ...(resolveToolOutput ? { resolveOutput: resolveToolOutput } : {}),
    ...(renderToolOutput ? { renderOutput: renderToolOutput } : {}),
    ...(maxToolOutputChars !== undefined ? { maxOutputChars: maxToolOutputChars } : {}),
    ...(onRetryTool ? { onRetry: onRetryTool } : {}),
  };

  const renderOne = (item: ListRow): ReactNode => {
    if (item.group) {
      const running = item.group.some((e) => ("toolCallId" in e ? e.outcome === null : e.live));
      return (
        <div data-fancy-chat-row="activity" className="px-3 py-1.5">
          <ActivityTimeline
            id={item.id.slice("activity:".length)}
            entries={item.group}
            running={running}
            expanded={expanded?.[item.id]}
            onExpandedChange={onExpandedChange ? (v) => onExpandedChange(item.id, v) : undefined}
            toolRowProps={toolRowProps}
            labels={props.labels}
          />
        </div>
      );
    }
    if (!item.row) {
      return (
        <div className="flex justify-center py-2">
          <Button size="sm" variant="ghost" data-fancy-chat-load-earlier="" onClick={onLoadEarlier}>
            {labels.loadEarlier}
          </Button>
        </div>
      );
    }
    const row = item.row;
    const custom = renderRow?.(row);
    if (custom !== undefined) return <div data-fancy-chat-row={row.kind}>{custom}</div>;
    const open = expanded?.[row.id];
    const setOpen = onExpandedChange ? (v: boolean) => onExpandedChange(row.id, v) : undefined;
    let body: ReactNode = null;
    switch (row.kind) {
      case "message":
        body = renderMessage(row);
        break;
      case "thinking":
        body = <ThinkingBlock entry={row} expanded={open} onExpandedChange={setOpen} labels={props.labels} />;
        break;
      case "tool":
        body = <ToolRow entry={row} expanded={open} onExpandedChange={setOpen} {...toolRowProps} labels={props.labels} />;
        break;
      case "plan":
        body = <PlanRow entry={row} onShowApproval={onShowApproval} labels={props.labels} />;
        break;
      case "approval":
        body = renderApproval(row.approvalId);
        break;
      case "question":
        body = renderQuestion(row.questionId);
        break;
      case "undo":
        body = <UndoCountdown entry={row} onRevert={onRevertUndo} now={now} labels={props.labels} />;
        break;
    }
    return (
      <div data-fancy-chat-row={row.kind} data-fancy-chat-branch={branchOf.get(row.id)} className="px-3 py-1.5">
        {body}
      </div>
    );
  };

  const collapsed = renderApprovalProp ? items.filter(isCollapsed) : [];
  // Keyed on the ids, so the list keeps its array (and its offsets) between renders.
  const collapsedKey = JSON.stringify(collapsed.map((item) => item.id));
  const listItems = useMemo(() => {
    const ids = new Set<string>(JSON.parse(collapsedKey) as string[]);
    return ids.size === 0 ? items : items.filter((item) => !ids.has(item.id));
  }, [items, collapsedKey]);

  return (
    <div data-fancy-chat-thread="" data-fancy-chat-following={follow ? "true" : "false"} className={["relative flex min-h-0 flex-col", className].filter(Boolean).join(" ")} style={{ height }}>
      {collapsed.length > 0 ? (
        <div hidden data-fancy-chat-hidden-rows="">
          {collapsed.map((item) => (
            <div key={item.id}>{renderOne(item)}</div>
          ))}
        </div>
      ) : null}
      <VirtualList
        id="fancy-chat-thread"
        aria-label={labels.thread}
        items={listItems}
        renderRow={renderOne}
        height="100%"
        estimateRowHeight={estimateRowHeight}
        followTail={follow}
        onFollowChange={onFollowChange}
        onUnseenChange={setUnseen}
        scrollToId={scrollToId ?? null}
        onScrollToIdResolved={onScrollToIdResolved}
        anchorOnPrepend
      />
      {onSuggest && suggestions && suggestions.length > 0 && !quickRepliesHidden(state, { hidden: suggestionsHidden }) ? (
        <div className="px-3 py-1.5">
          <QuickReplies suggestions={suggestions} onSuggest={onSuggest} labels={props.labels} />
        </div>
      ) : null}
      {lastTurn ? (
        <div className="px-3 py-1">
          <ModelError turn={lastTurn} onRetry={retryTurn} labels={props.labels} />
        </div>
      ) : null}
      {!follow ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <Button size="sm" className="pointer-events-auto" data-fancy-chat-jump="" data-fancy-chat-unseen={unseen} onClick={() => onFollowChange(true)}>
            {labels.jumpToLatest(unseen)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
