'use strict';

var react = require('react');
var reactFancy = require('@particle-academy/react-fancy');
var jsxRuntime = require('react/jsx-runtime');

// src/knowledge/shapes.ts
var G282_VERSION = "g282.1";
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var str = (v) => typeof v === "string";
var strOrNull = (v) => v === null || typeof v === "string";
var int = (v, min = 0) => typeof v === "number" && Number.isInteger(v) && v >= min;
var intOrNull = (v) => v === null || int(v);
function version(v, expected = G282_VERSION) {
  if (v.contractVersion === expected) return null;
  const seen = v.contractVersion;
  return { ok: false, error: "knowledge.version", version: seen === void 0 || seen === null ? null : String(seen) };
}
function isSource(v) {
  return isObj(v) && str(v.sourceId) && str(v.title) && strOrNull(v.kind) && str(v.createdAt) && int(v.chunkCount) && str(v.trust);
}
function isProvenance(v) {
  return isObj(v) && str(v.uri) && str(v.sha256) && intOrNull(v.byteStart) && intOrNull(v.byteEnd) && intOrNull(v.lineStart) && intOrNull(v.lineEnd) && Array.isArray(v.headingPath) && v.headingPath.every(str) && strOrNull(v.recipe) && str(v.trust) && strOrNull(v.writer) && str(v.recordedAt);
}
function isChunk(v) {
  return isObj(v) && str(v.chunkId) && str(v.sourceId) && str(v.text) && int(v.position) && isProvenance(v.provenance) && (v.sourceTitle === void 0 || str(v.sourceTitle)) && (v.retired === void 0 || typeof v.retired === "boolean");
}
var STATES = /* @__PURE__ */ new Set(["queued", "running", "done", "failed"]);
function readListing(input, isItem, what, expected = G282_VERSION) {
  if (!isObj(input)) return { ok: false, error: "knowledge.shape" };
  const refused = version(input, expected);
  if (refused) return refused;
  if (!Array.isArray(input.items) || !strOrNull(input.nextCursor)) return { ok: false, error: "knowledge.shape" };
  if (!input.items.every(isItem)) return { ok: false, error: `knowledge.shape.${what}` };
  return { ok: true, value: input };
}
var readSourceListing = (input) => readListing(input, isSource, "source");
var readChunkListing = (input) => readListing(input, isChunk, "chunk");
function readIngestJob(input) {
  if (!isObj(input)) return { ok: false, error: "knowledge.shape" };
  const refused = version(input);
  if (refused) return refused;
  const p = input.progress;
  const ok = str(input.jobId) && str(input.sourceId) && str(input.state) && STATES.has(input.state) && isObj(p) && int(p.done) && (p.total === null || int(p.total)) && Array.isArray(input.errors) && input.errors.every((e) => isObj(e) && str(e.sourceId) && str(e.code) && str(e.message)) && strOrNull(input.queuedAt) && strOrNull(input.startedAt) && strOrNull(input.finishedAt) && strOrNull(input.heartbeatAt);
  return ok ? { ok: true, value: input } : { ok: false, error: "knowledge.shape.job" };
}
function readIngestJobListing(input) {
  if (!isObj(input)) return { ok: false, error: "knowledge.shape" };
  const refused = version(input);
  if (refused) return refused;
  if (!Array.isArray(input.items) || !strOrNull(input.nextCursor)) return { ok: false, error: "knowledge.shape" };
  for (const item of input.items) {
    const r = readIngestJob(item);
    if (!r.ok) return r;
  }
  return { ok: true, value: input };
}
function readWorkerStatus(input) {
  if (!isObj(input)) return { ok: false, error: "knowledge.shape" };
  const refused = version(input);
  if (refused) return refused;
  return strOrNull(input.heartbeatAt) && int(input.staleAfterMs, 1) ? { ok: true, value: input } : { ok: false, error: "knowledge.shape.worker" };
}
var FACT_STATUSES = /* @__PURE__ */ new Set(["accepted", "proposed", "belief"]);
function isFact(v) {
  return isObj(v) && str(v.id) && str(v.subject) && str(v.predicate) && str(v.object) && Array.isArray(v.evidence) && v.evidence.every(str) && str(v.validFrom) && strOrNull(v.validTo ?? null) && strOrNull(v.supersededBy ?? null) && str(v.status) && FACT_STATUSES.has(v.status) && strOrNull(v.recordedAt ?? null) && strOrNull(v.expiredAt ?? null);
}
var readFactListing = (input) => readListing(input, isFact, "fact");
var G282_2_VERSION = "g282.2";
var readFactListingV2 = (input) => readListing(input, isFact, "fact", G282_2_VERSION);

