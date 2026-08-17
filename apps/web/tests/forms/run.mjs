#!/usr/bin/env node
// Form-submission suite runner (ai-ops issue 123): bundles each tests/forms/*.test.tsx
// with esbuild — the same technique packages/ts/ui-visual/scripts/render.mjs
// uses to run real component TSX outside of Next — then hands the bundles to
// `node --test`. See dom-env.ts for why this exists at all: the repo's other
// test runner (`node --experimental-strip-types --test`, the `test` script)
// strips TYPES, not JSX, so it cannot even parse a `.tsx` file, and has no DOM
// for a form to mount into.
//
// A directory glob, not a hand-written file list: scripts/check-test-list.mjs
// exists because `apps/web`'s main `test` script is fifty file paths typed out
// by hand, and a file left off that line runs green forever by never running.
// Globbing tests/forms/*.test.tsx cannot have that failure mode — a new file
// here is picked up the next time this script runs, with nothing to edit.
import esbuild from "esbuild";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const testFiles = readdirSync(here)
  .filter((file) => file.endsWith(".test.tsx"))
  .sort();

if (testFiles.length === 0) {
  console.error("test:forms: found no tests/forms/*.test.tsx — that cannot be right");
  process.exit(1);
}

// studio-custom-gate.test.tsx imports `CircuitBuilder` out of
// studio-workspace.tsx, which also has a MODULE-LEVEL `import { useRouter }
// from "next/navigation"` for the (untested-here) outer `StudioWorkspace`
// component. `next/navigation` is Next's own resolution target, not a plain
// package export Node can follow outside a Next build. CircuitBuilder itself
// never calls `useRouter()`, so a stub that only throws if actually invoked
// is both sufficient and a canary: if a future edit makes CircuitBuilder
// depend on the router, this stub turns that into a loud test failure
// instead of a silent gap.
const stubNextNavigation = {
  name: "stub-next-navigation",
  setup(build) {
    build.onResolve({ filter: /^next\/navigation$/ }, (args) => ({
      path: args.path,
      namespace: "stub-next-navigation",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub-next-navigation" }, () => ({
      contents:
        "export function useRouter() { throw new Error('next/navigation is stubbed in tests/forms — this code path was not expected to call useRouter()'); }",
      loader: "js",
    }));
  },
};

// Bundles land under apps/web itself (gitignored), not the OS tmp dir: the
// bundle only has `import "react"` etc. left as real bare specifiers
// (`packages: "external"` below), and Node resolves those by walking up from
// the importing file looking for node_modules — a file under /tmp finds none.
const bundleRoot = join(here, ".form-test-bundles");
mkdirSync(bundleRoot, { recursive: true });
const bundleDir = mkdtempSync(join(bundleRoot, "run-"));
const bundlePaths = [];

try {
  for (const file of testFiles) {
    const result = await esbuild.build({
      entryPoints: [join(here, file)],
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      jsx: "automatic",
      // Bundle our own relative source (the component under test, its lib
      // imports, this suite's dom-env helper) AND monorepo workspace
      // packages (@majorana/ui, @majorana/contracts-gen): they ship raw TS
      // with extensionless relative imports written for a bundler consumer,
      // which Node's native ESM resolver refuses at runtime. Leave real npm
      // packages — react, @testing-library/react, jsdom — external instead
      // of `packages: "external"` for everything, so there is exactly one
      // React in the process: the component under test and
      // @testing-library/react both resolve the SAME react/react-dom from
      // apps/web's node_modules, and a second bundled copy never gets a
      // chance to make RTL's rendered elements fail an `instanceof` check
      // against the component's own hooks.
      external: ["react", "react/*", "react-dom", "react-dom/*", "@testing-library/react", "@testing-library/dom", "jsdom"],
      loader: { ".css": "empty" },
      plugins: [stubNextNavigation],
      write: false,
      logLevel: "warning",
    });
    const outPath = join(bundleDir, file.replace(/\.tsx$/, ".mjs"));
    writeFileSync(outPath, result.outputFiles[0].text, "utf8");
    bundlePaths.push(outPath);
  }

  // `--import` runs preload.mjs's jsdom setup to completion as its own,
  // earlier module graph — BEFORE Node even starts resolving the test
  // bundles' imports (react-dom included). See preload.mjs for why that
  // ordering guarantee is load-bearing, not just tidy.
  const child = spawn(
    process.execPath,
    ["--import", join(here, "preload.mjs"), "--test", ...bundlePaths],
    { cwd: join(here, "..", ".."), stdio: "inherit" },
  );
  // Both `exit` and `error`, because only one of them fires. If `spawn` fails
  // before the child ever starts — a bad `process.execPath`, an exhausted
  // process table — Node emits `error` and never emits `exit`, so awaiting
  // `exit` alone leaves this promise pending forever and `pnpm test:forms`
  // hangs with no output instead of failing. A test runner that hangs on a
  // launch failure is worse than one that crashes: CI reports a timeout, which
  // reads as a slow test rather than a broken harness.
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  // `process.exitCode =`, never `process.exit()`: the latter terminates the
  // process immediately, synchronously, WITHOUT unwinding through `finally`
  // — the bundle cleanup below would never run, and .form-test-bundles/
  // would accumulate a new run-* directory on every invocation, in CI and on
  // dev machines alike. Setting exitCode lets this function return normally,
  // the `finally` runs, and Node exits on its own once nothing else is
  // keeping the event loop alive (the child process has already exited by
  // this point).
  process.exitCode = code ?? 1;
} finally {
  rmSync(bundleRoot, { recursive: true, force: true });
}
