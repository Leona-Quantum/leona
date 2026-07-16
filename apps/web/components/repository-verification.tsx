import {
  VERIFICATION_METHODS,
  VERIFICATION_TIERS,
  getVerificationMethod,
  getVerificationTierInfo,
  strongestTier,
  type VerificationMethodId,
} from "../lib/public-repository";
import type { PublicLocale } from "../lib/public-locale";

/**
 * Verification classification UI: tier badge, method chips, and the legend.
 * Tones ride the semantic tokens through data-tone attributes; every tier keeps
 * its glyph so the classification never relies on hue alone (the light palette
 * is monochrome by owner directive).
 */

export function VerificationTierBadge({
  methods,
  locale,
}: {
  methods: readonly VerificationMethodId[];
  locale: PublicLocale;
}) {
  const info = getVerificationTierInfo(strongestTier(methods));
  return (
    <span className="mj-vtier" data-tone={info.tone} title={locale === "ja" ? info.summaryJa : info.summary}>
      <span aria-hidden="true">{info.glyph}</span>
      {locale === "ja" ? info.nameJa : info.name}
    </span>
  );
}

export function VerificationMethodChips({
  methods,
  locale,
}: {
  methods: readonly VerificationMethodId[];
  locale: PublicLocale;
}) {
  return (
    <ul className="mj-vmethods" aria-label={locale === "ja" ? "検証方法" : "Verification methods"}>
      {methods.map((id) => {
        const method = getVerificationMethod(id);
        const tier = getVerificationTierInfo(method.tier);
        return (
          <li key={id} data-tone={tier.tone} title={locale === "ja" ? method.descriptionJa : method.description}>
            <span aria-hidden="true">{tier.glyph}</span>
            {locale === "ja" ? method.labelJa : method.label}
          </li>
        );
      })}
    </ul>
  );
}

export function VerificationLegend({ locale }: { locale: PublicLocale }) {
  const isJapanese = locale === "ja";
  return (
    <details className="mj-vlegend">
      <summary>
        <span aria-hidden="true">◈</span>
        {isJapanese ? "検証分類の凡例" : "Verification legend"}
      </summary>
      <div className="mj-vlegend-body">
        <p className="mj-vlegend-note">
        {isJapanese
          ? "各レコードは、どのように検証されたかで分類されます。バッジは最も強い根拠の階層を示し、チップは適用された個々の方法を示します。"
          : "Every record is classified by how it was verified. The badge shows the strongest tier of evidence; the chips list each method that applies."}
        </p>
        {VERIFICATION_TIERS.map((tier) => (
          <section className="mj-vlegend-tier" data-tone={tier.tone} key={tier.tier}>
            <header>
              <span className="mj-vtier" data-tone={tier.tone}>
                <span aria-hidden="true">{tier.glyph}</span>
                {isJapanese ? tier.nameJa : tier.name}
              </span>
              <p>{isJapanese ? tier.summaryJa : tier.summary}</p>
            </header>
            <dl>
              {VERIFICATION_METHODS.filter((method) => method.tier === tier.tier).map((method) => (
                <div key={method.id}>
                  <dt>{isJapanese ? method.labelJa : method.label}</dt>
                  <dd>{isJapanese ? method.descriptionJa : method.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </details>
  );
}
