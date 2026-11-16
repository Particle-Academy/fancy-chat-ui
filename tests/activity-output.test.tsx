import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { projectThread, type ToolEntry } from "@particle-academy/fancy-chat-js";

import { ActivityTimeline, AgentThread, ModelError, ToolRow } from "../src/index";
import { ev, flush } from "./helpers";

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

const tool = (over: Partial<ToolEntry> = {}): ToolEntry => ({
  toolCallId: "tc_1",
  runId: "r_1",
  name: "send_email",
  args: {},
  startedAt: null,
  progress: null,
  outcome: "ok",
  durationMs: 1200,
  durationExact: true,
  outputRef: null,
  truncated: false,
  output: null,
  outputLanguage: null,
  ...over,
});

describe("ToolRow output (inline, bounded, never HTML)", () => {
  it("shows a failure's own words without expanding", () => {
    render(<ToolRow entry={tool({ outcome: "failure", output: "SMTP 550: mailbox unavailable" })} />);
    expect(el("[data-fancy-chat-tool-output]")?.textContent).toContain("SMTP 550: mailbox unavailable");
  });

  it("renders output as text, never as HTML", () => {
    render(<ToolRow entry={tool({ outcome: "failure", output: "<b>bold</b><img src=x onerror=alert(1)>" })} />);
    const out = el("[data-fancy-chat-tool-output]")!;
    expect(out.querySelector("b")).toBeNull();
    expect(out.querySelector("img")).toBeNull();
    expect(out.textContent).toContain("<b>bold</b>");
  });

  it("shows an ok result's output when expanded, as code when it names a language", () => {
    const { rerender } = render(<ToolRow entry={tool({ output: '{"deals":[7]}', outputLanguage: "json" })} expanded={false} />);
    expect(el("[data-fancy-chat-tool-output]")).toBeNull();
    rerender(<ToolRow entry={tool({ output: '{"deals":[7]}', outputLanguage: "json" })} expanded />);
    expect(el("[data-fancy-chat-tool-output]")?.getAttribute("data-fancy-chat-tool-output-language")).toBe("json");
    expect(el("[data-fancy-chat-tool-output]")?.textContent).toContain('{"deals":[7]}');
  });

  it("bounds what it displays and says so", () => {
    render(<ToolRow entry={tool({ outcome: "failure", output: "abcdefghij" })} maxOutputChars={4} />);
    expect(el("[data-fancy-chat-tool-output]")?.textContent).toContain("abcd");
    expect(el("[data-fancy-chat-tool-output]")?.textContent).not.toContain("abcde");
    expect(el("[data-fancy-chat-tool-output-truncated]")).not.toBeNull();
  });

  it("marks a server-truncated output", () => {
    render(<ToolRow entry={tool({ outcome: "failure", output: "partial", truncated: true })} />);
    expect(el("[data-fancy-chat-tool-output-truncated]")).not.toBeNull();
  });

  it("loads the full output lazily through resolveOutput, once, only when expanded", async () => {
    const resolveOutput = vi.fn(async () => ({ text: "the whole result", language: "text" }));
    const entry = tool({ output: "the who", truncated: true, outputRef: "o_9" });
    const { rerender } = render(<ToolRow entry={entry} expanded={false} resolveOutput={resolveOutput} />);
    await act(flush);
    expect(resolveOutput).not.toHaveBeenCalled();
    rerender(<ToolRow entry={entry} expanded resolveOutput={resolveOutput} />);
    await act(flush);
    expect(resolveOutput).toHaveBeenCalledTimes(1);
    expect(resolveOutput).toHaveBeenCalledWith("o_9", entry);
    expect(el("[data-fancy-chat-tool-output]")?.textContent).toContain("the whole result");
    rerender(<ToolRow entry={entry} expanded resolveOutput={resolveOutput} />);
    await act(flush);
    expect(resolveOutput).toHaveBeenCalledTimes(1);
  });

  it("collapsing and expanding again does not fetch again", async () => {
    const resolveOutput = vi.fn(async () => "the whole result");
    const entry = tool({ output: "the who", truncated: true, outputRef: "o_9" });
    const { rerender } = render(<ToolRow entry={entry} expanded resolveOutput={resolveOutput} />);
    await act(flush);
    rerender(<ToolRow entry={entry} expanded={false} resolveOutput={resolveOutput} />);
    await act(flush);
    rerender(<ToolRow entry={entry} expanded resolveOutput={resolveOutput} />);
    await act(flush);
    expect(resolveOutput).toHaveBeenCalledTimes(1);
    expect(el("[data-fancy-chat-tool-output]")?.textContent).toContain("the whole result");
  });

  it("shows a load error instead of failing the row", async () => {
    const resolveOutput = vi.fn(async () => {
      throw new Error("gone");
    });
    render(<ToolRow entry={tool({ outputRef: "o_9" })} expanded resolveOutput={resolveOutput} />);
    await act(flush);
    expect(el("[data-fancy-chat-tool-output-error]")).not.toBeNull();
  });

  it("never fetches without a ref, or without a resolver", async () => {
    const resolveOutput = vi.fn(async () => "x");
    render(<ToolRow entry={tool({ output: "inline only" })} expanded resolveOutput={resolveOutput} />);
    await act(flush);
    expect(resolveOutput).not.toHaveBeenCalled();
  });

  it("AgentThread passes the resolver and the bound through to its tool rows", async () => {
    const p = projectThread([
      ev(1, "tool.called", { toolCallId: "tc_1", name: "send_email", args: {} }, { runId: "r_1" }),
      ev(2, "tool.result", { toolCallId: "tc_1", outcome: "failure", output: "SMTP 550 mailbox unavailable", outputRef: "o_1" }, { runId: "r_1" }),
    ]);
    const resolveToolOutput = vi.fn(async () => "full text");
    render(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} resolveToolOutput={resolveToolOutput} maxToolOutputChars={4} />);
    expect(el('[data-fancy-chat-tool="tc_1"] [data-fancy-chat-tool-output]')?.textContent).toContain("SMTP");
    expect(el('[data-fancy-chat-tool="tc_1"] [data-fancy-chat-tool-output-truncated]')).not.toBeNull();
    fireEvent.click(el('[data-fancy-chat-tool="tc_1"] [data-fancy-chat-tool-toggle]')!);
    await act(flush);
    expect(resolveToolOutput).toHaveBeenCalledWith("o_1", expect.objectContaining({ toolCallId: "tc_1" }));
  });
});

