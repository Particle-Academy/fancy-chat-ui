import { factGraphOption } from './chunk-ZLI6D2DT.js';
import { EChart } from '@particle-academy/fancy-echarts';
import { Text } from '@particle-academy/react-fancy';
import { validatePart, partToText } from '@particle-academy/fancy-chat-js';
import { jsx } from 'react/jsx-runtime';

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
function chartPartRenderer(options = {}) {
  const { allowRawOptions = false, height = 280, theme, renderer } = options;
  return (part) => {
    const handle = { "data-fancy-chat-chart": part.id, "data-fancy-chat-chart-height": String(height) };
    const fallback = (reason) => /* @__PURE__ */ jsx("div", { ...handle, "data-fancy-chat-chart-refused": reason, children: /* @__PURE__ */ jsx(Text, { children: partToText(part) }) });
    const raw = part.echarts !== void 0;
    if (raw && !allowRawOptions) return fallback("raw-options");
    const verdict = validatePart(part, { origin: raw ? "server" : "agent" });
    if (!verdict.ok) return fallback("invalid");
    const option = raw ? part.echarts : chartSpecToOption(part.spec, typeof part.title === "string" ? part.title : null);
    return /* @__PURE__ */ jsx("div", { ...handle, "data-fancy-chat-chart-source": raw ? "raw" : "spec", children: /* @__PURE__ */ jsx(EChart, { option, style: { width: "100%", height }, ...theme !== void 0 ? { theme } : {}, ...renderer ? { renderer } : {} }) });
  };
}
function FactGraph({ facts, chunks, onSelectFact, categories, height = 360, theme, renderer }) {
  const option = factGraphOption(facts, categories, chunks);
  const onEvents = {
    click: (p) => {
      if (p?.dataType === "node" && typeof p.data?.factId === "string") onSelectFact(p.data.factId);
    }
  };
  return /* @__PURE__ */ jsx("div", { "data-fancy-chat-fact-graph": "", children: /* @__PURE__ */ jsx(EChart, { option, onEvents, style: { width: "100%", height }, ...theme !== void 0 ? { theme } : {}, ...renderer ? { renderer } : {} }) });
}

export { FactGraph, chartPartRenderer, chartSpecToOption };
//# sourceMappingURL=charts.js.map
//# sourceMappingURL=charts.js.map