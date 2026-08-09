// Bundled by scripts/render.mjs (esbuild, platform=node) and invoked as renderAll(). Renders
// each story to a standalone static HTML document with tokens.css + styles.css inlined FROM
// SOURCE (the `.css` text-loader imports below resolve the real @majorana/ui files), so the
// harness can never drift from the shipped design system. Output → <pkg>/dist/<name>.html
// plus a manifest the a11y test iterates.
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import tokensCss from "../../ui/tokens.css";
import stylesCss from "../../ui/styles.css";
import { STORIES, type Story } from "./stories";
import { CONVERGE_STORIES } from "./converge-stories";

function documentFor(story: Story): string {
  const markup = renderToStaticMarkup(story.node);
  // `lang` per story, not a constant. `styles.css` carries `:lang(ja)` rules and
  // they reach the whole document, so a Japanese figure rendered under `lang="en"`
  // is drawn with the wrong font stack and every width measured off it is a width
  // the app never draws.
  return `<!doctype html>
<html lang="${story.lang ?? "en"}" data-story="${story.name}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${story.title}</title>
<style>
${tokensCss}
${stylesCss}
:root { color-scheme: dark; }
body {
  margin: 0;
  padding: 24px;
  background: var(--bg-0);
  color: var(--text-0);
  font-family: var(--font-ui);
  font-size: var(--fs-13);
}
.mj-visual-root { max-width: ${story.wide ? "none" : "720px"}; margin: 0 auto; }
</style>
</head>
<body>
<main class="mj-visual-root">
${markup}
</main>
</body>
</html>
`;
}

export function renderAll(): void {
  const outDir = join(process.cwd(), "dist");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const write = (stories: readonly Story[], file: string): number => {
    const manifest = stories.map((story) => {
      writeFileSync(join(outDir, `${story.name}.html`), documentFor(story), "utf8");
      return { name: story.name, title: story.title, file: `${story.name}.html` };
    });
    writeFileSync(join(outDir, file), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifest.length;
  };

  const components = write(STORIES, "manifest.json");
  // A second manifest rather than a flag on `Story` the a11y sweep filters by.
  // The Atlas figures are whole surfaces, not single components, and the two
  // specs ask different questions of them: axe asks about the component library,
  // `converge-plate.spec.ts` asks whether a `<rect>` covers text it did not
  // compute. A boolean the a11y sweep read would be one flip away from emptying
  // that sweep's subject list, and a guard whose subjects vanish passes for
  // everything — a failure this repository has shipped before.
  const converge = write(CONVERGE_STORIES, "converge-manifest.json");
  // eslint-disable-next-line no-console
  console.log(
    `ui-visual: rendered ${components} component stories + ${converge} converge figures → ${outDir}`,
  );
}