describe("renderOutput through AgentThread", () => {
  it("AgentThread passes renderToolOutput to every tool row, in rows and timeline mode", () => {
    const p = projectThread([
      ev(1, "tool.called", { toolCallId: "tc_1", name: "send_email", args: {} }, { runId: "r_1" }),
      ev(2, "tool.result", { toolCallId: "tc_1", outcome: "ok", output: "sent", outputRef: "o_1" }, { runId: "r_1" }),
    ]);
    const renderToolOutput = vi.fn((e: ToolEntry) => <span data-host-output="">{`host:${e.outputRef}`}</span>);
    const { rerender } = render(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} renderToolOutput={renderToolOutput} />);
    fireEvent.click(el('[data-fancy-chat-tool="tc_1"] [data-fancy-chat-tool-toggle]')!);
    expect(el('[data-fancy-chat-tool="tc_1"] [data-host-output]')?.textContent).toBe("host:o_1");
    rerender(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} activity="timeline" renderToolOutput={renderToolOutput} />);
    fireEvent.click(el("[data-fancy-chat-activity-toggle]")!);
    fireEvent.click(el('[data-fancy-chat-tool="tc_1"] [data-fancy-chat-tool-toggle]')!);
    expect(el('[data-fancy-chat-tool="tc_1"] [data-host-output]')?.textContent).toBe("host:o_1");
  });
});

