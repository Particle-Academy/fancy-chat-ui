import type { ReactNode } from "react";
import { PromptInput } from "@particle-academy/react-fancy";
import type { PromptAttachment, PromptCmd, PromptDraft, PromptMention } from "@particle-academy/react-fancy";

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
}

/**
 * The composer, on react-fancy's PromptInput: one composer serves every
 * thread by swapping the controlled draft with `draftKey`, instead of keeping a
 * hidden composer mounted per thread.
 */
export function AgentComposer(props: AgentComposerProps): ReactNode {
  const { threadId, drafts, onDraftsChange, onSend, running = false, onStop, outcome, commands, mentions, budgetTokens = 0, usedTokens, meter = "hidden", aboveInput, disabled, placeholder, className } = props;
  const labels = mergeLabels(props.labels);
  const draft = drafts[threadId] ?? EMPTY_PROMPT_DRAFT;

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
    <div data-fancy-chat-composer={threadId} data-fancy-chat-running={running ? "true" : "false"} className={className}>
      <PromptInput
        draft={draft}
        draftKey={threadId}
        onDraftChange={(d) => onDraftsChange({ ...drafts, [threadId]: d })}
        onSubmit={submit}
        running={running}
        onStop={onStop}
        commands={commands}
        mentions={mentions}
        budgetTokens={budgetTokens}
        usedTokens={usedTokens}
        meter={meter}
        aboveInput={aboveInput}
        disabled={disabled}
        placeholder={placeholder ?? labels.composerPlaceholder}
        labels={{ stop: labels.stop }}
      />
      {outcomeText ? (
        <div data-fancy-chat-send-outcome="" data-fancy-chat-delivery={outcome?.delivery} role="status" className={outcome?.delivery === "failed" ? "mt-1 text-xs text-red-600 dark:text-red-400" : "mt-1 text-xs opacity-70"}>
          {outcomeText}
        </div>
      ) : null}
    </div>
  );
}
