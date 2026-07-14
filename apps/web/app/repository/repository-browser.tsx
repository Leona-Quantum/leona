"use client";

import { useMemo, useState } from "react";
import type { PublicRepositoryEntry } from "../../lib/public-repository";

function statusLabel(status: PublicRepositoryEntry["status"]): string {
  return status === "verified" ? "Verified" : "Verified with caveats";
}

export function RepositoryBrowser({ entries }: { entries: PublicRepositoryEntry[] }) {
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("All families");
  const [framework, setFramework] = useState("All frameworks");

  const families = useMemo(
    () => ["All families", ...Array.from(new Set(entries.map((entry) => entry.algorithmFamily)))],
    [entries],
  );
  const frameworks = useMemo(
    () => ["All frameworks", ...Array.from(new Set(entries.map((entry) => entry.framework)))],
    [entries],
  );
  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesQuery = !normalizedQuery || [
        entry.title,
        entry.algorithmFamily,
        entry.framework,
        entry.description,
        entry.provenance,
        ...entry.tags,
      ].join(" ").toLowerCase().includes(normalizedQuery);
      const matchesFamily = family === "All families" || entry.algorithmFamily === family;
      const matchesFramework = framework === "All frameworks" || entry.framework === framework;
      return matchesQuery && matchesFamily && matchesFramework;
    });
  }, [entries, family, framework, query]);

  return (
    <div className="mj-repository-browser">
      <div className="mj-repository-controls">
        <label>
          <span>Search the repository</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search algorithms, frameworks, or tags"
            type="search"
          />
        </label>
        <label>
          <span>Algorithm family</span>
          <select value={family} onChange={(event) => setFamily(event.target.value)}>
            {families.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
        <label>
          <span>Framework</span>
          <select value={framework} onChange={(event) => setFramework(event.target.value)}>
            {frameworks.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
      </div>

      <p className="mj-repository-result-count" aria-live="polite">
        {filteredEntries.length} public {filteredEntries.length === 1 ? "entry" : "entries"}
      </p>

      {filteredEntries.length ? (
        <div className="mj-repository-grid">
          {filteredEntries.map((entry) => (
            <article className="mj-repository-entry" key={entry.slug}>
              <div className="mj-repository-entry-head">
                <div className="mj-repository-status-row">
                  <span className="mj-repository-status" data-status={entry.status}>
                    {statusLabel(entry.status)}
                  </span>
                  <span>{entry.framework}</span>
                </div>
                <time dateTime={entry.updatedAt}>{entry.updatedAt}</time>
              </div>
              <h3>{entry.title}</h3>
              <p>{entry.description}</p>
              <div className="mj-repository-resource-row">
                {entry.resources.map((resource) => (
                  <div key={resource.label}>
                    <span>{resource.label}</span>
                    <strong>{resource.value}</strong>
                  </div>
                ))}
              </div>
              <dl className="mj-repository-evidence">
                <div><dt>Family</dt><dd>{entry.algorithmFamily}</dd></div>
                <div><dt>Verification</dt><dd>{entry.verification}</dd></div>
                <div><dt>Export</dt><dd>{entry.exportStatus}</dd></div>
                <div><dt>Provenance</dt><dd>{entry.provenance}</dd></div>
              </dl>
              <div className="mj-repository-tags" aria-label="Tags">
                {entry.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mj-repository-empty">
          <h3>No entries match those filters.</h3>
          <p>Try a broader search or return to the full reference set.</p>
          <button type="button" onClick={() => { setQuery(""); setFamily("All families"); setFramework("All frameworks"); }}>
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
