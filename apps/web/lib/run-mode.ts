export const COMPOSER_MODES = ["auto", "execute", "qapp", "ideate", "explain"] as const;

export type ComposerMode = (typeof COMPOSER_MODES)[number];

export function isComposerMode(value: string): value is ComposerMode {
  return COMPOSER_MODES.includes(value as ComposerMode);
}
