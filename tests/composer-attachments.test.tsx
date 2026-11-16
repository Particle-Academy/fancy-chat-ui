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
});
