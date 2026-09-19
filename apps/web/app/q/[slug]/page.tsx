import type { components } from "@majorana/contracts-gen";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { QappRuntime } from "../../../components/qapp-runtime";
import { getMajoranaAuth } from "../../../lib/auth";
import { controlPlaneUrl, fetchControlPlane } from "../../../lib/control-plane";
import { qappCopy } from "../../../lib/qapp-copy";
import { getPublicLocale } from "../../../lib/public-locale-server";

type PublicQapp = components["schemas"]["PublicQapp"];

/**
 * One control-plane read per request, shared by the metadata and the page.
 * `cache` dedupes within a render, so the title can be the Qapp's own title —
 * the tab used to read "bell-explorer-01a0ab5c… — Qapp", the slug with its
 * uuid tail, which is also what a shared link previewed as.
 */
const loadPublicQapp = cache(async (slug: string): Promise<PublicQapp | null> => {
  const response = await fetchControlPlane(controlPlaneUrl(`/v1/qapps/public/${encodeURIComponent(slug)}`));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Qapp is temporarily unavailable");
  return await response.json() as PublicQapp;
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const qapp = await loadPublicQapp(slug);
  if (!qapp) return { title: "Qapp — Leona Quantum", robots: { index: false } };
  return {
    title: `${qapp.title} — Qapp · Leona Quantum`,
    description: qapp.description,
    openGraph: { title: qapp.title, description: qapp.description, type: "website" },
    robots: { index: true, follow: true },
  };
}

export default async function PublicQappPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [qapp, auth, locale] = await Promise.all([loadPublicQapp(slug), getMajoranaAuth(), getPublicLocale()]);
  if (!qapp) notFound();
  const copy = qappCopy(locale).public;
  const returnTo = `/q/${encodeURIComponent(qapp.slug)}`;
  return (
    <main className="qapp-page">
      <header className="qapp-page-header">
        <Link className="qapp-brand" href="/">{copy.brand}</Link>
        <span className="qapp-public-badge">{copy.badge}</span>
        <span className="qapp-page-spacer" />
        <Link href="/run?mode=qapp">{copy.buildYourOwn}</Link>
      </header>
      <section className="qapp-page-intro">
        <p className="qapp-kicker">{copy.kicker(qapp.framework, qapp.qubits_estimate)}</p>
        <h1>{qapp.title}</h1>
        <p>{qapp.description}</p>
      </section>
      <QappRuntime
        slug={qapp.slug}
        uiDocument={qapp.ui_document}
        canExecute={Boolean(auth.user)}
        signInPath={`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
        locale={locale}
      />
    </main>
  );
}
