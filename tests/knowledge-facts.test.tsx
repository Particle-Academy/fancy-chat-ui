import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  FactsExplorer,
  G282_VERSION,
  KnowledgeExplorer,
  factGraphOption,
  readFactListing,
  type FactGraphProps,
  type KnowledgeAdapter,
  type KnowledgeFact,
} from "../src/knowledge/index";
import { flush } from "./helpers";

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const all = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];

const fact = (over: Partial<KnowledgeFact> = {}): KnowledgeFact => ({
  id: "f_1",
  subject: "acme",
  predicate: "refund_window",
  object: "30 days",
  evidence: ["c_1"],
  validFrom: "2026-01-01T00:00:00Z",
  validTo: null,
  supersededBy: null,
  status: "accepted",
  recordedAt: "2026-11-01T00:00:00Z",
  expiredAt: null,
  ...over,
});
const listing = <T,>(items: T[], contractVersion: unknown = G282_VERSION) => ({ contractVersion, items, nextCursor: null });
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
const chunk = (id: string, text: string) => ({ chunkId: id, sourceId: "s_1", text, position: 1, provenance });

const FACTS = [
  fact(),
  fact({ id: "f_2", predicate: "ceo", object: "Ada", status: "proposed", evidence: ["c_2"] }),
  fact({ id: "f_3", predicate: "mood", object: "optimistic", status: "belief", evidence: ["c_3"] }),
];

function adapter(over: Partial<KnowledgeAdapter> = {}): KnowledgeAdapter {
  return {
    search: vi.fn(async () => listing([])),
    facts: vi.fn(async () => listing(FACTS)),
    factTimeline: vi.fn(async () =>
      listing([
        fact({ id: "f_0", object: "14 days", validFrom: "2025-01-01T00:00:00Z", validTo: "2026-01-01T00:00:00Z", supersededBy: "f_1", recordedAt: "2025-01-02T00:00:00Z", expiredAt: "2026-11-01T00:00:00Z" }),
        fact(),
        fact({ id: "f_2", predicate: "ceo", object: "Ada", status: "proposed" }),
      ]),
    ),
    getChunks: vi.fn(async (ids: string[]) => listing(ids.map((id) => chunk(id, `Passage ${id}: refunds within 30 days.`)))),
    ...over,
  };
}

async function mount(ui: React.ReactElement) {
  const r = render(ui);
  await act(flush);
  return r;
}

describe("readFactListing (prism-graph 0.3 Fact, g282.1 envelope)", () => {
  it("accepts the shape", () => {
    expect(readFactListing(listing(FACTS)).ok).toBe(true);
  });
  it("refuses an unknown or missing contractVersion, naming it", () => {
    expect(readFactListing(listing(FACTS, "g282.2"))).toEqual({ ok: false, error: "knowledge.version", version: "g282.2" });
    expect(readFactListing({ items: FACTS, nextCursor: null })).toEqual({ ok: false, error: "knowledge.version", version: null });
  });
  it("refuses an unknown status, or a malformed fact, instead of guessing", () => {
    expect(readFactListing(listing([fact({ status: "maybe" as never })])).ok).toBe(false);
    expect(readFactListing(listing([fact({ evidence: "c_1" as never })])).ok).toBe(false);
    expect(readFactListing(listing([fact({ object: 7 as never })])).ok).toBe(false);
  });
});

