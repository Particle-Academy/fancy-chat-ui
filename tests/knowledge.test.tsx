import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  G282_VERSION,
  KnowledgeExplorer,
  deriveIngestDisplay,
  readChunkListing,
  readIngestJob,
  readIngestJobListing,
  readSourceListing,
  readWorkerStatus,
  type IngestJob,
  type KnowledgeAdapter,
  type WorkerStatus,
} from "../src/knowledge/index";
import { flush } from "./helpers";

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const all = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];

const source = (n: number) => ({ sourceId: `s_${n}`, title: `Handbook ${n}`, kind: "pdf", createdAt: "2026-11-15T10:00:00.000000Z", chunkCount: 3, trust: "doc" });
const provenance = {
  uri: "file:///handbook.pdf",
  sha256: "ab".repeat(32),
  byteStart: 0,
  byteEnd: 120,
  lineStart: 1,
  lineEnd: 4,
  headingPath: ["Refunds", "Timing"],
  recipe: "pdf-v1",
  trust: "doc",
  writer: "ingest",
  recordedAt: "2026-11-15T10:00:00.000000Z",
};
const chunk = (n: number, text = `Refunds take ${n} days.`) => ({ chunkId: `c_${n}`, sourceId: "s_1", text, position: n, provenance });
const listing = <T,>(items: T[], nextCursor: string | null = null, contractVersion: unknown = G282_VERSION) => ({ contractVersion, items, nextCursor });
const job = (over: Partial<IngestJob> = {}): IngestJob => ({
  contractVersion: G282_VERSION,
  jobId: "j_1",
  sourceId: "s_1",
  state: "done",
  progress: { done: 3, total: 3 },
  errors: [],
  queuedAt: "2026-11-15T10:00:00.000000Z",
  startedAt: "2026-11-15T10:00:01.000000Z",
  finishedAt: "2026-11-15T10:00:02.000000Z",
  heartbeatAt: "2026-11-15T10:00:02.000000Z",
  ...over,
});
const NOW = Date.parse("2026-11-15T10:01:00.000Z");
const worker = (agoMs: number | null, staleAfterMs = 30000): WorkerStatus => ({
  contractVersion: G282_VERSION,
  heartbeatAt: agoMs === null ? null : new Date(NOW - agoMs).toISOString(),
  staleAfterMs,
});

describe("g282.1 validators", () => {
  it("accept the agreed shapes", () => {
    expect(readSourceListing(listing([source(1)], "cur_2")).ok).toBe(true);
    expect(readChunkListing(listing([chunk(1)])).ok).toBe(true);
    expect(readIngestJob(job()).ok).toBe(true);
    expect(readIngestJobListing(listing([job()])).ok).toBe(true);
    expect(readWorkerStatus(worker(1000)).ok).toBe(true);
  });

  it("refuse an unknown or missing contractVersion, naming what arrived", () => {
    expect(readSourceListing(listing([source(1)], null, "g282.2"))).toEqual({ ok: false, error: "knowledge.version", version: "g282.2" });
    expect(readSourceListing({ items: [source(1)], nextCursor: null })).toEqual({ ok: false, error: "knowledge.version", version: null });
    expect(readIngestJob({ ...job(), contractVersion: "g283.1" })).toEqual({ ok: false, error: "knowledge.version", version: "g283.1" });
    expect(readWorkerStatus({ ...worker(1), contractVersion: 1 })).toEqual({ ok: false, error: "knowledge.version", version: "1" });
  });

  it("refuse a wrong shape instead of guessing", () => {
    expect(readSourceListing(listing([{ ...source(1), chunkCount: "3" }])).ok).toBe(false);
    expect(readChunkListing(listing([{ ...chunk(1), provenance: { ...provenance, headingPath: "Refunds" } }])).ok).toBe(false);
    expect(readChunkListing(listing([{ ...chunk(1), text: 5 }])).ok).toBe(false);
    expect(readIngestJob(job({ state: "paused" as never })).ok).toBe(false);
    expect(readIngestJob(job({ progress: { done: -1, total: 3 } })).ok).toBe(false);
    expect(readWorkerStatus({ ...worker(1), staleAfterMs: 0 }).ok).toBe(false);
    expect(readSourceListing({ ...listing([source(1)]), nextCursor: 7 }).ok).toBe(false);
  });
});

