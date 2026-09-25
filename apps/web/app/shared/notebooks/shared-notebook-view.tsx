"use client";

import type { components } from "@majorana/contracts-gen";
import Link from "next/link";
import { useEffect, useState } from "react";
import { NotebookView } from "../../../components/notebook-view";
import { notebookShareCopy } from "../../../lib/notebook-share-copy";
import { notebookCellViews } from "../../../lib/notebook-view";
import { LEGACY_PUBLIC_LOCALE_COOKIE, PUBLIC_LOCALE_COOKIE, parsePublicLocale } from "../../../lib/public-locale";

type PublicNotebookView = components["schemas"]["PublicNotebookView"];

type LoadState =
  | { kind: "loading" }
  | { kind: "no_token" }
  | { kind: "not_found" }
  | { kind: "error" }
  | { kind: "ready"; notebook: PublicNotebookView };

/**
 * The token travels here in a URL FRAGMENT (`#token`, set by whatever produced
 * the share link), which the browser never sends to any server — see
 * `app/api/notebooks/shared/lookup/route.ts` for the other half of why this
 * page takes no dynamic path segment at all: a path- or query-embedded secret
 * ends up in every access log between the browser and the control plane, and a
 * fragment plus a POST body never does.
 *
 * One consequence worth stating rather than leaving implicit: this page cannot
 * be server-rendered per notebook (the server never sees the token), so there
 * is no per-notebook `<title>` or Open Graph preview here. That is an accepted
 * trade for this specific page — `page.tsx` already sets `robots: {index:
 * false, follow: false}`, so it was never going to be indexed or unfurled
 * either way.
 */
function readToken(): string | null {
  if (typeof window === "undefined") return null;
  const fragment = window.location.hash.replace(/^#/, "");
  return fragment.length > 0 ? fragment : null;
}

function readLocaleCookie(): "en" | "ja" {
  if (typeof document === "undefined") return "en";
  const cookies = document.cookie.split(";").map((entry) => entry.trim());
  const match =
    cookies.find((entry) => entry.startsWith(`${PUBLIC_LOCALE_COOKIE}=`)) ??
    cookies.find((entry) => entry.startsWith(`${LEGACY_PUBLIC_LOCALE_COOKIE}=`));
  return parsePublicLocale(match?.split("=")[1]);
}

export function SharedNotebookView() {
  const [locale] = useState(readLocaleCookie);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const copy = notebookShareCopy(locale).publicView;

  useEffect(() => {
    const token = readToken();
    if (!token) {
      setState({ kind: "no_token" });
      return;
    }
    const controller = new AbortController();
    fetch("/api/notebooks/shared/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) {
          setState({ kind: "not_found" });
          return;
        }
        if (!response.ok) {
          setState({ kind: "error" });
          return;
        }
        const notebook = (await response.json()) as PublicNotebookView;
        setState({ kind: "ready", notebook });
      })
      .catch(() => setState({ kind: "error" }));
    return () => controller.abort();
  }, []);

  return (
    <main className="shared-notebook-page">
      <header className="shared-notebook-header">
        <Link className="shared-notebook-brand" href="/">
          {copy.brand}
        </Link>
        <span className="shared-notebook-badge">{copy.badge}</span>
      </header>
      {state.kind === "loading" && <p className="shared-notebook-status">{copy.loading}</p>}
      {state.kind === "no_token" && <p className="shared-notebook-status">{copy.noToken}</p>}
      {(state.kind === "not_found" || state.kind === "error") && (
        <p className="shared-notebook-status">{copy.notFound}</p>
      )}
      {state.kind === "ready" && state.notebook.status === "not_ready" && (
        <p className="shared-notebook-status">{copy.notReady}</p>
      )}
      {state.kind === "ready" && state.notebook.status === "ready" && (
        <>
          <section className="shared-notebook-intro">
            <h1>{state.notebook.title}</h1>
            {state.notebook.summary && <p>{state.notebook.summary}</p>}
            <p className="shared-notebook-view-only-notice">{copy.viewOnlyNotice}</p>
          </section>
          <NotebookView
            cells={notebookCellViews(state.notebook.cells, state.notebook.report ?? null)}
            locale={locale}
            framework={state.notebook.framework.name}
            // The Atlas slice a block's cost is worked out from is served to signed-in
            // readers only (`/api/notebook-blocks`); here a block links to its Atlas page.
            blockCatalog={{ status: "unavailable" }}
          />
          <section className="shared-notebook-cta">
            <p>{copy.signInCta}</p>
            <Link href={`/auth/sign-in?returnTo=${encodeURIComponent("/notebooks")}`}>
              {copy.signIn}
            </Link>
          </section>
        </>
      )}
    </main>
  );
}
