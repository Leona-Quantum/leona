#!/usr/bin/env node
// Generate (or --check) the pinned catalog bootstrap manifest (ADR-0019, Slice A).
//
// Bundles apps/web/lib/public-repository.ts with esbuild (same mechanism as
// scripts/check-repository-data.mjs — Node cannot import the .ts directly),
// reads the assembled PUBLIC_REPOSITORY_ENTRIES, and emits a deterministic,
// schema-versioned manifest via scripts/catalog-bootstrap/manifest-core.mjs.
//
// The manifest is the auditable index for the Slice B local bootstrap connector
// that submits these records through the durable importer. This step touches no
// database, no network, and never mutates the TypeScript source (ADR-0019).
//
// Usage:
//   node scripts/generate-catalog-bootstrap-manifest.mjs [--out <path>] [--source-commit <sha>] [--stdout]
//   node scripts/generate-catalog-bootstrap-manifest.mjs --check [--out <path>] [--source-commit <sha>]
//
// --check regenerates in-memory and compares against the committed manifest,
// exiting non-zero on any drift (for CI). --source-commit defaults to `git
// rev-parse HEAD`; pass an explicit value for reproducible/offline runs.

import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildManifest, serializeManifest, verifyChecksum } from "./catalog-bootstrap/manifest-core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(root, "services/api/catalog_bootstrap/manifest.json");

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}
const CHECK = args.includes("--check");
const STDOUT = args.includes("--stdout");
const OUT = flag("--out") ?? DEFAULT_OUT;
const SOURCE_COMMIT = flag("--source-commit") ?? resolveHead();

function resolveHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim();
  } catch {
    return "unknown";
  }
}

async function loadEntries() {
  const require = createRequire(join(root, "packages/ts/ui-visual/package.json"));
  const esbuild = require("esbuild");
  const outDir = mkdtempSync(join(tmpdir(), "catalog-bootstrap-"));
  const outFile = join(outDir, "public-repository.mjs");
  try {
    await esbuild.build({
      entryPoints: [join(root, "apps/web/lib/public-repository.ts")],
      bundle: true,
      format: "esm",
      platform: "neutral",
      outfile: outFile,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outFile).href);
    const entries = mod.PUBLIC_REPOSITORY_ENTRIES;
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error("public-repository.ts did not export a non-empty PUBLIC_REPOSITORY_ENTRIES");
    }
    return entries;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

async function main() {
  const entries = await loadEntries();
  const manifest = buildManifest(entries, { sourceCommit: SOURCE_COMMIT });
  const serialized = serializeManifest(manifest);

  if (STDOUT) {
    process.stdout.write(serialized);
    return;
  }

  if (CHECK) {
    let existing;
    try {
      existing = readFileSync(OUT, "utf8");
    } catch {
      console.error(`✖ no committed manifest at ${OUT} — run without --check to create it`);
      process.exit(1);
    }
    // Compare on content, ignoring the source_commit line (a fresh checkout at a
    // different commit still validates the data is unchanged): re-verify the
    // committed manifest's own checksum, then compare item sets by hash.
    const committed = JSON.parse(existing);
    const cs = verifyChecksum(committed);
    if (!cs.ok) {
      console.error(`✖ committed manifest checksum mismatch: expected ${cs.expected}, found ${cs.actual}`);
      process.exit(1);
    }
    const freshBySlug = new Map(manifest.items.map((i) => [i.upstream_identity, i.source_blob_sha256]));
    const committedBySlug = new Map(committed.items.map((i) => [i.upstream_identity, i.source_blob_sha256]));
    const drift = [];
    for (const [slug, hash] of freshBySlug) {
      if (committedBySlug.get(slug) !== hash) drift.push(slug);
    }
    for (const slug of committedBySlug.keys()) {
      if (!freshBySlug.has(slug)) drift.push(`removed:${slug}`);
    }
    if (manifest.item_count !== committed.item_count || drift.length > 0) {
      console.error(
        `✖ manifest drift: committed ${committed.item_count} items, regenerated ${manifest.item_count};` +
          (drift.length ? ` changed/removed: ${drift.slice(0, 10).join(", ")}${drift.length > 10 ? " …" : ""}` : ""),
      );
      console.error("  Regenerate with: node scripts/generate-catalog-bootstrap-manifest.mjs");
      process.exit(1);
    }
    console.log(`✓ bootstrap manifest up to date (${committed.item_count} items, checksum ${committed.manifest_checksum.slice(0, 12)}…)`);
    return;
  }

  writeFileSync(OUT, serialized);
  console.log(
    `✓ wrote ${manifest.item_count}-item bootstrap manifest → ${OUT}\n` +
      `  source_commit ${manifest.source_commit}\n  checksum ${manifest.manifest_checksum}`,
  );
}

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
