import { notFound } from "next/navigation";
import { SentryVerifyButtons } from "./buttons";

export const metadata = { title: "Sentry verify — Leona Quantum" };

/**
 * A deliberate-error page for proving Sentry is actually receiving events —
 * not just configured. ai-ops#97: the DSNs and MAJORANA_ENV were live on every
 * surface for weeks with zero events in Sentry, which is indistinguishable
 * from "nothing has ever gone wrong" until something throws on purpose and the
 * event is watched land.
 *
 * Same gate as `app/dev/ui/fixtures.tsx`: 404s in a production build unless
 * explicitly armed, and by a DIFFERENT env var (`MAJORANA_SENTRY_VERIFY`, not
 * `MAJORANA_UI_FIXTURES`) so re-verifying Sentry after a config change does
 * not also expose the UI fixtures page. Arm it in Vercel (Production env), hit
 * both buttons, confirm the events in Sentry, then remove the env var — this
 * page has no reason to be reachable outside that window.
 */
export default function SentryVerifyPage() {
  if (process.env.NODE_ENV === "production" && process.env.MAJORANA_SENTRY_VERIFY !== "1") {
    notFound();
  }
  return (
    <main style={{ padding: "2rem", fontFamily: "monospace", maxWidth: "40rem" }}>
      <h1>Sentry verify</h1>
      <p>
        Not a real feature — a manually-armed diagnostic for confirming Sentry actually
        receives an event from this deployment, on both the browser and server surfaces.
      </p>
      <SentryVerifyButtons />
    </main>
  );
}
