"use client";

import type { components } from "@majorana/contracts-gen";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { QappsIcon, SearchIcon } from "../../../components/icons";
import { refusalSentence } from "../../../lib/api-error";
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

const COPY = {
  en: {
    eyebrow: "Quantum applications",
    title: "Qapps",
    lede: "Open the applications you created, or explore Qapps published by people around the world.",
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
    count: (shown: number, total: number) => `${shown} of ${total} Qapps`,
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
    lede: "自分が作った量子アプリを開いたり、世界中で公開されているQappを探したりできます。",
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
    count: (shown: number, total: number) => `${total}件中${shown}件のQapp`,
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

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetch(view === "mine" ? "/api/qapps" : "/api/qapps/public", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as unknown;
        if (!response.ok || !Array.isArray(payload)) {
          throw new Error(refusalSentence(payload) ?? copy.loadFailed);
        }
        return payload as Array<Qapp | PublicQappSummary>;
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
    };
  }, [copy.loadFailed, view]);

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
            <p className="mj-section-label">{copy.eyebrow}</p>
            <div className="mj-qapps-title-row">
              <QappsIcon size={22} />
              <h1>{copy.title}</h1>
            </div>
            <p>{copy.lede}</p>
          </div>
          <div className="mj-qapps-create-actions">
            <Link className="mj-secondary-button" href="/studio?new=1">{copy.createStudio}</Link>
            <Link className="mj-primary-button" href="/run?mode=qapp">{copy.createRun}</Link>
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
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} />
          </label>
        </div>

        {!loading && !error && items.length > 0 ? (
          <p className="mj-library-meta"><span>{copy.count(visible.length, items.length)}</span></p>
        ) : null}

        {loading ? <QappGalleryNotice role="status" text={copy.loading} /> : null}
        {error ? <QappGalleryNotice role="alert" text={error} /> : null}
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
        <h2>{qapp.title}</h2>
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

function QappGalleryNotice({ text, role }: { text: string; role?: "alert" | "status" }) {
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
