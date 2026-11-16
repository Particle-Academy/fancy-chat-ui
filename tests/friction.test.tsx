import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentComposer, PartView, createHttpTransport, useAgentThread, type ChatTransport } from "../src/index";
import { flush } from "./helpers";

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;

describe("PartView image src: only http(s) or a same-origin ROOT path (SECURITY)", () => {
  const part = { id: "i", kind: "image", ref: "r_1", alt: "chart" } as const;
  const srcOf = (src: string) => {
    const { unmount } = render(<PartView part={part} resolveRef={() => ({ src })} />);
    const img = el("img");
    const out = img ? img.getAttribute("src") : null;
    unmount();
    return out;
  };

  it("keeps https and a root-relative path", () => {
    expect(srcOf("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(srcOf("/media/a.png")).toBe("/media/a.png");
  });

  it("refuses a protocol-relative src: //host is another origin, not this one", () => {
    expect(srcOf("//evil.example/a.png")).toBeNull();
  });

  it("refuses a backslash variant, which browsers read as //", () => {
    expect(srcOf("/\\evil.example/a.png")).toBeNull();
  });

  it("refuses other schemes", () => {
    expect(srcOf("javascript:alert(1)")).toBeNull();
    expect(srcOf("data:image/svg+xml,<svg/>")).toBeNull();
  });
});

function transport(over: Partial<ChatTransport> = {}): ChatTransport {
  return {
    subscribe: () => () => {},
    fetchAfter: async () => ({ events: [], next: 0 }),
    send: async () => ({ messageId: "m", seq: 1, delivery: "sent" }),
    cancel: async () => ({ outcome: "ok" }),
    unsend: async () => ({ ok: true }),
    decide: vi.fn(async () => ({})),
    answer: async () => ({}),
    revertUndo: async () => ({}),
    ...over,
  };
}

describe("useAgentThread().decide passes `edited` through", () => {
  it("sends optionId, note and edited; never an actor or a decision", async () => {
    const t = transport();
    const { result } = renderHook(() => useAgentThread({ transport: t }));
    await act(async () => {
      await result.current.decide({ approvalId: "a_1", optionId: "o_edit", decision: "edit", note: "tightened", edited: { subject: "Hello" } });
    });
    expect(t.decide).toHaveBeenCalledWith("a_1", { optionId: "o_edit", note: "tightened", edited: { subject: "Hello" } });
  });

  it("omits edited when there is none", async () => {
    const t = transport();
    const { result } = renderHook(() => useAgentThread({ transport: t }));
    await act(async () => {
      await result.current.decide({ approvalId: "a_1", optionId: "o_ok", decision: "approve" });
    });
    expect(t.decide).toHaveBeenCalledWith("a_1", { optionId: "o_ok" });
    await act(flush);
  });
});

describe("the backend's cancel capability reaches the composer", () => {
  it("AgentComposer canStop={false}: running shows, Stop does not", () => {
    const onStop = vi.fn();
    render(<AgentComposer threadId="t_1" drafts={{}} onDraftsChange={() => {}} onSend={() => {}} running onStop={onStop} canStop={false} />);
    expect(el("[data-react-fancy-prompt-input-stop]")).toBeNull();
    expect(el('[data-fancy-chat-composer="t_1"]')?.getAttribute("data-fancy-chat-running")).toBe("true");
    expect(el('[data-fancy-chat-composer="t_1"]')?.getAttribute("data-fancy-chat-can-stop")).toBe("false");
  });

  it("canStop defaults to true", () => {
    render(<AgentComposer threadId="t_1" drafts={{}} onDraftsChange={() => {}} onSend={() => {}} running onStop={() => {}} />);
    expect(el("[data-react-fancy-prompt-input-stop]")).not.toBeNull();
  });

  it("the HTTP transport reads GET threads/{id}/capabilities", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ capabilities: { cancel: false, steering: false, approvals: true } }), { status: 200 }));
    const t = createHttpTransport({ baseUrl: "/c", threadId: "t_1", fetch: fetch as never });
    await expect(t.capabilities!()).resolves.toEqual({ cancel: false, steering: false, approvals: true });
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("/c/threads/t_1/capabilities");
  });

  it("useAgentThread exposes the capabilities once loaded; null before, and when the transport has none", async () => {
    const t = transport({ capabilities: async () => ({ cancel: false, steering: true, approvals: true }) });
    const { result } = renderHook(() => useAgentThread({ transport: t }));
    expect(result.current.capabilities).toBeNull();
    await act(flush);
    expect(result.current.capabilities).toEqual({ cancel: false, steering: true, approvals: true });
    const bare = renderHook(() => useAgentThread({ transport: transport() }));
    await act(flush);
    expect(bare.result.current.capabilities).toBeNull();
  });

  it("a failed capabilities read leaves them null (Stop stays, the server answers `unsupported`)", async () => {
    const t = transport({ capabilities: async () => Promise.reject(new Error("404")) });
    const { result } = renderHook(() => useAgentThread({ transport: t }));
    await act(flush);
    expect(result.current.capabilities).toBeNull();
  });
});

describe("capabilities: only a well-formed answer counts", () => {
  it("a malformed answer leaves them null", async () => {
    const t = transport({ capabilities: async () => ({ cancel: "no" }) as never });
    const { result } = renderHook(() => useAgentThread({ transport: t }));
    await act(flush);
    expect(result.current.capabilities).toBeNull();
  });
});
