import { defineConfig } from "tsup";

export default defineConfig({
  // Three entries. `./knowledge` and `./charts` are OPTIONAL: the root entry
  // never imports them, so a host that uses neither pays for neither, and
  // fancy-echarts is only ever needed by `./charts`.
  entry: {
    index: "src/index.ts",
    knowledge: "src/knowledge/index.ts",
    charts: "src/charts/index.tsx",
  },
  format: ["esm", "cjs"],
  dts: true,
  // Every one of these is a peer. A bundled react-fancy would ship a second
  // component registry; a bundled fancy-chat-js a second copy of the contract
  // whose machines could disagree with the server's; a bundled fancy-echarts
  // a second ECharts.
  external: ["react", "react-dom", "@particle-academy/react-fancy", "@particle-academy/fancy-chat-js", "@particle-academy/fancy-echarts"],
  treeshake: true,
  clean: true,
  sourcemap: true,
  metafile: true,
});
