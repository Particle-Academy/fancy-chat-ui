import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { projectThread, type ToolEntry } from "@particle-academy/fancy-chat-js";

import { AgentComposer, AgentThread, ThinkingBlock, ToolRow, useAgentThread, type ChatTransport } from "../src/index";
import { ev, flush, streamedMessage } from "./helpers";

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;

const tool = (over: Partial<ToolEntry> = {}): ToolEntry => ({
  toolCallId: "tc_1",
  runId: "r_1",
  name: "search_deals",
  args: { q: "Acme" },
  startedAt: null,
  progress: null,
  outcome: null,
  durationMs: null,
  outputRef: null,
  truncated: false,
  ...over,
});

describe("ToolRow", () => {
  it("shows running, then ok with its duration", () => {
    const { rerender } = render(<ToolRow entry={tool({ progress: { fraction: 0.5, text: null } })} />);
    expect(el('[data-fancy-chat-tool="tc_1"]')?.getAttribute("data-fancy-chat-tool-outcome")).toBe("running");
    expect(el("[data-fancy-chat-tool-progress]")).not.toBeNull();
    rerender(<ToolRow entry={tool({ outcome: "ok", durationMs: 4200 })} />);
    expect(el('[data-fancy-chat-tool="tc_1"]')?.getAttribute("data-fancy-chat-tool-outcome")).toBe("ok");
    expect(screen.getByText("4.2 s")).toBeTruthy();
  });

  it("styles a refusal apart from a failure, and offers Retry only on failure", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ToolRow entry={tool({ outcome: "refusal" })} onRetry={onRetry} />);
    expect(el('[data-fancy-chat-tool="tc_1"]')?.getAttribute("data-fancy-chat-tool-outcome")).toBe("refusal");
    expect(el("[data-fancy-chat-tool-retry]")).toBeNull();
    rerender(<ToolRow entry={tool({ outcome: "failure" })} onRetry={onRetry} />);
    fireEvent.click(el("[data-fancy-chat-tool-retry]")!);
    expect(onRetry).toHaveBeenCalledWith("tc_1");
  });

  it("shows arguments lazily, only when expanded (controlled)", () => {
    const onExpandedChange = vi.fn();
    const { rerender } = render(<ToolRow entry={tool()} expanded={false} onExpandedChange={onExpandedChange} />);
    expect(el("[data-fancy-chat-tool-args]")).toBeNull();
    fireEvent.click(el("[data-fancy-chat-tool-toggle]")!);
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    rerender(<ToolRow entry={tool()} expanded onExpandedChange={onExpandedChange} />);
    expect(el("[data-fancy-chat-tool-args]")?.textContent).toContain("Acme");
  });
});

describe("ThinkingBlock", () => {
  it("is one collapsible block with a live state", () => {
    const { rerender } = render(<ThinkingBlock entry={{ runId: "r_1", text: "Look up the deal.", live: true }} />);
    const block = el('[data-fancy-chat-thinking="r_1"]');
    expect(block?.getAttribute("data-fancy-chat-thinking-live")).toBe("true");
    expect(el("[data-fancy-chat-thinking-text]")).toBeNull();
    fireEvent.click(el("[data-fancy-chat-thinking-toggle]")!);
    expect(el("[data-fancy-chat-thinking-text]")?.textContent).toContain("Look up the deal.");
    rerender(<ThinkingBlock entry={{ runId: "r_1", text: "Look up the deal.", live: false }} />);
    expect(el('[data-fancy-chat-thinking="r_1"]')?.getAttribute("data-fancy-chat-thinking-live")).toBe("false");
  });
});

const events = [
  ev(1, "message.created", { message: { id: "m_1", role: "user", parts: [{ id: "p", kind: "text", format: "plain", text: "Find Acme" }], delivery: "sent" } }, { actor: { kind: "human", id: "u_1" } }),
  ev(2, "thinking.started", {}, { runId: "r_1" }),
  ev(3, "thinking.delta", { text: "Hmm." }, { runId: "r_1" }),
  ev(4, "tool.called", { toolCallId: "tc_1", name: "search_deals", args: { q: "Acme" } }, { runId: "r_1" }),
  ...streamedMessage(5, "m_2", ["Acme ", "is **won**."]),
  ev(9, "approval.requested", { approval: { approvalId: "ap_1", title: "Send?", summary: "", preview: [], options: [{ id: "o1", kind: "allow-once", label: "Send" }], state: "pending" } }, { actor: { kind: "system", id: "server" } }),
];

