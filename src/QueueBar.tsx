import type { ReactNode } from "react";
import { Badge, Button, Text } from "@particle-academy/react-fancy";
import { partToText, type MessageEntry, type ThreadState } from "@particle-academy/fancy-chat-js";

import { mergeLabels, type ChatLabels } from "./labels";

/** The human's messages waiting behind a running turn, oldest first. */
export function queuedMessages(state: ThreadState): MessageEntry[] {
  return state.messages.filter((m) => m.delivery === "queued" && !m.retracted);
}

export interface QueueBarProps {
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
export function QueueBar(props: QueueBarProps): ReactNode {
  const { messages, onUnsend, onSendAll, onDiscardAll, onSendNow, onInterruptAndSend, queuedAt, now, sendNowAfterMs = 120000 } = props;
  const labels = mergeLabels(props.labels);
  if (messages.length === 0) return null;
  return (
    <div data-fancy-chat-queue="" data-fancy-chat-queue-count={messages.length} className="flex flex-col gap-1 rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color="amber" variant="soft" size="sm">
          {labels.queued(messages.length)}
        </Badge>
        {onSendAll ? (
          <Button size="xs" data-fancy-chat-queue-send-all="" onClick={onSendAll}>
            {labels.queueSendAll}
          </Button>
        ) : null}
        {onDiscardAll ? (
          <Button size="xs" variant="ghost" data-fancy-chat-queue-discard="" onClick={onDiscardAll}>
            {labels.queueDiscard}
          </Button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-1">
        {messages.map((m) => {
          const at = queuedAt?.(m);
          const waited = at !== undefined && now !== undefined ? now - at : 0;
          const canSendNow = !!onSendNow && at !== undefined && now !== undefined && waited >= sendNowAfterMs;
          const text = m.parts.map((p) => partToText(p)).join(" ");
          return (
            <li key={m.id} data-fancy-chat-queued={m.id} className="flex items-center gap-2">
              <Text className="min-w-0 flex-1 truncate">{text}</Text>
              {canSendNow ? (
                <Button size="xs" data-fancy-chat-queue-send-now={m.id} onClick={() => onSendNow?.(m.id)}>
                  {labels.queueSendNow}
                </Button>
              ) : null}
              {onInterruptAndSend ? (
                <Button size="xs" color="amber" data-fancy-chat-queue-interrupt={m.id} onClick={() => onInterruptAndSend(m.id)}>
                  {labels.queueInterrupt}
                </Button>
              ) : null}
              <Button size="xs" variant="ghost" data-fancy-chat-queue-unsend={m.id} onClick={() => onUnsend(m.id)}>
                {labels.queueUnsend}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
