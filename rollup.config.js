import { nodeResolve } from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import * as meta from "./package.json" with { type: "json" };

// Builds the UMD bundle from the CORE entry (src/index.js) only — the accessible
// widget layer ships as ESM at ./input, not in this global bundle.
// Externalize sibling d3-* modules (and the optional reactive-widget-helper) so
// the UMD bundle expects a shared global `d3` and we don't ship duplicate d3 code.
const external = Object.keys({ ...meta.default.dependencies, ...meta.default.peerDependencies });
const globals = Object.assign(
  { "reactive-widget-helper": "ReactiveWidget", "fast-kde": "fastKde" },
  ...external.filter((k) => /^d3-/.test(k)).map((k) => ({ [k]: "d3" }))
);

const config = {
  input: "src/index.js",
  external,
  output: {
    file: "dist/d3-zoomable-axis.js",
    format: "umd",
    name: "d3",          // merge our factories into the shared global d3
    extend: true,
    globals,
  },
  plugins: [nodeResolve()],
};

export default [
  config,
  {
    ...config,
    output: { ...config.output, file: "dist/d3-zoomable-axis.min.js" },
    plugins: [nodeResolve(), terser()],
  },
];
