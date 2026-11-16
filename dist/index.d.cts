import { ChatEvent, Part, AnswerDraft, ThreadState, Row, Gap, Decision, ApprovalRecord, QuestionRecord, ThinkingEntry, ToolEntry, TurnEntry, PlanEntry, MessageEntry, TypedApprovalConfig, UndoEntry } from '@particle-academy/fancy-chat-js';
import { C as ChatLabels, a as PartViewProps } from './PartView-BUiua884.cjs';
export { D as DEFAULT_LABELS, b as PartRenderContext, P as PartRenderer, c as PartView, R as RefResolver, m as mergeLabels } from './PartView-BUiua884.cjs';
import { ReactNode } from 'react';
import { PromptTriggerItem, PromptTrigger, PromptDraft, PromptAttachment, PromptCmd, PromptMention } from '@particle-academy/react-fancy';

type TransportMode = "sse" | "poll" | "interval";
/** `idle` and `paused` are interval mode's: nothing runs, or the tab is hidden. */
type ConnectionState = "connecting" | "live" | "polling" | "retrying" | "idle" | "paused" | "closed";
interface SubscribeHandlers {
    /** The last seq the client has applied; every (re)connect resumes after it. */
    after: () => number;
    onEvents: (events: ChatEvent[]) => void;
    onMode?: (mode: TransportMode) => void;
    onConnection?: (state: ConnectionState) => void;
    onError?: (error: unknown) => void;
    /**
     * Whether the thread has a turn in flight (pending, running or cancelling).
     * Interval mode polls only while this is true, or shortly after an action.
     * The thread store supplies it; without it, interval mode treats the thread
     * as always active.
     */
    active?: () => boolean;
}
interface SendInput {
    parts: Part[];
    /** Edit-and-resend: the message this one replaces. The host decides fork or truncate. */
    supersedes?: string;
    /** A client id the server echoes, so the composer can match the outcome. */
    clientMessageId?: string;
}
interface SendResult {
    messageId: string;
    seq: number;
    delivery: string;
    /**
     * Set when the server took the text as a typed approval (opt-in per app): it
     * was recorded as the decision and never delivered to the agent.
     */
    typedDecision?: {
        approvalId: string;
        optionId: string;
        decision: string;
        state: string;
    };
}
/** What the server's backend can do (fancy-chat-php `AgentBackend::capabilities()`). */
interface BackendCapabilities {
    /** The backend can stop a running turn. When false, offer no Stop. */
    cancel: boolean;
    steering: boolean;
    approvals: boolean;
}
type CancelOutcome = "ok" | "not-running" | "no-turn" | "unsupported" | "refused" | "uncertain";
/**
 * How a chat surface talks to its server. The HTTP transport below speaks the
 * fancy-chat-php / fancy-chat-js routes; a host with another backend supplies
 * its own. Decisions carry NO actor: the server takes the actor from its own
 * authenticated resolver, never from the request body.
 */
