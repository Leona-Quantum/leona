import type { Metadata } from "next";
import { PublicSite } from "../../components/public-site";
import { PUBLIC_REPOSITORY_ENTRIES } from "../../lib/public-repository";
import { RepositoryBrowser } from "./repository-browser";

export const metadata: Metadata = {
  title: "Repository",
  description: "Browse public Majorana reference artifacts with verification, export, and provenance context.",
};

export default function RepositoryPage() {
  return (
    <PublicSite activePath="/repository" className="mj-repository-site">
      <section className="mj-public-page-hero">
        <h1>Evidence you can inspect before you reuse it.</h1>
        <p>
          Browse reference circuits and algorithms by family, framework, verification status,
          export classification, and provenance. Every entry makes its limits visible.
        </p>
      </section>

      <section className="mj-repository-section" aria-labelledby="repository-heading">
        <div className="mj-repository-section-heading">
          <div>
            <p className="mj-section-label">Repository / reference set</p>
            <h2 id="repository-heading">Start with a small, legible corpus.</h2>
          </div>
          <p>Public entries are separate from private Libraries. Saving and publishing will become explicit account actions as the repository service expands.</p>
        </div>
        <RepositoryBrowser entries={PUBLIC_REPOSITORY_ENTRIES} />
      </section>

      <section className="mj-repository-provenance" aria-labelledby="provenance-heading">
        <div>
          <p className="mj-section-label">How to read an entry</p>
          <h2 id="provenance-heading">Verification is a claim with a boundary.</h2>
        </div>
        <div className="mj-repository-provenance-list">
          <p><strong>Verification</strong> tells you which checks passed and what metric or contract was used.</p>
          <p><strong>Export</strong> tells you whether another framework or OpenQASM path is available, lossless, caveated, or code-only.</p>
          <p><strong>Provenance</strong> tells you where the entry came from and keeps public reference material distinct from private workspace artifacts.</p>
        </div>
      </section>
    </PublicSite>
  );
}
