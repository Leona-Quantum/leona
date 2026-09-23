"use client";

import { useEffect, useRef, useState } from "react";
import { refusalSentence } from "../../../../../lib/api-error";
import type { CourseCertificate as CourseCertificateData, CourseCertificateList } from "../../../../../lib/course-types";
import type { PublicLocale } from "../../../../../lib/public-locale";
import { WORKSPACE_COPY } from "../../../../../lib/workspace-locale";

/**
 * A course completion certificate (ai-ops 349 proposal 8): the caller's own
 * claim state, and — for the creator only — the roster of everyone who has
 * claimed one, with a revoke action.
 *
 * Eligibility itself is never computed here. `POST .../certificates` either
 * succeeds or answers 409 `course_certificate_not_eligible`; this component
 * shows whichever of those the control plane already decided, the same way
 * the gradebook shows results the control plane computed rather than
 * re-deriving them from raw grading events.
 */
export function CourseCertificate({
  courseId,
  locale,
  viewerId,
  isCreator,
}: {
  courseId: string;
  locale: PublicLocale;
  viewerId: string | null;
  isCreator: boolean;
}) {
  const copy = WORKSPACE_COPY[locale].courses;
  const [list, setList] = useState<CourseCertificateList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimNotEligible, setClaimNotEligible] = useState(false);
  const [busyCertificateId, setBusyCertificateId] = useState<string | null>(null);
  const loadSeq = useRef(0);

  function load() {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    fetch(`/api/courses/${encodeURIComponent(courseId)}/certificates`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok) throw new Error(refusalSentence(payload) ?? copy.certificateLabel);
        if (seq === loadSeq.current) setList(payload as CourseCertificateList);
      })
      .catch((cause) => {
        if (seq === loadSeq.current) setError(cause instanceof Error ? cause.message : copy.certificateLabel);
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoading(false);
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- courseId change is a hard reset
  useEffect(() => {
    setList(null);
    load();
    return () => {
      loadSeq.current += 1;
    };
  }, [courseId]);

  async function claim(event: React.FormEvent) {
    event.preventDefault();
    if (claiming) return;
    setClaiming(true);
    setClaimError(null);
    setClaimNotEligible(false);
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/certificates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nameDraft.trim() ? { recipient_name: nameDraft.trim() } : {}),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        if (isRecord(payload) && payload.reason === "course_certificate_not_eligible") {
          setClaimNotEligible(true);
          return;
        }
        throw new Error(refusalSentence(payload) ?? copy.claimCertificateFailed);
      }
      load();
    } catch (cause) {
      setClaimError(cause instanceof Error ? cause.message : copy.claimCertificateFailed);
    } finally {
      setClaiming(false);
    }
  }

  async function revoke(certificateId: string) {
    if (!window.confirm(copy.revokeCertificateConfirmWarning)) return;
    setBusyCertificateId(certificateId);
    try {
      const response = await fetch(
        `/api/courses/${encodeURIComponent(courseId)}/certificates/${encodeURIComponent(certificateId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(refusalSentence(payload) ?? copy.revokeCertificateFailed);
      }
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.revokeCertificateFailed);
    } finally {
      setBusyCertificateId(null);
    }
  }

  if (loading && !list) return null;
  if (error) {
    return (
      <div className="mj-notebooks-retry" role="alert">
        <p>{error}</p>
        <button type="button" className="mj-secondary-button" onClick={load}>
          {locale === "ja" ? "再試行" : "Retry"}
        </button>
      </div>
    );
  }
  if (!list) return null;

  const items = list.items ?? [];
  const own = items.find((item) => item.user_id === viewerId);

  return (
    <section className="mj-course-certificate" aria-labelledby="course-certificate-title">
      <h2 id="course-certificate-title">{copy.certificateLabel}</h2>

      {own ? (
        <CertificateOwnStatus certificate={own} copy={copy} />
      ) : (
        <form className="mj-course-certificate-claim" onSubmit={claim}>
          <p>{claimNotEligible ? copy.certificateNotEligibleLede : copy.certificateEligibleLede}</p>
          {!claimNotEligible ? (
            <>
              <label>
                <span>{copy.certificateNameLabel}</span>
                <input
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  placeholder={copy.certificateNamePlaceholder}
                  disabled={claiming}
                />
              </label>
              <button className="mj-primary-button" type="submit" disabled={claiming}>
                {claiming ? copy.claimingCertificate : copy.claimCertificate}
              </button>
            </>
          ) : null}
          {claimError ? <p role="alert" className="mj-notebook-workspace-error">{claimError}</p> : null}
        </form>
      )}

      {isCreator ? (
        <div className="mj-course-certificates-roster">
          <h3>{copy.certificatesIssuedLabel}</h3>
          {items.length === 0 ? (
            <p className="mj-notebook-chat-empty">{copy.certificatesIssuedEmpty}</p>
          ) : (
            <ul className="mj-course-cohorts-list">
              {items.map((certificate) => (
                <li key={certificate.id} className="mj-course-cohort-row">
                  <span>{copy.certificateRecipient(certificate.recipient_name)}</span>
                  {certificate.revoked_at ? (
                    <span className="mj-course-gradebook-flag mj-course-gradebook-flag--missing">
                      {copy.certificateRevokedLede}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="mj-secondary-button"
                      disabled={busyCertificateId === certificate.id}
                      onClick={() => void revoke(certificate.id)}
                    >
                      {busyCertificateId === certificate.id ? copy.revokingCertificate : copy.revokeCertificate}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function CertificateOwnStatus({
  certificate,
  copy,
}: {
  certificate: CourseCertificateData;
  copy: (typeof WORKSPACE_COPY)["en"]["courses"];
}) {
  if (certificate.revoked_at) {
    return <p>{copy.certificateRevokedLede}</p>;
  }
  return (
    <div className="mj-course-certificate-claimed">
      <p>{copy.certificateClaimedLede(certificate.recipient_name)}</p>
      <a className="mj-secondary-button" href={certificate.public_url_path} target="_blank" rel="noreferrer">
        {copy.viewCertificate}
      </a>
      <a
        className="mj-secondary-button"
        href={`/api/certificates/${encodeURIComponent(certificate.id)}`}
      >
        {copy.downloadAssertion}
      </a>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
