import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// jsdom has no canvas: a probe records the option and exposes the click handler.
vi.mock("@particle-academy/fancy-echarts", () => ({
  EChart: (props: { option: unknown; onEvents?: Record<string, (p: unknown) => void>; style?: { height?: number } }) => (
    <div data-echart-probe="" data-option={JSON.stringify(props.option)} data-height={String(props.style?.height)}>
      <button data-click-fact="" onClick={() => props.onEvents?.click?.({ dataType: "node", data: { id: "fact:f_2", factId: "f_2" } })} />
      <button data-click-subject="" onClick={() => props.onEvents?.click?.({ dataType: "node", data: { id: "subject:acme" } })} />
      <button data-click-edge="" onClick={() => props.onEvents?.click?.({ dataType: "edge", data: { source: "a", target: "b" } })} />
    </div>
  ),
}));

import { FactGraph } from "../src/charts/index";
import { factGraphOption, type KnowledgeFact } from "../src/knowledge/index";

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const fact = (id: string, evidence: string[]): KnowledgeFact => ({
  id,
  subject: "acme",
  predicate: "p",
  object: "o",
  evidence,
  validFrom: "2026-01-01T00:00:00Z",
  validTo: null,
  supersededBy: null,
  status: "proposed",
  recordedAt: null,
  expiredAt: null,
});

describe("FactGraph (./charts, on fancy-echarts' graph series)", () => {
  const facts = [fact("f_1", ["c_1"]), fact("f_2", ["c_1", "c_2"])];

  it("renders factGraphOption on EChart", () => {
    render(<FactGraph facts={facts} chunks={[]} onSelectFact={() => {}} height={300} />);
    expect(JSON.parse(el("[data-echart-probe]")!.getAttribute("data-option")!)).toEqual(factGraphOption(facts));
    expect(el("[data-echart-probe]")!.getAttribute("data-height")).toBe("300");
    expect(el("[data-fancy-chat-fact-graph]")).not.toBeNull();
  });

  it("a click on a fact node selects that fact; subjects and edges select nothing", () => {
    const onSelectFact = vi.fn();
    render(<FactGraph facts={facts} chunks={[]} onSelectFact={onSelectFact} />);
    fireEvent.click(el("[data-click-subject]")!);
    fireEvent.click(el("[data-click-edge]")!);
    expect(onSelectFact).not.toHaveBeenCalled();
    fireEvent.click(el("[data-click-fact]")!);
    expect(onSelectFact).toHaveBeenCalledWith("f_2");
  });
});
