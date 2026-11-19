import type { ReactNode } from "react";
import { EChart } from "@particle-academy/fancy-echarts";
import { Text } from "@particle-academy/react-fancy";
import { partToText, validatePart, type Part } from "@particle-academy/fancy-chat-js";

import type { PartRenderer } from "../PartView";
import { chartSpecToOption, type ChartSpec } from "./spec";
import { factGraphOption, type FactGraphNode, type FactGraphProps } from "../knowledge/graph";

export { chartSpecToOption, type ChartSpec } from "./spec";

export interface ChartPartRendererOptions {
  /**
   * Render raw `part.echarts` options. Default FALSE. Raw options are admitted
   * only from trusted server code (the server refuses them from an agent), so
   * a host turns this on only when its server places them.
   */
  allowRawOptions?: boolean;
  /** Chart height in pixels. Default 280. */
  height?: number;
  /** Passed to fancy-echarts' EChart. */
  theme?: string | object;
  renderer?: "canvas" | "svg";
}

/**
 * A PartRenderer for the `chart` part, on fancy-echarts. Register it with
 * `renderers={{ chart: chartPartRenderer() }}` on PartView or AgentThread.
 * The neutral spec renders by default; anything else falls back to the part's
 * plain text, never to a guess.
 */
export function chartPartRenderer(options: ChartPartRendererOptions = {}): PartRenderer {
  const { allowRawOptions = false, height = 280, theme, renderer } = options;
  return (part: Part): ReactNode => {
    const handle = { "data-fancy-chat-chart": part.id, "data-fancy-chat-chart-height": String(height) };
    const fallback = (reason: "raw-options" | "invalid") => (
      <div {...handle} data-fancy-chat-chart-refused={reason}>
        <Text>{partToText(part)}</Text>
      </div>
    );
    const raw = part.echarts !== undefined;
    if (raw && !allowRawOptions) return fallback("raw-options");
    // The contract decides validity: the same validator the servers run, with
    // `server` origin only when the host has said raw options are trusted.
    const verdict = validatePart(part, { origin: raw ? "server" : "agent" });
    if (!verdict.ok) return fallback("invalid");
    const option = raw
      ? (part.echarts as Record<string, unknown>)
      : chartSpecToOption(part.spec as ChartSpec, typeof part.title === "string" ? part.title : null);
    return (
      <div {...handle} data-fancy-chat-chart-source={raw ? "raw" : "spec"}>
        <EChart option={option as never} style={{ width: "100%", height }} {...(theme !== undefined ? { theme } : {})} {...(renderer ? { renderer } : {})} />
      </div>
    );
  };
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]!);

/** A node's tooltip: its name, and on a fact node its (formatted) valid range, all escaped. */
function factTooltip(p: { data?: Partial<FactGraphNode> }): string {
  const d = p?.data ?? {};
  const name = escapeHtml(String(d.name ?? ""));
  if (d.category !== 1 || typeof d.validFrom !== "string") return name;
  const range = typeof d.validTo === "string" ? `${d.validFrom} to ${d.validTo}` : `from ${d.validFrom}`;
  return `${name}<br/>${escapeHtml(range)}`;
}

export interface FactGraphChartProps extends FactGraphProps {
  /** Pixels. Default 360. */
  height?: number;
  /** Passed to fancy-echarts' EChart. */
  theme?: string | object;
  renderer?: "canvas" | "svg";
}

/**
 * The facts map from `./knowledge` (`factGraphOption`), drawn with fancy-echarts'
 * graph series: subjects, facts and evidence as nodes, edges from a subject to
 * its facts and from a fact to its evidence. Clicking a fact node selects it.
 * Pass it to `FactsExplorer`'s `graph` prop.
 */
export function FactGraph({ facts, chunks, onSelectFact, categories, evidenceLabel, formatDate, height = 360, theme, renderer }: FactGraphChartProps): ReactNode {
  const base = factGraphOption(facts, categories, chunks, { ...(evidenceLabel ? { evidenceLabel } : {}), ...(formatDate ? { formatDate } : {}) });
  // ECharts renders a tooltip formatter's return as HTML: every piece is escaped,
  // so fact text and dates stay plain text.
  const option = { ...base, tooltip: { formatter: factTooltip } };
  const onEvents = {
    click: (p: { dataType?: string; data?: { factId?: unknown } }) => {
      if (p?.dataType === "node" && typeof p.data?.factId === "string") onSelectFact(p.data.factId);
    },
  };
  return (
    <div data-fancy-chat-fact-graph="">
      <EChart option={option as never} onEvents={onEvents} style={{ width: "100%", height }} {...(theme !== undefined ? { theme } : {})} {...(renderer ? { renderer } : {})} />
    </div>
  );
}
