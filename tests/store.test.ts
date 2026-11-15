import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHttpTransport, createThreadStore, type ChatTransport } from "../src/index";
import { ev, FakeEventSource, flush, jsonResponse, streamedMessage } from "./helpers";

const source = [ev(1, "turn.started", { turnId: "u_1" }), ev(2, "turn.transition", { turnId: "u_1", action: "start" }), ...streamedMessage(3, "m_1", ["Hello", " there", "."])];

describe("createHttpTransport", () => {
  beforeEach(() => FakeEventSource.reset());

  it("trims trailing slashes from baseUrl in linear time (code scanning #1)", () => {
    // Slashes NOT at the end: a /\/+$/ regex retries from every one, which is quadratic.
    const hostile = "/".repeat(100000) + "x";
    const started = performance.now();
    const t = createHttpTransport({ baseUrl: hostile + "///", threadId: "t_1", EventSource: FakeEventSource as never, fetch: vi.fn() as never });
    expect(performance.now() - started).toBeLessThan(250);
    const stop = t.subscribe({ after: () => 0, onEvents: () => {} });
    expect(FakeEventSource.last().url).toBe(`${hostile}/threads/t_1/events?after=0`);
    stop();
    createHttpTransport({ baseUrl: "/chat//", threadId: "t", EventSource: FakeEventSource as never, fetch: vi.fn() as never }).subscribe({ after: () => 0, onEvents: () => {} });
    expect(FakeEventSource.last().url).toBe("/chat/threads/t/events?after=0");
  });

  it("opens SSE resuming after the cursor, and closes on unsubscribe", () => {
    const t = createHttpTransport({ baseUrl: "/chat", threadId: "t 1", EventSource: FakeEventSource as never, fetch: vi.fn() as never });
    const stop = t.subscribe({ after: () => 7, onEvents: () => {} });
    expect(FakeEventSource.last().url).toBe("/chat/threads/t%201/events?after=7");
    stop();
    expect(FakeEventSource.last().closed).toBe(true);
  });

  it("falls back to long-poll when SSE fails before delivering anything", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("/events/poll")) return jsonResponse({ events: [], next: 0 });
      return jsonResponse({});
    });
    const modes: string[] = [];
    const t = createHttpTransport({
      baseUrl: "/chat",
      threadId: "t_1",
      EventSource: FakeEventSource as never,
      fetch: fetch as never,
      retryMs: 0,
      sseFailuresBeforePoll: 2,
      pollWaitMs: 5000,
    });
    const stop = t.subscribe({ after: () => 0, onEvents: () => {}, onMode: (m) => modes.push(m) });
    FakeEventSource.last().fail();
    await flush();
    FakeEventSource.last().fail();
    await flush();
    await flush();
    expect(modes).toContain("poll");
    expect(fetch.mock.calls.some(([u]) => String(u) === "/chat/threads/t_1/events/poll?after=0&wait=5000")).toBe(true);
    stop();
  });

  it("keeps SSE once it has delivered an event, reconnecting from the cursor", async () => {
    let cursor = 0;
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", EventSource: FakeEventSource as never, fetch: vi.fn() as never, retryMs: 0 });
    const modes: string[] = [];
    const stop = t.subscribe({
      after: () => cursor,
      onEvents: (events) => {
        cursor = events[events.length - 1]!.seq;
      },
      onMode: (m) => modes.push(m),
    });
    FakeEventSource.last().emit(source.slice(0, 2));
    for (let i = 0; i < 4; i += 1) {
      FakeEventSource.last().fail();
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(modes).not.toContain("poll");
    expect(FakeEventSource.last().url).toBe("/c/threads/t_1/events?after=2");
    stop();
  });

  it("posts messages and human decisions with the host's headers, never an actor", async () => {
    const fetch = vi.fn(async () => jsonResponse({ messageId: "m_9", seq: 12, delivery: "sent" }));
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, EventSource: FakeEventSource as never, headers: () => ({ "X-CSRF-TOKEN": "tok" }) });
    await t.send({ parts: [{ id: "p", kind: "text", format: "plain", text: "hi" }] });
    await t.decide("ap_1", { optionId: "o1", note: "ok" });
    await t.answer("q_1", { values: { f: "x" }, notes: {} });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/c/threads/t_1/messages");
    expect((init.headers as Record<string, string>)["X-CSRF-TOKEN"]).toBe("tok");
    const decision = JSON.parse(String((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(decision).toEqual({ optionId: "o1", note: "ok" });
    expect(Object.keys(decision)).not.toContain("actor");
    expect((fetch.mock.calls[1] as unknown as [string])[0]).toBe("/c/approvals/ap_1/decision");
    expect((fetch.mock.calls[2] as unknown as [string])[0]).toBe("/c/questions/q_1/answer");
  });
});

