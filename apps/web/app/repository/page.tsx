import type { Metadata } from "next";
import { CONTACT_MAILTO, PublicSite } from "../../components/public-site";
import {
  PUBLIC_REPOSITORY_ENTRIES,
  PUBLIC_REPOSITORY_GUIDANCE,
} from "../../lib/public-repository";
import { getPublicLocale } from "../../lib/public-locale-server";
import { RepositoryBrowser } from "./repository-browser";

export const metadata: Metadata = {
  title: "Repository",
  description: "Browse public Majorana reference artifacts with verification, export, and provenance context.",
};

export default async function RepositoryPage() {
  const locale = await getPublicLocale();
  const isJapanese = locale === "ja";
  return (
    <PublicSite activePath="/repository" className="mj-repository-site" locale={locale} showLanguageToggle>
      <section className="mj-public-page-hero">
        <p className="mj-public-overline">{isJapanese ? "公開研究データベース" : "Public research database"}</p>
        <h1>{isJapanese ? "再利用する前に、根拠を確認できる。" : "Evidence you can inspect before you reuse it."}</h1>
        <p>
          {isJapanese
            ? "回路とアルゴリズムをカテゴリ、系統、フレームワーク、検証、エクスポート、出典から探せます。各エントリは限界を隠しません。"
            : "Browse reference circuits and algorithms by category, family, framework, verification, export classification, and provenance. Every entry makes its limits visible."}
        </p>
        <div className="mj-public-actions">
          <a className="mj-primary-button" href="#repository-heading">{isJapanese ? "データベースを見る" : "Browse the database"}</a>
          <a className="mj-secondary-button" href={CONTACT_MAILTO}>{isJapanese ? "出典を提案する" : "Suggest a source"}</a>
        </div>
      </section>

      <section className="mj-repository-section" aria-labelledby="repository-heading">
        <div className="mj-repository-section-heading">
          <div>
            <p className="mj-section-label">{isJapanese ? "リポジトリ / 参照セット" : "Repository / reference set"}</p>
            <h2 id="repository-heading">{isJapanese ? "小さく、読みやすいコーパスから始める。" : "Start with a small, legible corpus."}</h2>
          </div>
          <p>{isJapanese
            ? "公開エントリは非公開Libraryとは分離されています。保存と公開は、サービス拡張時に明示的なアカウント操作として追加します。"
            : "Public entries are separate from private Libraries. Saving and publishing will become explicit account actions as the repository service expands."}</p>
        </div>
        <RepositoryBrowser entries={PUBLIC_REPOSITORY_ENTRIES} locale={locale} />
      </section>

      <section className="mj-repository-provenance" aria-labelledby="provenance-heading">
        <div>
          <p className="mj-section-label">{isJapanese ? "エントリの読み方" : "How to read an entry"}</p>
          <h2 id="provenance-heading">{isJapanese ? "検証には境界がある。" : "Verification is a claim with a boundary."}</h2>
        </div>
        <div className="mj-repository-provenance-list">
          <p><strong>{isJapanese ? "検証" : "Verification"}</strong> {isJapanese ? "どの検査と指標・契約が通ったかを示します。" : "tells you which checks passed and what metric or contract was used."}</p>
          <p><strong>{isJapanese ? "エクスポート" : "Export"}</strong> {isJapanese ? "他のフレームワークやOpenQASMの経路が、直接利用可能か、変換扱いかを示します。" : "tells you whether another framework or OpenQASM path is available, lossless, caveated, or code-only."}</p>
          <p><strong>{isJapanese ? "出典" : "Provenance"}</strong> {isJapanese ? "エントリの由来を示し、公開参照資料と非公開ワークスペースを分離します。" : "tells you where the entry came from and keeps public reference material distinct from private workspace artifacts."}</p>
        </div>
      </section>

      <section className="mj-repository-guidance" aria-labelledby="repository-guidance-heading">
        <div>
          <p className="mj-section-label">{isJapanese ? "設計の参考" : "Catalog design reference"}</p>
          <h2 id="repository-guidance-heading">{isJapanese ? PUBLIC_REPOSITORY_GUIDANCE.titleJa : PUBLIC_REPOSITORY_GUIDANCE.title}</h2>
        </div>
        <div>
          <p>{isJapanese ? PUBLIC_REPOSITORY_GUIDANCE.descriptionJa : PUBLIC_REPOSITORY_GUIDANCE.description}</p>
          <a className="mj-text-link" href={PUBLIC_REPOSITORY_GUIDANCE.sourceUrl} target="_blank" rel="noreferrer">
            {PUBLIC_REPOSITORY_GUIDANCE.sourceLabel} ↗
          </a>
        </div>
      </section>
    </PublicSite>
  );
}