describe("deriveIngestDisplay (the owner's rule)", () => {
  it("until ingest jobs land, shows only done or failed; everything else is unknown, never running", () => {
    for (const state of ["queued", "running"] as const) {
      expect(deriveIngestDisplay(job({ state }), worker(1), NOW)).toEqual({ display: "unknown", alarm: false });
    }
    expect(deriveIngestDisplay(job({ state: "done" }), null, NOW)).toEqual({ display: "done", alarm: false });
    expect(deriveIngestDisplay(job({ state: "failed" }), null, NOW)).toEqual({ display: "failed", alarm: false });
  });

  it("with jobs available, queued and running show only on a fresh heartbeat", () => {
    const opts = { jobsAvailable: true };
    expect(deriveIngestDisplay(job({ state: "running" }), worker(1000), NOW, opts)).toEqual({ display: "running", alarm: false });
    expect(deriveIngestDisplay(job({ state: "queued" }), worker(30000), NOW, opts)).toEqual({ display: "queued", alarm: false });
    expect(deriveIngestDisplay(job({ state: "running" }), worker(30001), NOW, opts)).toEqual({ display: "unknown", alarm: true });
    expect(deriveIngestDisplay(job({ state: "queued" }), worker(null), NOW, opts)).toEqual({ display: "unknown", alarm: true });
    expect(deriveIngestDisplay(job({ state: "queued" }), null, NOW, opts)).toEqual({ display: "unknown", alarm: true });
    expect(deriveIngestDisplay(job({ state: "done" }), worker(null), NOW, opts)).toEqual({ display: "done", alarm: false });
  });
});

function adapter(over: Partial<KnowledgeAdapter> = {}): KnowledgeAdapter {
  return {
    search: vi.fn(async () => listing([chunk(1, "<b>Refunds</b> take 5 days.")])),
    listSources: vi.fn(async (cursor?: string | null) => (cursor === "cur_2" ? listing([source(3)]) : listing([source(1), source(2)], "cur_2"))),
    listChunks: vi.fn(async () => listing([chunk(1), chunk(2)])),
    ...over,
  };
}

