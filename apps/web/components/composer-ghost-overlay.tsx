import type { GhostFrame } from "../lib/composer-ghost";

/**
 * The rotating placeholder's text and its blinking caret, drawn as a layer
 * behind the real textarea rather than typed into a `placeholder` attribute —
 * a `placeholder` cannot host a caret element (owner, ai-ops 108), so this is
 * what actually renders the typewriter effect for both composers.
 *
 * `aria-hidden`: this is decorative animation, not the field's accessible
 * name. Both composers keep naming the field the normal way (a real `<label>`
 * on the landing page, `aria-label` in the workspace) whether or not this is
 * mounted, so hiding it from the accessibility tree is not a regression — if
 * anything it is an improvement over the old placeholder text, which some
 * screen readers announce as if it were content.
 *
 * The caret only shows for `"typing"` and `"deleting"` frames — held and gap
 * frames sit still, matching what the owner asked for.
 */
export function ComposerGhostOverlay({ frame }: { frame: GhostFrame }) {
  const caret = frame.phase === "typing" || frame.phase === "deleting";
  return (
    <span className="mj-composer-ghost-overlay" aria-hidden="true">
      {frame.text}
      {caret ? <span className="mj-composer-ghost-caret" /> : null}
    </span>
  );
}
