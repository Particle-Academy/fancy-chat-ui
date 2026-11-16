import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Callout, Drawer, Input, Table, Text } from "@particle-academy/react-fancy";
import type { ButtonColor } from "@particle-academy/react-fancy";

import { FactsExplorer, type FactsExplorerProps } from "./FactsExplorer";
import { deriveIngestDisplay, type IngestDisplay } from "./ingest";
import {
  G282_VERSION,
  readChunkListing,
  readIngestJobListing,
  readSourceListing,
  readWorkerStatus,
  type IngestJob,
  type KnowledgeChunk,
  type KnowledgeSource,
  type Read,
  type WorkerStatus,
} from "./shapes";

type Awaitable<T> = T | Promise<T>;

/**
 * What the explorer reads. Every method returns a g282.1 shape. The SCOPE is
 * bound inside the adapter (tenant, owner, agent, thread): nothing here passes,
 * accepts or shows one, and a user never picks it. A method the adapter does
 * not implement hides its part of the UI.
 */
export interface KnowledgeAdapter {
  /** Search; returns a g282.1 listing of chunks. */
  search(query: string, options: { limit: number }): Awaitable<unknown>;
  listSources?(cursor: string | null, limit: number): Awaitable<unknown>;
  listChunks?(sourceId: string, cursor: string | null, limit: number): Awaitable<unknown>;
  /** A g282.1 listing of ingest jobs. */
  ingestJobs?(): Awaitable<unknown>;
  workerStatus?(): Awaitable<unknown>;
  /**
   * A subject's facts: a g282.1 listing of prism-graph 0.3 `Fact`s (ScopedGraph
   * `facts(subject, unaccepted)`). `unaccepted` asks for proposals and beliefs too.
   */
  facts?(subject: string, options: { unaccepted: boolean }): Awaitable<unknown>;
  /**
   * The full fact listing (prism-graph `listFacts`, contract g282.2): `{contractVersion:
   * "g282.2", items, nextCursor}`, accepted facts by default. With it, FactsExplorer loads
   * every fact on open and the subject is a filter; without it, nothing loads until a
   * subject is entered (and `facts` is used).
   */
  listFacts?(subject: string | null, cursor: string | null, limit: number): Awaitable<unknown>;
  /** Every version of a subject's facts: a g282.1 listing of `Fact`s (ScopedGraph `timeline`). */
  factTimeline?(subject: string): Awaitable<unknown>;
  /** Chunks by id, for a fact's evidence: a g282.1 chunk listing (ScopedGraph `get`). */
  getChunks?(chunkIds: string[]): Awaitable<unknown>;
  // There is deliberately NO accept or reject here: deciding a fact is a human's act,
  // passed to FactsExplorer as callbacks, so nothing holding the adapter can decide.
}

export interface KnowledgeLabels {
  title: string;
  query: string;
  search: string;
  noHits: string;
  sources: string;
  loadMore: string;
  open: string;
  chunks: string;
  columns: { title: string; kind: string; chunks: string; trust: string; created: string };
  ingest: string;
  ingestColumns: { source: string; status: string; progress: string; errors: string };
  display: Record<IngestDisplay, string>;
  nothingProcessing: string;
  versionRefused: (version: string | null) => string;
  shapeRefused: string;
  loadFailed: string;
  close: string;
}

export const DEFAULT_KNOWLEDGE_LABELS: KnowledgeLabels = {
  title: "Knowledge",
  query: "Search knowledge",
  search: "Search",
  noHits: "No results",
  sources: "Sources",
  loadMore: "Load more",
  open: "Open",
  chunks: "Chunks",
  columns: { title: "Title", kind: "Kind", chunks: "Chunks", trust: "Trust", created: "Added" },
  ingest: "Ingest",
  ingestColumns: { source: "Source", status: "Status", progress: "Progress", errors: "Errors" },
  display: { done: "Done", failed: "Failed", queued: "Queued", running: "Running", unknown: "Unknown" },
  nothingProcessing: "Nothing is processing: jobs are waiting and the ingest worker's heartbeat is stale or missing.",
  versionRefused: (v) => `Unsupported knowledge contract version ${v === null ? "(none)" : `"${v}"`}; this explorer reads "${G282_VERSION}". Nothing from it is shown.`,
  shapeRefused: "The knowledge service returned a shape this explorer does not recognise. Nothing from it is shown.",
  loadFailed: "The knowledge service could not be reached.",
  close: "Close",
};

