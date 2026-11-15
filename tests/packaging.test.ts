// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The same checker fancy-chat-js runs on itself (and proves against a negative
// control there), imported rather than copied.
// @ts-expect-error -- a plain .mjs script with no declaration file
import { checkNoPrism } from "@particle-academy/fancy-chat-js/scripts/check-no-prism.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
const tsup = readFileSync(`${root}/tsup.config.ts`, "utf8");

describe("packaging", () => {
  it("has no Prism dependency, import or bundled module (owner 2026-11-15)", () => {
    const { findings, visited } = checkNoPrism(root);
    expect(visited.manifest).toBe(true);
    expect(visited.sources).toBeGreaterThan(5);
    expect(findings).toEqual([]);
  });

  it("carries no runtime dependencies: react-fancy, the contract and React are peers", () => {
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(Object.keys(pkg.peerDependencies).sort()).toEqual([
      "@particle-academy/fancy-chat-js",
      "@particle-academy/fancy-echarts",
      "@particle-academy/react-fancy",
      "react",
      "react-dom",
    ]);
  });

  it("fancy-echarts is an OPTIONAL peer, and echarts is never listed directly", () => {
    expect(pkg.peerDependenciesMeta?.["@particle-academy/fancy-echarts"]).toEqual({ optional: true });
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) expect(Object.keys(pkg[field] ?? {})).not.toContain("echarts");
  });

  it("exports the optional ./knowledge and ./charts entries", () => {
    expect(Object.keys(pkg.exports)).toEqual(expect.arrayContaining([".", "./knowledge", "./charts"]));
  });

  it("never bundles a peer", () => {
    for (const peer of Object.keys(pkg.peerDependencies)) expect(tsup).toContain(`"${peer}"`);
  });

  it("the built root entry reaches neither ./knowledge, ./charts nor fancy-echarts (metafile)", () => {
    // `npm test` builds first (pretest), so this reads the real import graph.
    const metaPath = `${root}/dist/metafile-esm.json`;
    if (!existsSync(metaPath)) throw new Error("dist/metafile-esm.json is missing: run `npm test` (which builds first) or `npm run build`.");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
      outputs: Record<string, { imports?: { path: string; external?: boolean }[]; inputs?: Record<string, unknown> }>;
    };
    const key = (p: string) => p.replace(/^\.\//, "");
    const outputs = new Map(Object.entries(meta.outputs).map(([k, v]) => [key(k), v]));
    const seen = new Set<string>();
    const queue = ["dist/index.js"];
    const externals: string[] = [];
    const inputs: string[] = [];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const out = outputs.get(file);
      expect(out, `metafile has no output ${file}`).toBeDefined();
      inputs.push(...Object.keys(out!.inputs ?? {}));
      for (const imp of out!.imports ?? []) {
        if (imp.external) externals.push(imp.path);
        else queue.push(key(imp.path));
      }
    }
    expect(inputs.length).toBeGreaterThan(5);
    expect(inputs.filter((i) => /src[\\/](knowledge|charts)[\\/]/.test(i))).toEqual([]);
    expect(externals.filter((e) => e.includes("fancy-echarts"))).toEqual([]);
    // ...and the charts entry does reach it, so the check above can see one.
    const charts = outputs.get("dist/charts.js");
    const chartsReach = JSON.stringify(charts) + [...outputs.values()].map((o) => JSON.stringify(o.imports ?? [])).join("");
    expect(chartsReach).toContain("@particle-academy/fancy-echarts");
  });

  it("first-party peer ranges are maintained ranges, not file: links or 0.x carets", () => {
    expect(pkg.peerDependencies["@particle-academy/fancy-chat-js"]).toBe(">=0.1.0 <2.0");
    // PromptInput `triggers` ships in react-fancy 6.27.0, which refuses 6.26.0 (no
    // `triggers`). No prerelease: semver ranges exclude prereleases, so every sibling
    // peering on react-fancy (fancy-app-update, fancy-whats-new, fancy-inertia) would
    // refuse one, and a real host's install fails ERESOLVE.
    expect(pkg.peerDependencies["@particle-academy/react-fancy"]).toBe(">=6.27.0 <7");
    for (const range of Object.values(pkg.peerDependencies) as string[]) expect(range).not.toMatch(/^file:/);
  });
});

describe("installable from git", () => {
  it("builds dist in prepare, which npm runs for a git dependency", () => {
    expect(pkg.scripts.prepare).toBe("npm run build");
    expect(pkg.scripts.build).toBe("tsup");
  });

  it("dev dependencies on unreleased siblings are pinned to a commit, never a local path", () => {
    for (const [name, spec] of Object.entries(pkg.devDependencies as Record<string, string>)) {
      expect(spec, name).not.toMatch(/^file:/);
      // HTTPS, never SSH: a CI runner has no key, so a git+ssh lockfile entry cannot be cloned there.
      expect(spec, name).not.toMatch(/^(github:|git\+ssh:|git@)/);
      if (spec.startsWith("git+https:")) expect(spec, name).toMatch(/^git\+https:\/\/github\.com\/Particle-Academy\/[a-z0-9-]+\.git#[0-9a-f]{40}$/);
    }
  });
});
