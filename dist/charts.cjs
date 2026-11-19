'use strict';

var fancyEcharts = require('@particle-academy/fancy-echarts');
var reactFancy = require('@particle-academy/react-fancy');
var fancyChatJs = require('@particle-academy/fancy-chat-js');
var jsxRuntime = require('react/jsx-runtime');

// src/charts/index.tsx

// src/charts/spec.ts
function chartSpecToOption(spec, title) {
  const categories = Array.isArray(spec.x?.categories) ? spec.x.categories.map(String) : void 0;
  const series = Array.isArray(spec.series) ? spec.series : [];
  const named = (s) => typeof s.name === "string" ? { name: s.name } : {};
  const out = {};
  if (typeof title === "string" && title !== "") out.title = { text: title };
  if (spec.type === "pie") {
    const first = series[0];
    const data = (first?.data ?? []).map((v, i) => categories?.[i] !== void 0 ? { name: categories[i], value: v } : v);
    out.tooltip = { trigger: "item" };
    if (categories?.length) out.legend = { data: categories };
    out.series = first ? [{ type: "pie", ...named(first), data }] : [];
    return out;
  }
  out.tooltip = { trigger: spec.type === "scatter" ? "item" : "axis" };
  const names = series.map((s) => s.name).filter((n) => typeof n === "string");
  if (series.length > 1 && names.length) out.legend = { data: names };
  out.xAxis = spec.type === "scatter" ? { type: "value" } : { type: "category", ...categories ? { data: categories } : {} };
  out.yAxis = { type: "value" };
  out.series = series.map((s) => {
    const data = Array.isArray(s.data) ? s.data : [];
    if (spec.type === "area") return { type: "line", areaStyle: {}, ...named(s), data };
    return { type: spec.type, ...named(s), data };
  });
  return out;
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
function chartPartRenderer(options = {}) {
  const { allowRawOptions = false, height = 280, theme, renderer } = options;
  return (part) => {
    const handle = { "data-fancy-chat-chart": part.id, "data-fancy-chat-chart-height": String(height) };
    const fallback = (reason) => /* @__PURE__ */ jsxRuntime.jsx("div", { ...handle, "data-fancy-chat-chart-refused": reason, children: /* @__PURE__ */ jsxRuntime.jsx(reactFancy.Text, { children: fancyChatJs.partToText(part) }) });
    const raw = part.echarts !== void 0;
    if (raw && !allowRawOptions) return fallback("raw-options");
    const verdict = fancyChatJs.validatePart(part, { origin: raw ? "server" : "agent" });
    if (!verdict.ok) return fallback("invalid");
    const option = raw ? part.echarts : chartSpecToOption(part.spec, typeof part.title === "string" ? part.title : null);
    return /* @__PURE__ */ jsxRuntime.jsx("div", { ...handle, "data-fancy-chat-chart-source": raw ? "raw" : "spec", children: /* @__PURE__ */ jsxRuntime.jsx(fancyEcharts.EChart, { option, style: { width: "100%", height }, ...theme !== void 0 ? { theme } : {}, ...renderer ? { renderer } : {} }) });
  };
}
var HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
var escapeHtml = (s) => s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
function factTooltip(p) {
  const d = p?.data ?? {};
  const name = escapeHtml(String(d.name ?? ""));
  if (d.category !== 1 || typeof d.validFrom !== "string") return name;
  const range = typeof d.validTo === "string" ? `${d.validFrom} to ${d.validTo}` : `from ${d.validFrom}`;
  return `${name}<br/>${escapeHtml(range)}`;
}
function FactGraph({ facts, chunks, onSelectFact, categories, evidenceLabel, formatDate, height = 360, theme, renderer }) {
  const base = factGraphOption(facts, categories, chunks, { ...evidenceLabel ? { evidenceLabel } : {}, ...formatDate ? { formatDate } : {} });
  const option = { ...base, tooltip: { formatter: factTooltip } };
  const onEvents = {
    click: (p) => {
      if (p?.dataType === "node" && typeof p.data?.factId === "string") onSelectFact(p.data.factId);
    }
  };
  return /* @__PURE__ */ jsxRuntime.jsx("div", { "data-fancy-chat-fact-graph": "", children: /* @__PURE__ */ jsxRuntime.jsx(fancyEcharts.EChart, { option, onEvents, style: { width: "100%", height }, ...theme !== void 0 ? { theme } : {}, ...renderer ? { renderer } : {} }) });
}

exports.FactGraph = FactGraph;
exports.chartPartRenderer = chartPartRenderer;
exports.chartSpecToOption = chartSpecToOption;
//# sourceMappingURL=charts.cjs.map
//# sourceMappingURL=charts.cjs.map