/** An in-memory transport over a server-side log, with a lossy live channel. */
function memoryTransport(log: typeof source) {
  let push: ((e: typeof source) => void) | null = null;
  const fetchAfter = vi.fn(async (after: number) => ({ events: log.filter((e) => e.seq > after), next: log.length }));
  const t: ChatTransport = {
    subscribe: ({ onEvents }: { onEvents: (e: typeof source) => void }) => {
      push = onEvents;
      return () => {
        push = null;
      };
    },
    fetchAfter,
    send: vi.fn(),
    cancel: vi.fn(),
    unsend: vi.fn(),
    decide: vi.fn(),
    answer: vi.fn(),
  } as unknown as ChatTransport;
  return { t, live: (e: typeof source) => push?.(e), fetchAfter };
}

describe("createThreadStore", () => {
  afterEach(() => vi.useRealTimers());

  it("repairs a gap by re-requesting after the last applied seq", async () => {
    const m = memoryTransport(source);
    const store = createThreadStore({ transport: m.t });
    store.start();
    m.live([source[0]!, source[1]!, source[4]!, source[5]!]);
    await flush();
    await flush();
    expect(m.fetchAfter).toHaveBeenCalledWith(2);
    const snap = store.getSnapshot();
    expect(snap.lastSeq).toBe(source.length);
    const msg = snap.rows.find((r) => r.kind === "message");
    expect(msg && "parts" in msg ? msg.parts[0]?.text : null).toBe("Hello there.");
    store.stop();
  });

  it("dedupes a replayed batch and notifies subscribers once per change", async () => {
    const m = memoryTransport(source);
    const store = createThreadStore({ transport: m.t });
    const listener = vi.fn();
    store.subscribe(listener);
    store.start();
    m.live(source);
    m.live(source);
    await flush();
    expect(store.getSnapshot().lastSeq).toBe(source.length);
    expect(listener).toHaveBeenCalledTimes(1);
    store.stop();
  });

  it("a nudge with a newer seq fetches; an old or missed nudge costs nothing", async () => {
    const m = memoryTransport(source);
    let nudge: (seq: number) => void = () => {};
    const store = createThreadStore({
      transport: m.t,
      nudge: (cb) => {
        nudge = cb;
        return () => {};
      },
    });
    store.start();
    m.live(source.slice(0, 3));
    nudge(2);
    await flush();
    expect(m.fetchAfter).not.toHaveBeenCalled();
    nudge(source.length);
    await flush();
    await flush();
    expect(m.fetchAfter).toHaveBeenCalledWith(3);
    expect(store.getSnapshot().lastSeq).toBe(source.length);
    store.stop();
  });

  it("drops a cancelled turn's later events by turnId, never by timing", async () => {
    const log = [
      ev(1, "turn.started", { turnId: "u_1" }),
      ev(2, "turn.transition", { turnId: "u_1", action: "start" }),
      ev(3, "message.created", { turnId: "u_1", message: { id: "m_1", role: "assistant", parts: [] } }),
      ev(4, "turn.transition", { turnId: "u_1", action: "cancel" }),
      ev(5, "turn.settled", { turnId: "u_1", action: "cancelled" }),
      ev(6, "part.started", { messageId: "m_1", part: { id: "p", kind: "text", format: "plain", text: "late" } }, { turnId: "u_1" }),
    ];
    const m = memoryTransport(log);
    const store = createThreadStore({ transport: m.t });
    store.start();
    m.live(log);
    await flush();
    const msg = store.getSnapshot().rows.find((r) => r.kind === "message");
    expect(msg && "parts" in msg ? msg.parts : null).toEqual([]);
    expect(store.getSnapshot().lastSeq).toBe(6);
    store.stop();
  });
});
