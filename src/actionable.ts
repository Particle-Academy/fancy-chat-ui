import { pickActionable, type ThreadState } from "@particle-academy/fancy-chat-js";

/**
 * The one actionable HITL item in a projected thread (fancy-chat-js
 * `pickActionable`), ordered by first appearance, which is seq order.
 */
export function actionableIn(state: ThreadState, kinds: readonly string[] = ["approval", "question"]): string | null {
  const items = state.order
    .map((o, index) => ({ o, index }))
    .filter(({ o }) => o.kind === "approval" || o.kind === "question")
    .map(({ o, index }) => {
      const record = o.kind === "approval" ? state.approvals.find((a) => a.approvalId === o.id) : state.questions.find((q) => q.questionId === o.id);
      return { id: o.id, kind: o.kind, state: String(record?.state ?? "open"), seq: index };
    });
  return pickActionable(items, kinds);
}
