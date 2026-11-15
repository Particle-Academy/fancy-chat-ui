import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalRecord, QuestionRecord } from "@particle-academy/fancy-chat-js";

import { ApprovalCard, QuestionForm } from "../src/index";

const approval: ApprovalRecord = {
  approvalId: "ap_1",
  title: "Send the email?",
  summary: "To 3 recipients",
  preview: [{ id: "pv", kind: "text", format: "plain", text: "Hi all" }],
  // Labels deliberately contradict kinds: tone must come from the KIND.
  options: [
    { id: "o_yes", kind: "allow-once", label: "Reject" },
    { id: "o_no", kind: "reject-once", label: "Approve" },
    { id: "o_edit", kind: "edit", label: "Edit" },
  ],
  state: "pending",
};

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;

describe("ApprovalCard", () => {
  it("renders the record with stable handles and tone from the option kind", () => {
    render(<ApprovalCard record={approval} actionable onDecide={() => {}} />);
    const card = el('[data-fancy-chat-approval="ap_1"]');
    expect(card?.getAttribute("data-fancy-chat-approval-state")).toBe("pending");
    expect(el('[data-fancy-chat-option="o_yes"]')?.getAttribute("data-fancy-chat-option-tone")).toBe("positive");
    expect(el('[data-fancy-chat-option="o_no"]')?.getAttribute("data-fancy-chat-option-tone")).toBe("negative");
    expect(el('[data-fancy-chat-option="o_edit"]')?.getAttribute("data-fancy-chat-option-tone")).toBe("neutral");
    expect(screen.getByText("Hi all")).toBeTruthy();
  });

  it("decides with the option and note, and locks while the decision posts", async () => {
    let resolve: () => void = () => {};
    const onDecide = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(<ApprovalCard record={approval} actionable onDecide={onDecide} />);
    fireEvent.change(el('[data-fancy-chat-approval-note] textarea')!, { target: { value: "looks fine" } });
    fireEvent.click(el('[data-fancy-chat-option="o_yes"]')!);
    expect(onDecide).toHaveBeenCalledWith({ approvalId: "ap_1", optionId: "o_yes", decision: "approve", note: "looks fine" });
    expect((el('[data-fancy-chat-option="o_no"]') as HTMLButtonElement).disabled).toBe(true);
    expect(el('[data-fancy-chat-approval="ap_1"]')?.getAttribute("data-fancy-chat-approval-busy")).toBe("true");
    fireEvent.click(el('[data-fancy-chat-option="o_no"]')!);
    expect(onDecide).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
  });

  it("a second click in the same tick, before React re-renders, is refused by the lock", () => {
    let nested = false;
    const onDecide = vi.fn(() => {
      if (!nested) {
        nested = true;
        // Still inside the first click's handler: the buttons are not disabled yet.
        fireEvent.click(el('[data-fancy-chat-option="o_no"]')!);
      }
      return new Promise<void>(() => {});
    });
    render(<ApprovalCard record={approval} actionable onDecide={onDecide} />);
    fireEvent.click(el('[data-fancy-chat-option="o_yes"]')!);
    expect(onDecide).toHaveBeenCalledTimes(1);
  });

  it("offers no decision when it is not the actionable item, or not pending", () => {
    const { rerender } = render(<ApprovalCard record={approval} actionable={false} onDecide={() => {}} />);
    expect((el('[data-fancy-chat-option="o_yes"]') as HTMLButtonElement).disabled).toBe(true);
    rerender(<ApprovalCard record={{ ...approval, state: "applied" }} actionable onDecide={() => {}} />);
    expect(el('[data-fancy-chat-option="o_yes"]')).toBeNull();
    expect(el('[data-fancy-chat-approval="ap_1"]')?.getAttribute("data-fancy-chat-approval-state")).toBe("applied");
  });

  it("an option kind outside the contract is never offered", () => {
    render(<ApprovalCard record={{ ...approval, options: [{ id: "x", kind: "approve-everything" as never, label: "Go" }] }} actionable onDecide={() => {}} />);
    expect(el('[data-fancy-chat-option="x"]')).toBeNull();
  });
});

const question: QuestionRecord = {
  questionId: "q_1",
  prompt: "How should we ship?",
  fields: [
    { id: "when", type: "single", label: "When", options: [{ id: "now", label: "Now" }, { id: "later", label: "Later" }], required: true },
    { id: "why", type: "text", label: "Why", required: false },
  ],
  allowNote: true,
  state: "open",
};

describe("QuestionForm", () => {
  it("is controlled: the draft comes from props and edits go to onDraftChange", () => {
    const onDraftChange = vi.fn();
    render(<QuestionForm question={question} draft={{ values: {}, notes: {} }} onDraftChange={onDraftChange} onSubmit={() => {}} actionable />);
    fireEvent.click(screen.getByLabelText("Now"));
    expect(onDraftChange).toHaveBeenLastCalledWith({ values: { when: "now" }, notes: {} });
  });

  it("enables Answer only when every required field has an option or a note", () => {
    const { rerender } = render(<QuestionForm question={question} draft={{ values: {}, notes: {} }} onDraftChange={() => {}} onSubmit={() => {}} actionable />);
    const submit = () => el('[data-fancy-chat-question-submit]') as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    rerender(<QuestionForm question={question} draft={{ values: {}, notes: { when: "either" } }} onDraftChange={() => {}} onSubmit={() => {}} actionable />);
    expect(submit().disabled).toBe(false);
  });

  it("submits the draft, and shows Later and Dismiss only when the host wires them", () => {
    const onSubmit = vi.fn();
    const onLater = vi.fn();
    render(<QuestionForm question={question} draft={{ values: { when: "later" }, notes: {} }} onDraftChange={() => {}} onSubmit={onSubmit} onLater={onLater} actionable />);
    fireEvent.click(el('[data-fancy-chat-question-submit]')!);
    expect(onSubmit).toHaveBeenCalledWith({ questionId: "q_1", values: { when: "later" }, notes: {} });
    expect(el("[data-fancy-chat-question-later]")).not.toBeNull();
    expect(el("[data-fancy-chat-question-dismiss]")).toBeNull();
  });

  it("an answered question offers no inputs", () => {
    render(<QuestionForm question={{ ...question, state: "answered" }} draft={{ values: {}, notes: {} }} onDraftChange={() => {}} onSubmit={() => {}} actionable />);
    expect(el("[data-fancy-chat-question-submit]")).toBeNull();
    expect(el('[data-fancy-chat-question="q_1"]')?.getAttribute("data-fancy-chat-question-state")).toBe("answered");
  });
});
