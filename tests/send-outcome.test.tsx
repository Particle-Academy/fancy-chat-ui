import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { projectThread, type ChatEvent } from "@particle-academy/fancy-chat-js";
import type { PromptDraft } from "@particle-academy/react-fancy";

import { AgentComposer, AgentThread, sendOutcomeOf, useAgentThread, type AgentThreadApi, type ChatTransport, type SendResult } from "../src/index";
import { ev, flush } from "./helpers";

// Tynn #259: the composer's send outcome kept saying "Queued" after the queued
// message had been delivered, run and answered. The outcome has to follow the
// message's delivery in the projection, not the send response it started from.

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const outcomeLine = () => el("[data-fancy-chat-send-outcome]");

const human = { kind: "human", id: "u_1" } as const;
const server = { kind: "system", id: "server" } as const;
const text = (t: string) => [{ id: "p", kind: "text", format: "plain", text: t }];

function fakeTransport(send: (input: unknown) => Promise<SendResult>) {
  let push: ((events: ChatEvent[]) => void) | null = null;
  const transport = {
    subscribe: ({ onEvents }: { onEvents: (e: ChatEvent[]) => void }) => {
      push = onEvents;
      return () => {
        push = null;
      };
    },
    fetchAfter: vi.fn(async () => ({ events: [], next: 0 })),
    send: vi.fn(send),
    cancel: vi.fn(async () => ({ outcome: "ok" })),
    unsend: vi.fn(async () => ({ ok: true })),
    decide: vi.fn(async () => ({})),
    answer: vi.fn(async () => ({})),
    revertUndo: vi.fn(async () => ({})),
  } as unknown as ChatTransport;
  const emit = async (events: ChatEvent[]) => {
    act(() => push?.(events));
    await act(flush);
  };
  return { transport, emit };
}

let chat: AgentThreadApi | null = null;
const draft: PromptDraft = { v: 1, text: "", pills: [], attachments: [] };

function Surface({ transport }: { transport: ChatTransport }) {
  const api = useAgentThread({ transport });
  chat = api;
  return (
    <>
      <AgentThread rows={api.rows} state={api.state} follow onFollowChange={() => {}} onDecide={api.decide} onAnswer={api.answer} chat={api} suggestions={api.suggestions} onSuggest={(s) => void api.sendSuggestion(s)} />
      <AgentComposer
        threadId="t_1"
        drafts={{ t_1: draft }}
        onDraftsChange={() => {}}
        running={!!api.activeTurn}
        onSend={({ text: t }) => api.send({ parts: [{ id: "p1", kind: "text", format: "plain", text: t }] }).then(() => undefined)}
        outcome={api.outcome}
      />
    </>
  );
}

/** Turn u_1, started by m_1, running. */
const running = (): ChatEvent[] => [
  ev(1, "message.created", { turnId: "u_1", message: { id: "m_1", role: "user", parts: text("send the report"), delivery: "sent" } }, { actor: human }),
  ev(2, "turn.started", { turnId: "u_1", messageId: "m_1" }, { actor: server }),
  ev(3, "turn.transition", { turnId: "u_1", action: "start" }, { actor: server }),
  ev(4, "delivery.changed", { messageId: "m_1", action: "deliver" }, { actor: server }),
];

/** m_2 arrives mid-turn and queues, as fancy-chat-php records it. */
const queued = (seq: number, id = "m_2", body = "and cc finance"): ChatEvent[] => [
  ev(seq, "message.created", { message: { id, role: "user", parts: text(body), delivery: "sent" } }, { actor: human }),
  ev(seq + 1, "delivery.changed", { messageId: id, action: "queue" }, { actor: server }),
];

/** The queued message's own turn: started, delivered, answered, settled, with quick replies. */
const deliveredAndAnswered = (seq: number, turnId: string, id: string): ChatEvent[] => [
  ev(seq, "turn.started", { turnId, messageId: id }, { actor: server }),
  ev(seq + 1, "turn.transition", { turnId, action: "start" }, { actor: server }),
  ev(seq + 2, "delivery.changed", { messageId: id, action: "deliver" }, { actor: server }),
  ev(seq + 3, "message.created", { turnId, message: { id: `${id}_reply`, role: "assistant", parts: [{ id: "p", kind: "text", format: "markdown", text: "Done, finance is copied." }] } }),
  ev(seq + 4, "turn.settled", { turnId, action: "finish" }, { actor: server }),
  ev(seq + 5, "suggestions.updated", { turnId, items: [{ id: "s1", text: "Show me the report" }] }, { actor: server }),
];

