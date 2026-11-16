import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMemo, useState, type ReactNode } from "react";
import { projectThread, type ChatEvent, type ThreadState } from "@particle-academy/fancy-chat-js";

import { AgentThread, createHttpTransport, createThreadStore, useAgentThread, type ChatTransport } from "../src/index";
import { ev, FakeEventSource, jsonResponse } from "./helpers";

// A reducer that throws on one marked event: what fancy-chat-js 0.1.0 (inside
// this package's peer range) does on a plan step that is null. Every other
// event goes to the real reducer.
vi.mock("@particle-academy/fancy-chat-js", async (importOriginal) => {
  const real = await importOriginal<typeof import("@particle-academy/fancy-chat-js")>();
  return {
    ...real,
    applyEvent: (state: ThreadState, event: ChatEvent) => {
      if ((event.data as { poison?: boolean } | undefined)?.poison) throw new TypeError("Cannot read properties of null (reading 'status')");
      return real.applyEvent(state, event);
    },
  };
});

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const messageIds = () => [...document.querySelectorAll("[data-fancy-chat-message]")].map((m) => m.getAttribute("data-fancy-chat-message"));

const userMessage = (seq: number, id: string, text: string): ChatEvent =>
  ev(seq, "message.created", { message: { id, role: "user", parts: [{ id: "p", kind: "text", format: "plain", text }], delivery: "sent" } }, { actor: { kind: "human", id: "u_1" } });
const approvalRequested = (seq: number, approvalId: string): ChatEvent =>
  ev(seq, "approval.requested", { approval: { approvalId, title: "Send?", summary: "", preview: [], options: [{ id: "o1", kind: "allow-once", label: "Send" }], state: "pending" } }, { actor: { kind: "system", id: "server" } });
const running = (): ChatEvent[] => [ev(1, "turn.started", { turnId: "u_1" }), ev(2, "turn.transition", { turnId: "u_1", action: "start" })];

/** A server with a growing log; `fail` makes the next polls answer that status. */
function server() {
  const log: ChatEvent[] = [];
  const afters: number[] = [];
  const state = { fail: 0 as number, failures: 0 };
  const fetch = vi.fn(async (url: string) => {
    if (!url.includes("/events/poll")) return jsonResponse({});
    const after = Number(new URL(url, "http://h").searchParams.get("after"));
    afters.push(after);
    if (state.failures > 0) {
      state.failures -= 1;
      return jsonResponse({ error: "busy" }, state.fail);
    }
    const events = log.filter((e) => e.seq > after);
    return jsonResponse({ events, next: events.length ? events[events.length - 1]!.seq : after });
  });
  return { log, afters, fetch, state };
}
const interval = (fetch: unknown) => createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval", interval: { activeMs: 1000, emptyBackoff: 1, graceMs: 0, maxBackoffMs: 1000 } });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe("an event the reducer cannot apply never stalls the thread", () => {
  it("is skipped and counted; the rest of the batch applies, the cursor moves past it, and the batch is not retried", async () => {
    const s = server();
    s.log.push(...running(), ev(3, "plan.updated", { steps: [null], poison: true }, { runId: "r_1" }), userMessage(4, "m_1", "after the bad one"));
    const store = createThreadStore({ transport: interval(s.fetch) });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().lastSeq).toBe(4);
    expect(store.getSnapshot().rows.map((r) => r.id)).toEqual(["m_1"]);
    expect(store.getSnapshot().dropped).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.afters).toEqual([0, 4]);
    store.stop();
  });

  it("warns once per store, naming the event, however many it refuses", async () => {
    const s = server();
    s.log.push(...running(), ev(3, "plan.updated", { steps: [null], poison: true }, { runId: "r_1" }), ev(4, "plan.updated", { steps: [null], poison: true }, { runId: "r_1" }));
    const store = createThreadStore({ transport: interval(s.fetch) });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    const refusals = warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("refused"));
    expect(refusals).toHaveLength(1);
    expect(String(refusals[0]![0])).toContain("seq 3");
    expect(String(refusals[0]![0])).toContain("plan.updated");
    store.stop();
  });

  it("an event the contract calls illegal is refused, counted and warned about once too", async () => {
    const s = server();
    // A transition for a turn that does not exist: illegal per the contract.
    s.log.push(...running(), ev(3, "turn.transition", { turnId: "u_missing", action: "start" }), userMessage(4, "m_1", "still here"));
    const store = createThreadStore({ transport: interval(s.fetch) });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().lastSeq).toBe(4);
    expect(store.getSnapshot().dropped).toBe(1);
    expect(warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("refused"))).toHaveLength(1);
    store.stop();
  });
});

