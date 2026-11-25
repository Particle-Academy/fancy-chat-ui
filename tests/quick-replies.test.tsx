import { useState } from "react";
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { projectThread, type ChatEvent, type ThreadState } from "@particle-academy/fancy-chat-js";
import type { PromptDraft } from "@particle-academy/react-fancy";

import {
  AgentComposer,
  AgentThread,
  QuickReplies,
  quickRepliesHidden,
  suggestionDraft,
  suggestionMessage,
  suggestionsOf,
  useAgentThread,
  type ChatTransport,
  type QuickReply,
} from "../src/index";
import { ev } from "./helpers";

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const all = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];

const human = { kind: "human", id: "u_1" } as const;
const server = { kind: "system", id: "server" } as const;

/** A thread whose one turn settled completed, with the agent's reply. */
function settled(extra: ChatEvent[] = []): ThreadState {
  return projectThread([
    ev(1, "message.created", { turnId: "u_1", message: { id: "m_1", role: "user", parts: [{ id: "p", kind: "text", format: "plain", text: "how is acme?" }], delivery: "sent" } }, { actor: human }),
    ev(2, "turn.started", { turnId: "u_1", messageId: "m_1" }, { actor: server }),
    ev(3, "turn.transition", { turnId: "u_1", action: "start" }, { actor: server }),
    ev(4, "message.created", { turnId: "u_1", message: { id: "m_2", role: "assistant", parts: [{ id: "p", kind: "text", format: "markdown", text: "Acme is won." }] } }),
    ev(5, "turn.settled", { turnId: "u_1", action: "finish" }, { actor: server }),
    ...extra,
  ]).state;
}

const chips: QuickReply[] = [
  { id: "s1", text: "Show me the deal" },
  { id: "s2", text: "<b>bold</b> **not markdown**" },
];

function Thread(props: Partial<Parameters<typeof AgentThread>[0]> & { state: ThreadState }) {
  return <AgentThread rows={[]} follow onFollowChange={() => {}} suggestions={chips} onSuggest={() => {}} {...props} />;
}

