"use client";

import { useEffect, useState } from "react";
import { Shell } from "../../components/shell";
import { RunWorkspace } from "../(app)/run/run-workspace";
import { LibraryStudio } from "../(app)/library/library-studio";
import type { PublicLocale } from "../../lib/public-locale";
import { WORKSPACE_COPY } from "../../lib/workspace-locale";

export function DemoWorkspace({ locale = "en" }: { locale?: PublicLocale }) {
  const [view, setView] = useState<"run" | "library">("run");
  const copy = WORKSPACE_COPY[locale];

  useEffect(() => {
    setView(new URLSearchParams(window.location.search).get("view") === "library" ? "library" : "run");
  }, []);

  return (
    <Shell demoMode locale={locale} headerRight={<span className="font-mono">{copy.sidebar.readOnlyData}</span>}>
      <div className="mj-demo-banner">
        <div>
          <span className="mj-section-label">{copy.surfaces.preview}</span>
          <h1>{locale === "ja" ? "Leona Quantumのワークスペースを試す" : "Explore the Leona Quantum workspace."}</h1>
          <p>{locale === "ja" ? "このプレビューではフィクスチャを使い、WorkOSとライブ制御プレーンを設定する間もプロダクトの流れを確認できます。" : "This preview uses fixture artifacts so the product flow stays visible while WorkOS and the live control plane are configured."}</p>
        </div>
        <div className="mj-demo-tabs" role="tablist" aria-label={copy.surfaces.preview}>
          <a className={view === "run" ? "is-active" : ""} href="/demo?view=run" role="tab" aria-selected={view === "run"}>{copy.surfaces.brandedRun}</a>
          <a className={view === "library" ? "is-active" : ""} href="/demo?view=library" role="tab" aria-selected={view === "library"}>{copy.library.title}</a>
        </div>
      </div>
      {view === "library" ? <LibraryStudio demoMode locale={locale} /> : <RunWorkspace demoMode locale={locale} />}
    </Shell>
  );
}