interface ChatTransport {
    subscribe(handlers: SubscribeHandlers): () => void;
    /** One-shot replay after a seq: gap repair and nudges. */
    fetchAfter(after: number): Promise<{
        events: ChatEvent[];
        next: number;
    }>;
    send(input: SendInput): Promise<SendResult>;
    cancel(mode: "stop" | "interrupt"): Promise<{
        outcome: CancelOutcome;
    }>;
    unsend(messageId: string): Promise<{
        ok: boolean;
    }>;
    decide(approvalId: string, input: {
        optionId: string;
        note?: string;
        edited?: unknown;
    }): Promise<unknown>;
    answer(questionId: string, input: AnswerDraft): Promise<unknown>;
    /** Revert an undoable action inside its window. The server refuses a late or non-human revert. */
    revertUndo(actionId: string): Promise<unknown>;
    /**
     * OPTIONAL: re-send a failed, interrupted or cancelled turn's ORIGINAL message as a
     * new turn (fancy-chat-php `POST threads/{id}/turns/{turnId}/retry`; queued behind a
     * running turn like any message). The server finds the input, so it works after a reload.
     */
    retry?(turnId: string): Promise<SendResult>;
    /** OPTIONAL: what the backend can do. Without it, the hook reports `capabilities: null`. */
    capabilities?(): Promise<BackendCapabilities>;
}
interface HttpTransportOptions {
    /** Where the host mounted the routes, e.g. "/fancy-chat". No trailing slash. */
    baseUrl: string;
    threadId: string;
    fetch?: typeof fetch;
    EventSource?: typeof EventSource;
    /**
     * `auto` tries SSE and falls back to long-poll. Default `auto`.
     * `interval` is for a host that cannot hold a request open (one PHP worker, say):
     * short polls with `wait=0`, only while a turn runs; see `interval`.
     */
    mode?: "auto" | TransportMode;
    /** Interval mode's timing. Every number is milliseconds. */
    interval?: IntervalOptions;
    /** Consecutive SSE failures, before any event arrived, that switch to long-poll. Default 2. */
    sseFailuresBeforePoll?: number;
    /** Long-poll hold in milliseconds, sent as `wait` (fancy-chat-php reads milliseconds). Default 25000. */
    pollWaitMs?: number;
    /** Minimum gap after an EMPTY poll response, so an early answer cannot spin the loop. Default 250. */
    minPollGapMs?: number;
    /** Delay before a reconnect or a retried poll. Default 1000. */
    retryMs?: number;
    /** Extra request headers (a CSRF token, say), read per request. */
    headers?: () => Record<string, string>;
    /** Fetch credentials. Default `same-origin`. */
    credentials?: RequestCredentials;
    withCredentials?: boolean;
    /**
     * The surface profile this transport serves. Sent as `X-Fancy-Chat-Profile`
     * (and `profile=` on the event streams, which cannot carry headers); any
     * filtering by it is the host's policy on the server.
     */
    profileId?: string;
}
interface IntervalOptions {
    /** Between polls while a turn runs, after one that brought events. Default 1500. */
    activeMs?: number;
    /** Each empty poll while a turn runs multiplies the gap by this. Default 1.5 (1 disables). */
    emptyBackoff?: number;
    /** The empty-answer back-off stops growing here. Default 10000. */
    maxActiveMs?: number;
    /** After an error the gap doubles from activeMs, up to this. Default 30000. */
    maxBackoffMs?: number;
    /**
     * After an action (send, decide, answer, cancel, unsend, revert) it keeps polling
     * this long even before a turn shows up in the log. Default 4000.
     */
    graceMs?: number;
    /** Poll this often while nothing runs. Default null: do not poll while idle. */
    idleMs?: number | null;
    /** Stop polling while the document is hidden; catch up the moment it is shown. Default true. */
    pauseWhenHidden?: boolean;
}
declare function createHttpTransport(options: HttpTransportOptions): ChatTransport;

interface ThreadSnapshot {
    state: ThreadState;
    rows: Row[];
    lastSeq: number;
    /** Bumped on every change; cheap equality for memoised consumers. */
    version: number;
    connection: ConnectionState;
    mode: TransportMode | null;
    /** A gap being repaired, if any. */
    missing: Gap | null;
    /** Events this client refused (illegal per the contract, or a cancelled turn's tail). Diagnostics. */
    dropped: number;
    error: unknown;
}
interface ThreadStoreOptions {
    transport: ChatTransport;
    /** Resume from a snapshot the host already has (SSR, cache). */
    initial?: ThreadState;
    /**
     * An OPTIONAL "something new" hint (Laravel Echo / Reverb): call `cb(seq)` when
     * the server says the thread reached `seq`. It only triggers a fetch; a missed
     * nudge costs nothing because SSE or long-poll carries every event anyway.
     */
    nudge?: (cb: (seq: number) => void) => () => void;
}
interface ThreadStore {
    /** Start, or join a running store. Every start needs its stop; the last stop disconnects. */
    start(): void;
    stop(): void;
    getSnapshot(): ThreadSnapshot;
    subscribe(listener: () => void): () => void;
    /** Apply events from any source (an optimistic echo, a test). Deduped by seq. */
    ingest(events: ChatEvent[]): void;
}
declare function createThreadStore(options: ThreadStoreOptions): ThreadStore;

