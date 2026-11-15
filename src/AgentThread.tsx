import { useMemo, useState, type ReactNode } from "react";
import { Button, ChatMessage, VirtualList } from "@particle-academy/react-fancy";
import type { ChatMessageData } from "@particle-academy/react-fancy";
import { type AnswerDraft, type MessageEntry, type Part, type Row, type ThreadState } from "@particle-academy/fancy-chat-js";

import { actionableIn } from "./actionable";
import { ApprovalCard, type ApprovalDecisionInput } from "./ApprovalCard";
import { PlanRow, ThinkingBlock, ToolRow } from "./activity";
import { mergeLabels, type ChatLabels } from "./labels";
import { PartView, type PartViewProps } from "./PartView";
import { QuestionForm, type QuestionAnswerInput } from "./QuestionForm";

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
  labels?: Partial<ChatLabels>;
  className?: string;
}

type ListRow = { id: string; row: Row | null };

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
    actionableKinds = ["approval", "question"],
    expanded,
    onExpandedChange,
    onRetryTool,
    partViewProps,
    renderRow,
    className,
  } = props;
  const labels = mergeLabels(props.labels);
  const [unseen, setUnseen] = useState(0);
  const [ownDrafts, setOwnDrafts] = useState<Record<string, AnswerDraft>>({});
  const drafts = questionDrafts ?? ownDrafts;

  const actionableId = useMemo(() => actionableIn(state, actionableKinds), [state, actionableKinds]);

  const items = useMemo<ListRow[]>(() => {
    const visible = rows.filter((r) => !(r.kind === "message" && r.retracted)).map((r) => ({ id: r.id, row: r }));
    return onLoadEarlier && hasEarlier ? [{ id: EARLIER_ID, row: null }, ...visible] : visible;
  }, [rows, onLoadEarlier, hasEarlier]);

  const renderApproval = (approvalId: string) => {
    const record = state.approvals.find((a) => a.approvalId === approvalId);
    if (!record) return null;
    return (
      <ApprovalCard
        record={record}
        actionable={!!onDecide && actionableId === approvalId}
        onDecide={onDecide ?? (() => {})}
        labels={props.labels}
        partViewProps={partViewProps}
      />
    );
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
          <PartView key={part.id} {...partViewProps} part={part} streaming={m.open.includes(part.id)} renderHitl={renderHitl} labels={props.labels} />
        ))}
      </div>
    );
    return (
      <div
        data-fancy-chat-message={m.id}
        data-fancy-chat-delivery={m.delivery ?? undefined}
        data-fancy-chat-superseded={m.superseded ? "true" : "false"}
        data-fancy-chat-turn={m.turnId ?? undefined}
        className={m.superseded ? "opacity-60" : undefined}
      >
        <ChatMessage message={message} ownRoles={ownRoles} body={body} labels={{ pending: labels.delivery.sending ?? "Sending", failed: labels.delivery.failed ?? "Not sent" }} />
        {m.delivery && m.delivery !== "sent" && m.delivery !== "delivered" && m.delivery !== "sending" && m.delivery !== "failed" ? (
          <div data-fancy-chat-delivery-label="" className="mt-0.5 text-xs opacity-70">
            {labels.delivery[m.delivery] ?? m.delivery}
          </div>
        ) : null}
        {m.superseded ? <div className="mt-0.5 text-xs opacity-70">{labels.superseded}</div> : null}
      </div>
    );
  };

  const renderOne = (item: ListRow): ReactNode => {
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
        body = <ToolRow entry={row} expanded={open} onExpandedChange={setOpen} onRetry={onRetryTool} labels={props.labels} />;
        break;
      case "plan":
        body = <PlanRow entry={row} labels={props.labels} />;
        break;
      case "approval":
        body = renderApproval(row.approvalId);
        break;
      case "question":
        body = renderQuestion(row.questionId);
        break;
    }
    return (
      <div data-fancy-chat-row={row.kind} className="px-3 py-1.5">
        {body}
      </div>
    );
  };

  return (
    <div data-fancy-chat-thread="" data-fancy-chat-following={follow ? "true" : "false"} className={["relative flex min-h-0 flex-col", className].filter(Boolean).join(" ")} style={{ height }}>
      <VirtualList
        id="fancy-chat-thread"
        aria-label={labels.thread}
        items={items}
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
