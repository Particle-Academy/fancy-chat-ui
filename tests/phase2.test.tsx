import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { projectThread, type MessageEntry } from "@particle-academy/fancy-chat-js";

import {
  AgentComposer,
  AgentThread,
  QueueBar,
  UndoCountdown,
  createHttpTransport,
  createThreadStore,
  createTriggerRegistry,
  defineSurfaceProfile,
  queuedMessages,
  serializePill,
  useAgentThread,
  type ChatTransport,
} from "../src/index";
import { ev, FakeEventSource, flush, jsonResponse } from "./helpers";

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

describe("the trigger registry", () => {
  it("serialises to the pill grammar, and no label can close or split its pill", () => {
    expect(serializePill({ kind: "deal", target: "7", label: "Acme renewal" })).toBe("[deal:7|Acme renewal]");
    expect(serializePill({ kind: "deal", target: "7", label: "x] [file:/etc/passwd|y" })).toBe("[deal:7|x   file:/etc/passwd y]");
    expect(serializePill({ kind: "file", target: "a:b|c", label: "" })).toBe("[file:a b c|a b c]");
    expect(() => serializePill({ kind: "Deal", target: "7", label: "x" })).toThrow(/pill kind/);
  });

  it("maps definitions to PromptInput triggers, one per character", async () => {
    const registry = createTriggerRegistry([
      { char: "$", kind: "deal", label: "Deals", search: () => [{ dealId: 7, name: "Acme" }] as never[], toItem: (d: never) => ({ id: String((d as { dealId: number }).dealId), label: (d as { name: string }).name }) },
    ]);
    const [deal] = registry.triggers();
    expect(deal?.char).toBe("$");
    const items = await deal!.search("ac");
    expect(items).toEqual([{ id: "7", label: "Acme" }]);
    expect(deal!.serialize!(items[0]!)).toBe("[deal:7|Acme]");
    expect(() => registry.register({ char: "$", kind: "x", search: () => [] })).toThrow(/already registered/);
    expect(() => registry.register({ char: "ab", kind: "x", search: () => [] })).toThrow(/one character/);
  });
});

const queued = (id: string, text: string): MessageEntry => ({
  id,
  role: "user",
  author: { kind: "human", id: "u_1" },
  turnId: null,
  parts: [{ id: "p", kind: "text", format: "plain", text }],
  open: [],
  delivery: "queued",
  supersedes: null,
  retracted: false,
  superseded: false,
});

describe("QueueBar", () => {
  it("lists the queue, unsends one, and offers Send now only after the delay", () => {
    const onUnsend = vi.fn();
    const onSendNow = vi.fn();
    const messages = [queued("m_1", "first"), queued("m_2", "second")];
    const { rerender } = render(<QueueBar messages={messages} onUnsend={onUnsend} onSendNow={onSendNow} queuedAt={() => 1000} now={1000 + 119999} />);
    expect(el("[data-fancy-chat-queue]")?.getAttribute("data-fancy-chat-queue-count")).toBe("2");
    expect(el('[data-fancy-chat-queue-send-now="m_1"]')).toBeNull();
    rerender(<QueueBar messages={messages} onUnsend={onUnsend} onSendNow={onSendNow} queuedAt={() => 1000} now={1000 + 120000} />);
    fireEvent.click(el('[data-fancy-chat-queue-send-now="m_1"]')!);
    expect(onSendNow).toHaveBeenCalledWith("m_1");
    fireEvent.click(el('[data-fancy-chat-queue-unsend="m_2"]')!);
    expect(onUnsend).toHaveBeenCalledWith("m_2");
  });

  it("renders nothing with an empty queue, and queuedMessages reads the projection", () => {
    const p = projectThread([
      ev(1, "message.created", { message: { id: "m_1", role: "user", parts: [{ id: "p", kind: "text", format: "plain", text: "hi" }], delivery: "sent" } }, { actor: { kind: "human", id: "u_1" } }),
      ev(2, "delivery.changed", { messageId: "m_1", action: "queue" }),
    ]);
    expect(queuedMessages(p.state).map((m) => m.id)).toEqual(["m_1"]);
    render(<QueueBar messages={[]} onUnsend={() => {}} />);
    expect(el("[data-fancy-chat-queue]")).toBeNull();
  });
});

