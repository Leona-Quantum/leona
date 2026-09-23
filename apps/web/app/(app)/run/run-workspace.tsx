"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { rememberChat } from "../../../lib/chat-history";
import { refusalSentence, responseString, submittedId } from "../../../lib/api-error.ts";
import { titleFromPrompt } from "../../../lib/chat-title";
import { artifactFromResource, type LibraryArtifact } from "../../../lib/library-data";
import { consumeLandingPromptHandoff } from "../../../lib/landing-prompt-handoff";
import type { PublicLocale } from "../../../lib/public-locale";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";
import {
  canSubmitAfterArtifactHydration,
  hydrateArtifactFramework,
  type ArtifactFrameworkHydration,
} from "../../../lib/framework-selection";
import { isComposerMode, type ComposerMode } from "../../../lib/run-mode";
import { RunComposer, type ComposerFramework } from "../../../components/run-composer";
import { LionessField } from "../../../components/lioness-field";
import { usePromptAttachments } from "../../../lib/use-prompt-attachments";
import { NalaPlanCue } from "../../../components/nala-plan-cue";
import { indexPlannerGraph, type PlannerGraph } from "../../../lib/workflow-planner/graph.ts";
import { contextForPrompt } from "../../../lib/workflow-planner/run-context.ts";

/**
 * The planner's graph (prose stripped, see `leanPlannerGraph`) and the worked
 * examples' titles, passed by the signed-in Run page so a recognised prompt
 * reaches Nala with its workflow. Absent in the public demo, which never sends.
 */
export interface RunPlanner {
  graph: PlannerGraph;
  exampleTitles: Record<string, string>;
}

