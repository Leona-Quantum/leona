import { UpgradeContent } from "./upgrade-content";

export const metadata = { title: "Move up a plan — Leona Quantum" };

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
