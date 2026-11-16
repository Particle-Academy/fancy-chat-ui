// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
const tsup = readFileSync(`${root}/tsup.config.ts`, "utf8");

describe("packaging", () => {
  it("carries no runtime dependencies: react-fancy, the contract, prism-graph's types and React are peers", () => {
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(Object.keys(pkg.peerDependencies).sort()).toEqual([
      "@particle-academy/fancy-chat-js",
      "@particle-academy/fancy-echarts",
      "@particle-academy/prism-graph",
      "@particle-academy/react-fancy",
      "react",
      "react-dom",
    ]);
  });

  it("no longer runs the withdrawn no-Prism check (owner, 2026-11-16)", () => {
    expect(pkg.scripts["check:no-prism"]).toBeUndefined();
  });

  it("takes the knowledge types from prism-graph: an OPTIONAL peer, read for types only", () => {
    expect(pkg.peerDependencies["@particle-academy/prism-graph"]).toBe(">=0.3.0 <2.0");
    expect(pkg.peerDependenciesMeta?.["@particle-academy/prism-graph"]).toEqual({ optional: true });
    const shapes = readFileSync(`${root}/src/knowledge/shapes.ts`, "utf8");
    expect(shapes).toMatch(/import type \{[^}]*\bListedSource\b[^}]*\} from "@particle-academy\/prism-graph"/);
  });

  it("no built file imports prism-graph at runtime (its index loads a node:sqlite driver)", () => {
    const files = readdirSync(`${root}/dist`).filter((f) => /\.(c?js)$/.test(f));
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) expect(readFileSync(`${root}/dist/${f}`, "utf8"), f).not.toContain("@particle-academy/prism-graph");
    // ...while the declarations do name it, so the check above is not vacuous.
    expect(readFileSync(`${root}/dist/knowledge.d.ts`, "utf8")).toContain("@particle-academy/prism-graph");
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
    // PromptInput `attachments` ships in react-fancy 6.28.0 (`triggers` in 6.27.0). No
    // prerelease: semver ranges exclude prereleases, so every sibling peering on
    // react-fancy (fancy-app-update, fancy-whats-new, fancy-inertia) would refuse one,
    // and a real host's install fails ERESOLVE.
    expect(pkg.peerDependencies["@particle-academy/react-fancy"]).toBe(">=6.28.0 <7.0");
    for (const range of Object.values(pkg.peerDependencies) as string[]) expect(range).not.toMatch(/^file:/);
  });
});

describe("installable from git", () => {
  it("dev dependencies on unreleased siblings are pinned to a commit, never a local path", () => {
    for (const [name, spec] of Object.entries(pkg.devDependencies as Record<string, string>)) {
      expect(spec, name).not.toMatch(/^file:/);
      // HTTPS, never SSH: a CI runner has no key, so a git+ssh lockfile entry cannot be cloned there.
      expect(spec, name).not.toMatch(/^(github:|git\+ssh:|git@)/);
      if (spec.startsWith("git+https:")) expect(spec, name).toMatch(/^git\+https:\/\/github\.com\/Particle-Academy\/[a-z0-9-]+\.git#[0-9a-f]{40}$/);
    }
  });
});

describe("installs from git without building", () => {
  it("has no prepare script, so npm installs no devDependencies and runs no build for a git dependency", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    expect(manifest.scripts.prepare).toBeUndefined();
    expect(manifest.scripts.prepack).toBeUndefined();
  });

  it("commits dist: every entry file the manifest names is tracked by git", () => {
    const tracked = execFileSync("git", ["ls-files", "dist"], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { main: string; module: string; types: string };
    for (const entry of [manifest.main, manifest.module, manifest.types]) expect(tracked, entry).toContain(entry.replace(/^\.\//, ""));
  });
});