export function RunWorkspace({
  demoMode = false,
  locale = "en",
  planner,
}: { demoMode?: boolean; locale?: PublicLocale; planner?: RunPlanner } = {}) {
  const copy = WORKSPACE_COPY[locale].run;
  const plannerIndex = useMemo(() => (planner ? indexPlannerGraph(planner.graph) : null), [planner]);
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<ComposerMode>("auto");
  const [framework, setFramework] = useState<ComposerFramework>("qiskit");
  const [artifactHydration, setArtifactHydration] =
    useState<ArtifactFrameworkHydration>("checking");
  const frameworkCurrent = useRef<ComposerFramework>("qiskit");
  const frameworkTouched = useRef(false);
  const [pending, setPending] = useState(false);
  const [composerEngaged, setComposerEngaged] = useState(false);
  const lionessStandRef = useRef<HTMLSpanElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextArtifact, setContextArtifact] = useState<LibraryArtifact | null>(null);
  const { attachments, reading, isReading, addFiles, removeAttachment } = usePromptAttachments(locale, setError);
  const promptTouched = useRef(false);
  const submittingRef = useRef(false);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const contextController = useRef<AbortController | null>(null);
  const [confirmingSend, setConfirmingSend] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    contextController.current = controller;
    const search = new URLSearchParams(window.location.search);
    const requestedMode = search.get("mode");
    if (requestedMode && isComposerMode(requestedMode)) setMode(requestedMode);
    const artifactId = search.get("artifact");
    if (!artifactId) {
      setArtifactHydration("idle");
      return () => { active = false; };
    }
    setArtifactHydration("loading");
    const selectedArtifactId = artifactId;

    async function loadContext() {
      const response = await fetch(`/api/artifacts/${encodeURIComponent(selectedArtifactId)}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(locale === "ja" ? "Artifactのコンテキストを利用できません" : "Artifact context unavailable");
      const remote = (await response.json()) as Record<string, unknown>;
      let artifact = artifactFromResource(remote)[0];
      if (!artifact) throw new Error(locale === "ja" ? "Artifactのコンテキストを利用できません" : "Artifact context unavailable");
      if (artifact.currentVersionId && !artifact.code) {
        const versionResponse = await fetch(`/api/artifacts/${encodeURIComponent(artifact.id)}/versions/current`, { cache: "no-store", signal: controller.signal });
        if (versionResponse.ok) {
          const version = (await versionResponse.json()) as Record<string, unknown>;
          artifact = { ...artifact, code: typeof version.code === "string" ? version.code : "" };
        }
      }
      if (!active || controller.signal.aborted) return;
      setContextArtifact(artifact);
      const hydrated = hydrateArtifactFramework(
        frameworkCurrent.current,
        frameworkTouched.current,
        artifact.framework,
      );
      if (hydrated.error) {
        setError(hydrated.error);
        setArtifactHydration("error");
        return;
      }
      frameworkCurrent.current = hydrated.framework;
      setFramework(hydrated.framework);
      setArtifactHydration("ready");
      setPrompt((current) => promptTouched.current ? current : current || (locale === "ja"
        ? requestedMode === "qapp"
          ? `保存済みArtifact「${artifact.title}」を使って、操作しやすい量子アプリを作ってください。`
          : `保存済みArtifact「${artifact.title}」を次の質問のコンテキストとして使用してください。`
        : requestedMode === "qapp"
          ? `Turn the saved artifact “${artifact.title}” into an interactive quantum application.`
          : `Use the saved artifact "${artifact.title}" as context for my next question.`));
    }

    void loadContext().catch(() => {
      if (!active || controller.signal.aborted) return;
      setError(locale === "ja" ? "Artifactのコンテキストを利用できません" : "Artifact context unavailable");
      setArtifactHydration("error");
    });
    return () => { active = false; controller.abort(); };
  }, []);

  // Pre-fills from the landing page's composer (ai-ops 102), signed-out visitor
  // → sign-in → straight back here with their own words already in the box —
  // never auto-submitted; the owner's ruling was explicit that the person still
  // presses run themselves. `?artifact=` above wins when both are present: it is
  // a deliberate "view in Run" action, and a leftover landing prompt should
  // never override an explicit one. Checked independently here rather than
  // folded into the effect above because the two sources are unrelated (a URL
  // param that starts an async fetch vs. a synchronous read of the visitor's
  // own storage), and merging them would make the precedence harder to see, not
  // easier.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("artifact")) return;
    const carried = consumeLandingPromptHandoff();
    if (carried) setPrompt(carried);
  }, []);

  useEffect(() => {
    if (confirmingSend) confirmationRef.current?.focus();
  }, [confirmingSend]);

  function clearContext() {
    contextController.current?.abort();
    setContextArtifact(null);
    setArtifactHydration("idle");
    setConfirmingSend(false);
    setError(null);
    composerInputRef.current?.focus();
  }

  function promptWithAttachments(taskPrompt: string): string {
    if (!attachments.length) return taskPrompt;
    const blocks = attachments.map((attachment) => `\n\n--- Attachment: ${attachment.name} ---\n${attachment.content}`);
    return `${taskPrompt}${blocks.join("")}`;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const taskPrompt = prompt.trim();
    if (!taskPrompt || submittingRef.current || isReading()) return;
    if (!canSubmitAfterArtifactHydration(artifactHydration)) {
      setError(
        artifactHydration === "error"
          ? locale === "ja" ? "送信前にArtifactコンテキストのエラーを解決してください。" : "Resolve the artifact context error before submitting."
          : locale === "ja" ? "Artifactのフレームワーク読み込みが完了するまでお待ちください。" : "Wait for the artifact framework to finish loading.",
      );
      return;
    }
    if (demoMode) {
      setError(locale === "ja" ? "公開プレビューは閲覧専用です。実際に実行するにはサインインしてください。" : "Public preview mode is view-only. Sign in to start a real run.");
      return;
    }
    if (contextArtifact) {
      setConfirmingSend(true);
      return;
    }
    await sendRun(taskPrompt);
  }

  async function sendRun(taskPrompt: string) {
    if (submittingRef.current || !taskPrompt || isReading()) return;
    submittingRef.current = true;
    setConfirmingSend(false);
    setPending(true);
    setError(null);
    try {
      // The planner's reading of the typed prompt (not the attachments), when
      // it recognises one: Nala plans with the cited workflow instead of
      // guessing at the full-size cost. Only on a fresh run from here, never
      // when an artifact is attached, where the task is that artifact.
      const workflowContext =
        plannerIndex && planner && !contextArtifact
          ? contextForPrompt(plannerIndex, taskPrompt, locale, planner.exampleTitles)
          : null;
      const send = (withContext: boolean) =>
        fetch("/api/runs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            task_prompt: promptWithAttachments(taskPrompt),
            // Auto remains the safe default, while a deliberate user selection is
            // authoritative and bypasses intent reclassification in the worker.
            mode,
            framework,
            response_locale: locale,
            ...(contextArtifact?.code ? { source_code: contextArtifact.code } : {}),
            ...(contextArtifact?.currentVersionId ? { artifact_version_id: contextArtifact.currentVersionId } : {}),
            ...(withContext && workflowContext ? { workflow_context: workflowContext } : {}),
          }),
        });
      let response = await send(true);
      let payload = (await response.json()) as unknown;
      // An API that predates `workflow_context` refuses it (its request model
      // forbids unknown fields) with a 422 naming the field. The run the reader
      // asked for matters more than the context, so send it once more without.
      if (workflowContext && response.status === 422 && JSON.stringify(payload).includes("workflow_context")) {
        response = await send(false);
        payload = (await response.json()) as unknown;
      }
      // `typeof`, not just truthiness: the cast above is an assertion about this
      // body, not a check of it, and a numeric `id` would satisfy `!payload.id`
      // and then be carried into a route and a stored chat as if it were the
      // string those expect. Raised by CodeRabbit on this PR.
      const submitted = submittedId(payload);
      if (!response.ok || !submitted) {
        throw new Error(refusalSentence(payload) ?? `Run submission failed (${response.status})`);
      }
      rememberChat({
        id: submitted,
        title: titleFromPrompt(taskPrompt),
        prompt: taskPrompt,
        createdAt: new Date().toISOString(),
        status: "queued",
        conversationId: responseString(payload, "conversation_id") ?? undefined,
      });
      router.push(`/run/${submitted}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Run submission failed");
      submittingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div className="mj-run-home">
      <div className="mj-run-home-scroll">
        <div className="mj-run-home-content mj-run-home-content--centered">
          {/* The lioness, assembled from pieces, drawn on one canvas over the
              whole block; she stands above the heading and answers the pointer
              with a tail flick. Back by owner request (2026-09-10); the walk to
              the composer came and went on 2026-09-12. */}
          <LionessField className="mj-run-lioness-canvas" engaged={composerEngaged} standRef={lionessStandRef} />
          <header className="mj-run-home-heading mj-run-home-hero">
            <span ref={lionessStandRef} className={`mj-run-hero-lioness${composerEngaged ? " is-engaged" : ""}`} aria-hidden="true" />
            <h1>{locale === "ja" ? "何を作りたいですか？" : "What would you like to build?"}</h1>
            {demoMode ? (
              <div className="mj-run-home-status" aria-label={locale === "ja" ? "モデルの状態" : "Model status"}>
                <span className="mj-status-dot" aria-hidden="true" />
                {copy.previewStatus}
              </div>
            ) : null}
          </header>

          <div
            className="mj-run-composer-stage"
            onFocusCapture={() => setComposerEngaged(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setComposerEngaged(false);
            }}
          >
            <RunComposer
              value={prompt}
              inputRef={composerInputRef}
              // The same prompts the example strip offers, typed into the box
              // itself: a blank composer with a generic placeholder is the
              // hardest version of this product to start using.
              suggestions={copy.examples.map((example) => example.prompt)}
              disabled={!canSubmitAfterArtifactHydration(artifactHydration)}
              readingAttachments={reading}
              pending={pending}
              error={error}
              onChange={(value) => { promptTouched.current = true; setPrompt(value); }}
              mode={mode}
              onModeChange={setMode}
              framework={framework}
              onFrameworkChange={(value) => {
                frameworkTouched.current = true;
                frameworkCurrent.current = value;
                setFramework(value);
              }}
              onSubmit={submit}
              centered
              contextArtifact={contextArtifact ? { title: contextArtifact.title, framework: contextArtifact.framework, codeAvailable: Boolean(contextArtifact.code) } : null}
              onClearContext={clearContext}
              onFiles={demoMode ? undefined : addFiles}
              attachments={attachments.map(({ name, size }) => ({ name, size }))}
              onRemoveAttachment={removeAttachment}
              onAttach={demoMode ? () => setError(locale === "ja" ? "公開プレビューでは添付を利用できません。" : "Attachments are unavailable in the public preview.") : undefined}
              locale={locale}
            />
          </div>

          <NalaPlanCue prompt={prompt} locale={locale} informsNala={Boolean(planner) && !contextArtifact} />

          {confirmingSend && contextArtifact ? (
            <div className="mj-run-confirm" ref={confirmationRef} tabIndex={-1} role="region" aria-labelledby="run-confirm-title" aria-describedby="run-confirm-body">
              <strong id="run-confirm-title">{locale === "ja" ? "この回路と一緒に送信" : "Send with this circuit"}</strong>
              <p id="run-confirm-body">{locale === "ja" ? `「${contextArtifact.title}」のコードをメッセージに含めます。` : `Include the code from "${contextArtifact.title}" with your message.`}</p>
              <blockquote>{prompt.trim()}</blockquote>
              <div className="mj-run-confirm-actions">
                <button className="mj-primary-button" type="button" disabled={pending} onClick={() => void sendRun(prompt.trim())}>{locale === "ja" ? "送信" : "Send"}</button>
                <button className="mj-secondary-button" type="button" onClick={() => { setConfirmingSend(false); composerInputRef.current?.focus(); }}>{copy.confirmCancel}</button>
              </div>
            </div>
          ) : null}

          {artifactHydration === "checking" || artifactHydration === "loading" ? (
            <p className="mj-run-context-link" role="status">{locale === "ja" ? "Artifactコンテキストを読み込み中…" : "Loading artifact context…"}</p>
          ) : null}
          {artifactHydration === "error" ? (
            <div className="mj-run-context-recovery"><button className="mj-secondary-button" type="button" onClick={clearContext}>{locale === "ja" ? "回路を外して続ける" : "Continue without the circuit"}</button></div>
          ) : null}

          {contextArtifact ? <a className="mj-run-context-link" href={demoMode ? "/demo?view=library" : `/studio?artifact=${encodeURIComponent(contextArtifact.id)}`}>{copy.contextLabel}: {contextArtifact.title} · {copy.viewArtifact}</a> : null}

          <ExampleStrip
            copy={copy}
            locale={locale}
            onPick={(value) => {
              promptTouched.current = true;
              setPrompt(value);
              setError(null);
              composerInputRef.current?.focus();
            }}
          />
        </div>
      </div>
    </div>
  );
}


