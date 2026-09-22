import { notFound } from "next/navigation";
import { loadPublicQapp } from "../../../../lib/qapp-public";
import { qappCopy } from "../../../../lib/qapp-copy";
import { parsePublicLocale, type PublicLocale } from "../../../../lib/public-locale";
import { summarizeQappSchema, type QappFieldSummary } from "../../../../lib/qapp-schema-summary";

/**
 * The view-only embed for a published Qapp (ai-ops 355, owner ruling: "Any
 * website may embed a published Qapp"). The issue's own terms, which this
 * page is built to: view-only, with an "Open on Leona to run" link, never
 * running code for an anonymous visitor.
 *
 * ## What it shows, and why that is safe to hand to an unknown parent page
 *
 * Everything here — title, description, the input/output field list, the
 * verification record — is already public on `/q/[slug]` (`lib/qapp-public.ts`
 * is the ONE visibility check both pages share; there is no second one for
 * this route to get wrong). Nothing here is new exposure, only a smaller
 * rendering of exposure that already exists.
 *
 * ## What it deliberately does NOT do
 *
 * - **No `<QappRuntime>`.** That component is what lets a visitor submit
 *   inputs and execute the Qapp (`components/qapp-runtime.tsx`, posting to
 *   `/api/qapps/[slug]/executions`). This page never imports it, so there is
 *   no code path here that can run anything, signed in or not — not "signed-
 *   out visitors can't run it", but "this page contains no run mechanism at
 *   all". A framed page having no state-changing control is also why
 *   clickjacking is not a risk on this route: there is nothing here a
 *   clickjacked click could trigger.
 * - **No sign-in.** No call to the auth helper `/q/[slug]` uses to decide
 *   whether a visitor can execute — named in full in `lib/auth.ts`, and not
 *   repeated here as a literal call expression, because
 *   `scripts/check-static-routes.mjs` greps every route file's transitive
 *   imports for exactly that text to find personalized routes, and merely
 *   naming it that way in a comment once made this route look like it called
 *   it. No sign-in link either, and nothing that reads or writes a session.
 * - **No cookie of any kind.** Not even the locale cookie `/q/[slug]` reads
 *   via `getPublicLocale()` — see `layout.tsx`'s docstring for why, and why
 *   `?locale=` (a query param, read below) is the substitute. A page with no
 *   per-visitor state is a page safe to serve from a shared cache to every
 *   reader, which is what makes `edgeCacheRules` in `next.config.ts` correct
 *   to apply here.
 */

function embedLocale(value: string | undefined): PublicLocale {
  return parsePublicLocale(value);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const qapp = await loadPublicQapp(slug);
  if (!qapp) return { title: "Qapp", robots: { index: false, follow: false } };
  return {
    title: `${qapp.title} — Qapp`,
    description: qapp.description,
    // This is a widget for someone else's page, not a destination of its own —
    // `/q/[slug]` is the page that should be indexed, shared, and previewed.
    robots: { index: false, follow: false },
  };
}

function FieldList({
  heading,
  empty,
  fields,
}: {
  heading: string;
  empty: string;
  fields: QappFieldSummary[];
}) {
  return (
    <section className="qapp-embed-fields">
      <h2>{heading}</h2>
      {fields.length === 0 ? (
        <p className="qapp-embed-fields-empty">{empty}</p>
      ) : (
        <dl>
          {fields.map((field) => (
            <div className="qapp-embed-field" key={field.name}>
              <dt>{field.label}</dt>
              <dd>
                <span className="qapp-embed-field-type">{field.type}</span>
                {field.description ? <span className="qapp-embed-field-description"> · {field.description}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export default async function EmbedQappPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const [{ slug }, { locale: localeParam }] = await Promise.all([params, searchParams]);
  const qapp = await loadPublicQapp(slug);
  if (!qapp) notFound();
  const locale = embedLocale(localeParam);
  const copy = qappCopy(locale);
  const inputs = summarizeQappSchema(qapp.input_schema, locale);
  const outputs = summarizeQappSchema(qapp.output_schema, locale);
  const runHref = `/q/${encodeURIComponent(qapp.slug)}`;

  return (
    <main className="qapp-embed-page" lang={locale}>
      <header className="qapp-embed-header">
        <span className="qapp-public-badge">{copy.public.badge}</span>
        <span className="qapp-kicker">{copy.public.kicker(qapp.framework, qapp.qubits_estimate)}</span>
      </header>
      <h1 className="qapp-embed-title">{qapp.title}</h1>
      <p className="qapp-embed-description">{qapp.description}</p>

      <FieldList heading={copy.embed.inputsHeading} empty={copy.embed.noInputs} fields={inputs} />
      <FieldList heading={copy.embed.outputsHeading} empty={copy.embed.noOutputs} fields={outputs} />

      <section className="qapp-record qapp-embed-record" aria-labelledby="qapp-embed-record-heading">
        <h2 id="qapp-embed-record-heading">{copy.public.recordHeading}</h2>
        {/* Same three lines /q/[slug] shows, and the same reason: only what
            publication already proves (ADR-0031). */}
        <p>{copy.public.recordRanSuccessfully}</p>
        <p>{copy.public.recordQubits(qapp.qubits_estimate)}</p>
        <p className="qapp-record-note">{copy.public.recordNote}</p>
      </section>

      <footer className="qapp-embed-footer">
        <p className="qapp-embed-view-only-note">{copy.embed.viewOnlyNote}</p>
        {/* target="_blank" + rel="noopener": this frame never navigates the
            parent page, and the new tab gets no window.opener handle back to
            the page that embedded it. No `noreferrer`: /q/[slug] is public
            and gains nothing from hiding the referrer, and dropping it would
            also lose the little the Referer header can tell an operator about
            where an embed's traffic is coming from. */}
        <a className="mj-primary-button qapp-embed-run-link" href={runHref} target="_blank" rel="noopener">
          {copy.embed.openToRun}
        </a>
      </footer>
    </main>
  );
}