describe("ActivityTimeline", () => {
  const thinking = { thinkingId: "r_1", runId: "r_1", text: "Look it up.", live: false };
  const tools = [tool({ toolCallId: "a", durationMs: 1200 }), tool({ toolCallId: "b", durationMs: 3000, outcome: "failure", output: "boom" }), tool({ toolCallId: "c", durationMs: null, outcome: "refusal" })];

  it("collapses a finished run to a summary: tool calls, time, failures", () => {
    render(<ActivityTimeline id="r_1" entries={[thinking, ...tools]} running={false} />);
    const root = el('[data-fancy-chat-activity="r_1"]');
    expect(root?.getAttribute("data-fancy-chat-activity-expanded")).toBe("false");
    expect(el("[data-fancy-chat-activity-summary]")?.textContent).toBe("3 tool calls · 4.2 s · 1 failed");
    // Collapsed: the rows are hidden, except the failed one, whose text must stay visible.
    expect(all("[data-fancy-chat-tool]").map((t) => t.getAttribute("data-fancy-chat-tool"))).toEqual(["b"]);
  });

  it("is expanded while running, one timeline item per entry, toned by outcome", () => {
    render(<ActivityTimeline id="r_1" entries={[thinking, ...tools.slice(0, 2), tool({ toolCallId: "d", outcome: null, durationMs: null })]} running />);
    expect(el('[data-fancy-chat-activity="r_1"]')?.getAttribute("data-fancy-chat-activity-expanded")).toBe("true");
    expect(all("[data-fancy-chat-activity-item]").map((i) => i.getAttribute("data-fancy-chat-activity-tone"))).toEqual(["neutral", "ok", "failure", "running"]);
    expect(el('[data-fancy-chat-thinking="r_1"]')).not.toBeNull();
  });

  it("expanded is controlled when the host passes it", () => {
    const onExpandedChange = vi.fn();
    render(<ActivityTimeline id="r_1" entries={tools} running={false} expanded={false} onExpandedChange={onExpandedChange} />);
    fireEvent.click(el("[data-fancy-chat-activity-toggle]")!);
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    expect(el('[data-fancy-chat-activity="r_1"]')?.getAttribute("data-fancy-chat-activity-expanded")).toBe("false");
  });

  it("AgentThread groups a run's consecutive activity into one timeline in timeline mode only", () => {
    const p = projectThread([
      ev(1, "message.created", { message: { id: "m_1", role: "user", parts: [{ id: "p", kind: "text", format: "plain", text: "go" }], delivery: "sent" } }, { actor: { kind: "human", id: "u_1" } }),
      ev(2, "thinking.started", {}, { runId: "r_1" }),
      ev(3, "tool.called", { toolCallId: "tc_1", name: "a", args: {} }, { runId: "r_1" }),
      ev(4, "tool.result", { toolCallId: "tc_1", outcome: "ok", durationMs: 100 }, { runId: "r_1" }),
      ev(5, "tool.called", { toolCallId: "tc_2", name: "b", args: {} }, { runId: "r_1" }),
      ev(6, "tool.result", { toolCallId: "tc_2", outcome: "ok", durationMs: 200 }, { runId: "r_1" }),
      ev(7, "message.created", { message: { id: "m_2", role: "assistant", parts: [{ id: "p", kind: "text", format: "plain", text: "done" }] } }, { runId: "r_1" }),
    ]);
    const { rerender } = render(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} />);
    expect(all("[data-fancy-chat-activity]")).toHaveLength(0);
    expect(all('[data-fancy-chat-row="tool"]')).toHaveLength(2);
    rerender(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} activity="timeline" />);
    expect(all("[data-fancy-chat-activity]")).toHaveLength(1);
    expect(el("[data-fancy-chat-activity-summary]")?.textContent).toBe("2 tool calls · 0.3 s");
    expect(el('[data-fancy-chat-message="m_2"]')).not.toBeNull();
  });
});

