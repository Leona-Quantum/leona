// axe-core WCAG assertions over the pre-rendered stories. Scoped to the WCAG A/AA rule
// tags (color-contrast is wcag2aa) — NOT best-practice rules like `region` /
// `page-has-heading-one`, which flag any standalone component fragment for not being a full
// page and would test nothing real. Run `node scripts/render.mjs` first (the `test` script
// chains it) so dist/ exists.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

interface StoryEntry {
  name: string;
  title: string;
  file: string;
}

const manifest: StoryEntry[] = JSON.parse(
  readFileSync(join(distDir, "manifest.json"), "utf8"),
);

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const story of manifest) {
  test(`a11y: ${story.title}`, async ({ page }) => {
    const html = readFileSync(join(distDir, story.file), "utf8");
    await page.setContent(html, { waitUntil: "load" });

    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    const summary = violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => n.html),
    }));
    expect(summary, `WCAG violations in "${story.name}"`).toEqual([]);
  });
}
