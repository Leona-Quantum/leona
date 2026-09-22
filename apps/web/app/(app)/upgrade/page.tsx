import { UpgradeContent } from "./upgrade-content";
import { UPGRADE_COPY } from "../../../lib/public-copy";

// Derived from the heading the page renders, so the tab title cannot keep old
// words after the copy changes (it did, twice, in 2026-09).
export const metadata = { title: UPGRADE_COPY.en.title };

/**
 * /upgrade — reached from the usage meter, the billing panel, and the refusal a
 * person hits when the week is spent.
 *
 * Same page shell as /account so the two feel like one settings surface rather
 * than a marketing detour out of the app.
 */
export default function Upgrade() {
  return (
    <div className="mj-library-page">
      <div className="mj-library-scroll">
        <UpgradeContent />
      </div>
    </div>
  );
}