interface ApprovalDecisionInput {
    approvalId: string;
    optionId: string;
    decision: Decision;
    note?: string;
    /** For an `edit` option: the human's edited proposal, passed to the server as is. */
    edited?: unknown;
}
interface ApprovalCardProps {
    record: ApprovalRecord;
    /**
     * Whether this is THE actionable item in the host's coordination scope
     * (fancy-chat-js `pickActionable`). Other cards show their state and wait.
     */
    actionable: boolean;
    /**
     * The human's decision. Return a Promise to hold the in-flight lock until it
     * settles. The server takes the actor from its own resolver: nothing here
     * names who decided.
     */
    onDecide: (input: ApprovalDecisionInput) => void | Promise<unknown>;
    /** Show a note field. Default true. */
    allowNote?: boolean;
    /** Typed approval is opt-in per app; when the host enables it, it passes the hint to show. */
    typedHint?: ReactNode;
    labels?: Partial<ChatLabels>;
    partViewProps?: Omit<PartViewProps, "part">;
}
/**
 * An approval, rendered from its server record. Button tone and the decision
 * come from each option's KIND, never its label. Options of an unknown kind are
 * not offered. While a decision posts, every option is locked.
 */
declare function ApprovalCard(props: ApprovalCardProps): ReactNode;

interface QuestionAnswerInput extends AnswerDraft {
    questionId: string;
}
interface QuestionFormProps {
    question: QuestionRecord;
    /** Controlled: the host keeps a draft per question (and across threads). */
    draft: AnswerDraft;
    onDraftChange: (draft: AnswerDraft) => void;
    /** The human's answer. Return a Promise to hold the in-flight lock. No actor is sent. */
    onSubmit: (input: QuestionAnswerInput) => void | Promise<unknown>;
    /** Whether this is THE actionable item in the host's scope. */
    actionable: boolean;
    onLater?: (questionId: string) => void;
    onDismiss?: (questionId: string) => void;
    labels?: Partial<ChatLabels>;
}
/**
 * A question from its server record. Answer is enabled once every required
 * field has an option or (when the question allows) a note: the same rule as
 * fancy-chat-js `canSubmitAnswer`, which the server applies again.
 */
declare function QuestionForm(props: QuestionFormProps): ReactNode;

