import { I as IngestJob, W as WorkerStatus, a as FactStatus, b as FactGraphCategories, K as KnowledgeFact, c as FactGraphComponent, d as KnowledgeChunk } from './graph-DKlGQEuJ.cjs';
export { D as DEFAULT_FACT_GRAPH_CATEGORIES, e as FactGraphNode, f as FactGraphOptions, F as FactGraphProps, G as G282_2_VERSION, g as G282_VERSION, h as IngestState, i as KnowledgeListing, j as KnowledgeProvenance, k as KnowledgeSource, R as Read, l as defaultGraphEvidenceLabel, m as factGraphOption, r as readChunkListing, n as readFactListing, o as readFactListingV2, p as readIngestJob, q as readIngestJobListing, s as readSourceListing, t as readWorkerStatus } from './graph-DKlGQEuJ.cjs';
import { ReactNode } from 'react';
import '@particle-academy/prism-graph';

type IngestDisplay = "done" | "failed" | "queued" | "running" | "unknown";
interface IngestDisplayOptions {
    /**
     * Whether the backend runs asynchronous ingest jobs. Default false: Prism's
     * ingest is synchronous until its jobs land, so a queued or running state is
     * not something this client can confirm.
     */
    jobsAvailable?: boolean;
}
/**
 * What one ingest job shows (owner's rule). Until jobs are available, only
 * `done` and `failed` are shown; everything else is `unknown`. With jobs,
 * `queued` and `running` show only while the worker's heartbeat is fresh
 * (`now - heartbeatAt <= staleAfterMs`). The client derives liveness itself and
 * never trusts a stored `running` on a stale heartbeat. `unknown` is never
 * rendered as `running`.
 *
 * `alarm` means nothing is processing: a job waiting on (queued) or claiming
 * (running) a worker whose heartbeat is stale or missing.
 */
declare function deriveIngestDisplay(job: IngestJob, worker: WorkerStatus | null, now: number, options?: IngestDisplayOptions): {
    display: IngestDisplay;
    alarm: boolean;
};

/** The default fact date: medium date, short time, in the user's locale; anything not ISO 8601 as it came. */
declare function defaultFormatDate(iso: string): string;

type Awaitable$1<T> = T | Promise<T>;
interface FactsLabels {
    title: string;
    subject: string;
    load: string;
    noFacts: string;
    columns: {
        predicate: string;
        object: string;
        status: string;
        validFrom: string;
    };
    status: Record<FactStatus, string>;
    open: string;
    accept: string;
    reject: string;
    evidence: string;
    noEvidence: string;
    versions: string;
    validRange: (from: string, to: string | null) => string;
    current: string;
    superseded: string;
    graph: string;
    loadMore: string;
    categories: FactGraphCategories;
    decisionFailed: string;
    versionRefused: (version: string | null) => string;
    shapeRefused: string;
    loadFailed: string;
}
declare const DEFAULT_FACTS_LABELS: FactsLabels;
interface FactsExplorerProps {
    /** Needs `facts`; `factTimeline` and `getChunks` add the drawer's versions and evidence. Renders nothing without `facts`. */
    adapter: KnowledgeAdapter | null | undefined;
    /** The subject whose facts are listed. Controlled when `onSubjectChange` is passed with it. */
    subject?: string;
    onSubjectChange?: (subject: string) => void;
    /** The open fact (drawer). Controlled when passed. */
    openFactId?: string | null;
    onOpenFactChange?: (factId: string | null) => void;
    /** List proposals and beliefs beside accepted facts. Default true. */
    includeUnaccepted?: boolean;
    /**
     * HUMAN-ONLY. Accept or reject a proposal. These are callbacks to the host, never
     * adapter methods, so whatever holds the adapter (a co-driving agent included)
     * cannot decide. The host posts them to its own authenticated endpoint, which
     * resolves the actor. Without both, no buttons render. Shown on proposals only.
     */
    onAccept?: (fact: KnowledgeFact) => Awaitable$1<void>;
    onReject?: (fact: KnowledgeFact) => Awaitable$1<void>;
    /** Page size for `listFacts`. Default 50. */
    pageSize?: number;
    /** The map: `FactGraph` from `@particle-academy/fancy-chat-ui/charts`, or the host's own. Hidden without it. */
    graph?: FactGraphComponent;
    /**
     * How every fact date is shown (the table's valid-from and both ends of each
     * version's `validRange`). Default: `Intl.DateTimeFormat` with `dateStyle: "medium"`
     * and `timeStyle: "short"` in the user's locale; a value that does not parse is
     * shown as it came.
     */
    formatDate?: (iso: string) => string;
    /**
     * The line under each evidence passage. Default: the source title as-is (it can be
     * a URI), the heading path, the URI when it is not the title, the lines, the trust.
     */
    evidenceLabel?: (evidence: KnowledgeChunk) => string;
    labels?: Partial<FactsLabels>;
    className?: string;
}

