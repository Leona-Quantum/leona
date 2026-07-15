import type { Metadata } from "next";
import { PublicSite } from "../../components/public-site";
import { WORKSPACE_LANDING_COPY } from "../../lib/public-copy";
import { getPublicLocale } from "../../lib/public-locale-server";

export const metadata: Metadata = {
  title: "Workspace",
  description: "LeonaQ's personal quantum workspace for guided development, Studio, and verified Library artifacts.",
};

export default async function WorkspacePage() {
  const locale = await getPublicLocale();
  const copy = WORKSPACE_LANDING_COPY[locale];
  return (
    <PublicSite activePath="/workspace" className="mj-open-source" locale={locale}>
      <div className="mj-open-source-inner">
        <section className="mj-open-source-hero">
          <p className="mj-public-overline">{copy.overline}</p>
          <h1>{copy.title}</h1>
          <p className="mj-landing-copy">{copy.body}</p>
          <div className="mj-landing-actions">
            <a className="mj-primary-button" href="/contact">{copy.primary}</a>
            <a className="mj-secondary-button" href="/repository">{copy.secondary}</a>
          </div>
        </section>

        <section className="mj-open-source-section" aria-labelledby="workspace-flow-heading">
          <p className="mj-section-label">{copy.loopLabel}</p>
          <h2 id="workspace-flow-heading">{copy.loopTitle}</h2>
          <div className="mj-open-source-grid">
            {copy.loop.map((item) => (
              <article className="mj-open-source-card" key={item.kicker}>
                <span className="mj-open-source-kicker">{item.kicker}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mj-open-source-section" aria-labelledby="compute-heading">
          <p className="mj-section-label">{copy.computeLabel}</p>
          <h2 id="compute-heading">{copy.computeTitle}</h2>
          <div className="mj-open-source-circuits">
            {copy.compute.map((item) => <div key={item.title}><strong>{item.title}</strong><span>{item.body}</span></div>)}
          </div>
          <p className="mj-open-source-note">{copy.note}</p>
        </section>

        <section className="mj-open-source-section mj-open-source-start" aria-labelledby="workspace-open-heading">
          <div>
            <p className="mj-section-label">{copy.foundationsLabel}</p>
            <h2 id="workspace-open-heading">{copy.foundationsTitle}</h2>
            <p>{copy.foundationsBody}</p>
            <a className="mj-text-link" href="/repository">{copy.codeLink} ↗</a>
          </div>
          <pre><code>{`pnpm install
uv sync --all-packages
pnpm --dir apps/web dev`}</code></pre>
        </section>
      </div>
    </PublicSite>
  );
}
