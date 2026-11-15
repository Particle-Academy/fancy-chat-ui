import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  // Every one of these is a peer. A bundled react-fancy would ship a second
  // component registry; a bundled fancy-chat-js a second copy of the contract
  // whose machines could disagree with the server's.
  external: ["react", "react-dom", "@particle-academy/react-fancy", "@particle-academy/fancy-chat-js"],
  treeshake: true,
  clean: true,
  sourcemap: true,
  metafile: true,
});