describe("snapshot.error clears once a later request succeeds", () => {
  it("interval: a failed poll sets it, the next successful poll clears it", async () => {
    const s = server();
    s.log.push(...running());
    const store = createThreadStore({ transport: interval(s.fetch) });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    s.state.fail = 503;
    s.state.failures = 1;
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().error).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot().error).toBeNull();
    store.stop();
  });

  it("long-poll: cleared by the next successful poll", async () => {
    const s = server();
    s.state.fail = 401;
    s.state.failures = 1;
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: s.fetch as never, mode: "poll", retryMs: 100, minPollGapMs: 1000 });
    const store = createThreadStore({ transport: t });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().error).not.toBeNull();
    await vi.advanceTimersByTimeAsync(150);
    expect(store.getSnapshot().error).toBeNull();
    store.stop();
  });

  it("SSE: cleared when the stream opens again", async () => {
    FakeEventSource.reset();
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: vi.fn(async () => jsonResponse({})) as never, EventSource: FakeEventSource as never, mode: "sse", retryMs: 100 });
    const store = createThreadStore({ transport: t });
    store.start();
    FakeEventSource.last().fail();
    expect(store.getSnapshot().error).not.toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    FakeEventSource.last().open();
    expect(store.getSnapshot().error).toBeNull();
    store.stop();
  });

  it("gap repair: a failed fetchAfter sets it, a successful one clears it", async () => {
    let push: (e: ChatEvent[]) => void = () => {};
    let fail = true;
    const transport = {
      subscribe: (h: { onEvents: (e: ChatEvent[]) => void }) => {
        push = h.onEvents;
        return () => {};
      },
      fetchAfter: vi.fn(async () => {
        if (fail) throw new Error("HTTP 503");
        return { events: [ev(2, "turn.transition", { turnId: "u_1", action: "start" })], next: 2 };
      }),
    } as unknown as ChatTransport;
    const store = createThreadStore({ transport });
    store.start();
    push([ev(1, "turn.started", { turnId: "u_1" }), ev(3, "turn.transition", { turnId: "u_1", action: "park" })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().error).not.toBeNull();
    fail = false;
    push([ev(4, "usage", {})]); // still behind the gap: repair again
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().lastSeq).toBe(4);
    expect(store.getSnapshot().error).toBeNull();
    store.stop();
  });
});

describe("newer page props for the same thread are taken; older ones are not", () => {
  let mounts = 0;
  function Thread({ fetch, initial }: { fetch: unknown; initial: ThreadState }): ReactNode {
    const transport = useMemo(() => interval(fetch), [fetch]);
    const chat = useAgentThread({ transport, initial });
    const [follow, setFollow] = useState(true);
    const [mount] = useState(() => ++mounts);
    return (
      <div data-mount={mount} data-last-seq={chat.lastSeq}>
        <AgentThread rows={chat.rows} state={chat.state} follow={follow} onFollowChange={setFollow} height={600} onDecide={chat.decide} />
      </div>
    );
  }
  const lastSeq = () => Number(el("[data-last-seq]")?.getAttribute("data-last-seq"));
  beforeEach(() => {
    mounts = 0;
  });

  it("a parked thread takes an Inertia reload's props that are AHEAD of it, without a remount", async () => {
    const s = server();
    s.log.push(...running(), approvalRequested(3, "ap_1"), ev(4, "turn.transition", { turnId: "u_1", action: "park" }));
    const { rerender } = render(<Thread fetch={s.fetch} initial={projectThread(s.log).state} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(lastSeq()).toBe(4);
    // Decided in another tab; the turn resumes and answers. This tab is parked, so it polls nothing.
    s.log.push(
      ev(5, "approval.decided", { approvalId: "ap_1", optionId: "o1", decision: "approve", decidedBy: { kind: "human", id: "u_1" } }, { actor: { kind: "human", id: "u_1" } }),
      userMessage(6, "m_9", "from the other tab"),
    );
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(lastSeq()).toBe(4);
    rerender(<Thread fetch={s.fetch} initial={projectThread(s.log).state} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(lastSeq()).toBe(6);
    expect(el('[data-fancy-chat-approval="ap_1"]')?.getAttribute("data-fancy-chat-approval-state")).toBe("approved");
    expect(messageIds()).toEqual(["m_9"]);
    expect(mounts).toBe(1);
  });

  it("props BEHIND the store are ignored: nothing it applied is rolled back", async () => {
    const s = server();
    s.log.push(...running());
    const stale = projectThread(s.log).state;
    const { rerender } = render(<Thread fetch={s.fetch} initial={stale} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    s.log.push(userMessage(3, "m_1", "live"));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(lastSeq()).toBe(3);
    rerender(<Thread fetch={s.fetch} initial={projectThread(running()).state} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(lastSeq()).toBe(3);
    expect(messageIds()).toEqual(["m_1"]);
  });

  it("props at the SAME seq change nothing (the first render's own props included)", async () => {
    const s = server();
    s.log.push(...running(), userMessage(3, "m_1", "hi"));
    const initial = projectThread(s.log).state;
    const { rerender } = render(<Thread fetch={s.fetch} initial={initial} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    const before = el("[data-last-seq]")?.outerHTML;
    rerender(<Thread fetch={s.fetch} initial={projectThread(s.log).state} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(el("[data-last-seq]")?.outerHTML).toBe(before);
  });
});
