import { ComponentType } from 'react';
import { Fact, FactStatus as FactStatus$1, ListedChunk, ListingPage, ListedSource } from '@particle-academy/prism-graph';

/**
 * The knowledge explorer reads prism-graph's own shapes (G-282, contract g282.1).
 * The TYPES are prism-graph's (`@particle-academy/prism-graph`, an optional peer,
 * imported for types only: its index also loads a `node:sqlite` driver, which a
 * browser bundle must never pull in). The validators below stay, because a value
 * off the wire is untrusted whatever its type says.
 *
 * Every listing, ingest job and worker status carries `contractVersion`. Any
 * value other than {@link G282_VERSION}, or none, is REFUSED: the explorer shows
 * which version arrived and renders none of the data. It never guesses.
 */
declare const G282_VERSION: "g282.1";
type KnowledgeListing<T> = ListingPage<T>;
type KnowledgeSource = ListedSource;
type KnowledgeProvenance = ListedChunk["provenance"];
/**
 * prism-graph's listed chunk, plus what fancy-chat-php's KnowledgeBridge adds:
 * `sourceTitle` (its source's title, from prism-graph 0.4's `getSource`, which may
 * be a URI and is shown as-is) and `retired` (a cited chunk its source no longer holds).
 */
type KnowledgeChunk = ListedChunk & {
    readonly sourceTitle?: string;
    readonly retired?: boolean;
};
type IngestState = "queued" | "running" | "done" | "failed";
interface IngestJob {
    contractVersion: typeof G282_VERSION;
    jobId: string;
    sourceId: string;
    state: IngestState;
    progress: {
        done: number;
        total: number | null;
    };
    errors: {
        sourceId: string;
        code: string;
        message: string;
    }[];
    queuedAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    heartbeatAt: string | null;
}
interface WorkerStatus {
    contractVersion: typeof G282_VERSION;
    heartbeatAt: string | null;
    staleAfterMs: number;
}
type Read<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: string;
    version?: string | null;
};
declare const readSourceListing: (input: unknown) => Read<KnowledgeListing<ListedSource>>;
declare const readChunkListing: (input: unknown) => Read<KnowledgeListing<KnowledgeChunk>>;
declare function readIngestJob(input: unknown): Read<IngestJob>;
/** A listing of jobs: the listing and every job in it must carry g282.1. */
declare function readIngestJobListing(input: unknown): Read<KnowledgeListing<IngestJob>>;
declare function readWorkerStatus(input: unknown): Read<WorkerStatus>;
/** prism-graph's fact status: `accepted`, `proposed` or `belief`. */
type FactStatus = FactStatus$1;
/**
 * prism-graph's `Fact` as the store serves it: the store fills `status`, so a
 * served fact always has one. It arrives inside a g282.1 listing, so the
 * envelope's version gates it.
 */
type KnowledgeFact = Fact & {
    readonly status: FactStatus;
};
declare const readFactListing: (input: unknown) => Read<KnowledgeListing<KnowledgeFact>>;
/**
 * prism-graph's full fact listing, `listFacts(subject?, cursor?, limit?)`: contract
 * `g282.2` (accepted facts by default, paged). Anything else, g282.1 included, is refused.
 */
declare const G282_2_VERSION: "g282.2";
declare const readFactListingV2: (input: unknown) => Read<{
    contractVersion: string;
    items: KnowledgeFact[];
    nextCursor: string | null;
}>;

/**
 * The facts map, as an ECharts `graph` series option. Pure, and it imports no
 * ECharts: `./knowledge` stays free of the optional fancy-echarts peer. The
 * component that draws it, `FactGraph`, lives in `./charts`.
 *
 * Nodes are subjects, facts and the evidence chunks they cite. Edges run from a
 * subject to each of its facts, and from a fact to each piece of its evidence.
 * Ids are prefixed by kind (`subject:`, `fact:`, `evidence:`) so a fact and a
 * chunk that share an id never merge.
 */
interface FactGraphCategories {
    subject: string;
    fact: string;
    evidence: string;
}
declare const DEFAULT_FACT_GRAPH_CATEGORIES: FactGraphCategories;
interface FactGraphNode {
    id: string;
    name: string;
    /** 0 subject, 1 fact, 2 evidence. */
    category: 0 | 1 | 2;
    /** Set on fact nodes: the fact's id, unprefixed. */
    factId?: string;
    /** Set on fact nodes. */
    status?: KnowledgeFact["status"];
    symbolSize: number;
}
declare function factGraphOption(facts: readonly KnowledgeFact[], categories?: FactGraphCategories, chunks?: readonly KnowledgeChunk[]): Record<string, unknown>;
interface FactGraphProps {
    facts: readonly KnowledgeFact[];
    /** Evidence passages already loaded (the open fact's), to label evidence nodes. */
    chunks: readonly KnowledgeChunk[];
    /** A fact node was clicked. */
    onSelectFact: (factId: string) => void;
    categories?: FactGraphCategories;
}
/** What `FactsExplorer`'s `graph` prop takes: `FactGraph` from `./charts`, or the host's own. */
type FactGraphComponent = ComponentType<FactGraphProps>;

export { DEFAULT_FACT_GRAPH_CATEGORIES as D, type FactGraphProps as F, G282_2_VERSION as G, type IngestJob as I, type KnowledgeFact as K, type Read as R, type WorkerStatus as W, type FactStatus as a, type FactGraphCategories as b, type FactGraphComponent as c, type KnowledgeChunk as d, type FactGraphNode as e, G282_VERSION as f, type IngestState as g, type KnowledgeListing as h, type KnowledgeProvenance as i, type KnowledgeSource as j, factGraphOption as k, readFactListing as l, readFactListingV2 as m, readIngestJob as n, readIngestJobListing as o, readSourceListing as p, readWorkerStatus as q, readChunkListing as r };
