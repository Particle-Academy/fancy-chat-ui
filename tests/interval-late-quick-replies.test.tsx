import { useState } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "@particle-academy/fancy-chat-js";

import { AgentThread, createHttpTransport, createThreadStore, useAgentThread, type ChatTransport, type IntervalOptions } from "../src/index";

/*
 * Quick replies are generated AFTER a turn settles: fancy-chat-php's
 * `offerSuggestions` queues a `GenerateSuggestions` job once the settle is in the
 * log, so `suggestions.updated` lands seconds later. Interval mode used to stop
 * polling the moment the newest turn settled (and the host has no local action
 * to wake it), so the chip never reached the page. It now keeps polling after a
 * `completed` settle until `suggestions.updated` for that turn arrives or a
 * bounded window passes (`interval.suggestionsMs`, default 15000: the server's
 * generation timeout), then stops.
 */

const human = { kind: "human", id: "u_1" } as const;
const agent = { kind: "agent", id: "compass" } as const;
const system = { kind: "system", id: "server" } as const;

/** A server-side event log the fake endpoint serves, stamped with the (fake) clock. */
function serverLog() {
  const events: ChatEvent[] = [];
  const push = (type: string, data: Record<string, unknown>, actor: ChatEvent["actor"] = system, at = new Date().toISOString()) => {
    events.push({ v: 1, seq: events.length + 1, threadId: "t_1", at, type, actor, data } as ChatEvent);
  };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/events/poll")) {
      const after = Number(new URL(url, "http://h").searchParams.get("after"));
      return Response.json({ events: events.filter((e) => e.seq > after), next: events.length });
    }
    if (url.endsWith("/messages") && init?.method === "POST") return Response.json({ messageId: "m_new", seq: events.length + 1, delivery: "sent" }, { status: 201 });
    return Response.json({});
  });
  const polls = () => fetch.mock.calls.filter(([u]) => String(u).includes("/events/poll")).length;
  const startTurn = (turnId: string, messageId: string, text: string) => {
    push("message.created", { turnId, message: { id: messageId, role: "user", parts: [{ id: "p", kind: "text", format: "plain", text }], delivery: "sent" } }, human);
    push("turn.started", { turnId, messageId });
    push("turn.transition", { turnId, action: "start" });
  };
  const answer = (turnId: string, messageId: string, text: string, action = "finish") => {
    push("message.created", { turnId, message: { id: messageId, role: "assistant", parts: [{ id: "p", kind: "text", format: "plain", text }] } }, agent);
    push("turn.settled", { turnId, action });
  };
  const suggest = (turnId: string, items = [{ id: "more", text: "Tell me more" }, { id: "example", text: "Show an example" }]) =>
    push("suggestions.updated", { turnId, items });
  return { events, push, fetch, polls, startTurn, answer, suggest };
}

const transportFor = (fetch: ReturnType<typeof vi.fn>, interval?: IntervalOptions): ChatTransport =>
  createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval", ...(interval ? { interval } : {}) });

/** Lets the in-flight poll's promise chain settle at the current fake time. */
const flush = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0);
});
const advance = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms);
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-11-24T12:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

const chip = (id: string) => document.querySelector(`[data-fancy-chat-suggestion="${id}"]`) as HTMLButtonElement | null;

function Chat(props: { transport: ChatTransport; hidden?: boolean }) {
  const chat = useAgentThread({ transport: props.transport });
  return (
    <AgentThread
      rows={chat.rows}
      state={chat.state}
      follow
      onFollowChange={() => {}}
      suggestions={chat.suggestions}
      onSuggest={(s) => void chat.sendSuggestion(s)}
      suggestionsHidden={props.hidden}
    />
  );
}

