import type { ReactNode } from "react";
import { PromptInput } from "@particle-academy/react-fancy";
import type { PromptAttachment, PromptCmd, PromptDraft, PromptMention, PromptTrigger } from "@particle-academy/react-fancy";
import { matchTypedApproval, type ApprovalRecord, type TypedApprovalConfig } from "@particle-academy/fancy-chat-js";

import type { TriggerRegistry } from "./triggers";

import { mergeLabels, type ChatLabels } from "./labels";

export const EMPTY_PROMPT_DRAFT: PromptDraft = { v: 1, text: "", pills: [], attachments: [] };

export interface SendOutcome {
  /** A fancy-chat-js delivery state: sent, queued, steered, delivered, failed, dropped, unsent. */
  delivery: string;
  reason?: string;
}

export interface AgentComposerSendInput {
  threadId: string;
  text: string;
  attachments: PromptAttachment[];
}

export interface AgentComposerProps {
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
  onSend: (input: AgentComposerSendInput) => void | Promise<void | { ok: false; error?: string }>;
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
  typedApproval?: { config: Partial<TypedApprovalConfig>; approval: Pick<ApprovalRecord, "state" | "options"> | null };
}

/**
 * The composer, on react-fancy's PromptInput: one composer serves every
 * thread by swapping the controlled draft with `draftKey`, instead of keeping a
 * hidden composer mounted per thread.
 */
export function AgentComposer(props: AgentComposerProps): ReactNode {
  const { threadId, drafts, onDraftsChange, onSend, running = false, onStop, canStop = true, outcome, commands, mentions, budgetTokens = 0, usedTokens, meter = "hidden", aboveInput, disabled, placeholder, className } = props;
  const labels = mergeLabels(props.labels);
  const draft = drafts[threadId] ?? EMPTY_PROMPT_DRAFT;
  const triggers = props.triggers ? (Array.isArray(props.triggers) ? props.triggers : props.triggers.triggers()) : undefined;
  const typed = props.typedApproval ? matchTypedApproval(draft.text, props.typedApproval.approval, props.typedApproval.config) : null;

  const submit = async (text: string, attachments: PromptAttachment[]) => {
    const result = await onSend({ threadId, text, attachments });
    if (result && result.ok === false) return { ok: false as const, ...(result.error ? { error: result.error } : {}) };
    return undefined;
  };

  const outcomeText = outcome
    ? outcome.delivery === "failed"
      ? labels.sendFailed(outcome.reason ?? labels.delivery.failed ?? "failed")
      : (labels.delivery[outcome.delivery] ?? outcome.delivery) + (outcome.reason ? ` (${outcome.reason})` : "")
    : null;

  return (
    <div data-fancy-chat-composer={threadId} data-fancy-chat-running={running ? "true" : "false"} data-fancy-chat-can-stop={canStop ? "true" : "false"} className={className}>
      <PromptInput
        draft={draft}
        draftKey={threadId}
        onDraftChange={(d) => onDraftsChange({ ...drafts, [threadId]: d })}
        onSubmit={submit}
        running={running}
        onStop={canStop ? onStop : undefined}
        commands={commands}
        mentions={mentions}
        triggers={triggers}
        budgetTokens={budgetTokens}
        usedTokens={usedTokens}
        meter={meter}
        aboveInput={aboveInput}
        disabled={disabled}
        placeholder={placeholder ?? labels.composerPlaceholder}
        labels={{ stop: labels.stop }}
      />
      {typed ? (
        <div data-fancy-chat-typed-approval={typed.decision} role="status" className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          {labels.typedApproval(typed.decision)}
        </div>
      ) : null}
      {outcomeText ? (
        <div data-fancy-chat-send-outcome="" data-fancy-chat-delivery={outcome?.delivery} role="status" className={outcome?.delivery === "failed" ? "mt-1 text-xs text-red-600 dark:text-red-400" : "mt-1 text-xs opacity-70"}>
          {outcomeText}
        </div>
      ) : null}
    </div>
  );
}
