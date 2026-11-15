/** Every visible string, for translation. English defaults. */
export interface ChatLabels {
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
}

export const DEFAULT_LABELS: ChatLabels = {
  thread: "Conversation",
  loadEarlier: "Load earlier",
  jumpToLatest: (n) => (n > 0 ? `Jump to latest (${n} new)` : "Jump to latest"),
  thinking: "Thinking",
  thinkingLive: "Thinking...",
  showThinking: "Show thinking",
  hideThinking: "Hide thinking",
  tool: "Tool",
  toolRunning: "Running",
  toolOk: "Done",
  toolFailure: "Failed",
  toolRefusal: "Declined",
  toolArgs: "Arguments",
  toolRetry: "Retry",
  showMore: "Show all",
  showLess: "Show less",
  durationMs: (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`),
  approval: "Approval needed",
  approvalNote: "Note (optional)",
  approvalDeciding: "Sending your decision...",
  approvalWaiting: "Waiting for an earlier decision",
  approvalStates: {
    pending: "Waiting on you",
    deciding: "Deciding",
    approved: "Approved",
    rejected: "Rejected",
    edited: "Approved with changes",
    applied: "Applied",
    "apply-failed": "Apply failed",
    withdrawn: "Withdrawn",
    expired: "Expired",
  },
  question: "Question",
  questionNote: "Or add a note",
  questionSubmit: "Answer",
  questionLater: "Later",
  questionDismiss: "Dismiss",
  questionAnswered: "Answered",
  questionWaiting: "Waiting for an earlier question",
  unknownPart: "Unsupported content",
  file: "File",
  plan: (n, m) => `Plan ${n}/${m}`,
  delivery: {
    sending: "Sending",
    sent: "Sent",
    queued: "Queued",
    steered: "Sent mid-turn",
    delivered: "Delivered",
    failed: "Not sent",
    dropped: "Dropped",
    unsent: "Unsent",
  },
  composerPlaceholder: "Message the agent",
  stop: "Stop",
  sendFailed: (reason) => `Not sent: ${reason}. Your draft is kept.`,
  superseded: "Edited and resent",
  retracted: "Retracted",
  queued: (n) => (n === 1 ? "1 queued" : `${n} queued`),
  queueSendAll: "Send all",
  queueDiscard: "Discard all",
  queueSendNow: "Send now",
  queueInterrupt: "Interrupt and send",
  queueUnsend: "Unsend",
  undoOpen: (s) => `Undo available for ${s} s`,
  undoCommitted: "Done",
  undoReverted: "Undone",
  undoRevert: "Undo",
  typedApproval: (d) => (d === "reject" ? "Sending this will reject the pending approval." : "Sending this will approve the pending approval."),
  showEarlierVersion: "Show earlier version",
  hideEarlierVersion: "Hide earlier version",
  edit: "Edit",
  heldOnApproval: "Waiting on approval",
};

export function mergeLabels(labels?: Partial<ChatLabels>): ChatLabels {
  return labels ? { ...DEFAULT_LABELS, ...labels } : DEFAULT_LABELS;
}
