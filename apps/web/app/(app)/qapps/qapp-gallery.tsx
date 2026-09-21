"use client";

import type { components } from "@majorana/contracts-gen";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { QappsIcon, SearchIcon } from "../../../components/icons";
import { refusalSentence } from "../../../lib/api-error";
import { readPublicQappPage } from "../../../lib/qapp-management";
import type { PublicLocale } from "../../../lib/public-locale";

type Qapp = components["schemas"]["Qapp"];

type PublicQappSummary = {
  slug: string;
  title: string;
  description: string;
  framework: string;
  qubits_estimate: number;
  version: number;
  published_at: string;
};

export type QappGalleryView = "mine" | "public";

// The control plane's `list_qapps` / `list_public_qapps` page size (repos/qapps.py).
const LIST_LIMIT = 100;

const COPY = {
  en: {
    eyebrow: "Quantum applications",
    title: "Qapps",
    lede: "Run your quantum applications or explore published Qapps.",
    mine: "My Qapps",
    public: "Explore",
    createRun: "Create in Run",
    createStudio: "Create from Studio",
    search: "Search Qapps",
    searchPlaceholder: "Search by title, description, or framework",
    loading: "Loading Qapps…",
    loadFailed: "Qapps could not be loaded.",
    mineEmpty: "You have not created a Qapp yet.",
    publicEmpty: "No public Qapps have been published yet.",
    noMatch: "No Qapps match this search.",
    retry: "Try again",
    clear: "Clear search",
    count: (shown: number, total: number) => `${shown} of ${total} Qapps`,
    capped: (limit: number) => `Showing the newest ${limit}. Older Qapps are still there; search does not reach them yet.`,
    private: "Private",
    published: "Public",
    updated: "Updated",
    publishedOn: "Published",
    manage: "Open workspace",
    open: "Open Qapp",
    version: (value: number) => `Version ${value}`,
    qubits: (value: number) => `${value} qubits`,
  },
  ja: {
    eyebrow: "量子アプリケーション",
    title: "Qapps",
    lede: "自分の量子アプリを実行したり、公開Qappを探したりできます。",
    mine: "自分のQapp",
    public: "公開Qappを探す",
    createRun: "Runで作る",
    createStudio: "Studioから作る",
    search: "Qappを検索",
    searchPlaceholder: "タイトル、説明、フレームワークで検索",
    loading: "Qappを読み込んでいます…",
    loadFailed: "Qappを読み込めませんでした。",
    mineEmpty: "まだQappを作成していません。",
    publicEmpty: "公開されているQappはまだありません。",
    noMatch: "検索条件に一致するQappはありません。",
    retry: "再試行",
    clear: "検索をクリア",
    count: (shown: number, total: number) => `${total}件中${shown}件のQapp`,
    capped: (limit: number) => `最新の${limit}件を表示しています。それより古いQappも残っていますが、検索の対象にはまだなっていません。`,
    private: "非公開",
    published: "公開中",
    updated: "更新",
    publishedOn: "公開",
    manage: "ワークスペースを開く",
    open: "Qappを開く",
    version: (value: number) => `バージョン ${value}`,
    qubits: (value: number) => `${value}量子ビット`,
  },
} as const;

