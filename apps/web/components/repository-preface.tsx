import type { PublicLocale } from "../lib/public-locale";

const COPY = {
  en: {
    label: "About the Atlas",
    description: "Explore quantum algorithms and circuits, with resource estimates, verification evidence, and sources.",
    navigation: "Atlas views", map: "Open the Map", papers: "See the papers", claims: "Speedup sources",
  },
  ja: {
    label: "量子アトラスについて",
    description: "量子アルゴリズムと回路を、リソース見積もり、検証結果、出典とともに調べられます。",
    navigation: "アトラスの表示", map: "地図を開く", papers: "論文を見る", claims: "速度向上の出典",
  },
};

/** Keep the Atlas's map, papers and claim sources directly accessible. */
export function AboutTheAtlas({ locale }: { locale: PublicLocale }) {
  const copy = COPY[locale];
  return (
    <section className="mj-atlas-overview" aria-label={copy.label}>
      <p>{copy.description}</p>
      <nav aria-label={copy.navigation} data-tour="atlas-views">
        <a href="/repository/layers">{copy.map}</a>
        <a href="/repository/papers">{copy.papers}</a>
        <a href="/repository/claims">{copy.claims}</a>
      </nav>
    </section>
  );
}
