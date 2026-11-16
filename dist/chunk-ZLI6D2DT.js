// src/knowledge/graph.ts
var DEFAULT_FACT_GRAPH_CATEGORIES = { subject: "Subject", fact: "Fact", evidence: "Evidence" };
function factGraphOption(facts, categories = DEFAULT_FACT_GRAPH_CATEGORIES, chunks = []) {
  const nodes = [];
  const links = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (n) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push(n);
  };
  const passage = new Map(chunks.map((c) => [c.chunkId, c.text]));
  for (const f of facts) {
    const subject = `subject:${f.subject}`;
    const node = `fact:${f.id}`;
    add({ id: subject, name: f.subject, category: 0, symbolSize: 28 });
    add({ id: node, name: `${f.predicate}: ${f.object}`, category: 1, factId: f.id, status: f.status, symbolSize: 18 });
    links.push({ source: subject, target: node });
    for (const c of f.evidence) {
      const ev = `evidence:${c}`;
      const text = passage.get(c);
      add({ id: ev, name: text !== void 0 ? text.slice(0, 60) : c, category: 2, symbolSize: 10 });
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

export { DEFAULT_FACT_GRAPH_CATEGORIES, factGraphOption };
//# sourceMappingURL=chunk-ZLI6D2DT.js.map
//# sourceMappingURL=chunk-ZLI6D2DT.js.map