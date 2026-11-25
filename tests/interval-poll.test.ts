import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "@particle-academy/fancy-chat-js";

import { createHttpTransport, createThreadStore } from "../src/index";

/*
 * `mode: "interval"`, for a host with ONE PHP worker: a long-poll or an SSE
 * stream holds that worker for its whole wait, so nothing else is served. This
 * mode sends short polls (`wait=0`), only while a turn runs (plus a grace period
 * after any action), backs off on errors and on empty answers, and pauses while
 * the tab is hidden. Every number is configurable.
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ev = (seq: number, type: string, data: Record<string, unknown> = {}): ChatEvent =>
  ({ v: 1, seq, threadId: "t_1", at: "2026-11-15T10:00:00.000Z", type, actor: { kind: "system", id: "s" }, data }) as ChatEvent;

let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
});
afterEach(() => {
  vi.useRealTimers();
});
const setHidden = (h: boolean) => {
  hidden = h;
  document.dispatchEvent(new Event("visibilitychange"));
};
const polls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.filter(([u]) => String(u).includes("/events/poll")).map(([u]) => String(u));

function server(script: (n: number, after: number) => ChatEvent[] | Error) {
  let n = 0;
  return vi.fn(async (url: string) => {
    if (url.includes("/events/poll")) {
      const after = Number(new URL(url, "http://h").searchParams.get("after"));
      const r = script(n++, after);
      if (r instanceof Error) return json({ error: "busy" }, 503);
      return json({ events: r, next: after + r.length });
    }
    if (url.endsWith("/messages")) return json({ messageId: "m_1", seq: 1, delivery: "sent" }, 201);
    return json({});
  });
}

describe('createHttpTransport mode: "interval"', () => {
  it("polls once on start with wait=0 (never holds the worker), then stops while nothing runs", async () => {
    const fetch = server(() => []);
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval" });
    const store = createThreadStore({ transport: t });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(polls(fetch)).toEqual(["/c/threads/t_1/events/poll?after=0&wait=0"]);
    await vi.advanceTimersByTimeAsync(120000);
    expect(polls(fetch)).toHaveLength(1);
    store.stop();
  });

  // The quick-reply window after a `completed` settle is covered in
  // interval-late-quick-replies.test.tsx; here it is off, to pin the settle itself.
  it("keeps polling while a turn runs, at activeMs, and stops once it settles (quick-reply window off)", async () => {
    const fetch = server((n) =>
      n === 0 ? [ev(1, "turn.started", { turnId: "u_1" }), ev(2, "turn.transition", { turnId: "u_1", action: "start" })] : n === 3 ? [ev(3, "turn.settled", { turnId: "u_1", action: "finish" })] : [],
    );
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval", interval: { activeMs: 1000, emptyBackoff: 1, graceMs: 0, suggestionsMs: 0 } });
    const store = createThreadStore({ transport: t });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(polls(fetch)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(polls(fetch)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(polls(fetch)).toHaveLength(4);
    expect(store.getSnapshot().state.turns[0]?.state).toBe("settled");
    await vi.advanceTimersByTimeAsync(60000);
    expect(polls(fetch)).toHaveLength(4);
    store.stop();
  });

  it("an action wakes it, and it polls through the grace period even before the turn shows", async () => {
    const fetch = server(() => []);
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval", interval: { activeMs: 1000, graceMs: 3000, emptyBackoff: 1 } });
    const store = createThreadStore({ transport: t });
    store.start();
    await vi.advanceTimersByTimeAsync(5000);
    const before = polls(fetch).length;
    await t.send({ parts: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(polls(fetch).length).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(polls(fetch).length).toBe(before + 4);
    await vi.advanceTimersByTimeAsync(30000);
    expect(polls(fetch).length).toBe(before + 4);
    store.stop();
  });

  it("backs off on errors, doubling up to maxBackoffMs, and resets on success", async () => {
    const fetch = server((n) => (n >= 1 && n <= 4 ? new Error("503") : n === 0 ? [ev(1, "turn.started", { turnId: "u_1" })] : []));
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval", interval: { activeMs: 1000, maxBackoffMs: 4000, emptyBackoff: 1, graceMs: 0 } });
    const store = createThreadStore({ transport: t });
    store.start();
    await vi.advanceTimersByTimeAsync(0); // poll 1: ok, turn running
    await vi.advanceTimersByTimeAsync(1000); // poll 2: error -> next in 2000
    expect(polls(fetch)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(polls(fetch)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); // poll 3: error -> 4000
    await vi.advanceTimersByTimeAsync(4000); // poll 4: error -> 4000 (capped)
    expect(polls(fetch)).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(4000); // poll 5: error -> 4000
    await vi.advanceTimersByTimeAsync(4000); // poll 6: ok -> back to 1000
    expect(polls(fetch)).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(1000);
    expect(polls(fetch)).toHaveLength(7);
    store.stop();
  });

  it("backs off on empty answers while a turn runs, up to maxActiveMs", async () => {
    const fetch = server((n) => (n === 0 ? [ev(1, "turn.started", { turnId: "u_1" })] : []));
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval", interval: { activeMs: 1000, emptyBackoff: 2, maxActiveMs: 3000, graceMs: 0 } });
    const store = createThreadStore({ transport: t });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000); // poll 2 (empty) -> 2000
    await vi.advanceTimersByTimeAsync(2000); // poll 3 (empty) -> 3000 (capped from 4000)
    expect(polls(fetch)).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(2999);
    expect(polls(fetch)).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(polls(fetch)).toHaveLength(4);
    store.stop();
  });

  it("a turn parked on a human is not running: polling stops until the human acts", async () => {
    const fetch = server((n) =>
      n === 0
        ? [ev(1, "turn.started", { turnId: "u_1" }), ev(2, "turn.transition", { turnId: "u_1", action: "start" }), ev(3, "turn.transition", { turnId: "u_1", action: "park" })]
        : [],
    );
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval", interval: { activeMs: 1000, emptyBackoff: 1, graceMs: 0 } });
    const store = createThreadStore({ transport: t });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().state.turns[0]?.state).toBe("awaiting-human");
    await vi.advanceTimersByTimeAsync(60000);
    expect(polls(fetch)).toHaveLength(1);
    store.stop();
  });

  it("pauses while the tab is hidden and catches up at once when it is shown", async () => {
    const fetch = server((n) => (n === 0 ? [ev(1, "turn.started", { turnId: "u_1" })] : []));
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval", interval: { activeMs: 1000, emptyBackoff: 1, graceMs: 0 } });
    const store = createThreadStore({ transport: t });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(polls(fetch)).toHaveLength(1);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(polls(fetch)).toHaveLength(2);
    store.stop();
  });

  it("pauseWhenHidden: false keeps polling in a hidden tab", async () => {
    const fetch = server((n) => (n === 0 ? [ev(1, "turn.started", { turnId: "u_1" })] : []));
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval", interval: { activeMs: 1000, emptyBackoff: 1, graceMs: 0, pauseWhenHidden: false } });
    const store = createThreadStore({ transport: t });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    setHidden(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(polls(fetch)).toHaveLength(4);
    store.stop();
  });

  it("idleMs polls slowly while nothing runs, when the host asks for it", async () => {
    const fetch = server(() => []);
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval", interval: { idleMs: 10000, graceMs: 0 } });
    const store = createThreadStore({ transport: t });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(20000);
    expect(polls(fetch)).toHaveLength(3);
    store.stop();
  });

  it("stop ends it: no poll after unsubscribe, even on a wake", async () => {
    const fetch = server((n) => (n === 0 ? [ev(1, "turn.started", { turnId: "u_1" })] : []));
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval", interval: { activeMs: 1000 } });
    const store = createThreadStore({ transport: t });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    store.stop();
    await t.send({ parts: [] });
    await vi.advanceTimersByTimeAsync(60000);
    expect(polls(fetch)).toHaveLength(1);
  });
});
