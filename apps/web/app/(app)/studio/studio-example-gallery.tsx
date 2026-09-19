"use client";

import { WORKED_EXAMPLES, type WorkedExample } from "../../../lib/worked-examples";
import type { PublicLocale } from "../../../lib/public-locale";
import type { WORKSPACE_COPY } from "../../../lib/workspace-locale";

type StudioCopy = (typeof WORKSPACE_COPY)[PublicLocale]["studio"];

/**
 * "Start from a known circuit": WORKED_EXAMPLES as cards. Loading one is the
 * caller's job (`onLoad`) — this component only picks which example and asks
 * for it; the unsaved-changes confirm, the fresh draft, and wiring the notes
 * panel to the playhead all live in studio-workspace.tsx, the same place
 * every other draft-replacing action (opening a different artifact) already
 * does.
 */
export function ExampleGallery({
  locale,
  onLoad,
  onClose,
  copy,
}: {
  locale: PublicLocale;
  onLoad: (example: WorkedExample) => void;
  onClose: () => void;
  copy: StudioCopy;
}) {
  return (
    <div className="mj-edit-block-overlay" role="presentation">
      <div className="mj-edit-block-panel mj-example-gallery" role="dialog" aria-modal="true" aria-label={copy.galleryTitle}>
        <header className="mj-edit-block-head">
          <h3>{copy.galleryTitle}</h3>
          <button className="mj-secondary-button" type="button" onClick={onClose}>{copy.editBlockCancel}</button>
        </header>
        <div className="mj-example-cards">
          {WORKED_EXAMPLES.map((example) => (
            <article className="mj-example-card" key={example.id}>
              <h4>{locale === "ja" ? example.title.ja : example.title.en}</h4>
              <p>{locale === "ja" ? example.instance.ja : example.instance.en}</p>
              <span className="mj-mono-muted">{copy.exampleQubits(example.qubitCount)}</span>
              <button className="mj-primary-button" type="button" onClick={() => onLoad(example)}>{copy.loadExample}</button>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
