"use client";

import type { components } from "@majorana/contracts-gen";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "../../../components/icons";
import { refusalSentence } from "../../../lib/api-error";
import { notebookStatusPill } from "../../../lib/notebook-view";
import type { PublicLocale } from "../../../lib/public-locale";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";

type Notebook = components["schemas"]["Notebook"];
type NotebookList = components["schemas"]["NotebookList"];
type NotebookTemplates = components["schemas"]["NotebookTemplates"];
type NotebookKind = components["schemas"]["NotebookKind"];
type NotebookStarter = components["schemas"]["NotebookStarter"];
type AudienceLevel = components["schemas"]["Audience"]["level"];
type MathLevel = components["schemas"]["Style"]["math_level"];
type CreateNotebookResponse = components["schemas"]["CreateNotebookResponse"];
type ImportNotebookResponse = components["schemas"]["ImportNotebookResponse"];

const KIND_OPTIONS: NotebookKind[] = [
  "lesson", "lab", "challenge", "solution", "walkthrough",
  "demo", "quiz", "hardware", "benchmark", "project", "scratch",
];
const LEVEL_OPTIONS: AudienceLevel[] = ["newcomer", "engineer", "student", "researcher"];
const MATH_OPTIONS: MathLevel[] = ["none", "minimal", "full"];
const LANGUAGE_OPTIONS: Array<"en" | "ja"> = ["en", "ja"];

/**
 * The starters shown before "Show all briefs" is pressed, curated by id
 * rather than by taking the API's first six. A future id the server adds is
 * not hidden by this list — it simply lands in "Show all" instead of here —
 * and an id below that the server stops returning is skipped, not rendered
 * blank.
 */
const DEFAULT_STARTER_IDS = [
  "first-circuit",
  "bell-state",
  "grover-2q",
  "vqe-one-qubit",
  "hardware-first-job",
  "reproduce-a-paper-circuit",
] as const;

const BRIEF_PREVIEW_MAX_LENGTH = 110;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * A starter card's preview: the brief's first sentence, capped so a run-on
 * brief (several starters have no period before 130+ characters) still reads
 * as one line. The cut lands on a word boundary — the cap exists for a clean
 * line, not for a word sliced in half.
 */
export function briefPreview(brief: string, maxLength = BRIEF_PREVIEW_MAX_LENGTH): string {
  const trimmed = brief.trim();
  const periodIndex = trimmed.indexOf(".");
  const sentence = periodIndex === -1 ? trimmed : trimmed.slice(0, periodIndex + 1);
  if (sentence.length <= maxLength) return sentence;
  const headroom = sentence.slice(0, maxLength - 1);
  const breakAt = headroom.lastIndexOf(" ");
  const cut = breakAt > 0 ? headroom.slice(0, breakAt) : headroom;
  return `${cut.trimEnd()}…`;
}

/**
 * The one field this page reads off a create/import response: the new
 * notebook's id. `CreateNotebookResponse` and `ImportNotebookResponse` both
 * carry `{ notebook, version, run_id }` (the latter's `run_id` is nullable —
 * set only when `execute` asked for an immediate re-run), so one reader
 * covers both without caring which endpoint answered.
 */
function createdNotebookId(payload: CreateNotebookResponse | ImportNotebookResponse | Record<string, unknown> | null): string | null {
  if (!payload || !isRecord(payload)) return null;
  const notebook = payload.notebook;
  if (!isRecord(notebook)) return null;
  return typeof notebook.id === "string" && notebook.id ? notebook.id : null;
}

/** A row of mutually-exclusive toggle pills — the composer's preference chips. */
function PillToggle<T extends string>({
  legend,
  options,
  value,
  onChange,
  labelFor,
}: {
  legend: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labelFor: (option: T) => string;
}) {
  return (
    <fieldset className="mj-notebooks-pill-group">
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className="mj-notebooks-pill"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {labelFor(option)}
        </button>
      ))}
    </fieldset>
  );
}

function ComposerField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mj-notebooks-field">
      <span className="mj-notebooks-field-label">{label}</span>
      {children}
    </div>
  );
}