/** The default evidence line: title (as-is), heading path, URI (unless it is the title), lines, trust. */
declare function defaultEvidenceLabel(c: KnowledgeChunk): string;
/**
 * A subject's facts with their status (accepted, proposal, belief), a drawer with
 * the evidence passages and the version timeline, an optional map, and HUMAN-only
 * Accept and Reject on proposals. Every read goes through the host-scoped adapter
 * and is refused unless it carries g282.1. All text renders as plain text.
 */
declare function FactsExplorer(props: FactsExplorerProps): ReactNode;

type Awaitable<T> = T | Promise<T>;
/**
 * What the explorer reads. Every method returns a g282.1 shape. The SCOPE is
 * bound inside the adapter (tenant, owner, agent, thread): nothing here passes,
 * accepts or shows one, and a user never picks it. A method the adapter does
 * not implement hides its part of the UI.
 */
interface KnowledgeAdapter {
    /** Search; returns a g282.1 listing of chunks. */
    search(query: string, options: {
        limit: number;
    }): Awaitable<unknown>;
    listSources?(cursor: string | null, limit: number): Awaitable<unknown>;
    listChunks?(sourceId: string, cursor: string | null, limit: number): Awaitable<unknown>;
    /** A g282.1 listing of ingest jobs. */
    ingestJobs?(): Awaitable<unknown>;
    workerStatus?(): Awaitable<unknown>;
    /**
     * A subject's facts: a g282.1 listing of prism-graph 0.3 `Fact`s (ScopedGraph
     * `facts(subject, unaccepted)`). `unaccepted` asks for proposals and beliefs too.
     */
    facts?(subject: string, options: {
        unaccepted: boolean;
    }): Awaitable<unknown>;
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
}
interface KnowledgeLabels {
    title: string;
    query: string;
    search: string;
    noHits: string;
    sources: string;
    loadMore: string;
    open: string;
    chunks: string;
    columns: {
        title: string;
        kind: string;
        chunks: string;
        trust: string;
        created: string;
    };
    ingest: string;
    ingestColumns: {
        source: string;
        status: string;
        progress: string;
        errors: string;
    };
    display: Record<IngestDisplay, string>;
    nothingProcessing: string;
    versionRefused: (version: string | null) => string;
    shapeRefused: string;
    loadFailed: string;
    close: string;
}
declare const DEFAULT_KNOWLEDGE_LABELS: KnowledgeLabels;
interface KnowledgeExplorerProps {
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
/**
 * An optional knowledge explorer over a host-scoped KnowledgeAdapter: search,
 * sources with cursor paging, a source's chunks with provenance, and ingest
 * status with an explicit worker state. All text from the store is rendered as
 * plain text.
 */
declare function KnowledgeExplorer(props: KnowledgeExplorerProps): ReactNode;

export { DEFAULT_FACTS_LABELS, DEFAULT_KNOWLEDGE_LABELS, FactGraphCategories, FactGraphComponent, FactStatus, FactsExplorer, type FactsExplorerProps, type FactsLabels, type IngestDisplay, type IngestDisplayOptions, IngestJob, type KnowledgeAdapter, KnowledgeChunk, KnowledgeExplorer, type KnowledgeExplorerProps, KnowledgeFact, type KnowledgeLabels, WorkerStatus, defaultEvidenceLabel, defaultFormatDate, deriveIngestDisplay };
