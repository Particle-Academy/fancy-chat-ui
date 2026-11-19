import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * CC-fancy-0044 (approved, owner override), on the map: FactGraph and
 * factGraphOption take `evidenceLabel` and `formatDate`, and an evidence node
 * is named by its chunk's `sourceTitle` when there is one. Today's names are
 * the default.
 */

// jsdom has no canvas: a probe records the option and exposes the tooltip formatter.
let lastOption: { tooltip?: { formatter?: (p: unknown) => string } } | null = null;
vi.mock("@particle-academy/fancy-echarts", () => ({
  EChart: (props: { option: { tooltip?: { formatter?: (p: unknown) => string } } }) => {
    lastOption = props.option;
    return <div data-echart-probe="" data-option={JSON.stringify(props.option)} />;
  },
}));

import { FactGraph } from "../src/charts/index";
import { FactsExplorer, factGraphOption, G282_VERSION, type FactGraphNode, type FactGraphProps, type KnowledgeAdapter, type KnowledgeChunk, type KnowledgeFact } from "../src/knowledge/index";
import { flush } from "./helpers";

const fact = (over: Partial<KnowledgeFact> = {}): KnowledgeFact => ({
  id: "f_1",
  subject: "acme",
  predicate: "refund_window",
  object: "30 days",
  evidence: ["c_1", "c_2"],
  validFrom: "2026-01-01T09:30:00Z",
  validTo: null,
  supersededBy: null,
  status: "accepted",
  recordedAt: null,
  expiredAt: null,
  ...over,
});
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
const LONG = "Refunds take 30 days from the date of purchase, and are paid to the original card.";
const chunk = (over: Partial<KnowledgeChunk> = {}): KnowledgeChunk => ({ chunkId: "c_1", sourceId: "s_1", text: LONG, position: 1, provenance, ...over });

const nodes = (option: Record<string, unknown>) => (option.series as { data: FactGraphNode[] }[])[0]!.data;
const node = (option: Record<string, unknown>, id: string) => nodes(option).find((n) => n.id === id)!;
const shown = () => JSON.parse(document.querySelector("[data-echart-probe]")!.getAttribute("data-option")!) as Record<string, unknown>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("evidence node labels", () => {
  it("keeps today's name by default: the passage's first 60 characters, or the chunk id when it is not loaded", () => {
    const option = factGraphOption([fact()], undefined, [chunk()]);
    expect(node(option, "evidence:c_1").name).toBe(LONG.slice(0, 60));
    expect(node(option, "evidence:c_2").name).toBe("c_2");
  });

  it("names a node by its chunk's sourceTitle when there is one and no evidenceLabel", () => {
    const option = factGraphOption([fact()], undefined, [chunk({ sourceTitle: "Refund handbook" })]);
    expect(node(option, "evidence:c_1").name).toBe("Refund handbook");
    expect(node(option, "evidence:c_2").name).toBe("c_2");
  });

  it("uses the host's evidenceLabel for every loaded chunk, over sourceTitle", () => {
    const evidenceLabel = vi.fn((c: KnowledgeChunk) => `${c.sourceTitle ?? "?"} p.${c.position}`);
    render(<FactGraph facts={[fact()]} chunks={[chunk({ sourceTitle: "Handbook" })]} onSelectFact={() => {}} evidenceLabel={evidenceLabel} />);
    expect(node(shown(), "evidence:c_1").name).toBe("Handbook p.1");
    // A chunk that is not loaded has nothing to label: its id, as today.
    expect(node(shown(), "evidence:c_2").name).toBe("c_2");
    expect(evidenceLabel).toHaveBeenCalledTimes(1);
  });
});