const queuedResult = (messageId: string, seq: number): SendResult => ({ messageId, seq, delivery: "queued" });

describe("the send outcome follows the projection (Tynn #259)", () => {
  it("running-turn path: Queued while it waits, cleared once it is delivered, answered and settled", async () => {
    const { transport, emit } = fakeTransport(async () => queuedResult("m_2", 5));
    render(<Surface transport={transport} />);
    await emit(running());

    await act(async () => {
      await chat!.send({ parts: text("and cc finance") as never });
    });
    await emit(queued(5));
    expect(outcomeLine()?.textContent).toBe("Queued");
    expect(outcomeLine()?.getAttribute("data-fancy-chat-delivery")).toBe("queued");

    await emit([ev(7, "turn.settled", { turnId: "u_1", action: "finish" }, { actor: server }), ...deliveredAndAnswered(8, "u_2", "m_2")]);
    expect(el('[data-fancy-chat-composer="t_1"]')?.getAttribute("data-fancy-chat-running")).toBe("false");
    expect(el('[data-fancy-chat-message="m_2_reply"]')).not.toBeNull();
    expect(el('[data-fancy-chat-suggestion="s1"]')).not.toBeNull();
    expect(chat!.state.messages.find((m) => m.id === "m_2")?.delivery).toBe("delivered");
    expect(outcomeLine()).toBeNull();
    expect(chat!.outcome).toBeNull();
  });

  it("approval path: queued behind a parked turn, then the approval is decided and the turn settles", async () => {
    const { transport, emit } = fakeTransport(async () => queuedResult("m_2", 7));
    render(<Surface transport={transport} />);
    await emit([
      ...running(),
      ev(5, "approval.requested", { approval: { approvalId: "ap_1", title: "Send?", summary: "", preview: [], options: [{ id: "o1", kind: "allow-once", label: "Send" }], state: "pending" } }, { actor: server }),
      ev(6, "turn.transition", { turnId: "u_1", action: "park" }, { actor: server }),
    ]);
    expect(chat!.actionableId).toBe("ap_1");

    await act(async () => {
      await chat!.send({ parts: text("and cc finance") as never });
    });
    await emit(queued(7));
    expect(outcomeLine()?.textContent).toBe("Queued");

    fireEvent.click(el('[data-fancy-chat-approval="ap_1"] [data-fancy-chat-option="o1"]')!);
    await act(flush);
    expect(transport.decide).toHaveBeenCalledWith("ap_1", { optionId: "o1" });
    await emit([
      ev(9, "approval.decided", { approvalId: "ap_1", optionId: "o1", decision: "approve", decidedBy: human }, { actor: human }),
      ev(10, "turn.transition", { turnId: "u_1", action: "resume" }, { actor: server }),
      ev(11, "turn.settled", { turnId: "u_1", action: "finish" }, { actor: server }),
    ]);
    // The queued message has not been delivered yet: it still says so.
    expect(outcomeLine()?.textContent).toBe("Queued");

    await emit(deliveredAndAnswered(12, "u_2", "m_2"));
    expect(el('[data-fancy-chat-composer="t_1"]')?.getAttribute("data-fancy-chat-running")).toBe("false");
    expect(el('[data-fancy-chat-message="m_2_reply"]')).not.toBeNull();
    expect(outcomeLine()).toBeNull();
  });

  it("sendSuggestion path: a quick reply that queues is tracked too, and clears once delivered", async () => {
    const { transport, emit } = fakeTransport(async () => queuedResult("m_3", 11));
    render(<Surface transport={transport} />);
    await emit([...running(), ev(5, "turn.settled", { turnId: "u_1", action: "finish" }, { actor: server }), ev(6, "suggestions.updated", { turnId: "u_1", items: [{ id: "s0", text: "Send it again" }] }, { actor: server })]);
    // Another surface (or tab) starts a turn the chips have not caught up with.
    await emit([
      ev(7, "message.created", { turnId: "u_2", message: { id: "m_2", role: "user", parts: text("and cc finance"), delivery: "sent" } }, { actor: human }),
      ev(8, "turn.started", { turnId: "u_2", messageId: "m_2" }, { actor: server }),
      ev(9, "turn.transition", { turnId: "u_2", action: "start" }, { actor: server }),
      ev(10, "delivery.changed", { messageId: "m_2", action: "deliver" }, { actor: server }),
    ]);

    await act(async () => {
      await chat!.sendSuggestion({ id: "s0", text: "Send it again" });
    });
    expect(transport.send).toHaveBeenCalledWith({ parts: [{ id: "p1", kind: "text", format: "plain", text: "Send it again" }] });
    await emit(queued(11, "m_3", "Send it again"));
    expect(outcomeLine()?.textContent).toBe("Queued");

    await emit([ev(13, "turn.settled", { turnId: "u_2", action: "finish" }, { actor: server }), ...deliveredAndAnswered(14, "u_3", "m_3")]);
    expect(el('[data-fancy-chat-composer="t_1"]')?.getAttribute("data-fancy-chat-running")).toBe("false");
    expect(el('[data-fancy-chat-message="m_3_reply"]')).not.toBeNull();
    expect(outcomeLine()).toBeNull();
  });

  it("a quick reply picked from the chips, with the turn settled: no stale Queued from an earlier send", async () => {
    let n = 0;
    const { transport, emit } = fakeTransport(async () => (++n === 1 ? queuedResult("m_2", 5) : { messageId: "m_3", seq: 13, delivery: "sent" }));
    render(<Surface transport={transport} />);
    await emit(running());
    await act(async () => {
      await chat!.send({ parts: text("and cc finance") as never });
    });
    await emit(queued(5));
    expect(outcomeLine()?.textContent).toBe("Queued");
    // m_2 is delivered and answered, with chips; then the human taps one.
    await emit([ev(7, "turn.settled", { turnId: "u_1", action: "finish" }, { actor: server }), ...deliveredAndAnswered(8, "u_2", "m_2")]);
    fireEvent.click(el('[data-fancy-chat-suggestion="s1"]')!);
    await act(flush);
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(outcomeLine()).toBeNull();
  });

  it("keeps the send response until the projection moves past it, and shows a delivery that is not delivered", async () => {
    const { transport, emit } = fakeTransport(async () => queuedResult("m_2", 5));
    render(<Surface transport={transport} />);
    await emit(running());
    await act(async () => {
      await chat!.send({ parts: text("and cc finance") as never });
    });
    // The response is in; the events are not: the response is all there is.
    expect(outcomeLine()?.textContent).toBe("Queued");
    // message.created alone (delivery still "sent") must not hide the queue.
    await emit([queued(5)[0]!]);
    expect(outcomeLine()?.textContent).toBe("Queued");
    // Taken back out of the queue: the line follows.
    await emit([ev(6, "delivery.changed", { messageId: "m_2", action: "queue" }, { actor: server }), ev(7, "delivery.changed", { messageId: "m_2", action: "unsend" }, { actor: human })]);
    expect(outcomeLine()?.getAttribute("data-fancy-chat-delivery")).toBe("unsent");
    expect(outcomeLine()?.textContent).toBe("Unsent");
  });

  it("a failed send shows the failure and the next send replaces it", async () => {
    let n = 0;
    const { transport, emit } = fakeTransport(async () => {
      if (++n === 1) throw new Error("queue.full");
      return queuedResult("m_2", 5);
    });
    render(<Surface transport={transport} />);
    await emit(running());
    await act(async () => {
      await expect(chat!.send({ parts: text("one") as never })).rejects.toThrow("queue.full");
    });
    expect(outcomeLine()?.getAttribute("data-fancy-chat-delivery")).toBe("failed");
    expect(outcomeLine()?.textContent).toContain("queue.full");
    await act(async () => {
      await chat!.send({ parts: text("two") as never });
    });
    expect(outcomeLine()?.textContent).toBe("Queued");
  });

  it("an older send that resolves late does not overwrite a newer one", async () => {
    const resolvers: ((r: SendResult) => void)[] = [];
    const { transport, emit } = fakeTransport(() => new Promise<SendResult>((resolve) => resolvers.push(resolve)));
    render(<Surface transport={transport} />);
    await emit(running());
    let first: Promise<SendResult> | null = null;
    let second: Promise<SendResult> | null = null;
    act(() => {
      first = chat!.send({ parts: text("one") as never });
      second = chat!.send({ parts: text("two") as never });
    });
    await act(async () => {
      resolvers[1]!({ messageId: "m_3", seq: 6, delivery: "queued" });
      await second;
      resolvers[0]!({ messageId: "m_2", seq: 5, delivery: "decided" });
      await first;
    });
    expect(outcomeLine()?.getAttribute("data-fancy-chat-delivery")).toBe("queued");
  });

  it("a send in flight clears the previous send's line", async () => {
    let n = 0;
    let release: (r: SendResult) => void = () => {};
    const { transport, emit } = fakeTransport(() => (++n === 1 ? Promise.resolve(queuedResult("m_2", 5)) : new Promise<SendResult>((resolve) => (release = resolve))));
    render(<Surface transport={transport} />);
    await emit(running());
    await act(async () => {
      await chat!.send({ parts: text("one") as never });
    });
    expect(outcomeLine()?.textContent).toBe("Queued");
    let second: Promise<SendResult> | null = null;
    act(() => {
      second = chat!.send({ parts: text("two") as never });
    });
    expect(outcomeLine()).toBeNull();
    await act(async () => {
      release({ messageId: "m_3", seq: 7, delivery: "queued" });
      await second;
    });
    expect(outcomeLine()?.textContent).toBe("Queued");
  });

  it("retry is tracked like a send: a retried turn that queues says so, then clears once delivered", async () => {
    const { transport, emit } = fakeTransport(async () => queuedResult("m_2", 5));
    (transport as { retry?: (turnId: string) => Promise<SendResult> }).retry = vi.fn(async () => queuedResult("m_r", 5));
    render(<Surface transport={transport} />);
    await emit(running());
    await act(async () => {
      await chat!.retry("u_0");
    });
    expect(outcomeLine()?.textContent).toBe("Queued");
    await emit([...queued(5, "m_r", "retry"), ev(7, "turn.settled", { turnId: "u_1", action: "finish" }, { actor: server }), ...deliveredAndAnswered(8, "u_2", "m_r")]);
    expect(outcomeLine()).toBeNull();
  });

  it("a new transport (another thread) starts with no outcome", async () => {
    const a = fakeTransport(async () => queuedResult("m_2", 5));
    const b = fakeTransport(async () => queuedResult("m_9", 1));
    const { rerender } = render(<Surface transport={a.transport} />);
    await a.emit(running());
    await act(async () => {
      await chat!.send({ parts: text("and cc finance") as never });
    });
    expect(outcomeLine()?.textContent).toBe("Queued");
    rerender(<Surface transport={b.transport} />);
    await act(flush);
    expect(outcomeLine()).toBeNull();
  });
});