describe("AgentThread", () => {
  it("renders every row kind from the projection with stable handles, as a log", () => {
    const p = projectThread(events);
    render(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} onDecide={() => {}} />);
    expect(el("[data-fancy-chat-thread]")).not.toBeNull();
    expect(el('[role="log"]')).not.toBeNull();
    expect(el('[data-fancy-chat-message="m_1"]')).not.toBeNull();
    expect(el('[data-fancy-chat-thinking="r_1"]')).not.toBeNull();
    expect(el('[data-fancy-chat-tool="tc_1"]')).not.toBeNull();
    expect(el('[data-fancy-chat-message="m_2"] [data-chat-content]')?.textContent).toContain("won");
    expect(el('[data-fancy-chat-approval="ap_1"]')?.getAttribute("data-fancy-chat-approval-actionable")).toBe("true");
  });

  it("with two pending approvals only the oldest is actionable", () => {
    const p = projectThread([
      ...events,
      ev(10, "approval.requested", { approval: { approvalId: "ap_2", title: "Pay?", summary: "", preview: [], options: [{ id: "o1", kind: "allow-once", label: "Pay" }], state: "pending" } }, { actor: { kind: "system", id: "server" } }),
    ]);
    render(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} onDecide={() => {}} />);
    expect(el('[data-fancy-chat-approval="ap_1"]')?.getAttribute("data-fancy-chat-approval-actionable")).toBe("true");
    expect(el('[data-fancy-chat-approval="ap_2"]')?.getAttribute("data-fancy-chat-approval-actionable")).toBe("false");
  });

  it("follow is controlled; Jump to latest asks to turn it back on", () => {
    const p = projectThread(events);
    const onFollowChange = vi.fn();
    render(<AgentThread rows={p.rows} state={p.state} follow={false} onFollowChange={onFollowChange} height={600} />);
    fireEvent.click(el("[data-fancy-chat-jump]")!);
    expect(onFollowChange).toHaveBeenCalledWith(true);
  });

  it("offers Load earlier only with a handler, and marks the list to anchor on prepend", () => {
    const p = projectThread(events);
    const onLoadEarlier = vi.fn();
    const { rerender } = render(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} />);
    expect(el("[data-fancy-chat-load-earlier]")).toBeNull();
    rerender(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} onLoadEarlier={onLoadEarlier} hasEarlier />);
    fireEvent.click(el("[data-fancy-chat-load-earlier]")!);
    expect(onLoadEarlier).toHaveBeenCalled();
  });

  it("hides retracted messages and marks superseded ones", () => {
    const p = projectThread([
      ...events.slice(0, 1),
      ev(2, "message.created", { message: { id: "m_9", role: "user", parts: [{ id: "p", kind: "text", format: "plain", text: "fixed" }], delivery: "sent", supersedes: "m_1" } }, { actor: { kind: "human", id: "u_1" } }),
      ev(3, "message.created", { message: { id: "m_x", role: "assistant", parts: [{ id: "p", kind: "text", format: "plain", text: "oops" }] } }),
      ev(4, "message.retracted", { messageId: "m_x" }),
    ]);
    render(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} />);
    expect(el('[data-fancy-chat-message="m_x"]')).toBeNull();
    expect(el('[data-fancy-chat-message="m_1"]')?.getAttribute("data-fancy-chat-superseded")).toBe("true");
  });
});

describe("AgentComposer", () => {
  const draft = { v: 1 as const, text: "", pills: [], attachments: [] };

  it("keeps one draft per thread, controlled, and swaps by thread id", () => {
    const onDraftsChange = vi.fn();
    const { rerender } = render(<AgentComposer threadId="t_1" drafts={{ t_1: { ...draft, text: "one" }, t_2: { ...draft, text: "two" } }} onDraftsChange={onDraftsChange} onSend={() => {}} />);
    expect(el('[data-fancy-chat-composer="t_1"]')).not.toBeNull();
    expect(el('[data-fancy-chat-composer="t_1"]')?.textContent).toContain("one");
    rerender(<AgentComposer threadId="t_2" drafts={{ t_1: { ...draft, text: "one" }, t_2: { ...draft, text: "two" } }} onDraftsChange={onDraftsChange} onSend={() => {}} />);
    expect(el('[data-fancy-chat-composer="t_2"]')?.textContent).toContain("two");
  });

  it("shows Stop while the agent runs, and it calls onStop", () => {
    const onStop = vi.fn();
    render(<AgentComposer threadId="t_1" drafts={{}} onDraftsChange={() => {}} onSend={() => {}} running onStop={onStop} />);
    fireEvent.click(el("[data-react-fancy-prompt-input-stop] button") ?? el("[data-react-fancy-prompt-input-stop]")!);
    expect(onStop).toHaveBeenCalled();
  });

  it("shows the send outcome line, keeping the draft on failure", () => {
    render(<AgentComposer threadId="t_1" drafts={{ t_1: { ...draft, text: "hi" } }} onDraftsChange={() => {}} onSend={() => {}} outcome={{ delivery: "failed", reason: "rate limited" }} />);
    const line = el("[data-fancy-chat-send-outcome]");
    expect(line?.getAttribute("data-fancy-chat-delivery")).toBe("failed");
    expect(line?.textContent).toContain("rate limited");
  });
});

describe("useAgentThread", () => {
  it("starts the store on mount, exposes rows and actions, and stops on unmount", async () => {
    let push: ((e: typeof events) => void) | null = null;
    const stop = vi.fn();
    const transport = {
      subscribe: ({ onEvents }: { onEvents: (e: typeof events) => void }) => {
        push = onEvents;
        return stop;
      },
      fetchAfter: vi.fn(async () => ({ events: [], next: 0 })),
      send: vi.fn(async () => ({ messageId: "m_3", seq: 10, delivery: "sent" })),
      cancel: vi.fn(async () => ({ outcome: "ok" })),
      unsend: vi.fn(),
      decide: vi.fn(async () => ({})),
      answer: vi.fn(),
    } as unknown as ChatTransport;
    const { result, unmount } = renderHook(() => useAgentThread({ transport }));
    act(() => push?.(events));
    await act(flush);
    expect(result.current.rows.map((r) => r.id)).toEqual(["m_1", "r_1", "tc_1", "m_2", "ap_1"]);
    expect(result.current.actionableId).toBe("ap_1");
    await act(async () => {
      await result.current.decide({ approvalId: "ap_1", optionId: "o1", decision: "approve" });
    });
    expect(transport.decide).toHaveBeenCalledWith("ap_1", { optionId: "o1" });
    unmount();
    expect(stop).toHaveBeenCalled();
  });
});
