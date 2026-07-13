"use client";

import { useEffect, useState } from "react";
import { Shell } from "../../components/shell";
import { RunWorkspace } from "../(app)/run/run-workspace";
import { LibraryStudio } from "../(app)/library/library-studio";

export function DemoWorkspace() {
  const [view, setView] = useState<"run" | "library">("run");

  useEffect(() => {
    setView(new URLSearchParams(window.location.search).get("view") === "library" ? "library" : "run");
  }, []);

  return (
    <Shell demoMode headerRight={<span className="font-mono">Read-only preview</span>}>
      <div className="mj-demo-banner">
        <div>
          <span className="mj-section-label">Public preview</span>
          <h1>Explore the Nameko + Quepo workspace.</h1>
          <p>
            This preview uses fixture artifacts so the product surface is visible while WorkOS and the live control plane are configured for the team.
          </p>
        </div>
        <div className="mj-demo-tabs" role="tablist" aria-label="Preview surface">
          <a className={view === "run" ? "is-active" : ""} href="/demo?view=run" role="tab" aria-selected={view === "run"}>Nameko Run</a>
          <a className={view === "library" ? "is-active" : ""} href="/demo?view=library" role="tab" aria-selected={view === "library"}>Quepo Studio</a>
        </div>
      </div>
      {view === "library" ? <LibraryStudio /> : <RunWorkspace demoMode />}
    </Shell>
  );
}
