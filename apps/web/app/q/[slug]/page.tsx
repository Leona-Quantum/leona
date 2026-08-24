import type { components } from "@majorana/contracts-gen";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QappRuntime } from "../../../components/qapp-runtime";
import { getMajoranaAuth } from "../../../lib/auth";
import { controlPlaneUrl, fetchControlPlane } from "../../../lib/control-plane";

type PublicQapp = components["schemas"]["PublicQapp"];

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `${slug} — Qapp`, robots: { index: true, follow: true } };
}

export default async function PublicQappPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [response, auth] = await Promise.all([
    fetchControlPlane(controlPlaneUrl(`/v1/qapps/public/${encodeURIComponent(slug)}`)),
    getMajoranaAuth(),
  ]);
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("Qapp is temporarily unavailable");
  const qapp = await response.json() as PublicQapp;
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