describe("UndoCountdown", () => {
  const entry = { actionId: "a1", label: "Email to 3 people", deadline: "2026-11-15T10:00:30.000Z", state: "open" as const };

  it("shows the time left and reverts before the deadline", () => {
    const onRevert = vi.fn();
    render(<UndoCountdown entry={entry} onRevert={onRevert} now={Date.parse("2026-11-15T10:00:10.000Z")} />);
    expect(el('[data-fancy-chat-undo="a1"]')?.getAttribute("data-fancy-chat-undo-remaining")).toBe("20000");
    fireEvent.click(el("[data-fancy-chat-undo-revert]")!);
    expect(onRevert).toHaveBeenCalledWith("a1");
  });

  it("refuses a revert at the deadline", () => {
    const onRevert = vi.fn();
    render(<UndoCountdown entry={entry} onRevert={onRevert} now={Date.parse("2026-11-15T10:00:30.000Z")} />);
    expect((el("[data-fancy-chat-undo-revert]") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(el("[data-fancy-chat-undo-revert]")!);
    expect(onRevert).not.toHaveBeenCalled();
  });
});

describe("surface profiles", () => {
  it("refuse an unknown part kind or layout at definition", () => {
    expect(() => defineSurfaceProfile({ id: "compass", parts: ["text", "chrat"] })).toThrow(/Unknown part kind/);
    expect(() => defineSurfaceProfile({ id: "compass", layout: "sideways" as never })).toThrow(/Unknown layout/);
    expect(() => defineSurfaceProfile({ id: "Compass" })).toThrow(/profile id/);
    expect(defineSurfaceProfile({ id: "compass", parts: ["text", "x-moic.deal"] }).id).toBe("compass");
  });

  it("a surface renders only its part kinds in full, and acts only on its HITL kinds", () => {
    const p = projectThread([
      ev(1, "message.created", { message: { id: "m_1", role: "assistant", parts: [{ id: "c", kind: "code", language: "ts", code: "const secret = 1;" }, { id: "t", kind: "text", format: "plain", text: "Hello" }] } }),
      ev(2, "approval.requested", { approval: { approvalId: "ap_1", title: "Send?", summary: "", preview: [], options: [{ id: "o1", kind: "allow-once", label: "Send" }], state: "pending" } }, { actor: { kind: "system", id: "server" } }),
    ]);
    const compass = defineSurfaceProfile({ id: "compass", parts: ["text"], hitl: { actionable: ["question"] } });
    render(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} onDecide={() => {}} profile={compass} />);
    expect(el('[data-fancy-chat-part="c"]')?.getAttribute("data-fancy-chat-part-kind")).toBe("code");
    expect(el('[data-fancy-chat-part="c"]')?.hasAttribute("data-fancy-chat-part-unknown")).toBe(true);
    expect(el('[data-fancy-chat-part="t"]')?.textContent).toContain("Hello");
    expect(el('[data-fancy-chat-approval="ap_1"]')?.getAttribute("data-fancy-chat-approval-actionable")).toBe("false");
  });

  it("two surfaces share one engine: one store, one transport subscription", async () => {
    let subscriptions = 0;
    let push: ((e: ReturnType<typeof ev>[]) => void) | null = null;
    const transport = {
      subscribe: ({ onEvents }: { onEvents: (e: ReturnType<typeof ev>[]) => void }) => {
        subscriptions += 1;
        push = onEvents;
        // A real unsubscribe: an engine that disconnects early stops hearing events.
        return () => {
          push = null;
        };
      },
      fetchAfter: vi.fn(async () => ({ events: [], next: 0 })),
    } as unknown as ChatTransport;
    const store = createThreadStore({ transport });
    const a = renderHook(() => useAgentThread({ transport, store }));
    const b = renderHook(() => useAgentThread({ transport, store }));
    act(() => push?.([ev(1, "turn.started", { turnId: "u_1" })]));
    await act(flush);
    expect(subscriptions).toBe(1);
    expect(a.result.current.lastSeq).toBe(1);
    expect(b.result.current.lastSeq).toBe(1);
    a.unmount();
    act(() => push?.([ev(2, "turn.transition", { turnId: "u_1", action: "start" })]));
    expect(b.result.current.lastSeq).toBe(2);
  });
});

describe("edit and resend in the thread", () => {
  const p = projectThread([
    ev(1, "message.created", { message: { id: "m_1", role: "user", parts: [{ id: "p", kind: "text", format: "plain", text: "one" }], delivery: "sent" } }, { actor: { kind: "human", id: "u_1" } }),
    ev(2, "message.created", { message: { id: "m_2", role: "assistant", parts: [{ id: "p", kind: "text", format: "plain", text: "old reply" }] } }),
    ev(3, "message.created", { message: { id: "m_3", role: "user", parts: [{ id: "p", kind: "text", format: "plain", text: "one, edited" }], delivery: "sent", supersedes: "m_1" } }, { actor: { kind: "human", id: "u_1" } }),
  ]);

  it("hides the superseded branch by default, and shows it on request (controlled)", () => {
    const onShowBranchesChange = vi.fn();
    const { rerender } = render(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} onShowBranchesChange={onShowBranchesChange} />);
    expect(el('[data-fancy-chat-message="m_1"]')).toBeNull();
    expect(el('[data-fancy-chat-message="m_2"]')).toBeNull();
    expect(el('[data-fancy-chat-message="m_3"]')).not.toBeNull();
    fireEvent.click(el('[data-fancy-chat-branch-toggle="m_1"]')!);
    expect(onShowBranchesChange).toHaveBeenCalledWith(true);
    rerender(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} showBranches onShowBranchesChange={onShowBranchesChange} />);
    expect(el('[data-fancy-chat-message="m_1"]')).not.toBeNull();
    expect(el('[data-fancy-chat-message="m_2"]')?.getAttribute("data-fancy-chat-branch")).toBe("m_1");
  });

  it("offers Edit on the viewer's own latest messages only", () => {
    const onEdit = vi.fn();
    render(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} onEdit={onEdit} />);
    fireEvent.click(el('[data-fancy-chat-edit="m_3"]')!);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "m_3" }));
    expect(all("[data-fancy-chat-edit]").map((e) => e.getAttribute("data-fancy-chat-edit"))).toEqual(["m_3"]);
  });
});

