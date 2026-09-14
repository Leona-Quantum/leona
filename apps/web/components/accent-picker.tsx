"use client";

import { useSyncExternalStore } from "react";
import { ACCENTS, applyAccent, readDocumentAccent, subscribeTheme, type Accent } from "../lib/theme";
import type { PublicLocale } from "../lib/public-locale";

/**
 * The workspace's one colour, chosen (owner, 2026-09-12): moss, the default,
 * or plum. Two swatches in a radio group; the choice is applied at once, kept
 * in localStorage, and re-read by ThemeController on every navigation. The
 * public site keeps moss whatever is chosen here — see `resolveAccent`.
 */
export function AccentPicker({ locale = "en" }: { locale?: PublicLocale }) {
  const accent = useSyncExternalStore(subscribeTheme, readDocumentAccent, () => null);
  const copy = locale === "ja"
    ? { group: "ワークスペースの色", moss: "モス", plum: "プラム", use: (name: string) => `${name}を使う` }
    : { group: "Workspace colour", moss: "Moss", plum: "Plum", use: (name: string) => `Use ${name.toLowerCase()}` };
  return (
    <div className="mj-accent-picker" role="radiogroup" aria-label={copy.group}>
      {ACCENTS.map((option: Accent) => {
        const name = copy[option];
        return (
          <button
            key={option}
            type="button"
            role="radio"
            data-accent-option={option}
            aria-checked={accent === null ? undefined : accent === option}
            aria-label={copy.use(name)}
            title={copy.use(name)}
            onClick={() => applyAccent(option, true)}
          >
            <i aria-hidden="true" />
            <span>{name}</span>
          </button>
        );
      })}
    </div>
  );
}
