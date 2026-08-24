// Per-slot closure numbers for a region — methods, drawn stretches, authored
// stretches, and the fields the ratchets pin.
//
// **Exists because a ratchet floor must be measured before it is written.** A
// summed floor over several slots is met by one of them emptying while another
// grows, so `repository-layers.test.ts` pins them per slot — and a floor written
// without measuring is worse than no floor.
//
//   node scripts/measure-region-slots.mjs <slot,slot,...>
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
const esbuild = require("esbuild");
async function bundle(rel, label) {
  const outDir = mkdtempSync(join(tmpdir(), "lg-"));
  const outFile = join(outDir, `${label}.mjs`);
  await esbuild.build({ entryPoints: [join(root, rel)], bundle: true, format: "esm", platform: "neutral", outfile: outFile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outFile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}
const { LAYER_GRAPH } = await bundle("apps/web/lib/repository/layer-graph.ts", "g");
const layersMod = await bundle("apps/web/lib/repository/layers.ts", "l");
const { STATE_VOCABULARY } = await bundle("apps/web/lib/repository/state-vocabulary.ts", "s");
const slots = process.argv[2].split(",");
let sumM = 0, sumH = 0;
for (const slot of slots) {
  const r = layersMod.regionClosure(LAYER_GRAPH, STATE_VOCABULARY, [slot], new Map());
  const fields = Object.fromEntries(r.fields.map((f) => [f.field, `${f.present}/${f.total}`]));
  sumM += r.methods.length; sumH += r.hopStretches;
  console.log(
    `${slot.padEnd(24)} methods=${String(r.methods.length).padStart(3)} stretches=${String(r.hopStretches).padStart(3)} authored=${String(r.hopStretchesAuthored).padStart(3)}` +
    `  cost=${fields["cost"]} pseudo=${fields["example.pseudocode"]} unknown=${r.unknown.join(",")||"-"}`,
  );
  if (r.hopStretchesAuthored !== r.hopStretches) {
    console.log(`    unauthored: ${r.unauthoredHops.map((h) => `${h.method}/${h.key}`).join(", ")}`);
  }
}
console.log(`SUM methods=${sumM} stretches=${sumH}`);
const whole = layersMod.regionClosure(LAYER_GRAPH, STATE_VOCABULARY, slots, new Map());
console.log(`WHOLE-REGION methods=${whole.methods.length} stretches=${whole.hopStretches} authored=${whole.hopStretchesAuthored}`);
