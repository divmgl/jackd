import esbuild from "esbuild"
import { rename } from "fs/promises"

// Build bundles
await Promise.all([
  esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "esm",
    outfile: "dist/esm/index.js",
    target: "node18",
    platform: "node"
  }),
  esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "cjs",
    outfile: "dist/cjs/index.js",
    target: "node18",
    platform: "node"
  })
])

// Rename the CommonJS output to .cjs
await rename("dist/cjs/index.js", "dist/cjs/index.cjs")
