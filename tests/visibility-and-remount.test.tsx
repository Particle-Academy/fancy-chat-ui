import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMemo, useState, type ReactNode } from "react";
import { projectThread, type ChatEvent, type ThreadState } from "@particle-academy/fancy-chat-js";

import { AgentThread, createHttpTransport, useAgentThread } from "../src/index";
import { ev, jsonResponse, streamedMessage } from "./helpers";

/*
 * Interval mode in an open thread, across the two things a real page does that a
 * plain multi-poll test does not: the tab is hidden or loses focus, and an
 * Inertia visit or partial reload remounts the thread (or re-renders it with
 * fresh page props). Each test drives a server whose log grows while the page is
 * away, and asserts the open thread catches up FROM ITS CURSOR, with no
 * duplicates and no remount beyond the one the scenario itself makes.
 */

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const all = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];

let hidden = false;
const setHidden = (h: boolean) => {
  hidden = h;
  document.dispatchEvent(new Event("visibilitychange"));
};

/** A server with a growing log: every poll returns what is after its cursor. */
function server() {
  const log: ChatEvent[] = [];
  const afters: number[] = [];
  const fetch = vi.fn(async (url: string) => {
    if (url.includes("/events/poll")) {
      const after = Number(new URL(url, "http://h").searchParams.get("after"));
      afters.push(after);
      const events = log.filter((e) => e.seq > after);
      return jsonResponse({ events, next: events.length ? events[events.length - 1]!.seq : after });
    }
    if (url.endsWith("/messages")) return jsonResponse({ messageId: "m_x", seq: 1, delivery: "sent" }, 201);
    return jsonResponse({});
  });
  return { log, afters, fetch, polls: () => afters.length };
}

const userMessage = (seq: number, id: string, text: string): ChatEvent =>
  ev(seq, "message.created", { message: { id, role: "user", parts: [{ id: "p", kind: "text", format: "plain", text }], delivery: "sent" } }, { actor: { kind: "human", id: "u_1" } });
const approvalRequested = (seq: number, approvalId: string): ChatEvent =>
  ev(seq, "approval.requested", { approval: { approvalId, title: "Send?", summary: "", preview: [], options: [{ id: "o1", kind: "allow-once", label: "Send" }], state: "pending" } }, { actor: { kind: "system", id: "server" } });
const opening = (): ChatEvent[] => [userMessage(1, "m_1", "Find Acme"), ev(2, "turn.started", { turnId: "u_1", messageId: "m_1" }), ev(3, "turn.transition", { turnId: "u_1", action: "start" })];
const reply = (): ChatEvent[] => streamedMessage(4, "m_2", ["Acme ", "is **won**."]); // seq 4..7

let mounts = 0;
function Thread({ fetch, threadId, initial, interval }: { fetch: unknown; threadId: string; initial?: ThreadState; interval?: Record<string, unknown> }): ReactNode {
  // As the README wires it: the transport memoised on the thread id.
  const transport = useMemo(
    () => createHttpTransport({ baseUrl: "/c", threadId, fetch: fetch as never, mode: "interval", interval: { activeMs: 1000, emptyBackoff: 1, graceMs: 0, ...interval } }),
    [threadId, fetch],
  );
  const chat = useAgentThread({ transport, ...(initial ? { initial } : {}) });
  const [follow, setFollow] = useState(true);
  const [mount] = useState(() => ++mounts);
  return (
    <div data-mount={mount} data-last-seq={chat.lastSeq} data-connection={chat.connection}>
      <AgentThread rows={chat.rows} state={chat.state} follow={follow} onFollowChange={setFollow} height={600} chat={chat} onDecide={chat.decide} />
    </div>
  );
}
const lastSeq = () => Number(el("[data-last-seq]")?.getAttribute("data-last-seq"));
const messageIds = () => all("[data-fancy-chat-message]").map((m) => m.getAttribute("data-fancy-chat-message"));

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  mounts = 0;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
});
afterEach(() => vi.useRealTimers());

