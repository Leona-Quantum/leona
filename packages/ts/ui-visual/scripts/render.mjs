// Build the render entry with esbuild (bundling the real @majorana/ui TSX source + React,
// inlining *.css via the text loader) and run it to emit dist/*.html. Kept as a plain .mjs
// driver so there is no pre-existing toolchain assumption beyond esbuild. No Next, no auth.
import esbuild from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const result = await esbuild.build({
  entryPoints: [join(pkgRoot, "src", "render-entry.tsx")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  jsx: "automatic",
  loader: { ".css": "text" },
  // react-dom/server is CJS and does dynamic require("util"); give the ESM bundle a real
  // require so those resolve at runtime.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  write: false,
  logLevel: "warning",
});

const bundleDir = mkdtempSync(join(tmpdir(), "ui-visual-render-"));
const bundlePath = join(bundleDir, "render-entry.mjs");
writeFileSync(bundlePath, result.outputFiles[0].text, "utf8");

try {
  const mod = await import(pathToFileURL(bundlePath).href);
  await mod.renderAll();
} finally {
  rmSync(bundleDir, { recursive: true, force: true });
}
