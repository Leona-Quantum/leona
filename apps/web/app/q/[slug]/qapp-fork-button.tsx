"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { qappCopy } from "../../../lib/qapp-copy";
import type { PublicLocale } from "../../../lib/public-locale";
import { refusalSentence } from "../../../lib/api-error";

/**
 * Copies a published Qapp into the signed-in visitor's own account as a new
 * private Qapp, then sends them to its workspace page. Refused (409) if the
 * source is not currently published — the server is the source of truth for
 * that, this button does not try to predict it.
 */
export function QappForkButton({
  slug,
  signedIn,
  signInPath,
  locale = "en",
}: {
  slug: string;
  signedIn: boolean;
  signInPath: string;
  locale?: PublicLocale;
}) {
  const copy = qappCopy(locale).public;
  const [forking, setForking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!signedIn) {
    return <Link href={signInPath}>{copy.forkSignIn}</Link>;
  }

  async function fork() {
    if (forking) return;
    setForking(true);
    setError(null);
    try {
      const response = await fetch(`/api/qapps/public/${encodeURIComponent(slug)}/fork`, { method: "POST" });
      const payload = await response.json() as { qapp?: { id?: string } } | { title?: string };
      if (!response.ok || !("qapp" in payload) || !payload.qapp?.id) {
        throw new Error(refusalSentence(payload) ?? copy.forkFailed);
      }
      router.push(`/qapps/${encodeURIComponent(payload.qapp.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.forkFailed);
      setForking(false);
    }
  }

  return (
    <div className="qapp-fork">
      <button className="mj-secondary-button" type="button" disabled={forking} onClick={() => void fork()}>
        {forking ? copy.forking : copy.forkAction}
      </button>
      {error ? <p role="alert" className="qapp-private-error">{error}</p> : null}
    </div>
  );
}