describe("FactsExplorer", () => {
  it("renders nothing without an adapter that reads facts", async () => {
    await mount(<FactsExplorer adapter={{ search: async () => listing([]) }} subject="acme" />);
    expect(el("[data-fancy-chat-facts]")).toBeNull();
  });

  it("lists a subject's facts with their status, asking for unaccepted ones by default", async () => {
    const a = adapter();
    await mount(<FactsExplorer adapter={a} subject="acme" />);
    expect(a.facts).toHaveBeenCalledWith("acme", { unaccepted: true });
    expect(all("[data-fancy-chat-fact]").map((r) => [r.getAttribute("data-fancy-chat-fact"), r.getAttribute("data-fancy-chat-fact-status")])).toEqual([
      ["f_1", "accepted"],
      ["f_2", "proposed"],
      ["f_3", "belief"],
    ]);
    expect(el('[data-fancy-chat-fact="f_2"] [data-fancy-chat-fact-status-badge]')?.textContent).toBe("Proposal");
    expect(el('[data-fancy-chat-fact="f_3"] [data-fancy-chat-fact-status-badge]')?.textContent).toBe("Belief");
  });

  it("can be limited to accepted facts", async () => {
    const a = adapter();
    await mount(<FactsExplorer adapter={a} subject="acme" includeUnaccepted={false} />);
    expect(a.facts).toHaveBeenCalledWith("acme", { unaccepted: false });
  });

  it("refuses a listing in an unknown version and shows none of it", async () => {
    await mount(<FactsExplorer adapter={adapter({ facts: async () => listing(FACTS, "g999") })} subject="acme" />);
    expect(el('[data-fancy-chat-knowledge-error="facts"]')?.textContent).toContain('"g999"');
    expect(all("[data-fancy-chat-fact]")).toHaveLength(0);
  });

  it("renders every string as plain text", async () => {
    await mount(<FactsExplorer adapter={adapter({ facts: async () => listing([fact({ object: "<img src=x onerror=alert(1)>" })]) })} subject="acme" />);
    expect(el("[data-fancy-chat-facts] img")).toBeNull();
    expect(el('[data-fancy-chat-fact="f_1"]')?.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("the subject is controlled", async () => {
    const onSubjectChange = vi.fn();
    const a = adapter();
    const { rerender } = await mount(<FactsExplorer adapter={a} subject="acme" onSubjectChange={onSubjectChange} />);
    fireEvent.change(el("[data-fancy-chat-facts-subject] input")!, { target: { value: "globex" } });
    fireEvent.click(el("[data-fancy-chat-facts-load]")!);
    expect(onSubjectChange).toHaveBeenCalledWith("globex");
    rerender(<FactsExplorer adapter={a} subject="globex" onSubjectChange={onSubjectChange} />);
    await act(flush);
    expect(a.facts).toHaveBeenLastCalledWith("globex", { unaccepted: true });
  });

  it("the drawer shows evidence passages and the version timeline of that predicate", async () => {
    const a = adapter();
    await mount(<FactsExplorer adapter={a} subject="acme" />);
    fireEvent.click(el('[data-fancy-chat-fact-open="f_1"]')!);
    await act(flush);
    expect(a.getChunks).toHaveBeenCalledWith(["c_1"]);
    expect(a.factTimeline).toHaveBeenCalledWith("acme");
    expect(el('[data-fancy-chat-fact-evidence="c_1"]')?.textContent).toContain("Passage c_1");
    expect(el('[data-fancy-chat-fact-evidence="c_1"]')?.textContent).toContain("file:///handbook.pdf");
    // Versions of refund_window only, oldest first; the ceo fact is another predicate.
    expect(all("[data-fancy-chat-fact-version]").map((v) => v.getAttribute("data-fancy-chat-fact-version"))).toEqual(["f_0", "f_1"]);
    expect(el('[data-fancy-chat-fact-version="f_0"]')?.getAttribute("data-fancy-chat-fact-version-current")).toBe("false");
    expect(el('[data-fancy-chat-fact-version="f_1"]')?.getAttribute("data-fancy-chat-fact-version-current")).toBe("true");
  });

  it("the open fact is controlled", async () => {
    const onOpenFactChange = vi.fn();
    await mount(<FactsExplorer adapter={adapter()} subject="acme" openFactId={null} onOpenFactChange={onOpenFactChange} />);
    fireEvent.click(el('[data-fancy-chat-fact-open="f_2"]')!);
    expect(onOpenFactChange).toHaveBeenCalledWith("f_2");
    expect(el("[data-fancy-chat-fact-drawer]")).toBeNull();
  });

  it("refuses evidence in an unknown version", async () => {
    await mount(<FactsExplorer adapter={adapter({ getChunks: async () => listing([chunk("c_1", "x")], "g0") })} subject="acme" openFactId="f_1" />);
    expect(el('[data-fancy-chat-knowledge-error="evidence"]')?.textContent).toContain('"g0"');
    expect(el('[data-fancy-chat-fact-evidence="c_1"]')).toBeNull();
  });

  it("offers Accept and Reject on a proposal only, and only with the host's callbacks", async () => {
    const { rerender } = await mount(<FactsExplorer adapter={adapter()} subject="acme" />);
    expect(el("[data-fancy-chat-fact-accept]")).toBeNull();
    const onAccept = vi.fn(async () => {});
    const onReject = vi.fn(async () => {});
    rerender(<FactsExplorer adapter={adapter()} subject="acme" onAccept={onAccept} onReject={onReject} />);
    await act(flush);
    expect(all("[data-fancy-chat-fact-accept]").map((b) => b.getAttribute("data-fancy-chat-fact-accept"))).toEqual(["f_2"]);
    expect(all("[data-fancy-chat-fact-reject]").map((b) => b.getAttribute("data-fancy-chat-fact-reject"))).toEqual(["f_2"]);
  });

  it("Accept calls the host with the fact, locks while in flight, then reloads", async () => {
    let release!: () => void;
    const onAccept = vi.fn(() => new Promise<void>((r) => (release = r)));
    const a = adapter();
    await mount(<FactsExplorer adapter={a} subject="acme" onAccept={onAccept} onReject={async () => {}} />);
    const accept = el('[data-fancy-chat-fact-accept="f_2"]')!;
    fireEvent.click(accept);
    fireEvent.click(accept);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({ id: "f_2", status: "proposed" }));
    expect((el('[data-fancy-chat-fact-reject="f_2"]') as HTMLButtonElement).disabled).toBe(true);
    const before = (a.facts as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => {
      release();
      await flush();
    });
    expect((a.facts as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1);
  });

  it("Reject calls the host with the fact", async () => {
    const onReject = vi.fn(async () => {});
    await mount(<FactsExplorer adapter={adapter()} subject="acme" onAccept={async () => {}} onReject={onReject} />);
    fireEvent.click(el('[data-fancy-chat-fact-reject="f_2"]')!);
    await act(flush);
    expect(onReject).toHaveBeenCalledWith(expect.objectContaining({ id: "f_2" }));
  });

  it("a failed decision shows an error and unlocks", async () => {
    await mount(<FactsExplorer adapter={adapter()} subject="acme" onAccept={async () => Promise.reject(new Error("403"))} onReject={async () => {}} />);
    fireEvent.click(el('[data-fancy-chat-fact-accept="f_2"]')!);
    await act(flush);
    expect(el('[data-fancy-chat-knowledge-error="decision"]')).not.toBeNull();
    expect((el('[data-fancy-chat-fact-accept="f_2"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it("the adapter has no accept or reject: decisions never travel through it", async () => {
    // A co-driving agent may hold the adapter (search, read); it must not be able to accept.
    const a = adapter() as unknown as Record<string, unknown>;
    expect("accept" in a || "reject" in a || "acceptFact" in a).toBe(false);
  });

  it("passes facts and their evidence to the host's graph, and a node click opens a fact", async () => {
    const seen: FactGraphProps[] = [];
    const Graph = (p: FactGraphProps) => {
      seen.push(p);
      return <button data-graph-probe="" onClick={() => p.onSelectFact("f_3")} />;
    };
    const onOpenFactChange = vi.fn();
    await mount(<FactsExplorer adapter={adapter()} subject="acme" graph={Graph} onOpenFactChange={onOpenFactChange} />);
    expect(seen.at(-1)?.facts.map((f) => f.id)).toEqual(["f_1", "f_2", "f_3"]);
    fireEvent.click(el("[data-graph-probe]")!);
    expect(onOpenFactChange).toHaveBeenCalledWith("f_3");
  });

  it("KnowledgeExplorer embeds the facts explorer when the adapter reads facts", async () => {
    const onAccept = vi.fn(async () => {});
    await mount(<KnowledgeExplorer adapter={adapter()} factSubject="acme" onAcceptFact={onAccept} onRejectFact={async () => {}} />);
    expect(all("[data-fancy-chat-fact]")).toHaveLength(3);
    fireEvent.click(el('[data-fancy-chat-fact-accept="f_2"]')!);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});

describe("factGraphOption (an ECharts graph series, no ECharts import)", () => {
  it("subjects and facts are nodes; edges run subject to fact and fact to evidence", () => {
    const option = factGraphOption(FACTS) as { series: { type: string; data: { id: string; category: number; name: string }[]; links: { source: string; target: string }[]; categories: { name: string }[] }[] };
    const s = option.series[0]!;
    expect(s.type).toBe("graph");
    expect(s.categories.map((c) => c.name)).toEqual(["Subject", "Fact", "Evidence"]);
    expect(s.data.map((n) => [n.id, n.category])).toEqual([
      ["subject:acme", 0],
      ["fact:f_1", 1],
      ["evidence:c_1", 2],
      ["fact:f_2", 1],
      ["evidence:c_2", 2],
      ["fact:f_3", 1],
      ["evidence:c_3", 2],
    ]);
    expect(s.links).toEqual([
      { source: "subject:acme", target: "fact:f_1" },
      { source: "fact:f_1", target: "evidence:c_1" },
      { source: "subject:acme", target: "fact:f_2" },
      { source: "fact:f_2", target: "evidence:c_2" },
      { source: "subject:acme", target: "fact:f_3" },
      { source: "fact:f_3", target: "evidence:c_3" },
    ]);
    expect(s.data.find((n) => n.id === "fact:f_1")?.name).toBe("refund_window: 30 days");
  });

  it("shared evidence is one node with two edges", () => {
    const s = (factGraphOption([fact(), fact({ id: "f_2", evidence: ["c_1"] })]) as { series: { data: { id: string }[]; links: unknown[] }[] }).series[0]!;
    expect(s.data.filter((n) => n.id === "evidence:c_1")).toHaveLength(1);
    expect(s.links).toHaveLength(4);
  });

  it("labels: the host names the categories", () => {
    const s = (factGraphOption(FACTS, { subject: "S", fact: "F", evidence: "E" }) as { series: { categories: { name: string }[] }[] }).series[0]!;
    expect(s.categories.map((c) => c.name)).toEqual(["S", "F", "E"]);
  });
});