describe("sendOutcomeOf, for a host that keeps its own outcome", () => {
  const state = (events: ChatEvent[]) => projectThread(events).state;

  it("follows the message's delivery once the projection is past the response", () => {
    const parked = state([...running(), ...queued(5)]);
    expect(sendOutcomeOf(parked, { messageId: "m_2", delivery: "queued" })).toEqual({ messageId: "m_2", delivery: "queued" });
    const done = state([...running(), ...queued(5), ev(7, "turn.settled", { turnId: "u_1", action: "finish" }, { actor: server }), ...deliveredAndAnswered(8, "u_2", "m_2")]);
    expect(sendOutcomeOf(done, { messageId: "m_2", delivery: "queued" })).toBeNull();
  });

  it("drops the response's reason once the message has moved on", () => {
    const unsent = state([...running(), ...queued(5), ev(7, "delivery.changed", { messageId: "m_2", action: "unsend" }, { actor: human })]);
    expect(sendOutcomeOf(unsent, { messageId: "m_2", delivery: "queued", reason: "behind a turn" })).toEqual({ messageId: "m_2", delivery: "unsent" });
  });

  it("is null for nothing sent and for a plain sent; keeps a failure, which has no message", () => {
    const s = state(running());
    expect(sendOutcomeOf(s, null)).toBeNull();
    expect(sendOutcomeOf(s, { messageId: "m_1", delivery: "sent" })).toBeNull();
    expect(sendOutcomeOf(s, { delivery: "failed", reason: "rate limited" })).toEqual({ delivery: "failed", reason: "rate limited" });
    // No messageId (an older host): the response is all it can show.
    expect(sendOutcomeOf(s, { delivery: "queued" })).toEqual({ delivery: "queued" });
  });
});