function ExampleStrip({ copy, locale, onPick }: { copy: (typeof WORKSPACE_COPY)[PublicLocale]["run"]; locale: PublicLocale; onPick: (prompt: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const starters = locale === "ja" ? [
    { title: "Bell状態を作る", prompt: "Bell状態の回路を作り、測定分布を検証してください。" },
    { title: "アルゴリズムを調べる", prompt: "QAOAで5ノードのリングのMaxCutを解き、古典的な厳密解と比較してください。" },
    { title: "回路を理解する", prompt: "3量子ビットの量子フーリエ変換を、回路の各ステップとともに説明してください。" },
  ] : [
    { title: "Build a Bell state", prompt: "Build a Bell state circuit and verify its measured distribution." },
    { title: "Explore an algorithm", prompt: "Use QAOA to solve MaxCut on a 5-node ring and compare it with an exact classical baseline." },
    { title: "Explain a circuit", prompt: "Explain a three-qubit quantum Fourier transform, step by step through the circuit." },
  ];
  const allPrompts = [...copy.examples, ...copy.morePrompts];

  return (
    <section className="mj-run-home-examples" aria-label={copy.examplesTitle}>
      <div className="mj-nala-starters">
        {starters.map((example, index) => (
          <button className="mj-nala-starter" key={example.title} type="button" onClick={() => onPick(example.prompt)} data-tour={index === 0 ? "run-starter-bell" : "run-starter"}>
            <svg viewBox="0 0 32 32" aria-hidden="true" fill="none">
              {index === 0 ? <><path d="M16 16c-4-9-12-9-12 0s8 9 12 0 12-9 12 0-8 9-12 0Z" /><circle cx="9" cy="16" r="2" /><circle cx="23" cy="16" r="2" /></> : index === 1 ? <><path d="M7 7v18m0-18h18M7 16h12M7 25h18" /><circle cx="7" cy="7" r="2" /><circle cx="25" cy="7" r="2" /><circle cx="19" cy="16" r="2" /><circle cx="25" cy="25" r="2" /></> : <><path d="M3 9h26M3 23h26M11 9v14M23 9v14" /><circle cx="11" cy="9" r="3" /><rect x="19" y="19" width="8" height="8" rx="1" /></>}
            </svg>
            <span>{example.title}</span>
          </button>
        ))}
      </div>
      <div className="mj-example-strip">
        <button className="mj-secondary-button mj-example-more" type="button" aria-expanded={expanded} aria-controls="nala-more-prompts" onClick={() => setExpanded((current) => !current)}>
          {expanded ? locale === "ja" ? "例を閉じる" : "Fewer examples" : locale === "ja" ? "他の例を見る" : "More examples"}
        </button>
      </div>
      {expanded ? (
        <div className="mj-example-popout" id="nala-more-prompts">
          {allPrompts.map((example) => (
            <button className="mj-example-button" key={example.title} type="button" onClick={() => { onPick(example.prompt); setExpanded(false); }}>
              <strong>{example.title}</strong><span>{example.prompt}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