describe("ModelError (a failed turn, with Retry)", () => {
  it("shows the failure reason and Retry; Retry names the turn", () => {
    const onRetry = vi.fn();
    render(<ModelError turn={{ turnId: "u_1", messageId: null, state: "settled", outcome: "failed", reason: "provider timed out" }} onRetry={onRetry} />);
    expect(el('[data-fancy-chat-turn-error="u_1"]')?.textContent).toContain("provider timed out");
    fireEvent.click(el("[data-fancy-chat-turn-retry]")!);
    expect(onRetry).toHaveBeenCalledWith("u_1");
  });

  it("a refusal is not an error: neutral, and no Retry", () => {
    render(<ModelError turn={{ turnId: "u_1", messageId: null, state: "settled", outcome: "refused", reason: null }} onRetry={() => {}} />);
    expect(el('[data-fancy-chat-turn-error="u_1"]')?.getAttribute("data-fancy-chat-turn-error-tone")).toBe("neutral");
    expect(el("[data-fancy-chat-turn-retry]")).toBeNull();
  });

  it("renders nothing for a turn that did not fail", () => {
    render(<ModelError turn={{ turnId: "u_1", messageId: null, state: "settled", outcome: "completed", reason: null }} onRetry={() => {}} />);
    expect(el("[data-fancy-chat-turn-error]")).toBeNull();
  });

  it("AgentThread shows it for the newest turn when it failed, wired to onRetryTurn", () => {
    const p = projectThread([
      ev(1, "turn.started", { turnId: "u_1" }),
      ev(2, "turn.transition", { turnId: "u_1", action: "start" }),
      ev(3, "turn.settled", { turnId: "u_1", action: "fail", reason: "model overloaded" }),
    ]);
    const onRetryTurn = vi.fn();
    const { rerender } = render(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} onRetryTurn={onRetryTurn} />);
    fireEvent.click(el("[data-fancy-chat-turn-retry]")!);
    expect(onRetryTurn).toHaveBeenCalledWith("u_1");
    const ok = projectThread([ev(1, "turn.started", { turnId: "u_2" }), ev(2, "turn.transition", { turnId: "u_2", action: "start" }), ev(3, "turn.settled", { turnId: "u_2", action: "finish" })]);
    rerender(<AgentThread rows={ok.rows} state={ok.state} follow onFollowChange={() => {}} height={600} onRetryTurn={onRetryTurn} />);
    expect(el("[data-fancy-chat-turn-error]")).toBeNull();
  });
});

describe("several thinking blocks per run, and inexact durations", () => {
  it("a run that thinks, calls a tool and thinks again renders two blocks around the tool, in order", () => {
    const p = projectThread([
      ev(1, "thinking.started", {}, { runId: "r_1" }),
      ev(2, "thinking.delta", { text: "First." }, { runId: "r_1" }),
      ev(3, "thinking.completed", {}, { runId: "r_1" }),
      ev(4, "tool.called", { toolCallId: "tc_1", name: "a", args: {} }, { runId: "r_1" }),
      ev(5, "tool.result", { toolCallId: "tc_1", outcome: "ok", durationMs: 100 }, { runId: "r_1" }),
      ev(6, "thinking.started", {}, { runId: "r_1" }),
      ev(7, "thinking.delta", { text: "Second." }, { runId: "r_1" }),
    ]);
    const { rerender } = render(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} />);
    const order = () => all("[data-fancy-chat-thinking], [data-fancy-chat-tool]").map((n) => n.getAttribute("data-fancy-chat-thinking") ?? `tool:${n.getAttribute("data-fancy-chat-tool")}`);
    expect(order()).toEqual(["r_1", "tool:tc_1", "r_1#2"]);
    rerender(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} activity="timeline" />);
    expect(order()).toEqual(["r_1", "tool:tc_1", "r_1#2"]);
  });

  it("an inexact duration reads as at most, and the summary says so", () => {
    render(<ToolRow entry={tool({ durationMs: 1200, durationExact: false })} />);
    expect(el('[data-fancy-chat-tool-duration]')?.textContent).toBe("≤ 1.2 s");
    expect(el('[data-fancy-chat-tool-duration]')?.getAttribute("data-fancy-chat-tool-duration-exact")).toBe("false");
  });

  it("an exact one (or an entry without the field) reads plainly", () => {
    render(<ToolRow entry={tool({ durationMs: 1200, durationExact: true })} />);
    expect(el('[data-fancy-chat-tool-duration]')?.textContent).toBe("1.2 s");
  });

  it("the timeline summary marks a total that includes an inexact duration", () => {
    render(<ActivityTimeline id="r_1" entries={[tool({ toolCallId: "a", durationMs: 1000 }), tool({ toolCallId: "b", durationMs: 2000, durationExact: false })]} running={false} />);
    expect(el("[data-fancy-chat-activity-summary]")?.textContent).toBe("2 tool calls · ≤ 3.0 s");
  });
});

