import { ReactNode } from 'react';
import { P as PartRenderer } from './PartView-BUiua884.cjs';
import { F as FactGraphProps } from './graph-DxRlbggl.cjs';
import '@particle-academy/react-fancy';
import '@particle-academy/fancy-chat-js';
import '@particle-academy/prism-graph';

/** The neutral chart spec a `chart` part carries (fancy-chat-js validates it). */
interface ChartSpec {
    type: "line" | "bar" | "area" | "pie" | "scatter";
    series: {
        name?: string;
        data: unknown[];
    }[];
    x?: {
        categories?: string[];
    };
}
type Option = Record<string, unknown>;
/**
 * Neutral spec to an ECharts option. Only keys this function names are ever
 * emitted: a spec field it does not know (a `formatter` string, say) never
 * reaches ECharts, because ECharts formatters and rich text are where an
 * option stops being data.
 */
declare function chartSpecToOption(spec: ChartSpec, title?: string | null): Option;

interface ChartPartRendererOptions {
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
declare function chartPartRenderer(options?: ChartPartRendererOptions): PartRenderer;
interface FactGraphChartProps extends FactGraphProps {
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
declare function FactGraph({ facts, chunks, onSelectFact, categories, height, theme, renderer }: FactGraphChartProps): ReactNode;

export { type ChartPartRendererOptions, type ChartSpec, FactGraph, type FactGraphChartProps, chartPartRenderer, chartSpecToOption };