export interface KnowledgeExplorerProps {
  /** Renders nothing without one. */
  adapter: KnowledgeAdapter | null | undefined;
  /** Controlled search text (optional). */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Controlled open source (optional). */
  openSourceId?: string | null;
  onOpenSourceChange?: (sourceId: string | null) => void;
  /** Whether the backend runs async ingest jobs. Default false; see deriveIngestDisplay. */
  jobsAvailable?: boolean;
  /** The clock for heartbeat freshness. Default Date.now. */
  now?: () => number;
  /** Page size for listings. Default 50. */
  pageSize?: number;
  /** Search hits. Default 10. */
  searchLimit?: number;
  labels?: Partial<KnowledgeLabels>;
  className?: string;
  /** With an adapter that has `facts`: the facts explorer's subject (uncontrolled start). */
  factSubject?: string;
  /** HUMAN-only accept and reject of a proposal; see FactsExplorer. */
  onAcceptFact?: FactsExplorerProps["onAccept"];
  onRejectFact?: FactsExplorerProps["onReject"];
  /** The facts map; `FactGraph` from `./charts`. */
  factGraph?: FactsExplorerProps["graph"];
  factsLabels?: FactsExplorerProps["labels"];
}

const DISPLAY_COLOR: Record<IngestDisplay, ButtonColor> = { done: "emerald", failed: "red", queued: "sky", running: "sky", unknown: "zinc" };

function errorText(r: Read<unknown>, labels: KnowledgeLabels): string {
  if (r.ok) return "";
  return r.error === "knowledge.version" ? labels.versionRefused(r.version ?? null) : labels.shapeRefused;
}

function useControlled<T>(value: T | undefined, onChange: ((v: T) => void) | undefined, initial: T) {
  const [own, setOwn] = useState<T>(initial);
  const current = value !== undefined ? value : own;
  const set = (v: T) => {
    if (value === undefined) setOwn(v);
    onChange?.(v);
  };
  return [current, set] as const;
}

function ErrorLine({ text, area }: { text: string; area: string }) {
  if (!text) return null;
  return (
    <div data-fancy-chat-knowledge-error={area}>
      <Callout color="red">{text}</Callout>
    </div>
  );
}

/**
 * An optional knowledge explorer over a host-scoped KnowledgeAdapter: search,
 * sources with cursor paging, a source's chunks with provenance, and ingest
 * status with an explicit worker state. All text from the store is rendered as
 * plain text.
 */
