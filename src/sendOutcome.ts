import type { ThreadState } from "@particle-academy/fancy-chat-js";

import type { SendOutcome } from "./AgentComposer";

// What the send response says before the projection has caught up: a message
// the projection still shows as `sending` or `sent` has not been queued,
// steered or delivered YET, so the response is newer than it.
const BEHIND_THE_RESPONSE = new Set(["sending", "sent"]);
// Nothing to say: the message is in the thread and the agent has it.
const NOTHING_TO_SAY = new Set(["sent", "delivered"]);

/**
 * The send outcome as it stands NOW: the message's current delivery in the
 * projection, or the send response while the projection has not caught up.
 * Null once the message is delivered (it is in the thread; a line saying so is
 * noise) and for a plain `sent`. A failure has no message and stays until the
 * next send replaces it.
 *
 * `useAgentThread().outcome` is this, kept for you. Call it yourself only if
 * you hold the outcome in your own state: pass the send response's
 * `messageId`, or there is nothing to follow and the response is all it shows.
 */
export function sendOutcomeOf(state: ThreadState, sent: SendOutcome | null | undefined): SendOutcome | null {
  if (!sent) return null;
  const message = sent.messageId ? state.messages.find((m) => m.id === sent.messageId) : undefined;
  const projected = message?.delivery ?? null;
  const delivery = projected !== null && !BEHIND_THE_RESPONSE.has(projected) ? projected : sent.delivery;
  if (NOTHING_TO_SAY.has(delivery)) return null;
  // The response's reason belongs to the response's state; a later state drops it.
  if (delivery === sent.delivery) return sent;
  return { ...(sent.messageId ? { messageId: sent.messageId } : {}), delivery };
}
