import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "@particle-academy/fancy-chat-js";

import { createHttpTransport, createThreadStore } from "../src/index";
import { ev, FakeEventSource, jsonResponse } from "./helpers";

/*
 * A failing poll or stream must never be silent. Before this, a poll that came
 * back 401 or 419 (a session regenerated at login, an expired session) or never
 * came back (a network failure) set `snapshot.error`, which nothing renders, and
 * retried quietly forever; an SSE failure reported nothing at all. Now each
 * failure streak warns once on the console, naming the status, and SSE failures
 * reach `onError` like poll failures do. Retrying is unchanged.
 */

const turnRunning = (): ChatEvent[] => [ev(1, "turn.started", { turnId: "u_1" }), ev(2, "turn.transition", { turnId: "u_1", action: "start" })];

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
});

/** Poll n answers `script(n)`: events, an HTTP status, or a network failure. */
function server(script: (n: number) => ChatEvent[] | number | "network") {
  let n = 0;
  return vi.fn(async (url: string) => {
    if (!url.includes("/events/poll")) return jsonResponse({});
    const r = script(n++);
    if (r === "network") throw new TypeError("Failed to fetch");
    if (typeof r === "number") return jsonResponse({ message: r === 419 ? "CSRF token mismatch." : "Unauthenticated." }, r);
    const after = Number(new URL(url, "http://h").searchParams.get("after"));
    const events = r.filter((e) => e.seq > after);
    return jsonResponse({ events, next: events.length ? events[events.length - 1]!.seq : after });
  });
}
const warned = () => warn.mock.calls.map((c: unknown[]) => c.map(String).join(" "));

describe('mode "interval": a failing poll is not silent', () => {
  for (const status of [401, 419] as const) {
    it(`a ${status} warns once per failure streak, names the status, and still retries`, async () => {
      const fetch = server((n) => (n === 0 ? turnRunning() : n <= 3 ? status : n === 4 ? [] : status));
      const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval", interval: { activeMs: 1000, emptyBackoff: 1, graceMs: 0, maxBackoffMs: 1000 } });
      const store = createThreadStore({ transport: t });
      store.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(warn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(3000); // polls 1..3 fail
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warned()[0]).toContain(String(status));
      expect(warned()[0]).toContain("/c/threads/t_1/events/poll");
      expect(store.getSnapshot().connection).toBe("retrying");
      expect((store.getSnapshot().error as { status?: number }).status).toBe(status);
      await vi.advanceTimersByTimeAsync(1000); // poll 4 succeeds: the streak ends
      await vi.advanceTimersByTimeAsync(1000); // poll 5 fails again: a new streak warns again
      expect(warn).toHaveBeenCalledTimes(2);
      store.stop();
    });
  }

  it("a network failure warns too", async () => {
    const fetch = server((n) => (n === 0 ? turnRunning() : "network"));
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval", interval: { activeMs: 1000, emptyBackoff: 1, graceMs: 0 } });
    const store = createThreadStore({ transport: t });
    store.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warned()[0]).toContain("Failed to fetch");
    store.stop();
  });

  it("a stopped subscription does not warn about the request it aborted", async () => {
    const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval" });
    const store = createThreadStore({ transport: t });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    store.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('mode "poll": a failing long-poll is not silent', () => {
  it("a 401 warns once per streak and still retries", async () => {
    const fetch = server((n) => (n < 3 ? 401 : []));
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "poll", retryMs: 100, minPollGapMs: 1000 });
    const store = createThreadStore({ transport: t });
    store.start();
    await vi.advanceTimersByTimeAsync(350);
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warned()[0]).toContain("401");
    store.stop();
  });
});

describe("SSE: a failing stream is not silent", () => {
  beforeEach(() => FakeEventSource.reset());

  it("a stream error reaches onError and warns once per streak; it still reconnects", async () => {
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: vi.fn(async () => jsonResponse({})) as never, EventSource: FakeEventSource as never, mode: "sse", retryMs: 100 });
    const store = createThreadStore({ transport: t });
    store.start();
    FakeEventSource.last().fail();
    expect(store.getSnapshot().error).toBeInstanceOf(Error);
    expect(String((store.getSnapshot().error as Error).message)).toContain("/c/threads/t_1/events");
    expect(warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.last().fail();
    expect(warn).toHaveBeenCalledTimes(1); // the same streak
    await vi.advanceTimersByTimeAsync(100);
    const es = FakeEventSource.last();
    es.open(); // recovered
    es.fail();
    expect(warn).toHaveBeenCalledTimes(2);
    store.stop();
  });
});
