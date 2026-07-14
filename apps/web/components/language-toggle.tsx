"use client";

import { useRouter } from "next/navigation";
import { PUBLIC_LOCALE_COOKIE, type PublicLocale } from "../lib/public-locale";

export function LanguageToggle({ locale }: { locale: PublicLocale }) {
  const router = useRouter();

  function selectLocale(nextLocale: PublicLocale) {
    document.cookie = `${PUBLIC_LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  }

  return (
    <div className="mj-language-toggle" role="group" aria-label="Language">
      {(["en", "ja"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={locale === option}
          onClick={() => selectLocale(option)}
        >
          {option === "en" ? "EN" : "日本語"}
        </button>
      ))}
    </div>
  );
}
