import type { PublicLocale } from "./public-locale";

/**
 * Every fixed sentence the public certificate page (`/certificates/[id]`)
 * shows a reader, in both languages. Unlike the Qapp gallery's `qapp-copy.ts`
 * this page is ALWAYS anonymous — there is no signed-in variant — so there is
 * one flat object per locale rather than a `public`/`workspace` split.
 */
export const CERTIFICATE_COPY: Record<
  PublicLocale,
  {
    brand: string;
    kicker: string;
    issuedOn: (date: string) => string;
    issuedBy: (issuer: string) => string;
    revokedBadge: string;
    revokedBody: string;
    verificationNote: string;
    downloadAssertion: string;
    notFoundTitle: string;
    notFoundBody: string;
    loadFailed: string;
    tryAgain: string;
  }
> = {
  en: {
    brand: "Leona Quantum",
    kicker: "Certificate of completion",
    issuedOn: (date) => `Issued ${date}`,
    issuedBy: (issuer) => `by ${issuer}`,
    revokedBadge: "Revoked",
    revokedBody: "This certificate has been revoked and is no longer valid.",
    verificationNote: "This page is the certificate's public, hosted record (Open Badges 2.0).",
    downloadAssertion: "Download Open Badges assertion (JSON)",
    notFoundTitle: "Certificate not found",
    notFoundBody: "This certificate does not exist, or the link is wrong.",
    loadFailed: "This certificate could not be loaded.",
    tryAgain: "Try again",
  },
  ja: {
    brand: "Leona Quantum",
    kicker: "修了証明書",
    issuedOn: (date) => `発行日：${date}`,
    issuedBy: (issuer) => `発行：${issuer}`,
    revokedBadge: "取り消し済み",
    revokedBody: "この証明書は取り消されており、現在は無効です。",
    verificationNote: "このページは証明書の公開記録です（Open Badges 2.0）。",
    downloadAssertion: "Open Badgesデータをダウンロード（JSON）",
    notFoundTitle: "証明書が見つかりません",
    notFoundBody: "この証明書は存在しないか、リンクが正しくありません。",
    loadFailed: "この証明書を読み込めませんでした。",
    tryAgain: "再試行",
  },
};
