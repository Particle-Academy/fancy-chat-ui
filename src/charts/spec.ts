/** The neutral chart spec a `chart` part carries (fancy-chat-js validates it). */
export interface ChartSpec {
  type: "line" | "bar" | "area" | "pie" | "scatter";
  series: { name?: string; data: unknown[] }[];
  x?: { categories?: string[] };
}

type Option = Record<string, unknown>;

/**
 * Neutral spec to an ECharts option. Only keys this function names are ever
 * emitted: a spec field it does not know (a `formatter` string, say) never
 * reaches ECharts, because ECharts formatters and rich text are where an
 * option stops being data.
 */
export function chartSpecToOption(spec: ChartSpec, title?: string | null): Option {
  const categories = Array.isArray(spec.x?.categories) ? spec.x.categories.map(String) : undefined;
  const series = Array.isArray(spec.series) ? spec.series : [];
  const named = (s: { name?: string }) => (typeof s.name === "string" ? { name: s.name } : {});
  const out: Option = {};
  if (typeof title === "string" && title !== "") out.title = { text: title };

  if (spec.type === "pie") {
    const first = series[0];
    const data = (first?.data ?? []).map((v, i) => (categories?.[i] !== undefined ? { name: categories[i], value: v } : v));
    out.tooltip = { trigger: "item" };
    if (categories?.length) out.legend = { data: categories };
    out.series = first ? [{ type: "pie", ...named(first), data }] : [];
    return out;
  }

  out.tooltip = { trigger: spec.type === "scatter" ? "item" : "axis" };
  const names = series.map((s) => s.name).filter((n): n is string => typeof n === "string");
  if (series.length > 1 && names.length) out.legend = { data: names };
  out.xAxis = spec.type === "scatter" ? { type: "value" } : { type: "category", ...(categories ? { data: categories } : {}) };
  out.yAxis = { type: "value" };
  out.series = series.map((s) => {
    const data = Array.isArray(s.data) ? s.data : [];
    if (spec.type === "area") return { type: "line", areaStyle: {}, ...named(s), data };
    return { type: spec.type, ...named(s), data };
  });
  return out;
}
