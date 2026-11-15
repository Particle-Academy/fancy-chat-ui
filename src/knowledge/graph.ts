import type { ComponentType } from "react";

import type { KnowledgeChunk, KnowledgeFact } from "./shapes";

/**
 * The facts map, as an ECharts `graph` series option. Pure, and it imports no
 * ECharts: `./knowledge` stays free of the optional fancy-echarts peer. The
 * component that draws it, `FactGraph`, lives in `./charts`.
 *
 * Nodes are subjects, facts and the evidence chunks they cite. Edges run from a
 * subject to each of its facts, and from a fact to each piece of its evidence.
 * Ids are prefixed by kind (`subject:`, `fact:`, `evidence:`) so a fact and a
 * chunk that share an id never merge.
 */
export interface FactGraphCategories {
  subject: string;
  fact: string;
  evidence: string;
}

export const DEFAULT_FACT_GRAPH_CATEGORIES: FactGraphCategories = { subject: "Subject", fact: "Fact", evidence: "Evidence" };

export interface FactGraphNode {
  id: string;
  name: string;
  /** 0 subject, 1 fact, 2 evidence. */
  category: 0 | 1 | 2;
  /** Set on fact nodes: the fact's id, unprefixed. */
  factId?: string;
  /** Set on fact nodes. */
  status?: KnowledgeFact["status"];
  symbolSize: number;
}

export function factGraphOption(
  facts: readonly KnowledgeFact[],
  categories: FactGraphCategories = DEFAULT_FACT_GRAPH_CATEGORIES,
  chunks: readonly KnowledgeChunk[] = [],
): Record<string, unknown> {
  const nodes: FactGraphNode[] = [];
  const links: { source: string; target: string }[] = [];
  const seen = new Set<string>();
  const add = (n: FactGraphNode) => {
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
      add({ id: ev, name: text !== undefined ? text.slice(0, 60) : c, category: 2, symbolSize: 10 });
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
        links,
      },
    ],
  };
}

export interface FactGraphProps {
  facts: readonly KnowledgeFact[];
  /** Evidence passages already loaded (the open fact's), to label evidence nodes. */
  chunks: readonly KnowledgeChunk[];
  /** A fact node was clicked. */
  onSelectFact: (factId: string) => void;
  categories?: FactGraphCategories;
}

/** What `FactsExplorer`'s `graph` prop takes: `FactGraph` from `./charts`, or the host's own. */
export type FactGraphComponent = ComponentType<FactGraphProps>;