describe("KnowledgeExplorer", () => {
  it("renders nothing without an adapter", () => {
    const { container } = render(<KnowledgeExplorer adapter={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("pages sources by cursor, with no scope control anywhere", async () => {
    const a = adapter();
    render(<KnowledgeExplorer adapter={a} />);
    await act(flush);
    expect(all("[data-fancy-chat-knowledge-source]").map((r) => r.getAttribute("data-fancy-chat-knowledge-source"))).toEqual(["s_1", "s_2"]);
    fireEvent.click(el("[data-fancy-chat-knowledge-load-more]")!);
    await act(flush);
    expect(a.listSources).toHaveBeenLastCalledWith("cur_2", 50);
    expect(all("[data-fancy-chat-knowledge-source]")).toHaveLength(3);
    expect(el("[data-fancy-chat-knowledge-load-more]")).toBeNull();
    expect(document.body.innerHTML.toLowerCase()).not.toContain("scope");
  });

  it("opens a source's chunks with provenance", async () => {
    const a = adapter();
    render(<KnowledgeExplorer adapter={a} />);
    await act(flush);
    fireEvent.click(el('[data-fancy-chat-knowledge-open-source="s_1"]')!);
    await act(flush);
    expect(a.listChunks).toHaveBeenCalledWith("s_1", null, 50);
    expect(all("[data-fancy-chat-knowledge-chunk]")).toHaveLength(2);
    expect(el('[data-fancy-chat-knowledge-chunk="c_1"] [data-fancy-chat-knowledge-provenance]')?.textContent).toContain("Refunds / Timing");
  });

  it("renders search hits as plain text, never HTML", async () => {
    const a = adapter();
    render(<KnowledgeExplorer adapter={a} />);
    await act(flush);
    fireEvent.change(el("[data-fancy-chat-knowledge-query] input")!, { target: { value: "refunds" } });
    fireEvent.click(el("[data-fancy-chat-knowledge-search]")!);
    await act(flush);
    expect(a.search).toHaveBeenCalledWith("refunds", { limit: 10 });
    const hit = el('[data-fancy-chat-knowledge-hit="c_1"]');
    expect(hit?.querySelector("b")).toBeNull();
    expect(hit?.textContent).toContain("<b>Refunds</b>");
  });

  it("refuses a listing with an unknown version and shows the version, never the data", async () => {
    render(<KnowledgeExplorer adapter={adapter({ listSources: async () => listing([source(1)], null, "g282.9") as never })} />);
    await act(flush);
    expect(el("[data-fancy-chat-knowledge-source]")).toBeNull();
    expect(el("[data-fancy-chat-knowledge-error]")?.textContent).toContain("g282.9");
  });

  it("a refused page shows the error and hides the whole table, earlier rows included", async () => {
    const a = adapter({
      listSources: vi.fn(async (cursor?: string | null) => (cursor === "cur_2" ? listing([source(3)], null, "g282.5") : listing([source(1)], "cur_2"))) as never,
    });
    render(<KnowledgeExplorer adapter={a} />);
    await act(flush);
    expect(all("[data-fancy-chat-knowledge-source]")).toHaveLength(1);
    fireEvent.click(el("[data-fancy-chat-knowledge-load-more]")!);
    await act(flush);
    expect(el('[data-fancy-chat-knowledge-error="sources"]')?.textContent).toContain("g282.5");
    expect(all("[data-fancy-chat-knowledge-source]")).toHaveLength(0);
  });

  it("hides the UI for every method the adapter lacks", async () => {
    render(<KnowledgeExplorer adapter={{ search: async () => listing([]) }} />);
    await act(flush);
    expect(el("[data-fancy-chat-knowledge-sources]")).toBeNull();
    expect(el("[data-fancy-chat-knowledge-ingest]")).toBeNull();
    expect(el("[data-fancy-chat-knowledge-query]")).not.toBeNull();
  });

  it("ingest shows done or failed only, and unknown is never rendered as running", async () => {
    const a = adapter({
      ingestJobs: async () => listing([job({ jobId: "j_done" }), job({ jobId: "j_run", state: "running" }), job({ jobId: "j_fail", state: "failed", errors: [{ sourceId: "s_1", code: "pdf.encrypted", message: "Encrypted PDF" }] })]),
      workerStatus: async () => worker(1000),
    });
    render(<KnowledgeExplorer adapter={a} now={() => NOW} />);
    await act(flush);
    expect(el('[data-fancy-chat-knowledge-job="j_done"]')?.getAttribute("data-fancy-chat-knowledge-job-display")).toBe("done");
    expect(el('[data-fancy-chat-knowledge-job="j_fail"]')?.getAttribute("data-fancy-chat-knowledge-job-display")).toBe("failed");
    expect(el('[data-fancy-chat-knowledge-job="j_run"]')?.getAttribute("data-fancy-chat-knowledge-job-display")).toBe("unknown");
    expect(el("[data-fancy-chat-knowledge-ingest]")?.textContent?.toLowerCase()).not.toContain("running");
    expect(el('[data-fancy-chat-knowledge-job="j_fail"]')?.textContent).toContain("pdf.encrypted");
  });

  it("with jobs available, a queued job on a stale worker raises the nothing-processing banner", async () => {
    const a = adapter({ ingestJobs: async () => listing([job({ state: "queued" })]), workerStatus: async () => worker(60000) });
    render(<KnowledgeExplorer adapter={a} now={() => NOW} jobsAvailable />);
    await act(flush);
    expect(el("[data-fancy-chat-knowledge-worker-alarm]")).not.toBeNull();
    expect(el('[data-fancy-chat-knowledge-job="j_1"]')?.getAttribute("data-fancy-chat-knowledge-job-display")).toBe("unknown");
  });

  it("a worker status with an unknown version is refused, so liveness stays unknown", async () => {
    const a = adapter({ ingestJobs: async () => listing([job({ state: "running" })]), workerStatus: async () => ({ ...worker(1), contractVersion: "g9" }) as never });
    render(<KnowledgeExplorer adapter={a} now={() => NOW} jobsAvailable />);
    await act(flush);
    expect(el('[data-fancy-chat-knowledge-job="j_1"]')?.getAttribute("data-fancy-chat-knowledge-job-display")).toBe("unknown");
    expect(el("[data-fancy-chat-knowledge-error]")?.textContent).toContain("g9");
  });

  it("the query is controllable", () => {
    const onQueryChange = vi.fn();
    render(<KnowledgeExplorer adapter={adapter()} query="kept" onQueryChange={onQueryChange} />);
    const input = el("[data-fancy-chat-knowledge-query] input") as HTMLInputElement;
    expect(input.value).toBe("kept");
    fireEvent.change(input, { target: { value: "next" } });
    expect(onQueryChange).toHaveBeenCalledWith("next");
    expect(screen.getByDisplayValue("kept")).toBeTruthy();
  });
});

describe("KnowledgeExplorer under StrictMode", () => {
  // StrictMode (dev) runs an effect's cleanup and then the effect again; an
  // "alive" ref only the cleanup wrote stayed false, so every load was discarded.
  it("still shows what it loaded", async () => {
    render(
      <StrictMode>
        <KnowledgeExplorer adapter={adapter()} />
      </StrictMode>,
    );
    await act(flush);
    expect(all("[data-fancy-chat-knowledge-source]").map((r) => r.getAttribute("data-fancy-chat-knowledge-source"))).toEqual(["s_1", "s_2"]);
  });
});
