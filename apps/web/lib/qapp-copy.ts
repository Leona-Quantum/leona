import type { PublicLocale } from "./public-locale";

/**
 * Every fixed sentence the Qapp surfaces show a reader, in both languages.
 *
 * The gallery was bilingual from the start; the private workspace, the runtime
 * status line and the public `/q/<slug>` chrome were English only, so a Japanese
 * reader met a bilingual list and then an English app page behind it. The
 * generated app's own copy is whatever the creator asked for and is not touched
 * here, and the worker's range-smoke `detail` sentences arrive in English and
 * are passed through as they are.
 *
 * In `lib/` so the required `node --test` job checks the two locales keep the
 * same keys (`qapp-copy.test.ts`); a key added to one language and not the
 * other would otherwise render as `undefined` in the one nobody tested.
 */
export const QAPP_COPY = {
  en: {
    runtime: {
      frameTitle: "Qapp",
      busy: "Another execution is already running.",
      signInToRun: "Sign in to run this Qapp.",
      signInToExecute: "Sign in to execute this Qapp.",
      submitting: "Submitting execution…",
      submitFailed: "Execution could not be submitted.",
      complete: "Execution complete.",
      paused: "Automatic updates paused. The execution may still be running.",
      queued: "Queued. Waiting for execution to start.",
      stillRunning: "Still running. Results will appear here when ready.",
      running: "Running. Results will appear here.",
      interrupted: "Connection interrupted. The execution may still be running.",
      chooseInputs: "Choose inputs in the Qapp to run it.",
      retryStatus: "Retry status",
      signInLink: "Sign in to run",
    },
    workspace: {
      loadFailed: "Qapp could not be loaded.",
      loading: "Loading Qapp…",
      tryAgain: "Try again",
      all: "All Qapps",
      kicker: (framework: string) => `Qapp · ${framework} · private workspace`,
      openPublic: "Open public page ↗",
      saving: "Saving…",
      makePrivate: "Make private",
      publish: "Publish Qapp",
      visibilityFailed: "Visibility could not be changed.",
      published: "Qapp published. Anyone with its public link can view it.",
      madePrivate: "Qapp is private.",
      smokeWarnHeading: "At its largest inputs",
      smokeOkHeading: "Checked at both ends",
    },
    public: {
      brand: "Leona Quantum",
      badge: "Public Qapp",
      buildYourOwn: "Build your own",
      kicker: (framework: string, qubits: number) => `Qapp · ${framework} · up to ${qubits} qubits`,
    },
  },
  ja: {
    runtime: {
      frameTitle: "Qapp",
      busy: "別の実行がまだ進行中です。",
      signInToRun: "このQappを実行するにはサインインしてください。",
      signInToExecute: "このQappを実行するにはサインインが必要です。",
      submitting: "実行を送信しています…",
      submitFailed: "実行を送信できませんでした。",
      complete: "実行が完了しました。",
      paused: "自動更新を一時停止しました。実行はまだ続いている可能性があります。",
      queued: "待機中です。実行の開始を待っています。",
      stillRunning: "まだ実行中です。準備ができ次第、結果がここに表示されます。",
      running: "実行中です。結果はここに表示されます。",
      interrupted: "接続が中断されました。実行はまだ続いている可能性があります。",
      chooseInputs: "Qappで入力を選んで実行してください。",
      retryStatus: "状態を再取得",
      signInLink: "サインインして実行",
    },
    workspace: {
      loadFailed: "Qappを読み込めませんでした。",
      loading: "Qappを読み込んでいます…",
      tryAgain: "再試行",
      all: "すべてのQapp",
      kicker: (framework: string) => `Qapp · ${framework} · 非公開ワークスペース`,
      openPublic: "公開ページを開く ↗",
      saving: "保存中…",
      makePrivate: "非公開にする",
      publish: "Qappを公開する",
      visibilityFailed: "公開設定を変更できませんでした。",
      published: "Qappを公開しました。公開リンクを知っている人なら誰でも閲覧できます。",
      madePrivate: "Qappは非公開です。",
      smokeWarnHeading: "最大の入力では",
      smokeOkHeading: "両端で確認済み",
    },
    public: {
      brand: "Leona Quantum",
      badge: "公開Qapp",
      buildYourOwn: "自分のQappを作る",
      kicker: (framework: string, qubits: number) => `Qapp · ${framework} · 最大${qubits}量子ビット`,
    },
  },
} as const satisfies Record<PublicLocale, unknown>;

export function qappCopy(locale: PublicLocale | undefined) {
  return QAPP_COPY[locale ?? "en"];
}
