import type { PublicLocale } from "./public-locale";

/**
 * Every fixed sentence the notebook share feature shows a reader, in both
 * languages: the creator's share dialog (`components/notebook-share-dialog.tsx`)
 * and the anonymous public view (`app/shared/notebooks/shared-notebook-view.tsx`).
 *
 * In `lib/` so the required `node --test` job checks the two locales keep the
 * same keys (`notebook-share-copy.test.ts`) — the same convention
 * `qapp-copy.ts` uses, for the same reason: a key added to one language and not
 * the other renders as `undefined` in the one nobody tested.
 */
export const NOTEBOOK_SHARE_COPY = {
  en: {
    dialog: {
      title: "Share this notebook",
      description:
        "Anyone with this link can open a read-only copy. Answers, hidden checks and worked solutions are never shown.",
      createButton: "Create link",
      creating: "Creating…",
      createFailed: "Could not create a share link. Try again in a moment.",
      limitReached:
        "This notebook already has the most share links it can have at once. Revoke one to create another.",
      linkCreatedTitle: "Link created",
      linkCreatedBody: "Copy it now — you won't be able to see it again.",
      copy: "Copy link",
      copied: "Copied",
      noLinks: "No share links yet.",
      tail: (tail: string) => `Ends in ${tail}`,
      createdAt: (when: string) => `Created ${when}`,
      lastViewed: (when: string) => `Last opened ${when}`,
      neverViewed: "Not opened yet",
      expiresAt: (when: string) => `Expires ${when}`,
      neverExpires: "Doesn't expire",
      revoked: "Revoked",
      revoke: "Revoke",
      revoking: "Revoking…",
      revokeFailed: "Could not revoke this link. Try again.",
      expiryLabel: "Expiry",
      expiryNever: "Never",
      expiry7: "7 days",
      expiry30: "30 days",
      expiry90: "90 days",
      close: "Close",
    },
    publicView: {
      badge: "Shared notebook",
      loading: "Loading the shared notebook…",
      notFound:
        "This link isn't working anymore. It may have been revoked, or it may have expired.",
      notReady:
        "This notebook isn't ready yet. Ask whoever shared it with you to try sharing it again in a moment.",
      noToken: "This page needs a share link to open. Ask whoever shared it with you for the full link.",
      viewOnlyNotice: "You're viewing a read-only copy. Answers and hidden checks are not shown here.",
      signInCta: "Sign in to make your own copy and try the exercises yourself.",
      signIn: "Sign in",
      brand: "Leona Quantum",
    },
  },
  ja: {
    dialog: {
      title: "このノートブックを共有",
      description:
        "このリンクを持つ人は誰でも読み取り専用のコピーを開けます。答え、非表示のチェック、完成した解答は表示されません。",
      createButton: "リンクを作成",
      creating: "作成中…",
      createFailed: "共有リンクを作成できませんでした。しばらくしてからもう一度お試しください。",
      limitReached: "このノートブックはすでに作成できる共有リンクの上限に達しています。1つを取り消してから新しく作成してください。",
      linkCreatedTitle: "リンクを作成しました",
      linkCreatedBody: "今すぐコピーしてください。もう一度表示することはできません。",
      copy: "リンクをコピー",
      copied: "コピーしました",
      noLinks: "共有リンクはまだありません。",
      tail: (tail: string) => `末尾: ${tail}`,
      createdAt: (when: string) => `作成: ${when}`,
      lastViewed: (when: string) => `最終アクセス: ${when}`,
      neverViewed: "まだ開かれていません",
      expiresAt: (when: string) => `期限: ${when}`,
      neverExpires: "期限なし",
      revoked: "取り消し済み",
      revoke: "取り消す",
      revoking: "取り消し中…",
      revokeFailed: "このリンクを取り消せませんでした。もう一度お試しください。",
      expiryLabel: "有効期限",
      expiryNever: "なし",
      expiry7: "7日間",
      expiry30: "30日間",
      expiry90: "90日間",
      close: "閉じる",
    },
    publicView: {
      badge: "共有されたノートブック",
      loading: "共有されたノートブックを読み込んでいます…",
      notFound: "このリンクは現在使用できません。取り消されたか、期限が切れている可能性があります。",
      notReady: "このノートブックはまだ準備中です。共有した人にもう少し待ってから再度共有してもらってください。",
      noToken: "このページを開くには共有リンクが必要です。共有した人に完全なリンクをもらってください。",
      viewOnlyNotice: "これは読み取り専用のコピーです。答えや非表示のチェックはここには表示されません。",
      signInCta: "サインインすると自分用のコピーを作成し、演習を実際に試すことができます。",
      signIn: "サインイン",
      brand: "Leona Quantum",
    },
  },
} satisfies Record<PublicLocale, unknown>;

export function notebookShareCopy(locale: PublicLocale) {
  return NOTEBOOK_SHARE_COPY[locale];
}
