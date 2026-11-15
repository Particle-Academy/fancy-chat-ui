import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { AnswerDraft, ThreadState } from "@particle-academy/fancy-chat-js";

import { actionableIn } from "./actionable";

import type { ApprovalDecisionInput } from "./ApprovalCard";
import type { QuestionAnswerInput } from "./QuestionForm";
import { createThreadStore, type ThreadSnapshot, type ThreadStore } from "./store";
import type { ChatTransport, SendInput } from "./transport";

export interface UseAgentThreadOptions {
  transport: ChatTransport;
  initial?: ThreadState;
  /** Optional Echo/Reverb "something new" hint; see ThreadStoreOptions.nudge. */
  nudge?: (cb: (seq: number) => void) => () => void;
  /** HITL kinds this surface may act on. Default both. */
  actionableKinds?: ("approval" | "question")[];
}

export interface AgentThreadApi extends ThreadSnapshot {
  store: ThreadStore;
  /** The one HITL item the human can act on now, or null. */
  actionableId: string | null;
  /** The newest turn that has not settled, if any. */
  activeTurn: ThreadState["turns"][number] | null;
  send: ChatTransport["send"];
  cancel: ChatTransport["cancel"];
  unsend: ChatTransport["unsend"];
  /** The human's decision. Only the option and note travel; the server resolves the actor and the decision. */
  decide: (input: ApprovalDecisionInput) => Promise<unknown>;
  answer: (input: QuestionAnswerInput) => Promise<unknown>;
}

/**
 * One engine for a chat surface: seq dedupe, gap repair, the shared reducer and
 * the projection, over a transport. Several surfaces (surface profiles) can
 * share one store by passing the same transport and options.
 */
export function useAgentThread(options: UseAgentThreadOptions): AgentThreadApi {
  const { transport, initial, nudge, actionableKinds } = options;
  // A new transport is a new thread; the store is rebuilt for it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => createThreadStore({ transport, ...(initial ? { initial } : {}), ...(nudge ? { nudge } : {}) }), [transport]);

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const kinds = actionableKinds ?? ["approval", "question"];
  const kindsKey = kinds.join(",");
  const actionableId = useMemo(() => actionableIn(snapshot.state, kindsKey.split(",")), [snapshot.version, kindsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTurn = useMemo(() => [...snapshot.state.turns].reverse().find((t) => t.state !== "settled") ?? null, [snapshot.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((input: SendInput) => transport.send(input), [transport]);
  const cancel = useCallback((mode: "stop" | "interrupt") => transport.cancel(mode), [transport]);
  const unsend = useCallback((id: string) => transport.unsend(id), [transport]);
  const decide = useCallback(
    (input: ApprovalDecisionInput) => transport.decide(input.approvalId, { optionId: input.optionId, ...(input.note ? { note: input.note } : {}) }),
    [transport],
  );
  const answer = useCallback((input: QuestionAnswerInput) => transport.answer(input.questionId, { values: input.values, notes: input.notes } as AnswerDraft), [transport]);

  return { ...snapshot, store, actionableId, activeTurn, send, cancel, unsend, decide, answer };
}