describe("a message taken as a typed decision", () => {
  it("shows that it was taken as the decision, not as delivered", () => {
    const p = projectThread([
      ev(1, "message.created", { message: { id: "m_1", role: "user", parts: [{ id: "p", kind: "text", format: "plain", text: "approve" }], delivery: "sent" } }, { actor: { kind: "human", id: "u_1" } }),
      ev(2, "delivery.changed", { messageId: "m_1", action: "decide" }, { actor: { kind: "system", id: "server" } }),
    ]);
    render(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} />);
    expect(el('[data-fancy-chat-message="m_1"]')?.getAttribute("data-fancy-chat-delivery")).toBe("decided");
    expect(el('[data-fancy-chat-message="m_1"] [data-fancy-chat-delivery-label]')?.textContent).toBe("Taken as your decision");
  });
});

describe("undo and plan-step rows in the thread", () => {
  it("renders an undo row with its countdown and a held plan step that points at its approval", () => {
    const p = projectThread([
      ev(1, "undo.opened", { actionId: "a1", label: "Email", deadline: "2026-11-15T10:00:30.000Z" }, { actor: { kind: "system", id: "server" } }),
      ev(2, "plan.updated", { steps: [{ id: "s1", title: "Pay", status: "held", owner: "human", approvalId: "ap_1" }] }, { runId: "r_1" }),
    ]);
    const onRevertUndo = vi.fn();
    const onShowApproval = vi.fn();
    render(
      <AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} onRevertUndo={onRevertUndo} now={Date.parse("2026-11-15T10:00:00.000Z")} onShowApproval={onShowApproval} />,
    );
    fireEvent.click(el("[data-fancy-chat-undo-revert]")!);
    expect(onRevertUndo).toHaveBeenCalledWith("a1");
    fireEvent.click(el('[data-fancy-chat-plan-step-approval="ap_1"]')!);
    expect(onShowApproval).toHaveBeenCalledWith("ap_1");
  });
});

describe("AgentComposer phase 2", () => {
  const draft = { v: 1 as const, text: "", pills: [], attachments: [] };

  it("passes the registry's triggers to PromptInput", async () => {
    const registry = createTriggerRegistry([{ char: "$", kind: "deal", label: "Deals", search: () => [{ id: "7", label: "Acme" }] as never[] }]);
    render(<AgentComposer threadId="t_1" drafts={{ t_1: draft }} onDraftsChange={() => {}} onSend={() => {}} triggers={registry} />);
    const ta = el("[data-react-fancy-prompt-input-textarea]") as HTMLTextAreaElement;
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      set.call(ta, "$ac");
      ta.setSelectionRange(3, 3);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(flush);
    expect(el("[data-react-fancy-prompt-input-menu]")?.getAttribute("data-react-fancy-prompt-input-trigger")).toBe("$");
  });

  it("says when the draft will be taken as a decision (typed approval, opt-in)", () => {
    const approval = { approvalId: "ap_1", title: "Send?", summary: "", preview: [], state: "pending" as const, options: [{ id: "o1", kind: "allow-once" as const, label: "Send" }] };
    const config = { enabled: true, locale: "en", phrases: { en: { approve: ["approve"] } } };
    const { rerender } = render(<AgentComposer threadId="t_1" drafts={{ t_1: { ...draft, text: "approve" } }} onDraftsChange={() => {}} onSend={() => {}} typedApproval={{ config, approval }} />);
    expect(el("[data-fancy-chat-typed-approval]")?.getAttribute("data-fancy-chat-typed-approval")).toBe("approve");
    rerender(<AgentComposer threadId="t_1" drafts={{ t_1: { ...draft, text: "approve" } }} onDraftsChange={() => {}} onSend={() => {}} typedApproval={{ config: { ...config, enabled: false }, approval }} />);
    expect(el("[data-fancy-chat-typed-approval]")).toBeNull();
  });
});

describe("transport phase 2", () => {
  it("reverts an undo, and names the surface profile on every request", async () => {
    FakeEventSource.reset();
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never, EventSource: FakeEventSource as never, profileId: "compass" });
    await t.revertUndo("a 1");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/c/undo/a%201/revert");
    expect((init.headers as Record<string, string>)["X-Fancy-Chat-Profile"]).toBe("compass");
    t.subscribe({ after: () => 0, onEvents: () => {} });
    expect(FakeEventSource.last().url).toBe("/c/threads/t_1/events?after=0&profile=compass");
  });
});
