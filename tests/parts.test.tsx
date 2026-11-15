import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createPartRegistry, type Part } from "@particle-academy/fancy-chat-js";

import { PartView } from "../src/index";

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;

describe("PartView", () => {
  it("renders markdown text through ContentRenderer, sanitised", () => {
    render(<PartView part={{ id: "p", kind: "text", format: "markdown", text: "Hi **there** <script>alert(1)</script>" }} />);
    const part = el('[data-fancy-chat-part="p"]');
    expect(part?.getAttribute("data-fancy-chat-part-kind")).toBe("text");
    expect(part?.querySelector("strong")?.textContent).toBe("there");
    expect(part?.querySelector("script")).toBeNull();
  });

  it("renders plain text literally", () => {
    render(<PartView part={{ id: "p", kind: "text", format: "plain", text: "**not bold**" }} />);
    expect(el('[data-fancy-chat-part="p"]')?.querySelector("strong")).toBeNull();
    expect(el('[data-fancy-chat-part="p"]')?.textContent).toContain("**not bold**");
  });

  it("renders a table with its columns and rows", () => {
    render(<PartView part={{ id: "t", kind: "table", columns: [{ key: "a", label: "A" }, { key: "b", label: "B" }], rows: [{ a: 1, b: "x" }] }} />);
    const cells = [...document.querySelectorAll('[data-fancy-chat-part="t"] td')].map((c) => c.textContent);
    expect(cells).toEqual(["1", "x"]);
  });

  it("renders code through CodeBlock", () => {
    render(<PartView part={{ id: "c", kind: "code", language: "ts", code: "const a = 1;" }} />);
    expect(el('[data-fancy-chat-part="c"]')?.textContent).toContain("const a = 1;");
  });

  it("card links render only for http(s); post-back reports the action", () => {
    const onCardAction = vi.fn();
    const card: Part = {
      id: "k",
      kind: "card",
      cardType: "deal",
      title: "Acme",
      body: [{ id: "k1", kind: "text", format: "plain", text: "Won" }],
      actions: [
        { id: "open", label: "Open", kind: "link", href: "https://example.com/d/1" },
        { id: "evil", label: "Evil", kind: "link", href: "javascript:alert(1)" },
        { id: "nudge", label: "Nudge", kind: "post-back" },
      ],
    };
    render(<PartView part={card} onCardAction={onCardAction} />);
    expect(el('[data-fancy-chat-card-action="open"]')?.getAttribute("href")).toBe("https://example.com/d/1");
    expect(el('[data-fancy-chat-card-action="evil"]')).toBeNull();
    fireEvent.click(el('[data-fancy-chat-card-action="nudge"]')!);
    expect(onCardAction).toHaveBeenCalledWith(card, "nudge");
    expect(el('[data-fancy-chat-part="k1"]')?.textContent).toContain("Won");
  });

  it("a file links only through the host resolver, and only to http(s)", () => {
    const part: Part = { id: "f", kind: "file", name: "a.pdf", mimeType: "application/pdf", size: 1, ref: "f_1" };
    const { rerender } = render(<PartView part={part} />);
    expect(el('[data-fancy-chat-part="f"] a')).toBeNull();
    rerender(<PartView part={part} resolveRef={() => ({ href: "javascript:x" })} />);
    expect(el('[data-fancy-chat-part="f"] a')).toBeNull();
    rerender(<PartView part={part} resolveRef={() => ({ href: "https://example.com/f/1" })} />);
    expect(el('[data-fancy-chat-part="f"] a')?.getAttribute("rel")).toContain("noopener");
  });

  it("an unknown kind is never dropped: its text renders in a chip", () => {
    const registry = createPartRegistry([{ kind: "x-moic.deal", toText: (p) => `Deal #${String(p.dealId)}` }]);
    render(<PartView part={{ id: "x", kind: "x-moic.deal", dealId: 7 }} registry={registry} />);
    expect(el('[data-fancy-chat-part="x"]')?.hasAttribute("data-fancy-chat-part-unknown")).toBe(true);
    expect(el('[data-fancy-chat-part="x"]')?.textContent).toContain("Deal #7");
  });

  it("an app renderer replaces the default for its kind", () => {
    render(<PartView part={{ id: "x", kind: "x-moic.deal", dealId: 7 }} renderers={{ "x-moic.deal": (p) => <b data-deal="">{String(p.dealId)}</b> }} />);
    expect(el("[data-deal]")?.textContent).toBe("7");
  });
});