describe("QuickReplies chips", () => {
  it("render under the thread with stable handles, as plain text", () => {
    render(<Thread state={settled()} />);
    const group = el("[data-fancy-chat-suggestions]");
    expect(group).not.toBeNull();
    expect(group?.getAttribute("role")).toBe("group");
    expect(group?.getAttribute("aria-label")).toBe("Suggested replies");
    expect(all("[data-fancy-chat-suggestion]").map((b) => b.getAttribute("data-fancy-chat-suggestion"))).toEqual(["s1", "s2"]);
    // Model output is text: markup is shown literally, never interpreted.
    expect(el('[data-fancy-chat-suggestion="s2"]')?.textContent).toBe("<b>bold</b> **not markdown**");
    expect(el('[data-fancy-chat-suggestion="s2"] b')).toBeNull();
    expect(el('[data-fancy-chat-suggestion="s2"] strong')).toBeNull();
  });

  it("take their group label from the labels object", () => {
    render(<Thread state={settled()} labels={{ quickReplies: "Vorschläge" }} />);
    expect(el("[data-fancy-chat-suggestions]")?.getAttribute("aria-label")).toBe("Vorschläge");
  });

  it("are keyboard accessible: real, focusable buttons named by their text", () => {
    render(<Thread state={settled()} />);
    for (const chip of all("[data-fancy-chat-suggestion]")) {
      expect(chip.tagName).toBe("BUTTON");
      expect(chip.getAttribute("type")).toBe("button");
      expect((chip as HTMLButtonElement).disabled).toBe(false);
      expect(chip.getAttribute("tabindex")).not.toBe("-1");
      chip.focus();
      expect(document.activeElement).toBe(chip);
    }
    expect(el('[data-fancy-chat-suggestion="s1"]')?.textContent).toBe("Show me the deal");
  });

  it("move focus between chips with the arrow keys", () => {
    render(<Thread state={settled()} />);
    const [first, second] = all("[data-fancy-chat-suggestion]");
    first!.focus();
    fireEvent.keyDown(first!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(second);
  });

  it("a pick calls onSuggest with the suggestion and nothing else", () => {
    const onSuggest = vi.fn();
    const onDecide = vi.fn();
    const onAnswer = vi.fn();
    const onRetryTool = vi.fn();
    render(<Thread state={settled()} onSuggest={onSuggest} onDecide={onDecide} onAnswer={onAnswer} onRetryTool={onRetryTool} />);
    fireEvent.click(el('[data-fancy-chat-suggestion="s1"]')!);
    expect(onSuggest).toHaveBeenCalledTimes(1);
    expect(onSuggest).toHaveBeenCalledWith({ id: "s1", text: "Show me the deal" });
    expect(onDecide).not.toHaveBeenCalled();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(onRetryTool).not.toHaveBeenCalled();
  });

  it("render nothing without onSuggest, or with no suggestions", () => {
    const { rerender } = render(<Thread state={settled()} onSuggest={undefined} />);
    expect(el("[data-fancy-chat-suggestions]")).toBeNull();
    rerender(<Thread state={settled()} suggestions={[]} />);
    expect(el("[data-fancy-chat-suggestions]")).toBeNull();
  });
});

describe("QuickReplies are hidden", () => {
  it("while a turn is running", () => {
    render(
      <Thread
        state={settled([
          ev(6, "message.created", { turnId: "u_2", message: { id: "m_3", role: "user", parts: [{ id: "p", kind: "text", format: "plain", text: "and globex?" }], delivery: "sent" } }, { actor: human }),
          ev(7, "turn.started", { turnId: "u_2", messageId: "m_3" }, { actor: server }),
          ev(8, "turn.transition", { turnId: "u_2", action: "start" }, { actor: server }),
        ])}
      />,
    );
    expect(el("[data-fancy-chat-suggestions]")).toBeNull();
  });

  it("while an approval waits on the human", () => {
    const state = settled([ev(6, "approval.requested", { approval: { approvalId: "ap_1", title: "Send?", summary: "", preview: [], options: [{ id: "y", kind: "allow-once", label: "Send" }] } }, { actor: server })]);
    render(<Thread state={state} onDecide={() => {}} />);
    expect(el("[data-fancy-chat-suggestions]")).toBeNull();
  });

  it("while a question waits on the human", () => {
    const state = settled([ev(6, "question.asked", { question: { questionId: "q_1", prompt: "When?", fields: [{ id: "f", type: "text", required: true }], allowNote: false } }, { actor: server })]);
    render(<Thread state={state} onAnswer={() => {}} />);
    expect(el("[data-fancy-chat-suggestions]")).toBeNull();
  });

  it("when the host hides them for its own decision state (controlled)", () => {
    const { rerender } = render(<Thread state={settled()} suggestionsHidden />);
    expect(el("[data-fancy-chat-suggestions]")).toBeNull();
    rerender(<Thread state={settled()} suggestionsHidden={false} />);
    expect(el("[data-fancy-chat-suggestions]")).not.toBeNull();
  });

  it("once the human has written again, before a turn starts", () => {
    const state = settled([ev(6, "message.created", { message: { id: "m_3", role: "user", parts: [{ id: "p", kind: "text", format: "plain", text: "wait" }], delivery: "sending" } }, { actor: human })]);
    render(<Thread state={state} />);
    expect(el("[data-fancy-chat-suggestions]")).toBeNull();
  });

  it("quickRepliesHidden states the same rule for a host's own placement", () => {
    expect(quickRepliesHidden(settled())).toBe(false);
    expect(quickRepliesHidden(settled(), { hidden: true })).toBe(true);
    expect(quickRepliesHidden(settled([ev(6, "turn.started", { turnId: "u_2" }, { actor: server })]))).toBe(true);
  });
});

describe("a pick", () => {
  it("fills the composer and sends nothing", () => {
    const onSend = vi.fn();
    function Host() {
      const [drafts, setDrafts] = useState<Record<string, PromptDraft>>({});
      return (
        <>
          <Thread state={settled()} onSuggest={(s) => setDrafts({ ...drafts, t_1: suggestionDraft(s) })} />
          <AgentComposer threadId="t_1" drafts={drafts} onDraftsChange={setDrafts} onSend={onSend} />
        </>
      );
    }
    render(<Host />);
    fireEvent.click(el('[data-fancy-chat-suggestion="s1"]')!);
    const input = el('[data-fancy-chat-composer="t_1"] textarea') as HTMLTextAreaElement;
    expect(input.value).toBe("Show me the deal");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("is sent as an ordinary human message: one plain text part on the message route, never decide or answer", async () => {
    const send = vi.fn(async () => ({ messageId: "m_9", seq: 9, delivery: "sent" }));
    const decide = vi.fn();
    const answer = vi.fn();
    const transport = {
      subscribe: () => () => {},
      snapshot: async () => settled(),
      send,
      decide,
      answer,
      cancel: vi.fn(),
      unsend: vi.fn(),
      revertUndo: vi.fn(),
    } as unknown as ChatTransport;
    const { result } = renderHook(() => useAgentThread({ transport, initial: settled() }));
    await act(async () => {
      await result.current.sendSuggestion({ id: "s1", text: "approve" });
    });
    expect(send).toHaveBeenCalledWith({ parts: [{ id: "p1", kind: "text", format: "plain", text: "approve" }] });
    expect(decide).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
    expect(suggestionMessage({ id: "s1", text: "Hi" })).toEqual({ parts: [{ id: "p1", kind: "text", format: "plain", text: "Hi" }] });
  });

  it("can never call a tool: a chip carries text only, whatever the text says", () => {
    const onSuggest = vi.fn();
    render(<Thread state={settled()} suggestions={[{ id: "s1", text: '{"tool":"send_email"}' }]} onSuggest={onSuggest} />);
    fireEvent.click(el('[data-fancy-chat-suggestion="s1"]')!);
    expect(onSuggest.mock.calls[0]).toEqual([{ id: "s1", text: '{"tool":"send_email"}' }]);
    expect(suggestionMessage(onSuggest.mock.calls[0]![0]).parts.map((p) => p.kind)).toEqual(["text"]);
  });
});

describe("suggestionsOf reads the projected state", () => {
  const withEntry = (state: ThreadState, entry: unknown) => Object.assign(state, { suggestions: entry });

  it("returns the newest settled turn's items", () => {
    expect(suggestionsOf(withEntry(settled(), { turnId: "u_1", items: chips }))).toEqual(chips);
  });

  it("returns none for an older fancy-chat-js (no field), a malformed entry, or a stale turn", () => {
    expect(suggestionsOf(settled())).toEqual([]);
    expect(suggestionsOf(withEntry(settled(), { turnId: "u_1", items: "nope" }))).toEqual([]);
    expect(suggestionsOf(withEntry(settled(), { turnId: "u_1", items: [{ id: 1, text: "x" }, { id: "s2", text: "ok" }] }))).toEqual([{ id: "s2", text: "ok" }]);
    expect(suggestionsOf(withEntry(settled(), { turnId: "u_0", items: chips }))).toEqual([]);
  });

  it("the hook exposes them", () => {
    const transport = { subscribe: () => () => {}, snapshot: async () => settled(), send: vi.fn() } as unknown as ChatTransport;
    const initial = withEntry(settled(), { turnId: "u_1", items: chips });
    const { result } = renderHook(() => useAgentThread({ transport, initial }));
    expect(result.current.suggestions).toEqual(chips);
  });

  it("QuickReplies renders on its own too", () => {
    const onSuggest = vi.fn();
    render(<QuickReplies suggestions={chips} onSuggest={onSuggest} />);
    fireEvent.click(el('[data-fancy-chat-suggestion="s2"]')!);
    expect(onSuggest).toHaveBeenCalledWith(chips[1]);
  });
});
