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

export { DEFAULT_FACT_GRAPH_CATEGORIES, defaultFormatDate, defaultGraphEvidenceLabel, factGraphOption };
//# sourceMappingURL=chunk-D6U3RCQE.js.map
//# sourceMappingURL=chunk-D6U3RCQE.js.map