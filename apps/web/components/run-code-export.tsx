"use client";

/**
 * The program a run produced, in whichever framework the reader wants, with its
 * export.
 *
 * The Run surface used to end at a single code block in the one framework the
 * model happened to generate — the only place in the product where code appeared
 * without the conversions beside it. The artifact page had them, Studio had them, Atlas had
 * them, Run did not.
 *
 * The conversions cannot come from the run's own event stream. Events carry the
 * framework-native Python and only an *availability* flag for OpenQASM
 * (`qasm_emission`), never the QASM text — and the bounded parser cannot read
 * generated Python (`transpile`, `AerSimulator`, locals), so converting from it
 * yields nothing. The stored interchange QASM on the saved artifact version is
 * what every real conversion goes through, which is why this fetches the version
 * rather than deriving from events.
 *
 * If there is no saved artifact, or the fetch fails, this renders exactly the
 * plain code block the surface rendered before. A conversion panel is an
 * addition to the run's output; it is never allowed to take the code away.
 */

import { useEffect, useState } from "react";
import { SyntaxHighlightedCode } from "@majorana/ui";

import { CircuitDiagram } from "./circuit-diagram";
import {
  artifactExportFilename,
  artifactExportSource,
  fileExtension,
} from "../lib/artifact-export";
import { reconstructInterchangeCircuit } from "../lib/circuit-conversion";
import { circuitFramework } from "../lib/circuit-frameworks";
import {
  frameworkCodeOptions,
  type FrameworkCodeOption,
} from "../lib/framework-code-options";
import { statusFromVerificationSummary } from "../lib/library-data";
import type { LibraryArtifact } from "../lib/library-data";
import { verificationSummaryFromValue } from "../lib/verification-record";

export interface RunCodeFallback {
  label: string;
  language: string;
  source: string;
}

type LoadedVersion = {
  options: FrameworkCodeOption[];
  qasm: string | null;
  /** Only the fields the export header reads. */
  exportArtifact: LibraryArtifact;
};

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function loadVersion(artifactId: string, title: string): Promise<LoadedVersion | null> {
  const response = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/versions/current`, {
    cache: "no-store",
  });
  if (!response.ok) return null;
  const version = (await response.json()) as {
    code?: unknown;
    code_lang?: unknown;
    qasm?: unknown;
    framework_variants?: unknown;
    verification_summary?: unknown;
  };
  const code = typeof version.code === "string" ? version.code : "";
  const framework = typeof version.code_lang === "string" ? version.code_lang : "qiskit";
  const qasm = typeof version.qasm === "string" && version.qasm.trim() ? version.qasm : null;
  const variants =
    version.framework_variants && typeof version.framework_variants === "object"
      && !Array.isArray(version.framework_variants)
      ? (version.framework_variants as Record<string, string>)
      : null;

  const options = frameworkCodeOptions({ framework, code, qasm, frameworkVariants: variants });
  if (!options.length) return null;

  const verificationSummary = verificationSummaryFromValue(version.verification_summary);
  return {
    options,
    qasm,
    // The export header states the artifact's real verification standing, and an
    // export that omitted an INCONCLUSIVE verdict would be the more dangerous
    // file. Only the fields `artifactExportHeader` reads are populated.
    exportArtifact: {
      id: artifactId,
      title,
      slug: "",
      status: statusFromVerificationSummary(verificationSummary),
      verificationSummary,
      qasm,
    } as LibraryArtifact,
  };
}

export function RunCodeExport({
  artifactId,
  title,
  fallback,
}: {
  artifactId: string | null;
  title: string;
  fallback: RunCodeFallback | null;
}) {
  const [loaded, setLoaded] = useState<LoadedVersion | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!artifactId) return;
    let cancelled = false;
    // A failure here is not worth surfacing: the run's own code is already on
    // screen, and an error banner over a working code block would be noise.
    loadVersion(artifactId, title)
      .then((result) => {
        if (cancelled || !result) return;
        setLoaded(result);
        setSelected(result.options[0].key);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [artifactId, title]);

  if (!loaded || !selected) {
    return fallback ? (
      <div className="mj-run-result-code">
        <span className="mj-section-label">
          {fallback.label} · {fallback.language}
        </span>
        <pre>
          <SyntaxHighlightedCode code={fallback.source} language={fallback.language} />
        </pre>
      </div>
    ) : null;
  }

  const option = loaded.options.find((item) => item.key === selected) ?? loaded.options[0];
  const drawing = loaded.qasm ? reconstructInterchangeCircuit(loaded.qasm) : null;
  const filename = artifactExportFilename(
    { ...loaded.exportArtifact, slug: loaded.exportArtifact.slug || loaded.exportArtifact.id },
    option.key,
  );

  return (
    <div className="mj-run-result-code">
      <div className="mj-run-code-head">
        <span className="mj-section-label">
          Program · {option.native ? "as written" : "converted"}
        </span>
        <div className="mj-run-code-actions">
          <label>
            <span className="sr-only">Framework</span>
            <select value={option.key} onChange={(event) => setSelected(event.target.value)}>
              {loaded.options.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {/* The label used to be the whole filename — "Download
              bell-state-circuit.openqasm3.qasm" — which is a long, noisy button
              beside a framework picker that already says which framework this
              is. The exact name still reaches the user, on hover and in the
              accessible name, and is unchanged on disk. */}
          <button
            className="mj-secondary-button"
            type="button"
            title={filename}
            aria-label={`Download ${filename}`}
            onClick={() =>
              download(
                artifactExportSource(loaded.exportArtifact, {
                  framework: option.key,
                  code: option.code,
                }),
                filename,
                "text/plain",
              )
            }
          >
            Download <span className="mj-mono-muted">.{fileExtension(filename)}</span>
          </button>
        </div>
      </div>
      {drawing?.kind === "ok" ? (
        <CircuitDiagram
          qubitCount={drawing.circuit.qubitCount}
          steps={drawing.circuit.steps}
          customGates={[]}
          ariaLabel={`${title} circuit diagram`}
        />
      ) : null}
      <pre>
        <SyntaxHighlightedCode code={option.code} language={circuitFramework(option.key).key} />
      </pre>
      {option.note ? <p className="mj-run-code-note">{option.note}</p> : null}
    </div>
  );
}
