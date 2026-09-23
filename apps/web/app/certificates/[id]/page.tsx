import Link from "next/link";
import { notFound } from "next/navigation";
import { CERTIFICATE_COPY } from "../../../lib/certificate-copy";
import { loadPublicCertificate } from "../../../lib/certificate-public";
import { getPublicLocale } from "../../../lib/public-locale-server";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const certificate = await loadPublicCertificate(id);
  if (!certificate) return { title: "Certificate", robots: { index: false, follow: false } };
  return {
    title: `${certificate.recipientName} — ${certificate.courseTitle}`,
    description: `${certificate.recipientName} completed ${certificate.courseTitle} on Leona Quantum.`,
    // Never indexed: a certificate names a real person, and this is a link a
    // learner shares deliberately, not a page meant to surface in search.
    robots: { index: false, follow: false },
  };
}

function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export default async function PublicCertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [certificate, locale] = await Promise.all([loadPublicCertificate(id), getPublicLocale()]);
  if (!certificate) notFound();
  const copy = CERTIFICATE_COPY[locale];
  const issuedOn = formatDate(certificate.issuedOn, locale);

  return (
    <main className="certificate-page">
      <header className="certificate-page-header">
        <Link className="certificate-brand" href="/">
          {copy.brand}
        </Link>
      </header>

      {certificate.revoked ? (
        <div className="certificate-revoked-banner" role="status">
          <strong>{copy.revokedBadge}</strong>
          <span>{copy.revokedBody}</span>
        </div>
      ) : null}

      <section
        className={
          certificate.revoked ? "certificate-card certificate-card--revoked" : "certificate-card"
        }
        aria-labelledby="certificate-recipient"
      >
        <p className="certificate-kicker">{copy.kicker}</p>
        <h1 id="certificate-recipient" className="certificate-recipient">
          {certificate.recipientName}
        </h1>
        <p className="certificate-course">{certificate.courseTitle}</p>
        <p className="certificate-meta">
          {copy.issuedOn(issuedOn)} {copy.issuedBy(certificate.issuer)}
        </p>
      </section>

      <p className="certificate-verification-note">{copy.verificationNote}</p>
      <a className="certificate-download" href={`/api/certificates/${encodeURIComponent(certificate.id)}`}>
        {copy.downloadAssertion}
      </a>
    </main>
  );
}