export function NotebooksHome({ locale = "en", seedSlug = "" }: { locale?: PublicLocale; seedSlug?: string }) {
  const copy = WORKSPACE_COPY[locale].notebooks;
  const router = useRouter();

  const [items, setItems] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  const [templates, setTemplates] = useState<NotebookTemplates | null>(null);
  const [showAllStarters, setShowAllStarters] = useState(false);

  const [brief, setBrief] = useState("");
  const [kind, setKind] = useState<NotebookKind>("lesson");
  const [level, setLevel] = useState<AudienceLevel>("engineer");
  const [analogies, setAnalogies] = useState(true);
  const [mathLevel, setMathLevel] = useState<MathLevel>("minimal");
  const [language, setLanguage] = useState<"en" | "ja">(locale);
  const [atlasSlug, setAtlasSlug] = useState(seedSlug);
  const [circuitText, setCircuitText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const mutationPending = useRef(false);
  const importInput = useRef<HTMLInputElement>(null);
  const busy = submitting || importing;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    fetch("/api/notebooks", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as unknown;
        if (!response.ok || !isRecord(payload) || !Array.isArray(payload.items)) {
          throw new Error(refusalSentence(payload) ?? copy.listLoadFailed);
        }
        return (payload as NotebookList).items;
      })
      .then((list) => {
        if (active) setItems(list);
      })
      .catch((cause) => {
        if (active) {
          setItems([]);
          setLoadError(cause instanceof Error ? cause.message : copy.listLoadFailed);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [copy.listLoadFailed, loadAttempt]);

  useEffect(() => {
    let active = true;
    // Starters are a convenience, not load-bearing: the composer works with a
    // typed brief alone, so a failed fetch here degrades to "no starter cards"
    // rather than an error banner over an otherwise-working page.
    fetch("/api/notebook-templates", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<NotebookTemplates>) : null))
      .then((payload) => {
        if (active && payload) setTemplates(payload);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    if (!needle) return items;
    return items.filter((item) => item.title.toLocaleLowerCase(locale).includes(needle));
  }, [items, locale, query]);

  // Curated six first, the rest of whatever the API returned second — never
  // reordered once revealed, so "Show all" only ever appends.
  const { defaultStarters, restStarters } = useMemo(() => {
    const all = templates?.starters ?? [];
    const byId = new Map(all.map((starter) => [starter.id, starter] as const));
    const defaults = DEFAULT_STARTER_IDS
      .map((id) => byId.get(id))
      .filter((starter): starter is NotebookStarter => starter !== undefined);
    const defaultIds = new Set(defaults.map((starter) => starter.id));
    const rest = all.filter((starter) => !defaultIds.has(starter.id));
    return { defaultStarters: defaults, restStarters: rest };
  }, [templates]);
  const visibleStarters = showAllStarters ? [...defaultStarters, ...restStarters] : defaultStarters;

  /**
   * Apply a starter as a whole REQUEST, not just as text in the box.
   *
   * A starter carries the audience it was written for, and the audience is what decides
   * the notebook's structure (`templates._LEVEL_RULES` on the server). Filling the brief
   * and leaving the level at `engineer` would send "reproduce a paper's ansatz" as an
   * engineer request and produce something that reads like documentation — and the
   * researcher rules require the mathematics to be stated, so a starter that left
   * `math_level` at `none` would generate a draft its own structure check then fails.
   */
  function applyStarter(starter: NotebookStarter) {
    setBrief(starter.brief);
    setKind(starter.kind);
    const starterLevel = (starter.level ?? "engineer") as AudienceLevel;
    setLevel(starterLevel);
    if (starterLevel === "researcher") {
      setMathLevel("full");
      setAnalogies(false);
    } else if (starterLevel === "newcomer") {
      setMathLevel("minimal");
      setAnalogies(true);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = brief.trim();
    if (!trimmed || mutationPending.current) return;
    mutationPending.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const seeds = [
        ...(atlasSlug.trim()
          ? [{ kind: "atlas-record" as const, ref: atlasSlug.trim(), note: "" }]
          : []),
        ...(circuitText.trim()
          ? [{ kind: "circuit" as const, content: circuitText.trim(), note: "" }]
          : []),
      ];
      const response = await fetch("/api/notebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          brief: trimmed,
          kind,
          title: null,
          audience: { level, assumes: [], not_assumed: [] },
          style: {
            analogies,
            analogy_domains: [],
            tone: "plain",
            math_level: mathLevel,
            visualizations: true,
            code_comments: "light",
            language,
          },
          // Qiskit is the only framework this surface wires through today
          // (design doc §7 Q4 leaves the rest for a later decision).
          framework: { name: "qiskit", version: ">=2.5,<2.6", execution: "local-statevector" },
          seeds,
          response_locale: locale,
        }),
      });
      const payload = (await response.json()) as CreateNotebookResponse | Record<string, unknown>;
      const notebookId = createdNotebookId(payload);
      if (!response.ok || !notebookId) {
        throw new Error(refusalSentence(payload) ?? copy.createFailed);
      }
      router.push(`/notebooks/${encodeURIComponent(notebookId)}`);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : copy.createFailed);
      mutationPending.current = false;
      setSubmitting(false);
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file || mutationPending.current) return;
    mutationPending.current = true;
    setImporting(true);
    setSubmitError(null);
    try {
      const text = await file.text();
      let ipynb: unknown;
      try {
        ipynb = JSON.parse(text);
      } catch {
        throw new Error(copy.importFailed);
      }
      const response = await fetch("/api/notebooks/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ipynb, title: file.name.replace(/\.ipynb$/i, "") || null, execute: true }),
      });
      const payload = (await response.json()) as ImportNotebookResponse | Record<string, unknown>;
      const notebookId = createdNotebookId(payload);
      if (!response.ok || !notebookId) {
        throw new Error(refusalSentence(payload) ?? copy.importFailed);
      }
      // `payload.run_id` (nullable on ImportNotebookResponse) is not read here:
      // this page only ever routes to the new notebook, and the workspace page
      // itself detects an in-flight run off the notebook's own latest_status /
      // latest_run_id rather than trusting a value threaded through a redirect.
      router.push(`/notebooks/${encodeURIComponent(notebookId)}`);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : copy.importFailed);
      mutationPending.current = false;
      setImporting(false);
    }
  }

  return (
    <section className="mj-notebooks-page">
      <div className="mj-notebooks-scroll">
        <header className="mj-notebooks-hero">
          <div>
            <h1>{copy.title}</h1>
            <p>{copy.lede}</p>
          </div>
          <Link className="mj-secondary-button" href="/notebooks/courses" data-tour="notebooks-courses">
            {WORKSPACE_COPY[locale].courses.coursesTab}
          </Link>
        </header>

        <form className="mj-notebooks-composer" onSubmit={(event) => void submit(event)} aria-busy={busy}>
          <fieldset className="mj-notebooks-composer-content" disabled={busy}>
            <legend className="sr-only">{copy.create}</legend>
          <label className="mj-notebooks-brief" data-tour="notebooks-brief">
            <span>{copy.briefLabel}</span>
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder={copy.briefPlaceholder}
              rows={3}
              required
            />
          </label>

          {templates && templates.starters.length > 0 ? (
            <div className="mj-notebooks-starters" data-tour="notebooks-starters">
              <h2 className="mj-notebooks-starters-label">{copy.startersLabel}</h2>
              <div className="mj-notebooks-starter-list">
                {visibleStarters.map((starter) => (
                  <button
                    key={starter.id}
                    type="button"
                    className="mj-notebooks-starter-chip"
                    onClick={() => applyStarter(starter)}
                  >
                    <strong>{starter.title}</strong>
                    <span className="mj-mono-muted">
                      {copy.kindOption[starter.kind]}
                      {starter.level && starter.level !== "engineer"
                        ? ` · ${copy.audienceLevelOption[starter.level as AudienceLevel]}`
                        : ""}
                    </span>
                    <span className="mj-notebooks-starter-preview">"{briefPreview(starter.brief)}"</span>
                  </button>
                ))}
              </div>
              {restStarters.length > 0 && !showAllStarters ? (
                <button
                  type="button"
                  className="mj-secondary-button mj-notebooks-show-more"
                  onClick={() => setShowAllStarters(true)}
                >
                  {copy.showMoreBriefs(restStarters.length)}
                </button>
              ) : null}
            </div>
          ) : null}

          <details className="mj-notebooks-disclosure" data-tour="notebooks-options">
            <summary>
              <span>{locale === "ja" ? "ノートブックの設定" : "Notebook options"}</span>
              <span className="mj-notebooks-option-summary">{copy.kindOption[kind]} · {copy.languageOption[language]}</span>
            </summary>
          <div className="mj-notebooks-fields" data-tour="notebooks-fields">
            <ComposerField label={copy.kindLabel}>
              <select
                className="mj-notebooks-select"
                aria-label={copy.kindLabel}
                value={kind}
                onChange={(event) => setKind(event.target.value as NotebookKind)}
              >
                {KIND_OPTIONS.map((option) => (
                  <option key={option} value={option}>{copy.kindOption[option]}</option>
                ))}
              </select>
            </ComposerField>
            <ComposerField label={copy.audienceLevelLabel}>
              <PillToggle
                legend={copy.audienceLevelLabel}
                options={LEVEL_OPTIONS}
                value={level}
                onChange={setLevel}
                labelFor={(option) => copy.audienceLevelOption[option]}
              />
            </ComposerField>
            <ComposerField label={copy.mathLevelLabel}>
              <PillToggle
                legend={copy.mathLevelLabel}
                options={MATH_OPTIONS}
                value={mathLevel}
                onChange={setMathLevel}
                labelFor={(option) => copy.mathLevelOption[option]}
              />
            </ComposerField>
            <ComposerField label={copy.languageLabel}>
              <PillToggle
                legend={copy.languageLabel}
                options={LANGUAGE_OPTIONS}
                value={language}
                onChange={setLanguage}
                labelFor={(option) => copy.languageOption[option]}
              />
            </ComposerField>
            <ComposerField label={copy.analogiesLabel}>
              <button
                type="button"
                className="mj-notebooks-pill"
                aria-pressed={analogies}
                onClick={() => setAnalogies((current) => !current)}
              >
                {copy.analogiesLabel}
              </button>
            </ComposerField>
            <ComposerField label={copy.frameworkLabel}>
              {/* Qiskit only: see the comment on the submit body above. A fixed
                  badge states the constraint instead of offering a choice that
                  would fail once submitted. */}
              <span className="mj-notebooks-pill mj-notebooks-pill--fixed">Qiskit</span>
            </ComposerField>
          </div>
          </details>

          <details className="mj-notebooks-disclosure" open={seedSlug ? true : undefined}>
            <summary>{locale === "ja" ? "参考資料を追加" : "Add source material"}</summary>
          <label className="mj-notebooks-seed">
            <span>{copy.seedAtlasLabel}</span>
            <input
              type="text"
              value={atlasSlug}
              onChange={(event) => setAtlasSlug(event.target.value)}
              placeholder={copy.seedAtlasPlaceholder}
            />
          </label>

          <label className="mj-notebooks-seed">
            <span>{copy.seedCircuitLabel}</span>
            <textarea
              className="mj-notebooks-seed-circuit"
              value={circuitText}
              onChange={(event) => setCircuitText(event.target.value)}
              placeholder={copy.seedCircuitPlaceholder}
              rows={5}
            />
          </label>

          </details>

          {submitError ? <p role="alert" className="mj-notebooks-error">{submitError}</p> : null}

          <div className="mj-notebooks-composer-actions">
            <button className="mj-primary-button" type="submit" disabled={busy || !brief.trim()} data-tour="notebooks-create">
              {submitting ? copy.creating : copy.create}
            </button>
            <button type="button" className="mj-secondary-button mj-notebooks-import" disabled={busy} onClick={() => importInput.current?.click()}>
              {importing ? (locale === "ja" ? "インポート中…" : "Importing…") : copy.importLabel}
            </button>
              <input
                ref={importInput}
                aria-label={copy.importLabel}
                type="file"
                accept=".ipynb,application/x-ipynb+json,application/json"
                onChange={(event) => void importFile(event)}
                disabled={busy}
                hidden
              />
          </div>
          </fieldset>
        </form>

        <div className="mj-library-toolbar mj-notebooks-library-toolbar">
          <h2>{locale === "ja" ? "マイノートブック" : "Your notebooks"}</h2>
          <label className="mj-library-search">
            <SearchIcon size={16} />
            <span className="sr-only">{copy.search}</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} />
          </label>
        </div>

        {loading ? <NotebooksNotice role="status" text={copy.listLoading} /> : null}
        {loadError ? (
          <div className="mj-notebooks-retry" role="alert">
            <p>{loadError}</p>
            <button type="button" className="mj-secondary-button" onClick={() => setLoadAttempt((current) => current + 1)}>{locale === "ja" ? "再試行" : "Retry"}</button>
          </div>
        ) : null}
        {!loading && !loadError && visible.length === 0 ? (
          <NotebooksNotice text={items.length ? copy.noMatch : copy.listEmpty} />
        ) : null}

        {!loading && !loadError && visible.length > 0 ? (
          <div className="mj-notebooks-grid">
            {visible.map((notebook) => (
              <NotebookCard key={notebook.id} notebook={notebook} locale={locale} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function NotebookCard({ notebook, locale }: { notebook: Notebook; locale: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale].notebooks;
  const pill = notebookStatusPill(notebook.latest_status);
  return (
    <article className="mj-notebook-card">
      <div className="mj-notebook-card-meta">
        <span className="mj-notebook-kind-badge">{copy.kindOption[notebook.kind]}</span>
        <span className={`mj-notebook-status-pill mj-notebook-status-pill--${pill}`}>{copy.statusPill[pill]}</span>
        <time dateTime={notebook.updated_at}>{copy.updated} {formatDate(notebook.updated_at, locale)}</time>
      </div>
      <div className="mj-notebook-card-copy">
        <h2><Link href={`/notebooks/${encodeURIComponent(notebook.id)}`}>{notebook.title}</Link></h2>
        {notebook.summary ? <p>{notebook.summary}</p> : null}
      </div>
      <div className="mj-notebook-card-actions">
        <Link className="mj-secondary-button" href={`/notebooks/${encodeURIComponent(notebook.id)}`}>{copy.open}</Link>
      </div>
    </article>
  );
}

function NotebooksNotice({ text, role }: { text: string; role?: "alert" | "status" }) {
  return <div className="mj-library-empty" role={role}><strong>{text}</strong></div>;
}

function formatDate(value: string, locale: PublicLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}
