// @vitest-environment node
import { readFileSync } from "node:fs";
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
    expect(Object.keys(pkg.peerDependencies).sort()).toEqual(["@particle-academy/fancy-chat-js", "@particle-academy/react-fancy", "react", "react-dom"]);
  });

  it("never bundles a peer", () => {
    for (const peer of Object.keys(pkg.peerDependencies)) expect(tsup).toContain(`"${peer}"`);
  });

  it("first-party peer ranges are maintained ranges, not file: links or 0.x carets", () => {
    expect(pkg.peerDependencies["@particle-academy/fancy-chat-js"]).toBe(">=0.1.0 <2.0");
    for (const range of Object.values(pkg.peerDependencies) as string[]) expect(range).not.toMatch(/^file:/);
  });
});
