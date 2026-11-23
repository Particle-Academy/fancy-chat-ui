import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { projectThread, type ApprovalRecord, type Row } from "@particle-academy/fancy-chat-js";

import { AgentThread, DEFAULT_LABELS, type AgentThreadProps, type ApprovalRenderContext } from "../src/index";
import { ev } from "./helpers";

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;

const requested = (seq: number, approvalId: string) =>
  ev(seq, "approval.requested", { approval: { approvalId, title: `Title ${approvalId}`, summary: "", preview: [], options: [{ id: "o1", kind: "allow-once", label: "Send" }], state: "pending" } }, { actor: { kind: "system", id: "server" } });

const message = (seq: number, id: string, parts: unknown[]) => ev(seq, "message.created", { message: { id, role: "assistant", parts, delivery: "sent" } });

const textPart = { id: "p_text", kind: "text", format: "plain", text: "Before the approval" };
const approvalPart = (approvalId: string) => ({ id: `p_${approvalId}`, kind: "approval", approvalId });

/** The approval as its own row. */
const asRow = () => projectThread([requested(1, "ap_1"), requested(2, "ap_2")]);

/** The approvals only inside a message's parts: the message row is the only row passed. */
const asPart = () => {
  const p = projectThread([message(1, "m_1", [textPart, approvalPart("ap_1"), approvalPart("ap_2")]), requested(2, "ap_1"), requested(3, "ap_2")]);
  return { state: p.state, rows: p.rows.filter((r: Row) => r.kind === "message") };
};

const thread = (p: { rows: AgentThreadProps["rows"]; state: AgentThreadProps["state"] }, over: Partial<AgentThreadProps> = {}) => (
  <AgentThread rows={p.rows} state={p.state} follow onFollowChange={() => {}} height={600} onDecide={() => {}} {...over} />
);

const positions = [
  ["an approval row", asRow],
  ["an approval in a message part", asPart],
] as const;

/** True when the element, or an ancestor, is out of the layout through `hidden`. */
const isHidden = (node: HTMLElement | null) => !!node?.closest("[hidden]");

describe.each(positions)("renderApproval on %s", (_name, fixture) => {
  it("renders the default card when the prop is absent", () => {
    render(thread(fixture()));
    expect(el('[data-fancy-chat-approval="ap_1"] [data-fancy-chat-option="o1"]')).not.toBeNull();
  });

  it("renders the default card when the prop returns undefined", () => {
    const renderApproval = vi.fn(() => undefined);
    render(thread(fixture(), { renderApproval }));
    expect(renderApproval).toHaveBeenCalled();
    expect(el('[data-fancy-chat-approval="ap_1"] [data-fancy-chat-option="o1"]')).not.toBeNull();
    expect(el('[data-fancy-chat-approval="ap_1"]')?.getAttribute("data-fancy-chat-approval-actionable")).toBe("true");
  });

  it("replaces the card, and the approval handle stays on a wrapper", () => {
    render(thread(fixture(), { renderApproval: (record) => <em data-testid={`custom-${record.approvalId}`}>{record.title}</em> }));
    const handle = el('[data-fancy-chat-approval="ap_1"]');
    expect(handle?.querySelector('[data-testid="custom-ap_1"]')?.textContent).toBe("Title ap_1");
    expect(handle?.getAttribute("data-fancy-chat-approval-state")).toBe("pending");
    expect(handle?.getAttribute("data-fancy-chat-approval-actionable")).toBe("true");
    expect(el('[data-fancy-chat-option="o1"]')).toBeNull();
    expect(isHidden(handle)).toBe(false);
  });

  it("null renders nothing, and the handle stays, out of the layout", () => {
    render(thread(fixture(), { renderApproval: (record) => (record.approvalId === "ap_1" ? null : undefined) }));
    const handle = el('[data-fancy-chat-approval="ap_1"]');
    expect(handle).not.toBeNull();
    expect(handle?.textContent).toBe("");
    expect(isHidden(handle)).toBe(true);
    // The other approval still renders its default card, visibly.
    expect(isHidden(el('[data-fancy-chat-approval="ap_2"]'))).toBe(false);
    expect(el('[data-fancy-chat-approval="ap_2"] [data-fancy-chat-option="o1"]')).not.toBeNull();
  });

  it("passes actionable true only to the actionable record", () => {
    const seen: Record<string, boolean> = {};
    render(thread(fixture(), { renderApproval: (record, ctx) => { seen[record.approvalId] = ctx.actionable; return <i />; } }));
    expect(seen).toEqual({ ap_1: true, ap_2: false });
  });

  it("passes actionable false to every record without onDecide", () => {
    const seen: boolean[] = [];
    render(thread(fixture(), { onDecide: undefined, renderApproval: (_record, ctx) => { seen.push(ctx.actionable); return <i />; } }));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((v) => v === false)).toBe(true);
  });

  it("passes actionable false when the surface may not act on approvals", () => {
    const seen: boolean[] = [];
    render(thread(fixture(), { actionableKinds: ["question"], renderApproval: (_record, ctx) => { seen.push(ctx.actionable); return <i />; } }));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((v) => v === false)).toBe(true);
  });

  it("passes onDecide through, and a decision reaches the host's handler", () => {
    const onDecide = vi.fn();
    const renderApproval = (record: ApprovalRecord, ctx: ApprovalRenderContext) => (
      <button data-testid={`go-${record.approvalId}`} onClick={() => void ctx.onDecide({ approvalId: record.approvalId, optionId: "o1", decision: "approve" })}>
        go
      </button>
    );
    render(thread(fixture(), { onDecide, renderApproval }));
    fireEvent.click(el('[data-testid="go-ap_1"]')!);
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith({ approvalId: "ap_1", optionId: "o1", decision: "approve" });
  });

  it("passes the merged labels, with the host's override applied", () => {
    let labels: ApprovalRenderContext["labels"] | undefined;
    render(thread(fixture(), { labels: { approvalNote: "Why?" }, renderApproval: (_record, ctx) => { labels = ctx.labels; return <i />; } }));
    expect(labels?.approvalNote).toBe("Why?");
    expect(labels?.approvalWaiting).toBe(DEFAULT_LABELS.approvalWaiting);
  });
});

