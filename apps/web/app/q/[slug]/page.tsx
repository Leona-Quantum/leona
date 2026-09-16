import type { components } from "@majorana/contracts-gen";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { QappRuntime } from "../../../components/qapp-runtime";
import { getMajoranaAuth } from "../../../lib/auth";
import { controlPlaneUrl, fetchControlPlane } from "../../../lib/control-plane";

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
  const [qapp, auth] = await Promise.all([loadPublicQapp(slug), getMajoranaAuth()]);
  if (!qapp) notFound();
  const returnTo = `/q/${encodeURIComponent(qapp.slug)}`;
  return (
    <main className="qapp-page">
      <header className="qapp-page-header">
        <Link className="qapp-brand" href="/">Leona Quantum</Link>
        <span className="qapp-public-badge">Public Qapp</span>
        <span className="qapp-page-spacer" />
        <Link href="/run?mode=qapp">Build your own</Link>
      </header>
      <section className="qapp-page-intro">
        <p className="qapp-kicker">Qapp · {qapp.framework} · up to {qapp.qubits_estimate} qubits</p>
        <h1>{qapp.title}</h1>
        <p>{qapp.description}</p>
      </section>
      <QappRuntime
        slug={qapp.slug}
        uiDocument={qapp.ui_document}
        canExecute={Boolean(auth.user)}
        signInPath={`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
      />
    </main>
  );
}
