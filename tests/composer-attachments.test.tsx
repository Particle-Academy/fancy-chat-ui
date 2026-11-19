import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentComposer, type AgentComposerProps } from "../src/index";
import { flush } from "./helpers";

/*
 * Attachments are on by default (Aion must not be text-only) and passed straight
 * through to react-fancy PromptInput (6.28.0): `attachments={false}` removes every
 * way to attach, for a host whose backend cannot take files.
 */

const attach = () => document.querySelector("[data-react-fancy-prompt-input-attach]");

function composer(over: Partial<AgentComposerProps> = {}) {
  return <AgentComposer threadId="t_1" drafts={{}} onDraftsChange={vi.fn()} onSend={vi.fn()} {...over} />;
}

describe("AgentComposer attachments", () => {
  it("offers attaching by default", async () => {
    render(composer());
    await act(flush);
    expect(attach()).not.toBeNull();
  });

  it("passes attachments={false} through to PromptInput, which then offers no way to attach", async () => {
    render(composer({ attachments: false }));
    await act(flush);
    expect(attach()).toBeNull();
    expect(document.querySelector('[data-fancy-chat-composer="t_1"] input[type="file"]')).toBeNull();
  });

  it("with attachments={false} a dropped or pasted file never reaches the draft", async () => {
    const onDraftsChange = vi.fn();
    render(composer({ attachments: false, onDraftsChange }));
    await act(flush);

    const drop = dropFile(new File(["x"], "a.pdf", { type: "application/pdf" }));
    const paste = pasteFile(new File(["x"], "shot.png", { type: "image/png" }));

    expect(drop.defaultPrevented).toBe(false);
    expect(paste.defaultPrevented).toBe(false);
    for (const [drafts] of onDraftsChange.mock.calls) expect(drafts.t_1.attachments).toEqual([]);
  });

  it("with attachments on (explicit or default) a dropped file reaches the draft", async () => {
    for (const over of [{ attachments: true }, {}]) {
      const onDraftsChange = vi.fn();
      const { unmount } = render(composer({ ...over, onDraftsChange }));
      await act(flush);

      const drop = dropFile(new File(["x"], "a.pdf", { type: "application/pdf" }));

      expect(drop.defaultPrevented).toBe(true);
      const last = onDraftsChange.mock.calls.at(-1)![0];
      expect(last.t_1.attachments.map((a: { name: string }) => a.name)).toEqual(["a.pdf"]);
      unmount();
    }
  });
});

/** jsdom has no DataTransfer, so hand React the shape its handler reads. */
function dropFile(f: File): Event {
  const target = document.querySelector('[data-fancy-chat-composer="t_1"] [data-react-fancy-prompt-input]')!;
  const ev = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: { files: [f] } });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

function pasteFile(f: File): Event {
  const ta = document.querySelector('[data-fancy-chat-composer="t_1"] textarea')!;
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: { files: [f], types: ["Files"], getData: () => "" },
  });
  act(() => {
    ta.dispatchEvent(ev);
  });
  return ev;
}