describe("(1) hidden or unfocused tab", () => {
  it("hidden mid-turn: no polls while hidden; shown again, it catches up from its cursor and renders", async () => {
    const s = server();
    s.log.push(...opening());
    render(<Thread fetch={s.fetch} threadId="t_1" />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(lastSeq()).toBe(3);

    setHidden(true);
    await act(() => vi.advanceTimersByTimeAsync(1000)); // the scheduled tick sees hidden and parks
    const parkedAt = s.polls();
    s.log.push(...reply(), approvalRequested(8, "ap_1"));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(s.polls()).toBe(parkedAt);
    expect(el("[data-connection]")?.getAttribute("data-connection")).toBe("paused");

    await act(async () => setHidden(false));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(s.afters[s.afters.length - 1]).toBe(3);
    expect(lastSeq()).toBe(8);
    expect(el('[data-fancy-chat-message="m_2"] [data-chat-content]')?.textContent).toContain("won");
    expect(el('[data-fancy-chat-approval="ap_1"]')?.getAttribute("data-fancy-chat-approval-actionable")).toBe("true");
    expect(messageIds()).toEqual(["m_1", "m_2"]);
    expect(mounts).toBe(1);
  });

  it("hidden while a poll is in flight: that poll still lands, and the next tick parks then resumes", async () => {
    const s = server();
    s.log.push(...opening());
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = vi.fn(async (url: string) => {
      if (url.includes("/events/poll") && s.polls() === 1) await gate;
      return s.fetch(url);
    });
    render(<Thread fetch={slow} threadId="t_1" />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(1000)); // poll 2 starts and hangs
    s.log.push(...reply());
    setHidden(true);
    await act(async () => release());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(lastSeq()).toBe(7);
    s.log.push(approvalRequested(8, "ap_1"));
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(lastSeq()).toBe(7);
    await act(async () => setHidden(false));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(lastSeq()).toBe(8);
    expect(el('[data-fancy-chat-approval="ap_1"]')).not.toBeNull();
  });

  it("hidden and shown before the next tick: polling carries on (no double loop, no stall)", async () => {
    const s = server();
    s.log.push(...opening());
    render(<Thread fetch={s.fetch} threadId="t_1" />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    setHidden(true);
    setHidden(false);
    s.log.push(...reply());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(lastSeq()).toBe(7);
    const n = s.polls();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(s.polls()).toBe(n + 3); // one loop at activeMs, not two
  });

  it("losing focus (blur) with the tab still visible does not pause polling", async () => {
    const s = server();
    s.log.push(...opening());
    render(<Thread fetch={s.fetch} threadId="t_1" />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    window.dispatchEvent(new Event("blur"));
    s.log.push(...reply(), approvalRequested(8, "ap_1"));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(lastSeq()).toBe(8);
    window.dispatchEvent(new Event("focus"));
    expect(el('[data-fancy-chat-approval="ap_1"]')?.getAttribute("data-fancy-chat-approval-actionable")).toBe("true");
  });

  it("a turn parked on a human while hidden: shown again, the pending approval is there and actionable", async () => {
    const s = server();
    s.log.push(...opening());
    render(<Thread fetch={s.fetch} threadId="t_1" />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    setHidden(true);
    s.log.push(...reply(), approvalRequested(8, "ap_1"), ev(9, "turn.transition", { turnId: "u_1", action: "park" }));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await act(async () => setHidden(false));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(lastSeq()).toBe(9);
    expect(el('[data-fancy-chat-approval="ap_1"]')?.getAttribute("data-fancy-chat-approval-actionable")).toBe("true");
  });
});

describe("(2) Inertia visits and partial reloads", () => {
  it("remount with a STALE initial snapshot (history/memory restore): it resumes from that cursor, no duplicates", async () => {
    const s = server();
    s.log.push(...opening());
    const stale = projectThread(opening()).state; // the page props as first served: seq 3
    const { unmount } = render(<Thread fetch={s.fetch} threadId="t_1" initial={stale} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(s.afters[0]).toBe(3);
    unmount(); // an Inertia visit away

    s.log.push(...reply(), approvalRequested(8, "ap_1"), ev(9, "turn.transition", { turnId: "u_1", action: "park" }));
    render(<Thread fetch={s.fetch} threadId="t_1" initial={stale} />); // back, props restored from memory
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(s.afters[s.afters.length - 1]).toBe(3);
    expect(lastSeq()).toBe(9);
    expect(messageIds()).toEqual(["m_1", "m_2"]);
    expect(all('[data-fancy-chat-approval="ap_1"]')).toHaveLength(1);
    expect(el('[data-fancy-chat-approval="ap_1"]')?.getAttribute("data-fancy-chat-approval-actionable")).toBe("true");
  });

  it("partial reload: fresh page props for the SAME thread keep the live store (no reset to the props, no duplicates)", async () => {
    const s = server();
    s.log.push(...opening());
    const { rerender } = render(<Thread fetch={s.fetch} threadId="t_1" initial={projectThread(opening()).state} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    s.log.push(...reply());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(lastSeq()).toBe(7);
    // The reload's props are OLDER than what the store has applied.
    rerender(<Thread fetch={s.fetch} threadId="t_1" initial={projectThread(opening()).state} />);
    s.log.push(approvalRequested(8, "ap_1"));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(lastSeq()).toBe(8);
    expect(messageIds()).toEqual(["m_1", "m_2"]);
    expect(el('[data-fancy-chat-approval="ap_1"]')?.getAttribute("data-fancy-chat-approval-actionable")).toBe("true");
    expect(mounts).toBe(1);
  });

  it("a visit to ANOTHER thread and back: each store polls its own thread from its own cursor", async () => {
    const s = server();
    s.log.push(...opening());
    const { rerender } = render(<Thread fetch={s.fetch} threadId="t_1" />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    rerender(<Thread fetch={s.fetch} threadId="t_2" />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    const toT2 = s.fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.includes("/threads/t_2/"));
    expect(toT2.length).toBeGreaterThan(0);
    s.log.push(...reply());
    rerender(<Thread fetch={s.fetch} threadId="t_1" />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(lastSeq()).toBe(7);
    expect(messageIds()).toEqual(["m_1", "m_2"]);
  });
});
