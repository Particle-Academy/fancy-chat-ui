import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// jsdom has no canvas, so fancy-echarts' component is replaced by a probe that
// records the option it was handed. What is under test is the option.
vi.mock("@particle-academy/fancy-echarts", () => ({
  EChart: (props: { option: unknown; style?: { height?: number } }) => (
    <div data-echart-probe="" data-option={JSON.stringify(props.option)} data-height={String(props.style?.height)} />
  ),
}));

import { PartView } from "../src/index";
import { chartPartRenderer, chartSpecToOption } from "../src/charts/index";

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const optionOf = () => JSON.parse(el("[data-echart-probe]")!.getAttribute("data-option")!);

describe("chartSpecToOption", () => {
  it("bar with categories and two series", () => {
    expect(
      chartSpecToOption({ type: "bar", series: [{ name: "2025", data: [1, 2] }, { name: "2026", data: [3, 4] }], x: { categories: ["Jan", "Feb"] } }, "Revenue"),
    ).toEqual({
      title: { text: "Revenue" },
      tooltip: { trigger: "axis" },
      legend: { data: ["2025", "2026"] },
      xAxis: { type: "category", data: ["Jan", "Feb"] },
      yAxis: { type: "value" },
      series: [
        { type: "bar", name: "2025", data: [1, 2] },
        { type: "bar", name: "2026", data: [3, 4] },
      ],
    });
  });

  it("area is a line with an area fill; one series has no legend and no title", () => {
    expect(chartSpecToOption({ type: "area", series: [{ data: [1, 2, 3] }] })).toEqual({
      tooltip: { trigger: "axis" },
      xAxis: { type: "category" },
      yAxis: { type: "value" },
      series: [{ type: "line", areaStyle: {}, data: [1, 2, 3] }],
    });
  });

  it("a single NAMED series still gets no legend", () => {
    expect(chartSpecToOption({ type: "line", series: [{ name: "only", data: [1] }] }).legend).toBeUndefined();
  });

  it("scatter uses value axes and item tooltips", () => {
    const o = chartSpecToOption({ type: "scatter", series: [{ name: "pts", data: [[1, 2], [3, 4]] }] });
    expect(o.xAxis).toEqual({ type: "value" });
    expect(o.tooltip).toEqual({ trigger: "item" });
    expect(o.series).toEqual([{ type: "scatter", name: "pts", data: [[1, 2], [3, 4]] }]);
  });

  it("pie names its slices from the categories, first series only", () => {
    expect(chartSpecToOption({ type: "pie", series: [{ name: "Share", data: [60, 40] }, { data: [1] }], x: { categories: ["A", "B"] } })).toEqual({
      tooltip: { trigger: "item" },
      legend: { data: ["A", "B"] },
      series: [{ type: "pie", name: "Share", data: [{ name: "A", value: 60 }, { name: "B", value: 40 }] }],
    });
  });

  it("never carries keys the spec did not name (no formatters, no functions)", () => {
    const spec = { type: "line", series: [{ name: "a", data: [1], formatter: "{a}" }], x: { categories: ["x"], formatter: "evil" } } as never;
    const o = chartSpecToOption(spec);
    expect(JSON.stringify(o)).not.toContain("formatter");
  });
});

describe("chartPartRenderer", () => {
  const spec = { id: "c", kind: "chart", title: "Revenue", spec: { type: "line", series: [{ name: "a", data: [1, 2] }], x: { categories: ["Q1", "Q2"] } } };
  const raw = { id: "r", kind: "chart", title: "Raw", echarts: { series: [{ type: "gauge", data: [{ value: 50 }] }] } };

  it("renders the neutral spec through fancy-echarts' EChart", () => {
    render(<PartView part={spec} renderers={{ chart: chartPartRenderer() }} />);
    expect(optionOf().series).toEqual([{ type: "line", name: "a", data: [1, 2] }]);
    expect(el('[data-fancy-chat-chart="c"]')?.getAttribute("data-fancy-chat-chart-source")).toBe("spec");
  });

  it("refuses raw options by default and shows the part's plain text instead", () => {
    render(<PartView part={raw} renderers={{ chart: chartPartRenderer() }} />);
    expect(el("[data-echart-probe]")).toBeNull();
    expect(el('[data-fancy-chat-chart="r"]')?.getAttribute("data-fancy-chat-chart-refused")).toBe("raw-options");
    expect(el('[data-fancy-chat-chart="r"]')?.textContent).toContain("[chart: Raw]");
  });

  it("renders raw options only when the host allows them", () => {
    render(<PartView part={raw} renderers={{ chart: chartPartRenderer({ allowRawOptions: true }) }} />);
    expect(optionOf()).toEqual(raw.echarts);
    expect(el('[data-fancy-chat-chart="r"]')?.getAttribute("data-fancy-chat-chart-source")).toBe("raw");
  });

  it("an invalid spec falls back to text rather than handing ECharts a guess", () => {
    render(<PartView part={{ id: "b", kind: "chart", spec: { type: "sankey3d", series: [] } }} renderers={{ chart: chartPartRenderer() }} />);
    expect(el("[data-echart-probe]")).toBeNull();
    expect(el('[data-fancy-chat-chart="b"]')?.getAttribute("data-fancy-chat-chart-refused")).toBe("invalid");
  });

  it("uses the configured height", () => {
    render(<PartView part={spec} renderers={{ chart: chartPartRenderer({ height: 123 }) }} />);
    expect(el('[data-fancy-chat-chart="c"]')?.getAttribute("data-fancy-chat-chart-height")).toBe("123");
    expect(el("[data-echart-probe]")?.getAttribute("data-height")).toBe("123");
  });
});