export function QappGallery({ view, locale = "en" }: { view: QappGalleryView; locale?: PublicLocale }) {
  const copy = COPY[locale];
  const [items, setItems] = useState<Array<Qapp | PublicQappSummary>>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    // `LIST_LIMIT` below assumes one full page; the public route's own default
    // page size is smaller (proposal 6's real paging lives at `/q`), so this
    // in-app tab asks for the same size it always showed rather than
    // inheriting the new default.
    fetch(view === "mine" ? "/api/qapps" : `/api/qapps/public?limit=${LIST_LIMIT}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as unknown;
        if (!response.ok) throw new Error(refusalSentence(payload) ?? copy.loadFailed);
        // `/api/qapps` is a bare array; `/api/qapps/public` is a real
        // server-paged { items, next_cursor } response (proposal 6). This tab
        // only ever shows the first page of the public listing — real paging
        // and search for the public gallery live at `/q`.
        // readPublicQappPage also accepts the bare array the API returned
        // before proposal 6, for the minutes when the API and website deploys
        // are out of step.
        const items = view === "mine" ? payload : readPublicQappPage(payload)?.items;
        if (!Array.isArray(items)) throw new Error(refusalSentence(payload) ?? copy.loadFailed);
        return items as Array<Qapp | PublicQappSummary>;
      })
      .then((payload) => {
        if (active) setItems(payload);
      })
      .catch((cause) => {
        if (active) {
          setItems([]);
          setError(cause instanceof Error ? cause.message : copy.loadFailed);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [copy.loadFailed, view, reload]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    if (!needle) return items;
    return items.filter((item) => {
      const framework = "framework" in item ? item.framework : "";
      return `${item.title} ${item.description} ${framework}`.toLocaleLowerCase(locale).includes(needle);
    });
  }, [items, locale, query]);

  return (
    <section className="mj-qapps-page">
      <div className="mj-qapps-scroll">
        <header className="mj-qapps-hero">
          <div>
            <div className="mj-qapps-title-row">
              <QappsIcon size={22} />
              <h1>{copy.title}</h1>
            </div>
            <p>{copy.lede}</p>
          </div>
          <div className="mj-qapps-create-actions">
            <Link className="mj-secondary-button" href="/studio?new=1">{copy.createStudio}</Link>
            <Link className="mj-primary-button" href="/run?mode=qapp" data-tour="qapps-create-run">{copy.createRun}</Link>
          </div>
        </header>

        <nav className="mj-qapps-tabs" aria-label={copy.title}>
          <Link href="/qapps?view=mine" aria-current={view === "mine" ? "page" : undefined}>{copy.mine}</Link>
          <Link href="/qapps?view=public" aria-current={view === "public" ? "page" : undefined}>{copy.public}</Link>
        </nav>

        <div className="mj-library-toolbar">
          <label className="mj-library-search">
            <SearchIcon size={16} />
            <span className="sr-only">{copy.search}</span>
            <input name="qapp-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} />
          </label>
          {query ? <button className="mj-secondary-button" type="button" onClick={() => setQuery("")}>{copy.clear}</button> : null}
        </div>

        {!loading && !error && items.length > 0 ? (
          <p className="mj-library-meta">
            <span>{copy.count(visible.length, items.length)}</span>
            {/* Both listings stop at LIST_LIMIT rows with no cursor, so a full page
                means "at least this many", and the count above would otherwise
                read as the total. */}
            {items.length >= LIST_LIMIT ? <span role="note">{copy.capped(LIST_LIMIT)}</span> : null}
          </p>
        ) : null}

        {loading ? <QappGalleryNotice role="status" text={copy.loading} /> : null}
        {error ? <QappGalleryNotice role="alert" text={error} action={<button className="mj-secondary-button" type="button" onClick={() => setReload((value) => value + 1)}>{copy.retry}</button>} /> : null}
        {!loading && !error && visible.length === 0 ? (
          <QappGalleryNotice text={items.length ? copy.noMatch : view === "mine" ? copy.mineEmpty : copy.publicEmpty} />
        ) : null}

        {!loading && !error && visible.length > 0 ? (
          <div className="mj-qapps-grid">
            {view === "mine"
              ? (visible as Qapp[]).map((qapp) => <OwnedQappCard key={qapp.id} qapp={qapp} locale={locale} />)
              : (visible as PublicQappSummary[]).map((qapp) => <PublicQappCard key={qapp.slug} qapp={qapp} locale={locale} />)}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function OwnedQappCard({ qapp, locale }: { qapp: Qapp; locale: PublicLocale }) {
  const copy = COPY[locale];
  const isPublic = qapp.visibility === "public";
  return (
    <article className="mj-qapp-card">
      <div className="mj-qapp-card-meta">
        <span data-public={isPublic ? "true" : undefined}>{isPublic ? copy.published : copy.private}</span>
        <time dateTime={qapp.updated_at}>{copy.updated} {formatDate(qapp.updated_at, locale)}</time>
      </div>
      <div className="mj-qapp-card-copy">
        <h2><Link href={`/qapps/${encodeURIComponent(qapp.id)}`}>{qapp.title}</Link></h2>
        <p>{qapp.description}</p>
      </div>
      <div className="mj-qapp-card-actions">
        {isPublic ? <Link href={`/q/${encodeURIComponent(qapp.slug)}`}>{copy.open}</Link> : null}
        <Link className="mj-secondary-button" href={`/qapps/${encodeURIComponent(qapp.id)}`}>{copy.manage}</Link>
      </div>
    </article>
  );
}

function PublicQappCard({ qapp, locale }: { qapp: PublicQappSummary; locale: PublicLocale }) {
  const copy = COPY[locale];
  return (
    <article className="mj-qapp-card">
      <div className="mj-qapp-card-meta">
        <span data-public="true">{qapp.framework}</span>
        <time dateTime={qapp.published_at}>{copy.publishedOn} {formatDate(qapp.published_at, locale)}</time>
      </div>
      <div className="mj-qapp-card-copy">
        <h2>{qapp.title}</h2>
        <p>{qapp.description}</p>
      </div>
      <div className="mj-qapp-card-detail">
        <span>{copy.qubits(qapp.qubits_estimate)}</span>
        <span>{copy.version(qapp.version)}</span>
      </div>
      <div className="mj-qapp-card-actions">
        <Link className="mj-primary-button" href={`/q/${encodeURIComponent(qapp.slug)}`}>{copy.open}</Link>
      </div>
    </article>
  );
}

function QappGalleryNotice({ text, role, action }: { text: string; role?: "alert" | "status"; action?: import("react").ReactNode }) {
  return <div className="mj-library-empty leona-workspace-state" role={role}><strong>{text}</strong>{action}</div>;
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
