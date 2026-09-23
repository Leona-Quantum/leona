"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { refusalSentence } from "../../../lib/api-error";
import { readQappExamples, type QappExampleSummary } from "../../../lib/qapp-management";
import type { PublicLocale } from "../../../lib/public-locale";

const COPY = {
  en: {
    title: "Start from an example",
    lede: "Example Qapps from the Leona team. Adding one puts a private copy in your account. Run it once to check it works, then publish it whenever you like.",
    add: "Add to my Qapps",
    adding: "Adding…",
    addFailed: "The example could not be added. Please try again.",
    qubits: (value: number) => `${value} qubits`,
    example: "Example",
  },
  ja: {
    title: "サンプルから始める",
    lede: "Leonaチームが用意したサンプルQappです。追加すると、非公開のコピーがあなたのアカウントに作られます。一度実行して動作を確かめてから、好きなときに公開できます。",
    add: "自分のQappに追加",
    adding: "追加しています…",
    addFailed: "サンプルを追加できませんでした。もう一度お試しください。",
    qubits: (value: number) => `${value}量子ビット`,
    example: "サンプル",
  },
} as const;

/**
 * Leona's example Qapps (ai-ops 363), shown under the signed-in person's own
 * list. "Add" copies one into their account as a new PRIVATE Qapp and opens its
 * workspace, the same way forking a published Qapp does.
 *
 * If the list cannot be read, the section is simply not drawn. The examples
 * are an extra, never a reason for the page to show an error: the one realistic
 * failure is the website deploying a few minutes ahead of the API, when the old
 * API refuses the path.
 */
export function QappExamples({ locale = "en" }: { locale?: PublicLocale }) {
  const copy = COPY[locale];
  const router = useRouter();
  const [examples, setExamples] = useState<QappExampleSummary[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/qapps/examples", { cache: "no-store", signal: controller.signal })
      .then(async (response) => (response.ok ? readQappExamples(await response.json()) : null))
      .then((list) => setExamples(list ?? []))
      .catch(() => {
        if (!controller.signal.aborted) setExamples([]);
      });
    return () => controller.abort();
  }, []);

  async function add(key: string) {
    if (adding) return;
    setAdding(key);
    setError(null);
    try {
      const response = await fetch(`/api/qapps/examples/${encodeURIComponent(key)}`, { method: "POST" });
      const payload = await response.json() as { qapp?: { id?: string } } | { title?: string };
      if (!response.ok || !("qapp" in payload) || !payload.qapp?.id) {
        throw new Error(refusalSentence(payload) ?? copy.addFailed);
      }
      router.push(`/qapps/${encodeURIComponent(payload.qapp.id)}`);
    } catch (cause) {
      setError({ key, message: cause instanceof Error ? cause.message : copy.addFailed });
      setAdding(null);
    }
  }

  if (examples.length === 0) return null;

  return (
    <section className="mj-qapps-examples" aria-labelledby="qapp-examples-title">
      <h2 id="qapp-examples-title">{copy.title}</h2>
      <p>{copy.lede}</p>
      <div className="mj-qapps-grid">
        {examples.map((example) => (
          <article className="mj-qapp-card" key={example.key}>
            <div className="mj-qapp-card-meta">
              <span>{example.framework}</span>
              <span>{copy.example}</span>
            </div>
            <div className="mj-qapp-card-copy">
              <h2>{example.title}</h2>
              <p>{example.description}</p>
            </div>
            <div className="mj-qapp-card-detail">
              <span>{copy.qubits(example.qubits_estimate)}</span>
            </div>
            <div className="mj-qapp-card-actions">
              {error?.key === example.key ? <p role="alert" className="mj-qapps-example-error">{error.message}</p> : null}
              <button
                className="mj-primary-button"
                type="button"
                disabled={adding !== null}
                onClick={() => void add(example.key)}
              >
                {adding === example.key ? copy.adding : copy.add}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
