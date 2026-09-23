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
    loading: "Loading examples…",
    loadFailed: "The examples could not be loaded.",
    empty: "No examples are available right now.",
    retry: "Try again",
  },
  ja: {
    title: "サンプルから始める",
    lede: "Leonaチームが用意したサンプルQappです。追加すると、非公開のコピーがあなたのアカウントに作られます。一度実行して動作を確かめてから、好きなときに公開できます。",
    add: "自分のQappに追加",
    adding: "追加しています…",
    addFailed: "サンプルを追加できませんでした。もう一度お試しください。",
    qubits: (value: number) => `${value}量子ビット`,
    example: "サンプル",
    loading: "サンプルを読み込んでいます…",
    loadFailed: "サンプルを読み込めませんでした。",
    empty: "現在利用できるサンプルはありません。",
    retry: "再試行",
  },
} as const;

/**
 * Leona's example Qapps (ai-ops 363), shown under the signed-in person's own
 * list. "Add" copies one into their account as a new PRIVATE Qapp and opens its
 * workspace, the same way forking a published Qapp does.
 *
 * Like every async view here it has loading, empty and error states. The one
 * realistic error is the website deploying a few minutes ahead of the API, when
 * the old API refuses the path; "Try again" then recovers without a reload.
 */
export function QappExamples({ locale = "en" }: { locale?: PublicLocale }) {
  const copy = COPY[locale];
  const router = useRouter();
  const [examples, setExamples] = useState<QappExampleSummary[] | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState("loading");
    fetch("/api/qapps/examples", { cache: "no-store", signal: controller.signal })
      .then(async (response) => (response.ok ? readQappExamples(await response.json()) : null))
      .then((list) => {
        if (list === null) throw new Error("unreadable example list");
        setExamples(list);
        setLoadState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadState("failed");
      });
    return () => controller.abort();
  }, [reload]);

  async function add(key: string) {
    if (adding) return;
    setAdding(key);
    setError(null);
    try {
      // One key per press: a retry of this request converges on one copy, while
      // pressing Add again later is a deliberate second copy and gets a new key.
      const response = await fetch(`/api/qapps/examples/${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
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

  const notice = loadState === "loading"
    ? <div className="mj-library-empty leona-workspace-state" role="status"><strong>{copy.loading}</strong></div>
    : loadState === "failed"
      ? (
        <div className="mj-library-empty leona-workspace-state" role="alert">
          <strong>{copy.loadFailed}</strong>
          <button className="mj-secondary-button" type="button" onClick={() => setReload((value) => value + 1)}>{copy.retry}</button>
        </div>
      )
      : examples?.length === 0
        ? <div className="mj-library-empty leona-workspace-state"><strong>{copy.empty}</strong></div>
        : null;

  return (
    <section className="mj-qapps-examples" aria-labelledby="qapp-examples-title">
      <h2 id="qapp-examples-title">{copy.title}</h2>
      <p>{copy.lede}</p>
      {notice}
      {loadState === "ready" && examples && examples.length > 0 ? (
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
      ) : null}
    </section>
  );
}
