import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FactsExplorer, G282_VERSION, readChunkListing, type KnowledgeAdapter, type KnowledgeChunk, type KnowledgeFact } from "../src/knowledge/index";
import { flush } from "./helpers";

/*
 * CC-fancy-0044 (approved): fact dates are formatted for people, the evidence
 * line can be relabelled, and evidence carries its source's title.
 */

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;

const fact = (over: Partial<KnowledgeFact> = {}): KnowledgeFact => ({
  id: "f_1",
  subject: "acme",
  predicate: "refund_window",
  object: "30 days",
  evidence: ["c_1"],
  validFrom: "2026-01-01T09:30:00Z",
  validTo: null,
  supersededBy: null,
  status: "accepted",
  recordedAt: "2026-11-01T00:00:00Z",
  expiredAt: null,
  ...over,
});
const listing = <T,>(items: T[]) => ({ contractVersion: G282_VERSION, items, nextCursor: null });
const provenance = {
  uri: "file:///handbook.pdf",
  sha256: "ab".repeat(32),
  byteStart: 0,
  byteEnd: 120,
  lineStart: 3,
  lineEnd: 4,
  headingPath: ["Refunds"],
  recipe: "pdf-v1",
  trust: "document",
  writer: "ingest",
  recordedAt: "2026-11-15T10:00:00.000000Z",
};
const chunk = (over: Partial<KnowledgeChunk> = {}): KnowledgeChunk => ({ chunkId: "c_1", sourceId: "s_1", text: "Refunds take 30 days.", position: 1, provenance, ...over });

function adapter(chunks: KnowledgeChunk[] = [chunk()]): KnowledgeAdapter {
  return {
    search: vi.fn(async () => listing([])),
    facts: vi.fn(async () => listing([fact()])),
    factTimeline: vi.fn(async () =>
      listing([
        fact({ id: "f_0", object: "14 days", validFrom: "2025-01-01T00:00:00Z", validTo: "2026-01-01T09:30:00Z", supersededBy: "f_1" }),
        fact(),
      ]),
    ),
    getChunks: vi.fn(async () => listing(chunks)),
  };
}

const medium = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

async function openDrawer(ui: React.ReactElement) {
  render(ui);
  await act(flush);
  fireEvent.click(el('[data-fancy-chat-fact-open="f_1"]')!);
  await act(flush);
}

describe("fact dates (formatDate)", () => {
  it("formats every fact date with Intl medium date and short time by default", async () => {
    await openDrawer(<FactsExplorer adapter={adapter()} subject="acme" />);
    const row = el('[data-fancy-chat-fact="f_1"]')!;
    expect(row.textContent).toContain(medium("2026-01-01T09:30:00Z"));
    expect(row.textContent).not.toContain("2026-01-01T09:30:00Z");
    // validRange gets formatted dates too, on every version.
    const old = el('[data-fancy-chat-fact-version="f_0"]')!.textContent!;
    expect(old).toContain(`${medium("2025-01-01T00:00:00Z")} to ${medium("2026-01-01T09:30:00Z")}`);
    expect(el('[data-fancy-chat-fact-version="f_1"]')!.textContent).toContain(`from ${medium("2026-01-01T09:30:00Z")}`);
  });

  it("uses the host's formatter for every date, validRange included", async () => {
    const formatDate = vi.fn((iso: string) => `<${iso.slice(0, 10)}>`);
    await openDrawer(<FactsExplorer adapter={adapter()} subject="acme" formatDate={formatDate} />);
    expect(el('[data-fancy-chat-fact="f_1"]')!.textContent).toContain("<2026-01-01>");
    expect(el('[data-fancy-chat-fact-version="f_0"]')!.textContent).toContain("<2025-01-01> to <2026-01-01>");
    expect(formatDate).not.toHaveBeenCalledWith(null);
  });

  it("shows a date it cannot parse as it came, never Invalid Date", async () => {
    const a = adapter();
    a.facts = vi.fn(async () => listing([fact({ validFrom: "sometime in 2026" })]));
    render(<FactsExplorer adapter={a} subject="acme" />);
    await act(flush);
    expect(el('[data-fancy-chat-fact="f_1"]')!.textContent).toContain("sometime in 2026");
    expect(el('[data-fancy-chat-fact="f_1"]')!.textContent).not.toContain("Invalid");
  });
});

describe("evidence labels (evidenceLabel, sourceTitle)", () => {
  it("keeps today's label when there is no source title", async () => {
    await openDrawer(<FactsExplorer adapter={adapter()} subject="acme" />);
    expect(el('[data-fancy-chat-fact-evidence-label="c_1"]')!.textContent).toBe("Refunds · file:///handbook.pdf · lines 3-4 · document");
  });

  it("leads with the source title, shown as-is even when it is a URI", async () => {
    await openDrawer(<FactsExplorer adapter={adapter([chunk({ sourceTitle: "Refund handbook" })])} subject="acme" />);
    expect(el('[data-fancy-chat-fact-evidence-label="c_1"]')!.textContent).toBe("Refund handbook · Refunds · file:///handbook.pdf · lines 3-4 · document");
  });

  it("does not repeat a title that is the same URI", async () => {
    await openDrawer(<FactsExplorer adapter={adapter([chunk({ sourceTitle: "file:///handbook.pdf" })])} subject="acme" />);
    expect(el('[data-fancy-chat-fact-evidence-label="c_1"]')!.textContent).toBe("file:///handbook.pdf · Refunds · lines 3-4 · document");
  });

  it("uses the host's label when given", async () => {
    const evidenceLabel = vi.fn((c: KnowledgeChunk) => `${c.sourceTitle ?? "?"} p.${c.position}`);
    await openDrawer(<FactsExplorer adapter={adapter([chunk({ sourceTitle: "Handbook" })])} subject="acme" evidenceLabel={evidenceLabel} />);
    expect(el('[data-fancy-chat-fact-evidence-label="c_1"]')!.textContent).toBe("Handbook p.1");
  });
});

describe("readChunkListing and sourceTitle", () => {
  it("accepts an optional string sourceTitle, and refuses any other type", () => {
    expect(readChunkListing(listing([chunk({ sourceTitle: "Handbook" })])).ok).toBe(true);
    expect(readChunkListing(listing([chunk()])).ok).toBe(true);
    expect(readChunkListing(listing([chunk({ sourceTitle: 7 as never })])).ok).toBe(false);
  });
});
