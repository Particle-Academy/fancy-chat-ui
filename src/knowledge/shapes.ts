import type { Fact, FactStatus as PrismFactStatus, ListedChunk, ListedSource, ListingPage } from "@particle-academy/prism-graph";

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
export const G282_VERSION = "g282.1" as const;

export type KnowledgeListing<T> = ListingPage<T>;

export type KnowledgeSource = ListedSource;

export type KnowledgeProvenance = ListedChunk["provenance"];

/**
 * prism-graph's listed chunk, plus what fancy-chat-php's KnowledgeBridge adds:
 * `sourceTitle` (its source's title, from prism-graph 0.4's `getSource`, which may
 * be a URI and is shown as-is) and `retired` (a cited chunk its source no longer holds).
 */
export type KnowledgeChunk = ListedChunk & { readonly sourceTitle?: string; readonly retired?: boolean };

/*
 * Ingest jobs and worker status are NOT in prism-graph yet (ingest is synchronous
 * there, a known Prism gap), so these two shapes are the agreed g282.1 wire shapes,
 * declared here until prism-graph ships them.
 */
export type IngestState = "queued" | "running" | "done" | "failed";

export interface IngestJob {
  contractVersion: typeof G282_VERSION;
  jobId: string;
  sourceId: string;
  state: IngestState;
  progress: { done: number; total: number | null };
  errors: { sourceId: string; code: string; message: string }[];
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
}

export interface WorkerStatus {
  contractVersion: typeof G282_VERSION;
  heartbeatAt: string | null;
  staleAfterMs: number;
}

export type Read<T> = { ok: true; value: T } | { ok: false; error: string; version?: string | null };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const strOrNull = (v: unknown) => v === null || typeof v === "string";
const int = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;
const intOrNull = (v: unknown) => v === null || int(v);

function version(v: Obj, expected: string = G282_VERSION): Read<never> | null {
  if (v.contractVersion === expected) return null;
  const seen = v.contractVersion;
  return { ok: false, error: "knowledge.version", version: seen === undefined || seen === null ? null : String(seen) };
}

function isSource(v: unknown): v is KnowledgeSource {
  return isObj(v) && str(v.sourceId) && str(v.title) && strOrNull(v.kind) && str(v.createdAt) && int(v.chunkCount) && str(v.trust);
}

function isProvenance(v: unknown): v is KnowledgeProvenance {
  return (
    isObj(v) &&
    str(v.uri) &&
    str(v.sha256) &&
    intOrNull(v.byteStart) &&
    intOrNull(v.byteEnd) &&
    intOrNull(v.lineStart) &&
    intOrNull(v.lineEnd) &&
    Array.isArray(v.headingPath) &&
    v.headingPath.every(str) &&
    strOrNull(v.recipe) &&
    str(v.trust) &&
    strOrNull(v.writer) &&
    str(v.recordedAt)
  );
}

function isChunk(v: unknown): v is KnowledgeChunk {
  return (
    isObj(v) &&
    str(v.chunkId) &&
    str(v.sourceId) &&
    str(v.text) &&
    int(v.position) &&
    isProvenance(v.provenance) &&
    (v.sourceTitle === undefined || str(v.sourceTitle)) &&
    (v.retired === undefined || typeof v.retired === "boolean")
  );
}

const STATES = new Set<string>(["queued", "running", "done", "failed"]);

function readListing<T>(input: unknown, isItem: (v: unknown) => v is T, what: string, expected: string = G282_VERSION): Read<KnowledgeListing<T>> {
  if (!isObj(input)) return { ok: false, error: "knowledge.shape" };
  const refused = version(input, expected);
  if (refused) return refused;
  if (!Array.isArray(input.items) || !strOrNull(input.nextCursor)) return { ok: false, error: "knowledge.shape" };
  if (!input.items.every(isItem)) return { ok: false, error: `knowledge.shape.${what}` };
  return { ok: true, value: input as unknown as KnowledgeListing<T> };
}

export const readSourceListing = (input: unknown) => readListing(input, isSource, "source");
export const readChunkListing = (input: unknown) => readListing(input, isChunk, "chunk");

export function readIngestJob(input: unknown): Read<IngestJob> {
  if (!isObj(input)) return { ok: false, error: "knowledge.shape" };
  const refused = version(input);
  if (refused) return refused;
  const p = input.progress;
  const ok =
    str(input.jobId) &&
    str(input.sourceId) &&
    str(input.state) &&
    STATES.has(input.state) &&
    isObj(p) &&
    int(p.done) &&
    (p.total === null || int(p.total)) &&
    Array.isArray(input.errors) &&
    input.errors.every((e) => isObj(e) && str(e.sourceId) && str(e.code) && str(e.message)) &&
    strOrNull(input.queuedAt) &&
    strOrNull(input.startedAt) &&
    strOrNull(input.finishedAt) &&
    strOrNull(input.heartbeatAt);
  return ok ? { ok: true, value: input as unknown as IngestJob } : { ok: false, error: "knowledge.shape.job" };
}

/** A listing of jobs: the listing and every job in it must carry g282.1. */
export function readIngestJobListing(input: unknown): Read<KnowledgeListing<IngestJob>> {
  if (!isObj(input)) return { ok: false, error: "knowledge.shape" };
  const refused = version(input);
  if (refused) return refused;
  if (!Array.isArray(input.items) || !strOrNull(input.nextCursor)) return { ok: false, error: "knowledge.shape" };
  for (const item of input.items) {
    const r = readIngestJob(item);
    if (!r.ok) return r;
  }
  return { ok: true, value: input as unknown as KnowledgeListing<IngestJob> };
}

export function readWorkerStatus(input: unknown): Read<WorkerStatus> {
  if (!isObj(input)) return { ok: false, error: "knowledge.shape" };
  const refused = version(input);
  if (refused) return refused;
  return strOrNull(input.heartbeatAt) && int(input.staleAfterMs, 1)
    ? { ok: true, value: input as unknown as WorkerStatus }
    : { ok: false, error: "knowledge.shape.worker" };
}

/** prism-graph's fact status: `accepted`, `proposed` or `belief`. */
export type FactStatus = PrismFactStatus;

/**
 * prism-graph's `Fact` as the store serves it: the store fills `status`, so a
 * served fact always has one. It arrives inside a g282.1 listing, so the
 * envelope's version gates it.
 */
export type KnowledgeFact = Fact & { readonly status: FactStatus };

const FACT_STATUSES = new Set<string>(["accepted", "proposed", "belief"]);

function isFact(v: unknown): v is KnowledgeFact {
  return (
    isObj(v) &&
    str(v.id) &&
    str(v.subject) &&
    str(v.predicate) &&
    str(v.object) &&
    Array.isArray(v.evidence) &&
    v.evidence.every(str) &&
    str(v.validFrom) &&
    strOrNull(v.validTo ?? null) &&
    strOrNull(v.supersededBy ?? null) &&
    str(v.status) &&
    FACT_STATUSES.has(v.status) &&
    strOrNull(v.recordedAt ?? null) &&
    strOrNull(v.expiredAt ?? null)
  );
}

export const readFactListing = (input: unknown) => readListing(input, isFact, "fact");

/**
 * prism-graph's full fact listing, `listFacts(subject?, cursor?, limit?)`: contract
 * `g282.2` (accepted facts by default, paged). Anything else, g282.1 included, is refused.
 */
export const G282_2_VERSION = "g282.2" as const;
export const readFactListingV2 = (input: unknown) => readListing(input, isFact, "fact", G282_2_VERSION) as Read<{ contractVersion: string; items: KnowledgeFact[]; nextCursor: string | null }>;
