import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import type { ChatEvent } from "@particle-academy/fancy-chat-js";

import { AgentThread, createHttpTransport, defineSurfaceProfile, useAgentThread, type ChatTransport } from "../src/index";
import { ev, FakeEventSource, jsonResponse, streamedMessage } from "./helpers";

/*
 * The regression: an OPEN thread must render what a later poll (or SSE frame)
 * brings, without a remount or a reload. Each test mounts the thread ONCE and
 * then only lets the transport deliver, and counts the mounts, so a passing
 * assertion cannot come from a fresh mount reading the store again.
 *
 * What these caught: AgentThread memoised `actionableId` on the projected `state`
 * OBJECT. The store mutates that object in place (invariant 7), so its identity
 * never changes and the memo was computed once, when the thread opened. With a
 * stable `actionableKinds` (a surface profile's, or a module constant) nothing
 * else in the key moved either, so an approval that arrived on a later poll or
 * SSE frame rendered as "waiting", never actionable, until a remount rebuilt the
 * memo. Rows themselves always rendered; with no `actionableKinds` and no
 * profile the default array is new on every render, which hid the defect.
 */

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;

const compass = defineSurfaceProfile({ id: "compass", hitl: { actionable: ["approval", "question"] } });
const KINDS: ("approval" | "question")[] = ["approval"];

let mounts = 0;
function Thread({ transport, variant }: { transport: ChatTransport; variant: "profile" | "kinds" }): ReactNode {
  const chat = useAgentThread({ transport });
  const [follow, setFollow] = useState(true);
  const [mount] = useState(() => ++mounts);
  return (
    <div data-mount={mount}>
      <AgentThread
        rows={chat.rows}
        state={chat.state}
        follow={follow}
        onFollowChange={setFollow}
        height={600}
        chat={chat}
        onDecide={chat.decide}
        onAnswer={chat.answer}
        {...(variant === "profile" ? { profile: compass } : { actionableKinds: KINDS })}
      />
    </div>
  );
}

const userMessage = (seq: number, id: string, text: string): ChatEvent =>
  ev(seq, "message.created", { message: { id, role: "user", parts: [{ id: "p", kind: "text", format: "plain", text }], delivery: "sent" } }, { actor: { kind: "human", id: "u_1" } });
const approvalRequested = (seq: number, approvalId: string): ChatEvent =>
  ev(seq, "approval.requested", { approval: { approvalId, title: "Send?", summary: "", preview: [], options: [{ id: "o1", kind: "allow-once", label: "Send" }], state: "pending" } }, { actor: { kind: "system", id: "server" } });
const opening = (): ChatEvent[] => [userMessage(1, "m_1", "Find Acme"), ev(2, "turn.started", { turnId: "u_1", messageId: "m_1" }), ev(3, "turn.transition", { turnId: "u_1", action: "start" })];
const later = (): ChatEvent[] => [...streamedMessage(4, "m_2", ["Acme ", "is **won**."]), approvalRequested(8, "ap_1")];

const actionable = (id: string) => el(`[data-fancy-chat-approval="${id}"]`)?.getAttribute("data-fancy-chat-approval-actionable");

beforeEach(() => {
  mounts = 0;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

describe('an open thread renders new events without a remount: mode "interval"', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  for (const variant of ["profile", "kinds"] as const) {
    it(`a reply and an approval from a LATER poll render, and the approval is actionable (${variant})`, async () => {
      const script = (n: number): ChatEvent[] => (n === 0 ? opening() : n === 2 ? later() : []);
      let n = 0;
      const fetch = vi.fn(async (url: string) => {
        if (url.includes("/events/poll")) {
          const after = Number(new URL(url, "http://h").searchParams.get("after"));
          const events = script(n++).filter((e) => e.seq > after);
          return jsonResponse({ events, next: events.length ? events[events.length - 1]!.seq : after });
        }
        return jsonResponse({});
      });
      const transport = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, mode: "interval", interval: { activeMs: 1000, emptyBackoff: 1, graceMs: 0 } });

      render(<Thread transport={transport} variant={variant} />);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(el('[data-fancy-chat-message="m_1"]')).not.toBeNull();
      expect(el('[data-fancy-chat-approval="ap_1"]')).toBeNull();

      // Two more polls with the thread still open.
      await act(() => vi.advanceTimersByTimeAsync(1000));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(fetch.mock.calls.filter(([u]) => String(u).includes("/events/poll")).length).toBe(3);
      expect(el('[data-fancy-chat-message="m_2"] [data-chat-content]')?.textContent).toContain("won");
      expect(el('[data-fancy-chat-approval="ap_1"]')).not.toBeNull();
      expect(actionable("ap_1")).toBe("true");
      expect(el('[data-fancy-chat-approval="ap_1"] button:not([disabled])')).not.toBeNull();
      expect(mounts).toBe(1);
    });
  }
});

describe("an open thread renders new events without a remount: SSE", () => {
  beforeEach(() => FakeEventSource.reset());

  for (const variant of ["profile", "kinds"] as const) {
    it(`an approval from a later frame is actionable in the open thread (${variant})`, async () => {
      const transport = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: vi.fn(async () => jsonResponse({})) as never, EventSource: FakeEventSource as never, mode: "sse" });
      render(<Thread transport={transport} variant={variant} />);
      const es = FakeEventSource.last();
      act(() => {
        es.open();
        es.emit(opening());
      });
      expect(el('[data-fancy-chat-message="m_1"]')).not.toBeNull();
      act(() => es.emit(later()));
      expect(el('[data-fancy-chat-message="m_2"] [data-chat-content]')?.textContent).toContain("won");
      expect(actionable("ap_1")).toBe("true");
      expect(mounts).toBe(1);
    });
  }

  it("the next approval becomes actionable once the first is decided, in the open thread", async () => {
    const transport = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: vi.fn(async () => jsonResponse({})) as never, EventSource: FakeEventSource as never, mode: "sse" });
    render(<Thread transport={transport} variant="kinds" />);
    const es = FakeEventSource.last();
    act(() => {
      es.open();
      es.emit([...opening(), approvalRequested(4, "ap_1"), approvalRequested(5, "ap_2")]);
    });
    expect(actionable("ap_1")).toBe("true");
    expect(actionable("ap_2")).toBe("false");
    act(() => es.emit(ev(6, "approval.decided", { approvalId: "ap_1", optionId: "o1", decision: "approve", decidedBy: { kind: "human", id: "u_1" } }, { actor: { kind: "human", id: "u_1" } })));
    expect(el('[data-fancy-chat-approval="ap_1"]')?.getAttribute("data-fancy-chat-approval-state")).not.toBe("pending");
    expect(actionable("ap_2")).toBe("true");
    expect(mounts).toBe(1);
  });
});