// src/knowledge/ingest.ts
function deriveIngestDisplay(job, worker, now, options = {}) {
  if (job.state === "done" || job.state === "failed") return { display: job.state, alarm: false };
  if (!options.jobsAvailable) return { display: "unknown", alarm: false };
  const beat = worker?.heartbeatAt ? Date.parse(worker.heartbeatAt) : Number.NaN;
  const fresh = worker !== null && Number.isFinite(beat) && now - beat <= worker.staleAfterMs;
  if (fresh) return { display: job.state, alarm: false };
  return { display: "unknown", alarm: true };
}

// src/knowledge/format.ts
var MEDIUM_SHORT = new Intl.DateTimeFormat(void 0, { dateStyle: "medium", timeStyle: "short" });
var ISO_8601 = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
function defaultFormatDate(iso) {
  const t = ISO_8601.test(iso) ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? iso : MEDIUM_SHORT.format(new Date(t));
}

// src/knowledge/graph.ts
var DEFAULT_FACT_GRAPH_CATEGORIES = { subject: "Subject", fact: "Fact", evidence: "Evidence" };
function defaultGraphEvidenceLabel(c) {
  return c.sourceTitle ?? c.text.slice(0, 60);
}
function factGraphOption(facts, categories = DEFAULT_FACT_GRAPH_CATEGORIES, chunks = [], options = {}) {
  const { evidenceLabel = defaultGraphEvidenceLabel, formatDate = defaultFormatDate } = options;
  const nodes = [];
  const links = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (n) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push(n);
  };
  const loaded = new Map(chunks.map((c) => [c.chunkId, c]));
  for (const f of facts) {
    const subject = `subject:${f.subject}`;
    const node = `fact:${f.id}`;
    add({ id: subject, name: f.subject, category: 0, symbolSize: 28 });
    add({
      id: node,
      name: `${f.predicate}: ${f.object}`,
      category: 1,
      factId: f.id,
      status: f.status,
      validFrom: formatDate(f.validFrom),
      ...f.validTo ? { validTo: formatDate(f.validTo) } : {},
      symbolSize: 18
    });
    links.push({ source: subject, target: node });
    for (const c of f.evidence) {
      const ev = `evidence:${c}`;
      const chunk = loaded.get(c);
      add({ id: ev, name: chunk !== void 0 ? evidenceLabel(chunk) : c, category: 2, symbolSize: 10 });
      links.push({ source: node, target: ev });
    }
  }
  return {
    tooltip: {},
    legend: { data: [categories.subject, categories.fact, categories.evidence] },
    series: [
      {
        type: "graph",
        layout: "force",
        roam: true,
        draggable: true,
        label: { show: true, position: "right" },
        force: { repulsion: 120, edgeLength: 60 },
        categories: [{ name: categories.subject }, { name: categories.fact }, { name: categories.evidence }],
        data: nodes,
        links
      }
    ]
  };
}
var DEFAULT_FACTS_LABELS = {
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
  validRange: (from, to) => to ? `${from} to ${to}` : `from ${from}`,
  current: "Current",
  superseded: "Superseded",
  graph: "Map",
  loadMore: "Load more",
  categories: DEFAULT_FACT_GRAPH_CATEGORIES,
  decisionFailed: "The decision could not be saved.",
  versionRefused: (v) => `Unsupported knowledge contract version ${v === null ? "(none)" : `"${v}"`}; this explorer reads "${G282_VERSION}". Nothing from it is shown.`,
  shapeRefused: "The knowledge service returned a shape this explorer does not recognise. Nothing from it is shown.",
  loadFailed: "The knowledge service could not be reached."
};
var STATUS_COLOR = { accepted: "emerald", proposed: "amber", belief: "zinc" };
function defaultEvidenceLabel(c) {
  const p = c.provenance;
  const title = c.sourceTitle ?? "";
  return [title, p.headingPath.join(" / "), p.uri === title ? "" : p.uri, p.lineStart !== null ? `lines ${p.lineStart}-${p.lineEnd ?? p.lineStart}` : "", p.trust].filter(Boolean).join(" \xB7 ");
}
function errorText(r, labels) {
  if (r.ok) return "";
  return r.error === "knowledge.version" ? labels.versionRefused(r.version ?? null) : labels.shapeRefused;
}
function ErrorLine({ text, area }) {
  if (!text) return null;
  return /* @__PURE__ */ jsxRuntime.jsx("div", { "data-fancy-chat-knowledge-error": area, children: /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Callout, { color: "red", children: text }) });
}
function FactsExplorer(props) {
  const { adapter, includeUnaccepted = true, onAccept, onReject, graph: Graph, className, pageSize = 50, formatDate = defaultFormatDate, evidenceLabel = defaultEvidenceLabel } = props;
  const labels = { ...DEFAULT_FACTS_LABELS, ...props.labels };
  const [ownSubject, setOwnSubject] = react.useState(props.subject ?? "");
  const subject = props.subject !== void 0 && props.onSubjectChange ? props.subject : ownSubject;
  const [draft, setDraft] = react.useState(subject);
  react.useEffect(() => setDraft(subject), [subject]);
  const [ownOpen, setOwnOpen] = react.useState(null);
  const openId = props.openFactId !== void 0 ? props.openFactId : ownOpen;
  const setOpen = (id) => {
    if (props.openFactId === void 0) setOwnOpen(id);
    props.onOpenFactChange?.(id);
  };
  const [facts, setFacts] = react.useState(null);
  const [factsCursor, setFactsCursor] = react.useState(null);
  const [factsError, setFactsError] = react.useState("");
  const [evidence, setEvidence] = react.useState([]);
  const [evidenceError, setEvidenceError] = react.useState("");
  const [versions, setVersions] = react.useState([]);
  const [versionsError, setVersionsError] = react.useState("");
  const [busy, setBusy] = react.useState(null);
  const busyRef = react.useRef(false);
  const [decisionError, setDecisionError] = react.useState("");
  const alive = react.useRef(true);
  react.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const read = react.useCallback(
    async (call, reader, onOk, onError) => {
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
    []
  );
  const loadFacts = react.useCallback(() => {
    if (adapter?.listFacts) {
      const list2 = adapter.listFacts.bind(adapter);
      void read(
        () => list2(subject || null, null, pageSize),
        readFactListingV2,
        (v) => {
          setFacts(v.items);
          setFactsCursor(v.nextCursor);
        },
        (t) => {
          setFactsError(t);
          if (t) setFacts(null);
        }
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
      }
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
        setFacts((prev) => [...prev ?? [], ...v.items]);
        setFactsCursor(v.nextCursor);
      },
      setFactsError
    );
  };
  react.useEffect(() => loadFacts(), [loadFacts]);
  const open = facts?.find((f) => f.id === openId) ?? null;
  const openKey = open ? `${open.id}|${open.evidence.join(",")}` : null;
  react.useEffect(() => {
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
        setVersionsError
      );
    }
  }, [openKey, adapter, read]);
  if (!adapter?.facts && !adapter?.listFacts) return null;
  const decide = async (fact, fn) => {
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
    if (props.subject === void 0 || !props.onSubjectChange) setOwnSubject(s);
    props.onSubjectChange?.(s);
  };
  return /* @__PURE__ */ jsxRuntime.jsxs("section", { "data-fancy-chat-facts": subject, className: ["flex flex-col gap-2", className].filter(Boolean).join(" "), children: [
    /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "font-medium", children: labels.title }),
    /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex items-end gap-2", children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { "data-fancy-chat-facts-subject": "", className: "flex-1", children: /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Input, { label: labels.subject, value: draft, onValueChange: setDraft, onKeyDown: (e) => e.key === "Enter" && submit() }) }),
      /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Button, { "data-fancy-chat-facts-load": "", onClick: submit, children: labels.load })
    ] }),
    /* @__PURE__ */ jsxRuntime.jsx(ErrorLine, { text: factsError, area: "facts" }),
    /* @__PURE__ */ jsxRuntime.jsx(ErrorLine, { text: decisionError, area: "decision" }),
    facts && !factsError ? facts.length ? /* @__PURE__ */ jsxRuntime.jsxs(reactFancy.Table, { children: [
      /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Head, { children: /* @__PURE__ */ jsxRuntime.jsxs(reactFancy.Table.Row, { children: [
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Column, { label: labels.columns.predicate }),
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Column, { label: labels.columns.object }),
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Column, { label: labels.columns.status }),
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Column, { label: labels.columns.validFrom }),
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Column, { label: "" })
      ] }) }),
      /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Body, { children: facts.map((f) => /* @__PURE__ */ jsxRuntime.jsxs(reactFancy.Table.Row, { "data-fancy-chat-fact": f.id, "data-fancy-chat-fact-status": f.status, children: [
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Cell, { children: f.predicate }),
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Cell, { children: f.object }),
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Cell, { children: /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Badge, { color: STATUS_COLOR[f.status], variant: "soft", size: "sm", children: /* @__PURE__ */ jsxRuntime.jsx("span", { "data-fancy-chat-fact-status-badge": "", children: labels.status[f.status] }) }) }),
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Cell, { children: formatDate(f.validFrom) }),
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Cell, { children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex gap-1", children: [
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Button, { size: "xs", variant: "ghost", "data-fancy-chat-fact-open": f.id, onClick: () => setOpen(f.id), children: labels.open }),
          canDecide && f.status === "proposed" ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
            /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Button, { size: "xs", color: "emerald", "data-fancy-chat-fact-accept": f.id, "data-fancy-chat-human-only": "", disabled: busy !== null, onClick: () => void decide(f, onAccept), children: labels.accept }),
            /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Button, { size: "xs", variant: "ghost", "data-fancy-chat-fact-reject": f.id, "data-fancy-chat-human-only": "", disabled: busy !== null, onClick: () => void decide(f, onReject), children: labels.reject })
          ] }) : null
        ] }) })
      ] }, f.id)) })
    ] }) : /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { children: labels.noFacts }) : null,
    !factsError && factsCursor && adapter.listFacts ? /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Button, { size: "sm", variant: "ghost", "data-fancy-chat-facts-more": "", onClick: loadMoreFacts, children: labels.loadMore }) : null,
    Graph && facts && facts.length && !factsError ? /* @__PURE__ */ jsxRuntime.jsxs("div", { "data-fancy-chat-facts-graph": "", children: [
      /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "text-sm opacity-70", children: labels.graph }),
      /* @__PURE__ */ jsxRuntime.jsx(Graph, { facts, chunks: evidence, onSelectFact: (id) => setOpen(id), categories: labels.categories, formatDate, ...props.evidenceLabel ? { evidenceLabel: props.evidenceLabel } : {} })
    ] }) : null,
    /* @__PURE__ */ jsxRuntime.jsxs(reactFancy.Drawer, { open: open !== null, onClose: () => setOpen(null), side: "right", children: [
      /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Drawer.Header, { children: open ? `${open.subject} \xB7 ${open.predicate}` : "" }),
      /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Drawer.Body, { children: open ? /* @__PURE__ */ jsxRuntime.jsxs("div", { "data-fancy-chat-fact-drawer": open.id, className: "flex flex-col gap-4", children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "whitespace-pre-wrap break-words", children: open.object }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Badge, { color: STATUS_COLOR[open.status], variant: "soft", size: "sm", children: labels.status[open.status] })
        ] }),
        adapter.getChunks ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex flex-col gap-2", children: [
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "font-medium", children: labels.evidence }),
          /* @__PURE__ */ jsxRuntime.jsx(ErrorLine, { text: evidenceError, area: "evidence" }),
          !evidenceError && evidence.length === 0 ? /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "text-sm opacity-70", children: labels.noEvidence }) : null,
          !evidenceError ? evidence.map((c) => /* @__PURE__ */ jsxRuntime.jsxs("div", { "data-fancy-chat-fact-evidence": c.chunkId, className: "flex flex-col gap-1", children: [
            /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "whitespace-pre-wrap break-words", children: c.text }),
            /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "text-xs opacity-70", children: /* @__PURE__ */ jsxRuntime.jsx("span", { "data-fancy-chat-fact-evidence-label": c.chunkId, children: evidenceLabel(c) }) })
          ] }, c.chunkId)) : null
        ] }) : null,
        adapter.factTimeline ? /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex flex-col gap-2", children: [
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "font-medium", children: labels.versions }),
          /* @__PURE__ */ jsxRuntime.jsx(ErrorLine, { text: versionsError, area: "versions" }),
          !versionsError && versions.length ? (
            // Not animated: an animated item stays hidden until it scrolls into view.
            /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Timeline, { animated: false, children: versions.map((v) => {
              const current = v.id === open.id;
              return /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Timeline.Item, { color: current ? "emerald" : "zinc", active: current, children: /* @__PURE__ */ jsxRuntime.jsxs("div", { "data-fancy-chat-fact-version": v.id, "data-fancy-chat-fact-version-current": current ? "true" : "false", className: "flex flex-col", children: [
                /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "whitespace-pre-wrap break-words", children: v.object }),
                /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "text-xs opacity-70", children: [labels.validRange(formatDate(v.validFrom), v.validTo ? formatDate(v.validTo) : null), labels.status[v.status], v.supersededBy ? labels.superseded : current ? labels.current : ""].filter(Boolean).join(" \xB7 ") })
              ] }) }, v.id);
            }) })
          ) : null
        ] }) : null
      ] }) : null })
    ] })
  ] });
}
var DEFAULT_KNOWLEDGE_LABELS = {
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
  close: "Close"
};
var DISPLAY_COLOR = { done: "emerald", failed: "red", queued: "sky", running: "sky", unknown: "zinc" };
function errorText2(r, labels) {
  if (r.ok) return "";
  return r.error === "knowledge.version" ? labels.versionRefused(r.version ?? null) : labels.shapeRefused;
}
function useControlled(value, onChange, initial) {
  const [own, setOwn] = react.useState(initial);
  const current = value !== void 0 ? value : own;
  const set = (v) => {
    if (value === void 0) setOwn(v);
    onChange?.(v);
  };
  return [current, set];
}
function ErrorLine2({ text, area }) {
  if (!text) return null;
  return /* @__PURE__ */ jsxRuntime.jsx("div", { "data-fancy-chat-knowledge-error": area, children: /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Callout, { color: "red", children: text }) });
}
function KnowledgeExplorer(props) {
  const { adapter, jobsAvailable = false, now = Date.now, pageSize = 50, searchLimit = 10, className } = props;
  const labels = { ...DEFAULT_KNOWLEDGE_LABELS, ...props.labels };
  const [query, setQuery] = useControlled(props.query, props.onQueryChange, "");
  const [openSource, setOpenSource] = useControlled(props.openSourceId, props.onOpenSourceChange, null);
  const [hits, setHits] = react.useState(null);
  const [searchError, setSearchError] = react.useState("");
  const [sources, setSources] = react.useState([]);
  const [sourcesCursor, setSourcesCursor] = react.useState(null);
  const [sourcesError, setSourcesError] = react.useState("");
  const [chunks, setChunks] = react.useState([]);
  const [chunksCursor, setChunksCursor] = react.useState(null);
  const [chunksError, setChunksError] = react.useState("");
  const [jobs, setJobs] = react.useState([]);
  const [jobsError, setJobsError] = react.useState("");
  const [worker, setWorker] = react.useState(null);
  const [workerError, setWorkerError] = react.useState("");
  const alive = react.useRef(true);
  react.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = react.useCallback(
    async (call, read, onOk, onError) => {
      try {
        const r = read(await call());
        if (!alive.current) return;
        if (r.ok) {
          onError("");
          onOk(r.value);
        } else {
          onError(errorText2(r, labels));
        }
      } catch {
        if (alive.current) onError(labels.loadFailed);
      }
    },
    // labels are display-only; re-creating the loader per label change is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const loadSources = react.useCallback(
    (cursor) => {
      if (!adapter?.listSources) return;
      const list = adapter.listSources.bind(adapter);
      void load(
        () => list(cursor, pageSize),
        readSourceListing,
        (v) => {
          setSources((prev) => cursor === null ? v.items : [...prev, ...v.items]);
          setSourcesCursor(v.nextCursor);
        },
        setSourcesError
      );
    },
    [adapter, load, pageSize]
  );
  react.useEffect(() => {
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
  const loadChunks = react.useCallback(
    (sourceId, cursor) => {
      if (!adapter?.listChunks) return;
      const list = adapter.listChunks.bind(adapter);
      void load(
        () => list(sourceId, cursor, pageSize),
        readChunkListing,
        (v) => {
          setChunks((prev) => cursor === null ? v.items : [...prev, ...v.items]);
          setChunksCursor(v.nextCursor);
        },
        setChunksError
      );
    },
    [adapter, load, pageSize]
  );
  react.useEffect(() => {
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
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { "data-fancy-chat-knowledge": "", className: ["flex flex-col gap-4", className].filter(Boolean).join(" "), children: [
    /* @__PURE__ */ jsxRuntime.jsxs("section", { className: "flex flex-col gap-2", children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex items-end gap-2", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { "data-fancy-chat-knowledge-query": "", className: "flex-1", children: /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Input, { label: labels.query, value: query, onValueChange: setQuery, type: "search", onKeyDown: (e) => e.key === "Enter" && runSearch() }) }),
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Button, { "data-fancy-chat-knowledge-search": "", onClick: runSearch, children: labels.search })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx(ErrorLine2, { text: searchError, area: "search" }),
      hits ? hits.length ? /* @__PURE__ */ jsxRuntime.jsx("ul", { className: "flex flex-col gap-2", "data-fancy-chat-knowledge-hits": "", children: hits.map((h) => /* @__PURE__ */ jsxRuntime.jsxs("li", { "data-fancy-chat-knowledge-hit": h.chunkId, children: [
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "whitespace-pre-wrap break-words", children: h.text }),
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "text-xs opacity-70", children: h.provenance.uri })
      ] }, h.chunkId)) }) : /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { children: labels.noHits }) : null
    ] }),
    adapter.listSources ? /* @__PURE__ */ jsxRuntime.jsxs("section", { "data-fancy-chat-knowledge-sources": "", className: "flex flex-col gap-2", children: [
      /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "font-medium", children: labels.sources }),
      /* @__PURE__ */ jsxRuntime.jsx(ErrorLine2, { text: sourcesError, area: "sources" }),
      !sourcesError ? /* @__PURE__ */ jsxRuntime.jsxs(reactFancy.Table, { children: [
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Head, { children: /* @__PURE__ */ jsxRuntime.jsxs(reactFancy.Table.Row, { children: [
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Column, { label: labels.columns.title }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Column, { label: labels.columns.kind }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Column, { label: labels.columns.chunks }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Column, { label: labels.columns.trust }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Column, { label: labels.columns.created }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Column, { label: "" })
        ] }) }),
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Body, { children: sources.map((s) => /* @__PURE__ */ jsxRuntime.jsxs(reactFancy.Table.Row, { "data-fancy-chat-knowledge-source": s.sourceId, children: [
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Cell, { children: s.title }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Cell, { children: s.kind ?? "" }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Cell, { children: String(s.chunkCount) }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Cell, { children: s.trust }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Cell, { children: s.createdAt }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Cell, { children: adapter.listChunks ? /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Button, { size: "xs", variant: "ghost", "data-fancy-chat-knowledge-open-source": s.sourceId, onClick: () => setOpenSource(s.sourceId), children: labels.open }) : null })
        ] }, s.sourceId)) })
      ] }) : null,
      !sourcesError && sourcesCursor ? /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Button, { size: "sm", variant: "ghost", "data-fancy-chat-knowledge-load-more": "", onClick: () => loadSources(sourcesCursor), children: labels.loadMore }) : null
    ] }) : null,
    adapter.facts || adapter.listFacts ? /* @__PURE__ */ jsxRuntime.jsx(
      FactsExplorer,
      {
        adapter,
        ...props.factSubject !== void 0 ? { subject: props.factSubject } : {},
        ...props.onAcceptFact ? { onAccept: props.onAcceptFact } : {},
        ...props.onRejectFact ? { onReject: props.onRejectFact } : {},
        ...props.factGraph ? { graph: props.factGraph } : {},
        ...props.factsLabels ? { labels: props.factsLabels } : {}
      }
    ) : null,
    adapter.ingestJobs || adapter.workerStatus ? /* @__PURE__ */ jsxRuntime.jsxs("section", { "data-fancy-chat-knowledge-ingest": "", className: "flex flex-col gap-2", children: [
      /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "font-medium", children: labels.ingest }),
      /* @__PURE__ */ jsxRuntime.jsx(ErrorLine2, { text: jobsError, area: "ingest" }),
      /* @__PURE__ */ jsxRuntime.jsx(ErrorLine2, { text: workerError, area: "worker" }),
      alarm ? /* @__PURE__ */ jsxRuntime.jsx("div", { "data-fancy-chat-knowledge-worker-alarm": "", role: "alert", children: /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Callout, { color: "red", children: labels.nothingProcessing }) }) : null,
      !jobsError && shown.length ? /* @__PURE__ */ jsxRuntime.jsxs(reactFancy.Table, { children: [
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Head, { children: /* @__PURE__ */ jsxRuntime.jsxs(reactFancy.Table.Row, { children: [
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Column, { label: labels.ingestColumns.source }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Column, { label: labels.ingestColumns.status }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Column, { label: labels.ingestColumns.progress }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Column, { label: labels.ingestColumns.errors })
        ] }) }),
        /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Body, { children: shown.map(({ job, display }) => /* @__PURE__ */ jsxRuntime.jsxs(reactFancy.Table.Row, { "data-fancy-chat-knowledge-job": job.jobId, "data-fancy-chat-knowledge-job-display": display, children: [
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Cell, { children: job.sourceId }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Cell, { children: /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Badge, { color: DISPLAY_COLOR[display], variant: "soft", size: "sm", children: labels.display[display] }) }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Cell, { children: display === "done" || display === "failed" || display === "running" ? `${job.progress.done}${job.progress.total === null ? "" : ` / ${job.progress.total}`}` : "" }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Table.Cell, { children: job.errors.map((e) => `${e.code}: ${e.message}`).join("; ") })
        ] }, job.jobId)) })
      ] }) : null
    ] }) : null,
    adapter.listChunks ? /* @__PURE__ */ jsxRuntime.jsxs(reactFancy.Drawer, { open: openSource !== null, onClose: () => setOpenSource(null), side: "right", children: [
      /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Drawer.Header, { children: `${labels.chunks}: ${openTitle}` }),
      /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Drawer.Body, { children: /* @__PURE__ */ jsxRuntime.jsxs("div", { "data-fancy-chat-knowledge-chunks": openSource ?? "", className: "flex flex-col gap-3", children: [
        /* @__PURE__ */ jsxRuntime.jsx(ErrorLine2, { text: chunksError, area: "chunks" }),
        !chunksError ? chunks.map((c) => /* @__PURE__ */ jsxRuntime.jsxs("div", { "data-fancy-chat-knowledge-chunk": c.chunkId, className: "flex flex-col gap-1", children: [
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "whitespace-pre-wrap break-words", children: c.text }),
          /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { className: "text-xs opacity-70", "data-fancy-chat-knowledge-provenance": "", children: [c.provenance.headingPath.join(" / "), c.provenance.uri, c.provenance.lineStart !== null ? `lines ${c.provenance.lineStart}-${c.provenance.lineEnd ?? c.provenance.lineStart}` : "", c.provenance.trust].filter(Boolean).join(" \xB7 ") })
        ] }, c.chunkId)) : null,
        !chunksError && chunksCursor && openSource ? /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Button, { size: "sm", variant: "ghost", "data-fancy-chat-knowledge-chunks-more": "", onClick: () => loadChunks(openSource, chunksCursor), children: labels.loadMore }) : null
      ] }) })
    ] }) : null
  ] });
}

