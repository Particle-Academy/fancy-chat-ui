import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@particle-academy/react-fancy";
import type { PromptDraft } from "@particle-academy/react-fancy";
import type { ThreadState } from "@particle-academy/fancy-chat-js";

import { mergeLabels, type ChatLabels } from "./labels";
import type { SendInput } from "./transport";

/**
 * One quick reply (fancy-chat-js `Suggestion`): a stable id and one line of plain
 * text. Model output, so it is rendered as text, never as markdown or HTML.
 */
export interface QuickReply {
  id: string;
  text: string;
}

export interface QuickRepliesProps {
  /** Controlled: the chips to show, in order. Usually `chat.suggestions`. */
  suggestions: readonly QuickReply[];
  /**
   * A pick. Fill the composer (`suggestionDraft`) or send it as an ordinary
   * message (`chat.sendSuggestion`); a pick never decides, answers or calls a tool.
   */
  onSuggest: (suggestion: QuickReply) => void;
  labels?: Partial<ChatLabels>;
  className?: string;
}

/**
 * The chips: a labelled group of real buttons, so Tab reaches them and Enter or
 * Space picks one; the arrow keys move between them. Stable handles:
 * `data-fancy-chat-suggestions` on the group, `data-fancy-chat-suggestion="<id>"`
 * on each chip.
 */
export function QuickReplies(props: QuickRepliesProps): ReactNode {
  const { suggestions, onSuggest, className } = props;
  const labels = mergeLabels(props.labels);
  const group = useRef<HTMLDivElement>(null);
  if (suggestions.length === 0) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const chips = Array.from(group.current?.querySelectorAll<HTMLButtonElement>("[data-fancy-chat-suggestion]") ?? []);
    const at = chips.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0 || chips.length === 0) return;
    e.preventDefault();
    const next = (at + (e.key === "ArrowRight" ? 1 : -1) + chips.length) % chips.length;
    chips[next]?.focus();
  };

  return (
    <div
      ref={group}
      role="group"
      aria-label={labels.quickReplies}
      data-fancy-chat-suggestions=""
      onKeyDown={onKeyDown}
      className={["flex flex-wrap gap-1.5", className].filter(Boolean).join(" ")}
    >
      {suggestions.map((s) => (
        <Button key={s.id} type="button" size="sm" data-fancy-chat-suggestion={s.id} onClick={() => onSuggest({ id: s.id, text: s.text })}>
          {s.text}
        </Button>
      ))}
    </div>
  );
}

/**
 * Whether quick replies must stay out of sight: while any turn is unsettled, while
 * a human decision waits (an approval pending or being decided, a question open),
 * once the newest message is the human's own, or when the host says so (`hidden`,
 * for its own decision states such as an approval-queue modal).
 */
export function quickRepliesHidden(state: ThreadState, options: { hidden?: boolean } = {}): boolean {
  if (options.hidden) return true;
  if (state.turns.some((t) => t.state !== "settled")) return true;
  if (state.approvals.some((a) => a.state === "pending" || a.state === "deciding")) return true;
  if (state.questions.some((q) => (q.state ?? "open") === "open")) return true;
  const messages = state.messages.filter((m) => !m.retracted);
  const last = messages.length > 0 ? messages[messages.length - 1] : undefined;
  return !last || last.author?.kind === "human";
}

/**
 * The projected quick replies (fancy-chat-js `state.suggestions`) when they belong
 * to the newest turn; otherwise none. Reads defensively: a projection from a
 * fancy-chat-js without the field, or a malformed entry, yields none, and an item
 * that is not `{ id: string, text: string }` is skipped.
 */
export function suggestionsOf(state: ThreadState): QuickReply[] {
  const entry = (state as ThreadState & { suggestions?: unknown }).suggestions;
  if (!entry || typeof entry !== "object") return [];
  const { turnId, items } = entry as { turnId?: unknown; items?: unknown };
  const newest = state.turns.length > 0 ? state.turns[state.turns.length - 1] : undefined;
  if (typeof turnId !== "string" || !newest || newest.turnId !== turnId || !Array.isArray(items)) return [];
  const out: QuickReply[] = [];
  for (const item of items) {
    if (item && typeof item === "object" && typeof item.id === "string" && item.id !== "" && typeof item.text === "string" && item.text !== "") {
      out.push({ id: item.id, text: item.text });
    }
  }
  return out;
}

/** A composer draft holding the suggestion's text, for "fill the composer". */
export function suggestionDraft(suggestion: QuickReply): PromptDraft {
  return { v: 1, text: suggestion.text, pills: [], attachments: [] };
}

/** The suggestion as an ordinary human message: one plain-text part, nothing else. */
export function suggestionMessage(suggestion: QuickReply): SendInput {
  return { parts: [{ id: "p1", kind: "text", format: "plain", text: suggestion.text }] };
}
