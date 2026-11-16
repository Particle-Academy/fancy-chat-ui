import { ReactNode } from 'react';
import { ContentRendererProps } from '@particle-academy/react-fancy';
import { Part, PartRegistry } from '@particle-academy/fancy-chat-js';

/** Every visible string, for translation. English defaults. */
interface ChatLabels {
    thread: string;
    loadEarlier: string;
    jumpToLatest: (unseen: number) => string;
    thinking: string;
    thinkingLive: string;
    showThinking: string;
    hideThinking: string;
    tool: string;
    toolRunning: string;
    toolOk: string;
    toolFailure: string;
    toolRefusal: string;
    toolArgs: string;
    toolRetry: string;
    showMore: string;
    showLess: string;
    durationMs: (ms: number) => string;
    approval: string;
    approvalNote: string;
    approvalDeciding: string;
    approvalWaiting: string;
    approvalStates: Record<string, string>;
    question: string;
    questionNote: string;
    questionSubmit: string;
    questionLater: string;
    questionDismiss: string;
    questionAnswered: string;
    questionWaiting: string;
    unknownPart: string;
    file: string;
    plan: (n: number, m: number) => string;
    delivery: Record<string, string>;
    composerPlaceholder: string;
    stop: string;
    sendFailed: (reason: string) => string;
    superseded: string;
    retracted: string;
    queued: (n: number) => string;
    queueSendAll: string;
    queueDiscard: string;
    queueSendNow: string;
    queueInterrupt: string;
    queueUnsend: string;
    undoOpen: (seconds: number) => string;
    undoCommitted: string;
    undoReverted: string;
    undoRevert: string;
    typedApproval: (decision: string) => string;
    showEarlierVersion: string;
    hideEarlierVersion: string;
    edit: string;
    heldOnApproval: string;
    toolOutputTruncated: string;
    toolOutputLoading: string;
    toolOutputError: string;
    /** `exact` is false when any tool's duration was only bounded: the total is "at most". */
    activitySummary: (tools: number, seconds: string, failed: number, exact?: boolean) => string;
    /** A bounded, not measured, duration: "≤ 1.2 s". */
    durationAtMost: (formatted: string) => string;
    showActivity: string;
    hideActivity: string;
    turnFailed: (reason: string | null) => string;
    turnRefused: string;
    turnRetry: string;
}
declare const DEFAULT_LABELS: ChatLabels;
declare function mergeLabels(labels?: Partial<ChatLabels>): ChatLabels;

/** Renders one part kind. Hosts register these for `x-*` kinds and for `chart`. */
type PartRenderer = (part: Part, ctx: PartRenderContext) => ReactNode;
interface PartRenderContext {
    streaming: boolean;
    labels: ChatLabels;
    renderPart: (part: Part) => ReactNode;
}
/** A host resolver for `file` / `image` refs. Returning null renders the name with no link. */
type RefResolver = (part: Part) => {
    href?: string;
    src?: string;
} | null;
interface PartViewProps {
    part: Part;
    /** True while this part is still streaming (its id is in the message's `open`). */
    streaming?: boolean;
    renderers?: Record<string, PartRenderer>;
    registry?: PartRegistry;
    resolveRef?: RefResolver;
    /** A card action with kind `post-back`: a recorded human action. It can never decide an approval. */
    onCardAction?: (part: Part, actionId: string) => void;
    /** Options for every text part's ContentRenderer (extensions, a markup holdBack, ...). */
    contentOptions?: Pick<ContentRendererProps, "extensions" | "copyButtons" | "onCopy" | "clipboardWriter" | "holdBack" | "transform" | "lineSpacing">;
    /** How `approval` and `question` parts render: the thread places the HITL record here. */
    renderHitl?: (part: Part) => ReactNode;
    labels?: Partial<ChatLabels>;
    /** A surface profile's part kinds. Any other kind renders as its plain text. */
    allowedKinds?: readonly string[];
}
/**
 * One message part, composed from react-fancy. Text goes through
 * ContentRenderer (sanitised; held back while streaming), code through
 * CodeBlock, tables through Table. A kind nobody registered renders its plain
 * text in a chip, never silently dropped.
 */
declare function PartView(props: PartViewProps): ReactNode;

export { type ChatLabels as C, DEFAULT_LABELS as D, type PartRenderer as P, type RefResolver as R, type PartViewProps as a, type PartRenderContext as b, PartView as c, mergeLabels as m };