describe("fact dates on the map (formatDate)", () => {
  it("localises a fact's dates by default, with the browser's locale (pinned here to en-GB, UTC)", async () => {
    // Pin the locale and zone the default reads, so the expected text is a literal.
    const Real = Intl.DateTimeFormat;
    const seen: unknown[] = [];
    vi.stubGlobal("Intl", {
      ...Intl,
      DateTimeFormat: function (locale?: unknown, options?: Intl.DateTimeFormatOptions) {
        seen.push(locale);
        return new Real("en-GB", { ...options, timeZone: "UTC" });
      },
    });
    vi.resetModules();
    const { factGraphOption: fresh } = await import("../src/knowledge/graph");
    const option = fresh([fact({ validTo: "2026-03-05T17:00:00Z" })]);
    expect(node(option, "fact:f_1").validFrom).toBe("1 Jan 2026, 09:30");
    expect(node(option, "fact:f_1").validTo).toBe("5 Mar 2026, 17:00");
    // The browser's locale: none is passed.
    expect(seen).toContain(undefined);
  });

  it("FactsExplorer's exported defaultFormatDate is the same localised default (en-GB, UTC pinned)", async () => {
    const Real = Intl.DateTimeFormat;
    vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: function (_l?: unknown, o?: Intl.DateTimeFormatOptions) {
        return new Real("en-GB", { ...o, timeZone: "UTC" });
      },
    });
    vi.resetModules();
    const { defaultFormatDate } = await import("../src/knowledge/index");
    expect(defaultFormatDate("2026-01-01T09:30:00Z")).toBe("1 Jan 2026, 09:30");
    expect(defaultFormatDate("2026-13-45")).toBe("2026-13-45");
  });

  it("uses the host's formatDate, and leaves an open-ended fact without validTo", () => {
    const formatDate = vi.fn((iso: string) => `<${iso.slice(0, 10)}>`);
    const option = factGraphOption([fact()], undefined, [], { formatDate });
    expect(node(option, "fact:f_1").validFrom).toBe("<2026-01-01>");
    expect(node(option, "fact:f_1").validTo).toBeUndefined();
    expect(formatDate).not.toHaveBeenCalledWith(null);
  });

  it("shows a date it cannot parse as it came, never Invalid Date", () => {
    const option = factGraphOption([fact({ validFrom: "sometime in 2026" })]);
    expect(node(option, "fact:f_1").validFrom).toBe("sometime in 2026");
  });

  it("FactGraph's tooltip shows a fact's formatted dates as plain text", () => {
    render(<FactGraph facts={[fact({ object: "<b>30</b> days" })]} chunks={[]} onSelectFact={() => {}} formatDate={(iso) => `<${iso.slice(0, 4)}>`} />);
    const formatter = lastOption!.tooltip!.formatter!;
    const factNode = node(lastOption as Record<string, unknown>, "fact:f_1");
    const text = formatter({ dataType: "node", data: factNode });
    expect(text).toBe("refund_window: &lt;b&gt;30&lt;/b&gt; days<br/>from &lt;2026&gt;");
    // Non-fact nodes keep their name only, escaped.
    expect(formatter({ dataType: "node", data: { id: "subject:a", name: "a&b", category: 0 } })).toBe("a&amp;b");
  });
});

describe("FactsExplorer hands both to its graph", () => {
  it("passes the host's evidenceLabel and formatDate to the graph component", async () => {
    const got: FactGraphProps[] = [];
    const Graph = (p: FactGraphProps) => {
      got.push(p);
      return null;
    };
    const listing = <T,>(items: T[]) => ({ contractVersion: G282_VERSION, items, nextCursor: null });
    const adapter: KnowledgeAdapter = { search: vi.fn(async () => listing([])), facts: vi.fn(async () => listing([fact()])) };
    const evidenceLabel = (c: KnowledgeChunk) => c.chunkId;
    const formatDate = (iso: string) => iso;
    render(<FactsExplorer adapter={adapter} subject="acme" graph={Graph} evidenceLabel={evidenceLabel} formatDate={formatDate} />);
    await act(flush);
    expect(got.at(-1)!.evidenceLabel).toBe(evidenceLabel);
    expect(got.at(-1)!.formatDate).toBe(formatDate);
  });

  it("gives the graph no evidenceLabel by default, so the map keeps its own default", async () => {
    const got: FactGraphProps[] = [];
    const Graph = (p: FactGraphProps) => {
      got.push(p);
      return null;
    };
    const listing = <T,>(items: T[]) => ({ contractVersion: G282_VERSION, items, nextCursor: null });
    const adapter: KnowledgeAdapter = { search: vi.fn(async () => listing([])), facts: vi.fn(async () => listing([fact()])) };
    render(<FactsExplorer adapter={adapter} subject="acme" graph={Graph} />);
    await act(flush);
    expect(got.at(-1)!.evidenceLabel).toBeUndefined();
  });
});
