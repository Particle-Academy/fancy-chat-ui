import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Callout, Drawer, Input, Table, Text, Timeline } from "@particle-academy/react-fancy";
import type { ButtonColor } from "@particle-academy/react-fancy";

import type { KnowledgeAdapter } from "./KnowledgeExplorer";
import { DEFAULT_FACT_GRAPH_CATEGORIES, type FactGraphCategories, type FactGraphComponent } from "./graph";
import { G282_VERSION, readChunkListing, readFactListing, readFactListingV2, type FactStatus, type KnowledgeChunk, type KnowledgeFact, type Read } from "./shapes";

type Awaitable<T> = T | Promise<T>;

export interface FactsLabels {
  title: string;
  subject: string;
  load: string;
  noFacts: string;
  columns: { predicate: string; object: string; status: string; validFrom: string };
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

export const DEFAULT_FACTS_LABELS: FactsLabels = {
  title: "Facts",
  subject: "Subject",
  load: "Show facts",
  noFacts: "No facts for this subject",
  columns: { predicate: "Predicate", object: "Value", status: "Status", validFrom: "Valid from" },
  status: { accepted: "Accepted", proposed: "Proposal", belief: "Belief" },
  open: "Open",
  accept: "Accept",
  reject: "Reject",
  evidence: "Evidence",
  noEvidence: "No evidence passages",
  versions: "Versions",
  validRange: (from, to) => (to ? `${from} to ${to}` : `from ${from}`),
  current: "Current",
  superseded: "Superseded",
  graph: "Map",
  loadMore: "Load more",
  categories: DEFAULT_FACT_GRAPH_CATEGORIES,
  decisionFailed: "The decision could not be saved.",
  versionRefused: (v) => `Unsupported knowledge contract version ${v === null ? "(none)" : `"${v}"`}; this explorer reads "${G282_VERSION}". Nothing from it is shown.`,
  shapeRefused: "The knowledge service returned a shape this explorer does not recognise. Nothing from it is shown.",
  loadFailed: "The knowledge service could not be reached.",
};

export interface FactsExplorerProps {
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
  onAccept?: (fact: KnowledgeFact) => Awaitable<void>;
  onReject?: (fact: KnowledgeFact) => Awaitable<void>;
  /** Page size for `listFacts`. Default 50. */
  pageSize?: number;
  /** The map: `FactGraph` from `@particle-academy/fancy-chat-ui/charts`, or the host's own. Hidden without it. */
  graph?: FactGraphComponent;
  labels?: Partial<FactsLabels>;
  className?: string;
}

const STATUS_COLOR: Record<FactStatus, ButtonColor> = { accepted: "emerald", proposed: "amber", belief: "zinc" };

function errorText(r: Read<unknown>, labels: FactsLabels): string {
  if (r.ok) return "";
  return r.error === "knowledge.version" ? labels.versionRefused(r.version ?? null) : labels.shapeRefused;
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
 * A subject's facts with their status (accepted, proposal, belief), a drawer with
 * the evidence passages and the version timeline, an optional map, and HUMAN-only
 * Accept and Reject on proposals. Every read goes through the host-scoped adapter
 * and is refused unless it carries g282.1. All text renders as plain text.
 */
export function FactsExplorer(props: FactsExplorerProps): ReactNode {
  const { adapter, includeUnaccepted = true, onAccept, onReject, graph: Graph, className, pageSize = 50 } = props;
  const labels = { ...DEFAULT_FACTS_LABELS, ...props.labels };

  const [ownSubject, setOwnSubject] = useState(props.subject ?? "");
  const subject = props.subject !== undefined && props.onSubjectChange ? props.subject : ownSubject;
  const [draft, setDraft] = useState(subject);
  useEffect(() => setDraft(subject), [subject]);
  const [ownOpen, setOwnOpen] = useState<string | null>(null);
  const openId = props.openFactId !== undefined ? props.openFactId : ownOpen;
  const setOpen = (id: string | null) => {
    if (props.openFactId === undefined) setOwnOpen(id);
    props.onOpenFactChange?.(id);
  };

  const [facts, setFacts] = useState<KnowledgeFact[] | null>(null);
  const [factsCursor, setFactsCursor] = useState<string | null>(null);
  const [factsError, setFactsError] = useState("");
  const [evidence, setEvidence] = useState<KnowledgeChunk[]>([]);
  const [evidenceError, setEvidenceError] = useState("");
  const [versions, setVersions] = useState<KnowledgeFact[]>([]);
  const [versionsError, setVersionsError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [decisionError, setDecisionError] = useState("");
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const read = useCallback(
    async <T,>(call: () => Awaitable<unknown>, reader: (v: unknown) => Read<T>, onOk: (v: T) => void, onError: (t: string) => void) => {
      try {
        const r = reader(await call());
        if (!alive.current) return;
        if (r.ok) {
          onError("");
          onOk(r.value);
        } else onError(errorText(r, labels));
      } catch {
        if (alive.current) onError(labels.loadFailed);
      }
    },
    // labels are display-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const loadFacts = useCallback(() => {
    if (adapter?.listFacts) {
      // The full listing: everything on open; the subject only filters.
      const list = adapter.listFacts.bind(adapter);
      void read(
        () => list(subject || null, null, pageSize),
        readFactListingV2,
        (v) => {
          setFacts(v.items);
          setFactsCursor(v.nextCursor);
        },
        (t) => {
          setFactsError(t);
          if (t) setFacts(null);
        },
      );
      return;
    }
    if (!adapter?.facts || !subject) return;
    const list = adapter.facts.bind(adapter);
    void read(
      () => list(subject, { unaccepted: includeUnaccepted }),
      readFactListing,
      (v) => setFacts(v.items),
      (t) => {
        setFactsError(t);
        if (t) setFacts(null);
      },
    );
  }, [adapter, subject, includeUnaccepted, read, pageSize]);

  const loadMoreFacts = () => {
    if (!adapter?.listFacts || !factsCursor) return;
    const list = adapter.listFacts.bind(adapter);
    const cursor = factsCursor;
    void read(
      () => list(subject || null, cursor, pageSize),
      readFactListingV2,
      (v) => {
        setFacts((prev) => [...(prev ?? []), ...v.items]);
        setFactsCursor(v.nextCursor);
      },
      setFactsError,
    );
  };

  useEffect(() => loadFacts(), [loadFacts]);

  const open = facts?.find((f) => f.id === openId) ?? null;
  const openKey = open ? `${open.id}|${open.evidence.join(",")}` : null;

  useEffect(() => {
    setEvidence([]);
    setVersions([]);
    setEvidenceError("");
    setVersionsError("");
    if (!open || !adapter) return;
    if (adapter.getChunks && open.evidence.length) {
      const get = adapter.getChunks.bind(adapter);
      void read(() => get([...open.evidence]), readChunkListing, (v) => setEvidence(v.items), setEvidenceError);
    }
    if (adapter.factTimeline) {
      const timeline = adapter.factTimeline.bind(adapter);
      void read(
        () => timeline(open.subject),
        readFactListing,
        (v) => setVersions(v.items.filter((f) => f.predicate === open.predicate).sort((a, b) => (a.recordedAt ?? "").localeCompare(b.recordedAt ?? ""))),
        setVersionsError,
      );
    }
    // The open fact is keyed by id and evidence; the object itself is re-created per load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, adapter, read]);

  if (!adapter?.facts && !adapter?.listFacts) return null;

  const decide = async (fact: KnowledgeFact, fn: ((f: KnowledgeFact) => Awaitable<void>) | undefined) => {
    if (!fn || busyRef.current) return;
    busyRef.current = true;
    setBusy(fact.id);
    setDecisionError("");
    try {
      await fn(fact);
      if (alive.current) loadFacts();
    } catch {
      if (alive.current) setDecisionError(labels.decisionFailed);
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const canDecide = !!onAccept && !!onReject;
  const submit = () => {
    const s = draft.trim();
    if (!s) return;
    if (props.subject === undefined || !props.onSubjectChange) setOwnSubject(s);
    props.onSubjectChange?.(s);
  };

  return (
    <section data-fancy-chat-facts={subject} className={["flex flex-col gap-2", className].filter(Boolean).join(" ")}>
      <Text className="font-medium">{labels.title}</Text>
      <div className="flex items-end gap-2">
        <div data-fancy-chat-facts-subject="" className="flex-1">
          <Input label={labels.subject} value={draft} onValueChange={setDraft} onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        <Button data-fancy-chat-facts-load="" onClick={submit}>
          {labels.load}
        </Button>
      </div>
      <ErrorLine text={factsError} area="facts" />
      <ErrorLine text={decisionError} area="decision" />
      {facts && !factsError ? (
        facts.length ? (
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Column label={labels.columns.predicate} />
                <Table.Column label={labels.columns.object} />
                <Table.Column label={labels.columns.status} />
                <Table.Column label={labels.columns.validFrom} />
                <Table.Column label="" />
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {facts.map((f) => (
                <Table.Row key={f.id} data-fancy-chat-fact={f.id} data-fancy-chat-fact-status={f.status}>
                  <Table.Cell>{f.predicate}</Table.Cell>
                  <Table.Cell>{f.object}</Table.Cell>
                  <Table.Cell>
                    <Badge color={STATUS_COLOR[f.status]} variant="soft" size="sm">
                      <span data-fancy-chat-fact-status-badge="">{labels.status[f.status]}</span>
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>{f.validFrom}</Table.Cell>
                  <Table.Cell>
                    <div className="flex gap-1">
                      <Button size="xs" variant="ghost" data-fancy-chat-fact-open={f.id} onClick={() => setOpen(f.id)}>
                        {labels.open}
                      </Button>
                      {canDecide && f.status === "proposed" ? (
                        <>
                          <Button size="xs" color="emerald" data-fancy-chat-fact-accept={f.id} data-fancy-chat-human-only="" disabled={busy !== null} onClick={() => void decide(f, onAccept)}>
                            {labels.accept}
                          </Button>
                          <Button size="xs" variant="ghost" data-fancy-chat-fact-reject={f.id} data-fancy-chat-human-only="" disabled={busy !== null} onClick={() => void decide(f, onReject)}>
                            {labels.reject}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        ) : (
          <Text>{labels.noFacts}</Text>
        )
      ) : null}

      {!factsError && factsCursor && adapter.listFacts ? (
        <Button size="sm" variant="ghost" data-fancy-chat-facts-more="" onClick={loadMoreFacts}>
          {labels.loadMore}
        </Button>
      ) : null}

      {Graph && facts && facts.length && !factsError ? (
        <div data-fancy-chat-facts-graph="">
          <Text className="text-sm opacity-70">{labels.graph}</Text>
          <Graph facts={facts} chunks={evidence} onSelectFact={(id) => setOpen(id)} categories={labels.categories} />
        </div>
      ) : null}

      <Drawer open={open !== null} onClose={() => setOpen(null)} side="right">
        <Drawer.Header>{open ? `${open.subject} · ${open.predicate}` : ""}</Drawer.Header>
        <Drawer.Body>
          {open ? (
            <div data-fancy-chat-fact-drawer={open.id} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Text className="whitespace-pre-wrap break-words">{open.object}</Text>
                <Badge color={STATUS_COLOR[open.status]} variant="soft" size="sm">
                  {labels.status[open.status]}
                </Badge>
              </div>
              {adapter.getChunks ? (
                <div className="flex flex-col gap-2">
                  <Text className="font-medium">{labels.evidence}</Text>
                  <ErrorLine text={evidenceError} area="evidence" />
                  {!evidenceError && evidence.length === 0 ? <Text className="text-sm opacity-70">{labels.noEvidence}</Text> : null}
                  {!evidenceError
                    ? evidence.map((c) => (
                        <div key={c.chunkId} data-fancy-chat-fact-evidence={c.chunkId} className="flex flex-col gap-1">
                          <Text className="whitespace-pre-wrap break-words">{c.text}</Text>
                          <Text className="text-xs opacity-70">
                            {[c.provenance.headingPath.join(" / "), c.provenance.uri, c.provenance.lineStart !== null ? `lines ${c.provenance.lineStart}-${c.provenance.lineEnd ?? c.provenance.lineStart}` : "", c.provenance.trust]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        </div>
                      ))
                    : null}
                </div>
              ) : null}
              {adapter.factTimeline ? (
                <div className="flex flex-col gap-2">
                  <Text className="font-medium">{labels.versions}</Text>
                  <ErrorLine text={versionsError} area="versions" />
                  {!versionsError && versions.length ? (
                    // Not animated: an animated item stays hidden until it scrolls into view.
                    <Timeline animated={false}>
                      {versions.map((v) => {
                        const current = v.id === open.id;
                        return (
                          <Timeline.Item key={v.id} color={current ? "emerald" : "zinc"} active={current}>
                            <div data-fancy-chat-fact-version={v.id} data-fancy-chat-fact-version-current={current ? "true" : "false"} className="flex flex-col">
                              <Text className="whitespace-pre-wrap break-words">{v.object}</Text>
                              <Text className="text-xs opacity-70">
                                {[labels.validRange(v.validFrom, v.validTo ?? null), labels.status[v.status], v.supersededBy ? labels.superseded : current ? labels.current : ""].filter(Boolean).join(" · ")}
                              </Text>
                            </div>
                          </Timeline.Item>
                        );
                      })}
                    </Timeline>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </Drawer.Body>
      </Drawer>
    </section>
  );
}