describe("interval mode: quick replies that arrive after the turn settled", () => {
  it("reach the page with no idleMs and no local action, and a pick sends an ordinary message", async () => {
    const s = serverLog();
    s.startTurn("u_1", "m_1", "what is marigold?");
    render(<Chat transport={transportFor(s.fetch)} />);
    await flush();
    expect(s.polls()).toBe(1);

    // The answer and the settle land; the next active poll applies them.
    s.answer("u_1", "m_2", "Marigold is a useful example.");
    await advance(1500);
    expect(document.body.textContent).toContain("Marigold is a useful example.");
    expect(document.querySelector("[data-fancy-chat-suggestions]")).toBeNull();

    // Generation is a separate queue job: its event lands after the settle was polled.
    await advance(4000);
    s.suggest("u_1");
    await advance(15000);
    expect(chip("more")).not.toBeNull();

    fireEvent.click(chip("more")!);
    await flush();
    const writes = s.fetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(String(writes[0]![0])).toBe("/c/threads/t_1/messages");
    expect(JSON.parse((writes[0]![1] as RequestInit).body as string).parts).toEqual([{ id: "p1", kind: "text", format: "plain", text: "Tell me more" }]);
  });

  it("a suggestion that lands just before the 15 s default bound still arrives", async () => {
    const s = serverLog();
    s.startTurn("u_1", "m_1", "hi");
    const store = createThreadStore({ transport: transportFor(s.fetch) });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    s.answer("u_1", "m_2", "hello");
    await vi.advanceTimersByTimeAsync(1500); // the settle is applied here
    await vi.advanceTimersByTimeAsync(14500);
    s.suggest("u_1");
    await vi.advanceTimersByTimeAsync(500); // exactly the bound: one last poll lands on it
    expect(store.getSnapshot().state.suggestions?.turnId).toBe("u_1");
    store.stop();
  });

  it("stops at the bound when no suggestions ever come, and never polls again", async () => {
    const s = serverLog();
    s.startTurn("u_1", "m_1", "hi");
    const store = createThreadStore({ transport: transportFor(s.fetch) });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    s.answer("u_1", "m_2", "hello");
    await vi.advanceTimersByTimeAsync(1500);
    const atSettle = s.polls();
    await vi.advanceTimersByTimeAsync(15000);
    const atBound = s.polls();
    // Backed off, not hammering: a handful of polls inside the window, the last on the bound.
    expect(atBound - atSettle).toBeGreaterThan(0);
    expect(atBound - atSettle).toBeLessThanOrEqual(6);
    await vi.advanceTimersByTimeAsync(600000);
    expect(s.polls()).toBe(atBound);
    expect(store.getSnapshot().connection).toBe("idle");
    store.stop();
  });

  it("stops as soon as suggestions.updated for the turn arrives, even an empty list", async () => {
    const s = serverLog();
    s.startTurn("u_1", "m_1", "hi");
    const store = createThreadStore({ transport: transportFor(s.fetch) });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    s.answer("u_1", "m_2", "hello");
    s.suggest("u_1", []);
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.getSnapshot().state.suggestions).toBeNull();
    const after = s.polls();
    await vi.advanceTimersByTimeAsync(60000);
    expect(s.polls()).toBe(after);
    store.stop();
  });

  it("a snapshot jump that already carries them ends the window", async () => {
    const s = serverLog();
    s.startTurn("u_1", "m_1", "hi");
    const store = createThreadStore({ transport: transportFor(s.fetch) });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    s.answer("u_1", "m_2", "hello");
    await vi.advanceTimersByTimeAsync(1500);
    const jumped = JSON.parse(JSON.stringify(store.getSnapshot().state)) as Record<string, unknown> & { lastSeq: number };
    const seq = jumped.lastSeq + 1;
    jumped.lastSeq = seq;
    jumped.suggestions = { turnId: "u_1", items: [{ id: "more", text: "Tell me more" }] };
    store.ingest([{ v: 1, seq, threadId: "t_1", at: new Date().toISOString(), type: "thread.snapshot", actor: system, data: { snapshot: jumped } } as ChatEvent]);
    expect(store.getSnapshot().state.suggestions?.turnId).toBe("u_1");
    const after = s.polls();
    await vi.advanceTimersByTimeAsync(60000);
    expect(s.polls()).toBeLessThanOrEqual(after + 1);
    store.stop();
  });

  it("suggestionsMs is configurable: a shorter window ends sooner, and 0 turns it off", async () => {
    const short = serverLog();
    short.startTurn("u_1", "m_1", "hi");
    const a = createThreadStore({ transport: transportFor(short.fetch, { suggestionsMs: 5000 }) });
    a.start();
    await vi.advanceTimersByTimeAsync(0);
    short.answer("u_1", "m_2", "hello");
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(5000);
    const atBound = short.polls();
    short.suggest("u_1");
    await vi.advanceTimersByTimeAsync(60000);
    expect(short.polls()).toBe(atBound);
    expect(a.getSnapshot().state.suggestions).toBeNull();
    a.stop();

    const off = serverLog();
    off.startTurn("u_1", "m_1", "hi");
    const b = createThreadStore({ transport: transportFor(off.fetch, { suggestionsMs: 0 }) });
    b.start();
    await vi.advanceTimersByTimeAsync(0);
    off.answer("u_1", "m_2", "hello");
    await vi.advanceTimersByTimeAsync(1500);
    const atSettle = off.polls();
    await vi.advanceTimersByTimeAsync(60000);
    expect(off.polls()).toBe(atSettle);
    b.stop();
  });

  it("no window after a turn that did not complete (failed, cancelled): none are ever generated", async () => {
    for (const action of ["fail", "cancel"]) {
      const s = serverLog();
      s.startTurn("u_1", "m_1", "hi");
      const store = createThreadStore({ transport: transportFor(s.fetch) });
      store.start();
      await vi.advanceTimersByTimeAsync(0);
      if (action === "cancel") s.push("turn.transition", { turnId: "u_1", action: "cancel" });
      s.push("turn.settled", { turnId: "u_1", action: action === "cancel" ? "cancelled" : "fail" });
      await vi.advanceTimersByTimeAsync(1500);
      expect(store.getSnapshot().state.turns[0]?.state).toBe("settled");
      expect(store.getSnapshot().state.turns[0]?.outcome).not.toBe("completed");
      const atSettle = s.polls();
      await vi.advanceTimersByTimeAsync(60000);
      expect(s.polls()).toBe(atSettle);
      store.stop();
    }
  });

  it("loading a thread whose last turn completed long ago opens no window", async () => {
    const s = serverLog();
    const old = "2026-11-20T09:00:00.000Z";
    s.push("turn.started", { turnId: "u_1" }, system, old);
    s.push("turn.transition", { turnId: "u_1", action: "start" }, system, old);
    s.push("message.created", { turnId: "u_1", message: { id: "m_2", role: "assistant", parts: [{ id: "p", kind: "text", format: "plain", text: "hello" }] } }, agent, old);
    s.push("turn.settled", { turnId: "u_1", action: "finish" }, system, old);
    const store = createThreadStore({ transport: transportFor(s.fetch) });
    store.start();
    await vi.advanceTimersByTimeAsync(60000);
    expect(s.polls()).toBe(1);
    store.stop();
  });

  it("loading a thread whose last turn completed seconds ago waits out the rest of the window", async () => {
    const s = serverLog();
    const recent = new Date(Date.now() - 3000).toISOString();
    s.push("turn.started", { turnId: "u_1" }, system, recent);
    s.push("turn.transition", { turnId: "u_1", action: "start" }, system, recent);
    s.push("message.created", { turnId: "u_1", message: { id: "m_2", role: "assistant", parts: [{ id: "p", kind: "text", format: "plain", text: "hello" }] } }, agent, recent);
    s.push("turn.settled", { turnId: "u_1", action: "finish" }, system, recent);
    const store = createThreadStore({ transport: transportFor(s.fetch) });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(6000);
    s.suggest("u_1");
    await vi.advanceTimersByTimeAsync(6000); // 15 s after the settle's own time
    expect(store.getSnapshot().state.suggestions?.turnId).toBe("u_1");
    const done = s.polls();
    await vi.advanceTimersByTimeAsync(60000);
    expect(s.polls()).toBe(done);
    store.stop();
  });

  it("the next running turn: old chips never return, and the new turn's quick replies arrive after it settles", async () => {
    const s = serverLog();
    s.startTurn("u_1", "m_1", "hi");
    render(<Chat transport={transportFor(s.fetch)} />);
    await flush();
    s.answer("u_1", "m_2", "first answer");
    await advance(1500);

    // Inside the first window, another tab starts the next turn.
    s.startTurn("u_2", "m_3", "and then?");
    await advance(2250);
    // The first turn's late quick replies land after the next turn started: illegal,
    // dropped, and never shown.
    s.suggest("u_1");
    await advance(4000);
    expect(document.querySelector("[data-fancy-chat-suggestions]")).toBeNull();

    s.answer("u_2", "m_4", "second answer");
    await advance(10000);
    expect(document.body.textContent).toContain("second answer");
    s.push("suggestions.updated", { turnId: "u_2", items: [{ id: "next", text: "Go on" }] });
    await advance(15000);
    expect(chip("next")).not.toBeNull();
    expect(chip("more")).toBeNull();
  });

  it("an open host decision state (suggestionsHidden) still fetches them; closing it shows them with no further poll", async () => {
    const s = serverLog();
    s.startTurn("u_1", "m_1", "hi");
    let setHidden: (h: boolean) => void = () => {};
    const transport = transportFor(s.fetch);
    function Host() {
      const [hidden, set] = useState(true);
      setHidden = set;
      return <Chat transport={transport} hidden={hidden} />;
    }
    render(<Host />);
    await flush();
    s.answer("u_1", "m_2", "hello");
    await advance(1500);
    await advance(3000);
    s.suggest("u_1");
    await advance(15000);
    expect(document.querySelector("[data-fancy-chat-suggestions]")).toBeNull();
    const polled = s.polls();
    await advance(120000);
    expect(s.polls()).toBe(polled);

    act(() => setHidden(false));
    expect(chip("more")).not.toBeNull();
    expect(s.polls()).toBe(polled);
  });
});
