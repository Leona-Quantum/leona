import { AccountContent } from "./account-content";

export const metadata = { title: "Account — Leona Quantum" };

/**
 * /account as a full page.
 *
 * This is what a bookmark, a refresh, an emailed link and any other navigation
 * that is not a client-side <Link> renders — unchanged from before the modal
 * existed. The intercepting route at `@modal/(.)account` takes the in-app ones.
 * Both render `AccountContent`, so the two shapes cannot say different things.
 */
export default function Account() {
  return (
    <div className="mj-library-page">
      <div className="mj-library-scroll">
        <AccountContent />
      </div>
    </div>
  );
}