describe("a settled timeline keeps failures visible while collapsed", () => {
  it("shows each failed tool's name and text without expanding", () => {
    const entries = [tool({ toolCallId: "a", outcome: "ok", output: "fine" }), tool({ toolCallId: "b", name: "send_email", outcome: "failure", output: "SMTP 550: mailbox unavailable" })];
    render(<ActivityTimeline id="r_1" entries={entries} running={false} />);
    expect(el('[data-fancy-chat-activity="r_1"]')?.getAttribute("data-fancy-chat-activity-expanded")).toBe("false");
    const failures = el("[data-fancy-chat-activity-failures]");
    expect(failures?.textContent).toContain("send_email");
    expect(failures?.textContent).toContain("SMTP 550: mailbox unavailable");
    // Only the failed one, and never the ok output.
    expect(failures?.textContent).not.toContain("fine");
    expect(failures?.querySelectorAll('[data-fancy-chat-tool-outcome="failure"]')).toHaveLength(1);
  });

  it("a failure without text still shows that it failed", () => {
    render(<ActivityTimeline id="r_1" entries={[tool({ toolCallId: "b", name: "deploy", outcome: "failure", output: null })]} running={false} />);
    expect(el('[data-fancy-chat-activity-failures] [data-fancy-chat-tool="b"]')?.getAttribute("data-fancy-chat-tool-outcome")).toBe("failure");
  });

  it("nothing extra when nothing failed, or when expanded (the rows themselves show it)", () => {
    const { rerender } = render(<ActivityTimeline id="r_1" entries={[tool({ toolCallId: "a" })]} running={false} />);
    expect(el("[data-fancy-chat-activity-failures]")).toBeNull();
    rerender(<ActivityTimeline id="r_1" entries={[tool({ toolCallId: "b", outcome: "failure", output: "boom" })]} running={false} expanded />);
    expect(el("[data-fancy-chat-activity-failures]")).toBeNull();
    expect(all('[data-fancy-chat-tool="b"]')).toHaveLength(1);
  });

  it("AgentThread in timeline mode: a settled run's failure text is visible on the page", () => {
    const p = projectThread([
      ev(1, "tool.called", { toolCallId: "tc_1", name: "send_email", args: {} }, { runId: "r_1" }),
      ev(2, "tool.result", { toolCallId: "tc_1", outcome: "failure", output: "SMTP 550 mailbox unavailable" }, { runId: "r_1" }),
    ]);
    render(<AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} activity="timeline" />);
    expect(el("[data-fancy-chat-activity]")?.getAttribute("data-fancy-chat-activity-expanded")).toBe("false");
    expect(document.body.textContent).toContain("SMTP 550 mailbox unavailable");
  });
});