interface ThinkingBlockProps {
    entry: ThinkingEntry;
    expanded?: boolean;
    onExpandedChange?: (expanded: boolean) => void;
    labels?: Partial<ChatLabels>;
}
/** One merged, collapsible thinking block per run, with a live state. */
declare function ThinkingBlock({ entry, expanded, onExpandedChange, labels: l }: ThinkingBlockProps): ReactNode;
interface ToolRowProps {
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
type ToolOutputResolver = (ref: string, entry: ToolEntry) => string | {
    text: string;
    language?: string | null;
} | Promise<string | {
    text: string;
    language?: string | null;
}>;
/**
 * A tool call: name, arguments on demand, progress while running, and a
 * result styled by outcome. Failure is red; refusal is neutral, because a tool
 * that declined did its job.
 */
declare function ToolRow({ entry, expanded, onExpandedChange, onRetry, renderOutput, resolveOutput, maxOutputChars, labels: l }: ToolRowProps): ReactNode;
interface PlanRowProps {
    entry: PlanEntry;
    /** A held step's link to the approval it waits on (scroll the thread there). */
    onShowApproval?: (approvalId: string) => void;
    labels?: Partial<ChatLabels>;
}
/** "Plan n/m · doing" with each step's status. */
declare function PlanRow({ entry, onShowApproval, labels: l }: PlanRowProps): ReactNode;
type ActivityEntry = ThinkingEntry | ToolEntry;
interface ActivityTimelineProps {
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
/**
 * A run's activity on react-fancy's Timeline: expanded while running, then
 * collapsed to a summary such as "3 tool calls · 4.2 s · 1 failed".
 */
declare function ActivityTimeline({ id, entries, running, expanded, onExpandedChange, toolRowProps, labels: l }: ActivityTimelineProps): ReactNode;
interface ModelErrorProps {
    turn: TurnEntry;
    /** Retry the failed turn. Without it, the error shows with no Retry. */
    onRetry?: (turnId: string) => void;
    labels?: Partial<ChatLabels>;
}
/**
 * A turn the model could not finish: its reason and Retry. A refusal is an
 * answer, not an error: it shows neutral, with no Retry. Anything else renders nothing.
 */
declare function ModelError({ turn, onRetry, labels: l }: ModelErrorProps): ReactNode;

/** What a chosen item becomes in the message text: `[kind:target|label]`. */
interface PillRef {
    kind: string;
    target: string;
    label: string;
}
interface TriggerDefinition<T = PromptTriggerItem> {
    /** One character, e.g. `@ # / $ &` or a backtick. */
    char: string;
    label?: string;
    /** The pill kind a chosen item serialises to, e.g. `deal`. */
    kind: string;
    /** The app's source. Async is fine; a stale answer is dropped by PromptInput. */
    search: (query: string) => T[] | Promise<T[]>;
    /** Map one of the source's items to a picker row. Default: the item is already a row. */
    toItem?: (item: T) => PromptTriggerItem;
    /** The pill target for an item. Default: the row id. */
    toTarget?: (item: PromptTriggerItem) => string;
    wordStart?: boolean;
}
/** `[kind:target|label]`, the pill grammar the markup policy resolves. */
declare function serializePill(ref: PillRef): string;
interface TriggerRegistry {
    register<T>(definition: TriggerDefinition<T>): TriggerRegistry;
    /** The PromptInput `triggers` for these definitions. */
    triggers(): PromptTrigger[];
    chars(): string[];
}
/**
 * The app's trigger registry (MOIC: `@` prospect, `#` file, `/` prompt, `$`
 * deal, `&` op, a backtick for a skill). Each character gets a source and
 * serialises to the shared pill grammar; PromptInput's `triggers` does the
 * picking. One definition per character.
 */
declare function createTriggerRegistry(definitions?: TriggerDefinition<never>[]): TriggerRegistry;

type SurfaceLayout = "docked" | "overlay" | "page";
/**
 * One surface over the shared engine. MOIC's Compass and Admin chats become two
 * profiles over ONE store, transport and projection, instead of two stacks.
 * The profile id goes to the server, where any filtering is host policy; on the
 * client it only narrows what this surface shows and lets the human act on.
 */
interface SurfaceProfile {
    id: string;
    /** Part kinds this surface renders in full; anything else renders as its text. Default: every kind. */
    parts?: readonly string[];
    /** HITL kinds this surface lets the human act on. Default both. */
    hitl?: {
        actionable: readonly ("approval" | "question")[];
    };
    /** The composer's triggers on this surface. */
    triggers?: readonly TriggerDefinition<never>[];
    /** Which status fields the status line shows. */
    statusFields?: readonly string[];
    layout?: SurfaceLayout;
    labels?: Partial<ChatLabels>;
}
/** Validates a profile once, at definition, so a typo fails loudly instead of hiding a part. */
declare function defineSurfaceProfile(profile: SurfaceProfile): Readonly<SurfaceProfile>;
/** Whether a part kind renders in full on this surface. */
declare function profileAllowsPart(profile: SurfaceProfile | undefined, kind: string): boolean;

interface AgentThreadProps {
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
    chat?: {
        retry?: (turnId: string) => Promise<unknown>;
    };
}
/**
 * The thread, on ONE windowing and follow model: react-fancy's VirtualList,
 * which is virtualised, a `role="log"`, follows the tail under control, breaks
 * follow on a reader's scroll, and keeps the reader's place when earlier rows
 * are prepended. Messages render through react-fancy's ChatMessage with their
 * typed parts in its `body` slot.
 */
declare function AgentThread(props: AgentThreadProps): ReactNode;

declare const EMPTY_PROMPT_DRAFT: PromptDraft;
interface SendOutcome {
    /** A fancy-chat-js delivery state: sent, queued, steered, delivered, failed, dropped, unsent. */
    delivery: string;
    reason?: string;
}
interface AgentComposerSendInput {
    threadId: string;
    text: string;
    attachments: PromptAttachment[];
}
interface AgentComposerProps {
    /** The thread the composer is serving. Swapping it swaps the draft, the pickers and any in-flight send. */
    threadId: string;
    /** Controlled, persistent drafts: one PromptDraft per thread. The host stores them. */
    drafts: Record<string, PromptDraft>;
    onDraftsChange: (drafts: Record<string, PromptDraft>) => void;
    /**
     * Send. Resolve `{ ok: false, error }` (or reject) to keep the draft; the
     * reason shows in the outcome line. A message sent mid-turn queues or steers;
     * the server decides, and reports it through the delivery state.
     */
    onSend: (input: AgentComposerSendInput) => void | Promise<void | {
        ok: false;
        error?: string;
    }>;
    /** The agent is mid-turn: Stop replaces Send (the send key still queues). */
    running?: boolean;
    onStop?: () => void;
    /**
     * Whether this backend can stop a turn. Default true. Pass
     * `chat.capabilities?.cancel !== false`: when false the composer still shows the
     * turn is running, but offers no Stop.
     */
    canStop?: boolean;
    /** The last send's outcome, shown under the input. */
    outcome?: SendOutcome | null;
    commands?: PromptCmd[];
    mentions?: PromptMention[];
    /** Token budget for the meter. The meter is hidden unless `meter` says otherwise. */
    budgetTokens?: number;
    usedTokens?: number;
    meter?: "always" | "near-limit" | "hidden";
    /** Above the input: a queue bar, attachments preview, a mode switch. */
    aboveInput?: ReactNode;
    disabled?: boolean;
    placeholder?: string;
    labels?: Partial<ChatLabels>;
    className?: string;
    /** App pickers: a trigger registry, or PromptInput triggers directly. */
    triggers?: TriggerRegistry | PromptTrigger[];
    /**
     * Typed approval, opt-in per app. With the app's config and the actionable
     * approval, the composer says when the draft will be taken as a decision. The
     * server decides; this is the warning before send.
     */
    typedApproval?: {
        config: Partial<TypedApprovalConfig>;
        approval: Pick<ApprovalRecord, "state" | "options"> | null;
    };
}
/**
 * The composer, on react-fancy's PromptInput: one composer serves every
 * thread by swapping the controlled draft with `draftKey`, instead of keeping a
 * hidden composer mounted per thread.
 */
declare function AgentComposer(props: AgentComposerProps): ReactNode;

interface UseAgentThreadOptions {
    transport: ChatTransport;
    initial?: ThreadState;
    /** Optional Echo/Reverb "something new" hint; see ThreadStoreOptions.nudge. */
    nudge?: (cb: (seq: number) => void) => () => void;
    /** HITL kinds this surface may act on. Default both. */
    actionableKinds?: ("approval" | "question")[];
    /** A store shared by several surfaces (surface profiles): one engine, one subscription. */
    store?: ThreadStore;
}
interface AgentThreadApi extends ThreadSnapshot {
    store: ThreadStore;
    /** The one HITL item the human can act on now, or null. */
    actionableId: string | null;
    /** The newest turn that has not settled, if any. */
    activeTurn: ThreadState["turns"][number] | null;
    send: ChatTransport["send"];
    cancel: ChatTransport["cancel"];
    unsend: ChatTransport["unsend"];
    revertUndo: ChatTransport["revertUndo"];
    /** The human's decision. Only the option and note travel; the server resolves the actor and the decision. */
    decide: (input: ApprovalDecisionInput) => Promise<unknown>;
    answer: (input: QuestionAnswerInput) => Promise<unknown>;
    /**
     * What the backend can do, read once per transport (`transport.capabilities`).
     * Null until it loads, when the transport has no such method, or when the read
     * fails. Pass `canStop={capabilities?.cancel !== false}` to AgentComposer.
     */
    capabilities: BackendCapabilities | null;
    /**
     * Retry a failed turn with its original input (`transport.retry`). Rejects when the
     * transport cannot retry. Pass the hook to AgentThread as `chat` and its Retry uses this.
     */
    retry: (turnId: string) => Promise<SendResult>;
}
/**
 * One engine for a chat surface: seq dedupe, gap repair, the shared reducer and
 * the projection, over a transport. Several surfaces (surface profiles) can
 * share one store by passing the same transport and options.
 */
declare function useAgentThread(options: UseAgentThreadOptions): AgentThreadApi;

/**
 * The one actionable HITL item in a projected thread (fancy-chat-js
 * `pickActionable`), ordered by first appearance, which is seq order.
 */
declare function actionableIn(state: ThreadState, kinds?: readonly string[]): string | null;

/** The human's messages waiting behind a running turn, oldest first. */
declare function queuedMessages(state: ThreadState): MessageEntry[];
interface QueueBarProps {
    /** Usually `queuedMessages(state)`. */
    messages: readonly MessageEntry[];
    /** Take one message back out of the queue (delivery `unsent`). */
    onUnsend: (messageId: string) => void | Promise<unknown>;
    onSendAll?: () => void;
    onDiscardAll?: () => void;
    /** Deliver this one now, without interrupting. Offered once it has waited `sendNowAfterMs`. */
    onSendNow?: (messageId: string) => void;
    /** Stop the turn and deliver this one. */
    onInterruptAndSend?: (messageId: string) => void;
    /** When each message was queued (ms). The host knows; the projection carries no time. */
    queuedAt?: (message: MessageEntry) => number | undefined;
    /** The clock, in ms. Pass it so a re-render is what moves time on. */
    now?: number;
    /** How long a message waits before Send now is offered. Default 120000. */
    sendNowAfterMs?: number;
    labels?: Partial<ChatLabels>;
}
/** The queue behind a running turn: unsend one, send all, discard, send now, interrupt and send. */
declare function QueueBar(props: QueueBarProps): ReactNode;

interface UndoCountdownProps {
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
declare function UndoCountdown({ entry, onRevert, now: fixedNow, tickMs, totalMs, labels: l }: UndoCountdownProps): ReactNode;

export { type ActivityEntry, ActivityTimeline, type ActivityTimelineProps, AgentComposer, type AgentComposerProps, type AgentComposerSendInput, AgentThread, type AgentThreadApi, type AgentThreadProps, ApprovalCard, type ApprovalCardProps, type ApprovalDecisionInput, type BackendCapabilities, type CancelOutcome, ChatLabels, type ChatTransport, type ConnectionState, EMPTY_PROMPT_DRAFT, type HttpTransportOptions, type IntervalOptions, ModelError, type ModelErrorProps, PartViewProps, type PillRef, PlanRow, type PlanRowProps, type QuestionAnswerInput, QuestionForm, type QuestionFormProps, QueueBar, type QueueBarProps, type SendInput, type SendOutcome, type SendResult, type SubscribeHandlers, type SurfaceLayout, type SurfaceProfile, ThinkingBlock, type ThinkingBlockProps, type ThreadSnapshot, type ThreadStore, type ThreadStoreOptions, type ToolOutputResolver, ToolRow, type ToolRowProps, type TransportMode, type TriggerDefinition, type TriggerRegistry, UndoCountdown, type UndoCountdownProps, type UseAgentThreadOptions, actionableIn, createHttpTransport, createThreadStore, createTriggerRegistry, defineSurfaceProfile, profileAllowsPart, queuedMessages, serializePill, useAgentThread };