describe("a null approval leaves no empty chrome", () => {
  const listRows = () => el("[data-react-fancy-virtual-list]")?.getAttribute("data-react-fancy-virtual-list-rows");
  const sizerHeight = () => el("[data-react-fancy-virtual-list-sizer]")?.style.height;

  it("an approval row leaves the virtual list, because the list cannot measure a row to zero", () => {
    const p = asRow();
    render(thread(p, { estimateRowHeight: 50, renderApproval: (record) => (record.approvalId === "ap_1" ? null : undefined) }));
    expect(listRows()).toBe("1");
    expect(sizerHeight()).toBe("50px");
    expect(el('[data-fancy-chat-row="approval"] [data-fancy-chat-approval="ap_1"]')).not.toBeNull();
  });

  it("the row comes back when the renderer stops returning null", () => {
    const p = asRow();
    const hide = (record: ApprovalRecord) => (record.approvalId === "ap_1" ? null : undefined);
    const { rerender } = render(thread(p, { renderApproval: hide }));
    expect(listRows()).toBe("1");
    rerender(thread(p, { renderApproval: () => undefined }));
    expect(listRows()).toBe("2");
    expect(isHidden(el('[data-fancy-chat-approval="ap_1"]'))).toBe(false);
  });

  it("in a message with other content, only the part's wrapper is hidden", () => {
    render(thread(asPart(), { renderApproval: (record) => (record.approvalId === "ap_1" ? null : undefined) }));
    const part = el('[data-fancy-chat-part="p_ap_1"]');
    expect(part?.hasAttribute("hidden")).toBe(true);
    expect(part?.getAttribute("data-fancy-chat-part-kind")).toBe("approval");
    expect(isHidden(el('[data-fancy-chat-message="m_1"]'))).toBe(false);
    expect(el('[data-fancy-chat-part="p_text"]')?.textContent).toContain("Before the approval");
  });

  it("a message holding only hidden approvals leaves no empty bubble, and keeps its handles", () => {
    const p = projectThread([message(1, "m_1", [approvalPart("ap_1")]), requested(2, "ap_1")]);
    const rows = p.rows.filter((r: Row) => r.kind === "message");
    render(thread({ rows, state: p.state }, { renderApproval: () => null }));
    expect(listRows()).toBe("0");
    expect(isHidden(el('[data-fancy-chat-message="m_1"]'))).toBe(true);
    expect(el('[data-fancy-chat-part="p_ap_1"] [data-fancy-chat-approval="ap_1"]')).not.toBeNull();
  });

  it("a message with a part the profile renders as text is not collapsed", () => {
    const p = projectThread([message(1, "m_1", [approvalPart("ap_1")]), requested(2, "ap_1")]);
    const rows = p.rows.filter((r: Row) => r.kind === "message");
    render(thread({ rows, state: p.state }, { profile: { name: "s", parts: ["text"] } as never, renderApproval: () => null }));
    expect(listRows()).toBe("1");
    expect(isHidden(el('[data-fancy-chat-message="m_1"]'))).toBe(false);
  });

  it("a row the host replaced through renderRow is not collapsed", () => {
    const p = asRow();
    render(thread(p, { renderRow: (row) => (row.kind === "approval" ? <b data-testid={`row-${row.approvalId}`} /> : undefined), renderApproval: () => null }));
    expect(listRows()).toBe("2");
    expect(isHidden(el('[data-testid="row-ap_1"]'))).toBe(false);
  });
});
