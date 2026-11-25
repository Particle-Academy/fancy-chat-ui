import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AnswerDraft, ChatEvent, ThreadState } from "@particle-academy/fancy-chat-js";

import { actionableIn } from "./actionable";
import { suggestionMessage, suggestionsOf, type QuickReply } from "./QuickReplies";

import type { ApprovalDecisionInput } from "./ApprovalCard";
import type { QuestionAnswerInput } from "./QuestionForm";
import { createThreadStore, type ThreadSnapshot, type ThreadStore } from "./store";
import type { BackendCapabilities, ChatTransport, SendInput, SendResult } from "./transport";

export interface UseAgentThreadOptions {
  transport: ChatTransport;
  initial?: ThreadState;
  /** Optional Echo/Reverb "something new" hint; see ThreadStoreOptions.nudge. */
  nudge?: (cb: (seq: number) => void) => () => void;
  /** HITL kinds this surface may act on. Default both. */
  actionableKinds?: ("approval" | "question")[];
  /** A store shared by several surfaces (surface profiles): one engine, one subscription. */
  store?: ThreadStore;
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
  /**
   * The newest settled turn's quick replies (fancy-chat-js `state.suggestions`), or
   * none. Pass to AgentThread `suggestions`.
   */
  suggestions: QuickReply[];
  /** Sends a quick reply as an ordinary human message (one plain-text part). Never a decision or an answer. */
  sendSuggestion: (suggestion: QuickReply) => Promise<SendResult>;
}

/**
 * One engine for a chat surface: seq dedupe, gap repair, the shared reducer and
 * the projection, over a transport. Several surfaces (surface profiles) can
 * share one store by passing the same transport and options.
 */
export function useAgentThread(options: UseAgentThreadOptions): AgentThreadApi {
  const { transport, initial, nudge, actionableKinds, store: shared } = options;
  // A new transport is a new thread; the store is rebuilt for it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => shared ?? createThreadStore({ transport, ...(initial ? { initial } : {}), ...(nudge ? { nudge } : {}) }), [transport, shared]);

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  // Fresh page props for the SAME thread (an Inertia partial or memory reload)
  // that are AHEAD of the store by seq are taken, as a snapshot jump. A thread
  // that is not polling (idle, or parked on a human who acted in another tab)
  // otherwise kept showing the old state until a full reload. Props at or behind
  // the store are ignored: they would roll back what it has already applied.
  useEffect(() => {
    if (!initial || !(initial.lastSeq > store.getSnapshot().lastSeq)) return;
    store.ingest([
      {
        v: 1,
        seq: initial.lastSeq,
        threadId: "",
        at: new Date().toISOString(),
        type: "thread.snapshot",
        actor: { kind: "system", id: "fancy-chat-ui" },
        data: { snapshot: initial as unknown as Record<string, unknown> },
      } as ChatEvent,
    ]);
  }, [initial, store]);

  const [capabilities, setCapabilities] = useState<BackendCapabilities | null>(null);
  useEffect(() => {
    setCapabilities(null);
    if (!transport.capabilities) return;
    let live = true;
    transport.capabilities().then(
      (c) => {
        if (live && c && typeof c.cancel === "boolean") setCapabilities(c);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [transport]);

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const kinds = actionableKinds ?? ["approval", "question"];
  const kindsKey = kinds.join(",");
  const actionableId = useMemo(() => actionableIn(snapshot.state, kindsKey.split(",")), [snapshot.version, kindsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTurn = useMemo(() => [...snapshot.state.turns].reverse().find((t) => t.state !== "settled") ?? null, [snapshot.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((input: SendInput) => transport.send(input), [transport]);
  const suggestions = useMemo(() => suggestionsOf(snapshot.state), [snapshot.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const sendSuggestion = useCallback((suggestion: QuickReply) => transport.send(suggestionMessage(suggestion)), [transport]);
  const cancel = useCallback((mode: "stop" | "interrupt") => transport.cancel(mode), [transport]);
  const unsend = useCallback((id: string) => transport.unsend(id), [transport]);
  const retry = useCallback(
    (turnId: string) => (transport.retry ? transport.retry(turnId) : Promise.reject(new Error("This chat transport cannot retry a turn (no transport.retry)."))),
    [transport],
  );
  const revertUndo = useCallback((id: string) => transport.revertUndo(id), [transport]);
  const decide = useCallback(
    (input: ApprovalDecisionInput) => transport.decide(input.approvalId, {
        optionId: input.optionId,
        ...(input.note ? { note: input.note } : {}),
        ...(input.edited !== undefined ? { edited: input.edited } : {}),
      }),
    [transport],
  );
  const answer = useCallback((input: QuestionAnswerInput) => transport.answer(input.questionId, { values: input.values, notes: input.notes } as AnswerDraft), [transport]);

  return { ...snapshot, store, actionableId, activeTurn, send, cancel, unsend, revertUndo, decide, answer, capabilities, retry, suggestions, sendSuggestion };
}