export function KnowledgeExplorer(props: KnowledgeExplorerProps): ReactNode {
  const { adapter, jobsAvailable = false, now = Date.now, pageSize = 50, searchLimit = 10, className } = props;
  const labels = { ...DEFAULT_KNOWLEDGE_LABELS, ...props.labels };
  const [query, setQuery] = useControlled(props.query, props.onQueryChange, "");
  const [openSource, setOpenSource] = useControlled<string | null>(props.openSourceId, props.onOpenSourceChange, null);

  const [hits, setHits] = useState<KnowledgeChunk[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [sourcesCursor, setSourcesCursor] = useState<string | null>(null);
  const [sourcesError, setSourcesError] = useState("");
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [chunksCursor, setChunksCursor] = useState<string | null>(null);
  const [chunksError, setChunksError] = useState("");
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [jobsError, setJobsError] = useState("");
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [workerError, setWorkerError] = useState("");
  const alive = useRef(true);
  // Set on every mount, not only at creation: StrictMode (dev) runs the cleanup
  // and then the effect again, and a ref only the cleanup wrote stayed false.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(
    async <T,>(call: () => Awaitable<unknown>, read: (v: unknown) => Read<T>, onOk: (v: T) => void, onError: (text: string) => void) => {
      try {
        const r = read(await call());
        if (!alive.current) return;
        if (r.ok) {
          onError("");
          onOk(r.value);
        } else {
          onError(errorText(r, labels));
        }
      } catch {
        if (alive.current) onError(labels.loadFailed);
      }
    },
    // labels are display-only; re-creating the loader per label change is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const loadSources = useCallback(
    (cursor: string | null) => {
      if (!adapter?.listSources) return;
      const list = adapter.listSources.bind(adapter);
      void load(
        () => list(cursor, pageSize),
        readSourceListing,
        (v) => {
          setSources((prev) => (cursor === null ? v.items : [...prev, ...v.items]));
          setSourcesCursor(v.nextCursor);
        },
        setSourcesError,
      );
    },
    [adapter, load, pageSize],
  );

  useEffect(() => {
    if (!adapter) return;
    loadSources(null);
    if (adapter.ingestJobs) {
      const list = adapter.ingestJobs.bind(adapter);
      void load(() => list(), readIngestJobListing, (v) => setJobs(v.items), setJobsError);
    }
    if (adapter.workerStatus) {
      const status = adapter.workerStatus.bind(adapter);
      void load(() => status(), readWorkerStatus, setWorker, (text) => {
        setWorkerError(text);
        if (text) setWorker(null);
      });
    }
  }, [adapter, load, loadSources]);

  const loadChunks = useCallback(
    (sourceId: string, cursor: string | null) => {
      if (!adapter?.listChunks) return;
      const list = adapter.listChunks.bind(adapter);
      void load(
        () => list(sourceId, cursor, pageSize),
        readChunkListing,
        (v) => {
          setChunks((prev) => (cursor === null ? v.items : [...prev, ...v.items]));
          setChunksCursor(v.nextCursor);
        },
        setChunksError,
      );
    },
    [adapter, load, pageSize],
  );

  useEffect(() => {
    if (openSource) loadChunks(openSource, null);
    else {
      setChunks([]);
      setChunksCursor(null);
    }
  }, [openSource, loadChunks]);

  if (!adapter) return null;

  const runSearch = () => {
    const q = query.trim();
    if (!q) return;
    const search = adapter.search.bind(adapter);
    void load(() => search(q, { limit: searchLimit }), readChunkListing, (v) => setHits(v.items), setSearchError);
  };

  const at = now();
  const shown = jobs.map((j) => ({ job: j, ...deriveIngestDisplay(j, worker, at, { jobsAvailable }) }));
  const alarm = shown.some((s) => s.alarm);
  const openTitle = sources.find((s) => s.sourceId === openSource)?.title ?? openSource ?? "";

  return (
    <div data-fancy-chat-knowledge="" className={["flex flex-col gap-4", className].filter(Boolean).join(" ")}>
      <section className="flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <div data-fancy-chat-knowledge-query="" className="flex-1">
            <Input label={labels.query} value={query} onValueChange={setQuery} type="search" onKeyDown={(e) => e.key === "Enter" && runSearch()} />
          </div>
          <Button data-fancy-chat-knowledge-search="" onClick={runSearch}>
            {labels.search}
          </Button>
        </div>
        <ErrorLine text={searchError} area="search" />
        {hits ? (
          hits.length ? (
            <ul className="flex flex-col gap-2" data-fancy-chat-knowledge-hits="">
              {hits.map((h) => (
                <li key={h.chunkId} data-fancy-chat-knowledge-hit={h.chunkId}>
                  <Text className="whitespace-pre-wrap break-words">{h.text}</Text>
                  <Text className="text-xs opacity-70">{h.provenance.uri}</Text>
                </li>
              ))}
            </ul>
          ) : (
            <Text>{labels.noHits}</Text>
          )
        ) : null}
      </section>

      {adapter.listSources ? (
        <section data-fancy-chat-knowledge-sources="" className="flex flex-col gap-2">
          <Text className="font-medium">{labels.sources}</Text>
          <ErrorLine text={sourcesError} area="sources" />
          {!sourcesError ? (
            <Table>
              <Table.Head>
                <Table.Row>
                  <Table.Column label={labels.columns.title} />
                  <Table.Column label={labels.columns.kind} />
                  <Table.Column label={labels.columns.chunks} />
                  <Table.Column label={labels.columns.trust} />
                  <Table.Column label={labels.columns.created} />
                  <Table.Column label="" />
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {sources.map((s) => (
                  <Table.Row key={s.sourceId} data-fancy-chat-knowledge-source={s.sourceId}>
                    <Table.Cell>{s.title}</Table.Cell>
                    <Table.Cell>{s.kind ?? ""}</Table.Cell>
                    <Table.Cell>{String(s.chunkCount)}</Table.Cell>
                    <Table.Cell>{s.trust}</Table.Cell>
                    <Table.Cell>{s.createdAt}</Table.Cell>
                    <Table.Cell>
                      {adapter.listChunks ? (
                        <Button size="xs" variant="ghost" data-fancy-chat-knowledge-open-source={s.sourceId} onClick={() => setOpenSource(s.sourceId)}>
                          {labels.open}
                        </Button>
                      ) : null}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          ) : null}
          {!sourcesError && sourcesCursor ? (
            <Button size="sm" variant="ghost" data-fancy-chat-knowledge-load-more="" onClick={() => loadSources(sourcesCursor)}>
              {labels.loadMore}
            </Button>
          ) : null}
        </section>
      ) : null}

      {adapter.facts || adapter.listFacts ? (
        <FactsExplorer
          adapter={adapter}
          {...(props.factSubject !== undefined ? { subject: props.factSubject } : {})}
          {...(props.onAcceptFact ? { onAccept: props.onAcceptFact } : {})}
          {...(props.onRejectFact ? { onReject: props.onRejectFact } : {})}
          {...(props.factGraph ? { graph: props.factGraph } : {})}
          {...(props.factsLabels ? { labels: props.factsLabels } : {})}
        />
      ) : null}

      {adapter.ingestJobs || adapter.workerStatus ? (
        <section data-fancy-chat-knowledge-ingest="" className="flex flex-col gap-2">
          <Text className="font-medium">{labels.ingest}</Text>
          <ErrorLine text={jobsError} area="ingest" />
          <ErrorLine text={workerError} area="worker" />
          {alarm ? (
            <div data-fancy-chat-knowledge-worker-alarm="" role="alert">
              <Callout color="red">{labels.nothingProcessing}</Callout>
            </div>
          ) : null}
          {!jobsError && shown.length ? (
            <Table>
              <Table.Head>
                <Table.Row>
                  <Table.Column label={labels.ingestColumns.source} />
                  <Table.Column label={labels.ingestColumns.status} />
                  <Table.Column label={labels.ingestColumns.progress} />
                  <Table.Column label={labels.ingestColumns.errors} />
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {shown.map(({ job, display }) => (
                  <Table.Row key={job.jobId} data-fancy-chat-knowledge-job={job.jobId} data-fancy-chat-knowledge-job-display={display}>
                    <Table.Cell>{job.sourceId}</Table.Cell>
                    <Table.Cell>
                      <Badge color={DISPLAY_COLOR[display]} variant="soft" size="sm">
                        {labels.display[display]}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>{display === "done" || display === "failed" || display === "running" ? `${job.progress.done}${job.progress.total === null ? "" : ` / ${job.progress.total}`}` : ""}</Table.Cell>
                    <Table.Cell>{job.errors.map((e) => `${e.code}: ${e.message}`).join("; ")}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          ) : null}
        </section>
      ) : null}

      {adapter.listChunks ? (
        <Drawer open={openSource !== null} onClose={() => setOpenSource(null)} side="right">
          <Drawer.Header>{`${labels.chunks}: ${openTitle}`}</Drawer.Header>
          <Drawer.Body>
            <div data-fancy-chat-knowledge-chunks={openSource ?? ""} className="flex flex-col gap-3">
              <ErrorLine text={chunksError} area="chunks" />
              {!chunksError
                ? chunks.map((c) => (
                    <div key={c.chunkId} data-fancy-chat-knowledge-chunk={c.chunkId} className="flex flex-col gap-1">
                      <Text className="whitespace-pre-wrap break-words">{c.text}</Text>
                      <Text className="text-xs opacity-70" data-fancy-chat-knowledge-provenance="">
                        {[c.provenance.headingPath.join(" / "), c.provenance.uri, c.provenance.lineStart !== null ? `lines ${c.provenance.lineStart}-${c.provenance.lineEnd ?? c.provenance.lineStart}` : "", c.provenance.trust]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </div>
                  ))
                : null}
              {!chunksError && chunksCursor && openSource ? (
                <Button size="sm" variant="ghost" data-fancy-chat-knowledge-chunks-more="" onClick={() => loadChunks(openSource, chunksCursor)}>
                  {labels.loadMore}
                </Button>
              ) : null}
            </div>
          </Drawer.Body>
        </Drawer>
      ) : null}
    </div>
  );
}