exports.DEFAULT_FACTS_LABELS = DEFAULT_FACTS_LABELS;
exports.DEFAULT_FACT_GRAPH_CATEGORIES = DEFAULT_FACT_GRAPH_CATEGORIES;
exports.DEFAULT_KNOWLEDGE_LABELS = DEFAULT_KNOWLEDGE_LABELS;
exports.FactsExplorer = FactsExplorer;
exports.G282_2_VERSION = G282_2_VERSION;
exports.G282_VERSION = G282_VERSION;
exports.KnowledgeExplorer = KnowledgeExplorer;
exports.defaultEvidenceLabel = defaultEvidenceLabel;
exports.defaultFormatDate = defaultFormatDate;
exports.defaultGraphEvidenceLabel = defaultGraphEvidenceLabel;
exports.deriveIngestDisplay = deriveIngestDisplay;
exports.factGraphOption = factGraphOption;
exports.readChunkListing = readChunkListing;
exports.readFactListing = readFactListing;
exports.readFactListingV2 = readFactListingV2;
exports.readIngestJob = readIngestJob;
exports.readIngestJobListing = readIngestJobListing;
exports.readSourceListing = readSourceListing;
exports.readWorkerStatus = readWorkerStatus;
//# sourceMappingURL=knowledge.cjs.map
//# sourceMappingURL=knowledge.cjs.map