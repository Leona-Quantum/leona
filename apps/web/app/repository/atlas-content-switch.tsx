"use client";

/**
 * The single content-type switch that keeps the VQE Registry/Compare data
 * under the existing /repository page instead of a separate top-level
 * section. Circuits remains the existing browser; VQE Methods is the
 * component-first standard catalog fixed by ADR-0034. Literature and
 * repository records remain provenance-only and are not primary tabs.
 */
import { useState, type ReactNode } from "react";
import type { PublicLocale } from "../../lib/public-locale";
import type { PublicRepositoryListEntry } from "../../lib/public-repository";
import { RepositoryBrowser } from "./repository-browser";
import { VqeMethodsBrowser } from "./vqe/vqe-methods-browser";
import type {
  PrivateMvpCapabilityManifest,
  StandardVqeCatalogBundle,
} from "../../lib/atlas-vqe/types";
import type { RepositoryEstimateList } from "../../lib/repository/estimate";
import type { RepositoryProfileList } from "../../lib/repository/profile";
import type { TopicId } from "../../lib/repository/topics";

const COPY = {
  en: { circuits: "Circuits", vqeMethods: "VQE Methods" },
  ja: { circuits: "回路", vqeMethods: "VQE手法" },
} as const;

export function AtlasContentSwitch({
  entries,
  vqeCatalog,
  vqeCapabilityManifest,
  locale,
  isSignedIn,
  signInHref,
  legend,
  estimates,
  profiles,
  initialTopic = "",
}: {
  entries: PublicRepositoryListEntry[];
  vqeCatalog: StandardVqeCatalogBundle;
  vqeCapabilityManifest: PrivateMvpCapabilityManifest;
  locale: PublicLocale;
  isSignedIn: boolean;
  signInHref: string | null;
  legend?: ReactNode;
  estimates?: RepositoryEstimateList | null;
  profiles?: RepositoryProfileList | null;
  initialTopic?: TopicId | "";
}) {
  const copy = COPY[locale];
  const [contentType, setContentType] = useState<"circuits" | "vqe">("circuits");

  return (
    <div className="mj-atlas-switch-wrap">
      <div className="mj-atlas-switch" role="group" aria-label={locale === "ja" ? "コンテンツの種類" : "Content type"}>
        <button
          type="button"
          className={contentType === "circuits" ? "is-active" : ""}
          aria-pressed={contentType === "circuits"}
          onClick={() => setContentType("circuits")}
        >
          {copy.circuits}
        </button>
        <button
          type="button"
          className={contentType === "vqe" ? "is-active" : ""}
          aria-pressed={contentType === "vqe"}
          onClick={() => setContentType("vqe")}
        >
          {copy.vqeMethods}
        </button>
      </div>

      {contentType === "circuits" ? (
        <RepositoryBrowser
          entries={entries}
          locale={locale}
          isSignedIn={isSignedIn}
          signInHref={signInHref}
          legend={legend}
          estimates={estimates}
          profiles={profiles}
          initialTopic={initialTopic}
        />
      ) : (
        <VqeMethodsBrowser
          catalog={vqeCatalog}
          capabilityManifest={vqeCapabilityManifest}
          locale={locale}
        />
      )}
    </div>
  );
}
