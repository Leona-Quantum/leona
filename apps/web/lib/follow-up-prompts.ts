import type { PublicLocale } from "./public-locale";

export type FollowUpPromptKind = "answer" | "result" | "failure";

const FOLLOW_UP_MARKER = "<!-- majorana-follow-ups:";

function validPrompts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item, index, all) => Boolean(item) && item.length <= 240 && all.indexOf(item) === index)
    .slice(0, 3);
}

/**
 * How many trailing characters of `text` are an *incomplete* follow-ups marker.
 *
 * This is called on live streaming text, and the worker emits chat deltas in fixed
 * 160-character chunks without flushing the shorter tail until the model has
 * finished. So a chunk boundary landing inside the 25-character marker leaves the
 * browser holding `…<!-- majorana-foll` until the next 160 characters are generated
 * — seconds, not a frame. And it is visible: this app configures react-markdown
 * with no raw-HTML plugin, so an unterminated comment is escaped and rendered as
 * prose rather than dropped.
 *
 * Only a proper prefix is considered; a complete marker is the caller's branch.
 */
function trailingMarkerPrefix(text: string): number {
  const earliest = Math.max(0, text.length - FOLLOW_UP_MARKER.length + 1);
  for (let index = earliest; index < text.length; index += 1) {
    if (FOLLOW_UP_MARKER.startsWith(text.slice(index))) return text.length - index;
  }
  return 0;
}

/** Remove model-only metadata from prose and recover its contextual suggestions. */
export function splitAssistantFollowUps(text: string): {
  answer: string;
  prompts: string[];
} {
  const markerStart = text.lastIndexOf(FOLLOW_UP_MARKER);
  if (markerStart < 0) {
    // A half-written marker is withheld rather than shown. The accepted cost is that
    // prose whose latest chunk ends on `<` loses that character for one chunk; the
    // benefit is that model-only metadata never reaches the reader.
    const partial = trailingMarkerPrefix(text);
    return {
      answer: partial ? text.slice(0, text.length - partial).trimEnd() : text,
      prompts: [],
    };
  }
  const answer = text.slice(0, markerStart).trimEnd();
  const markerEnd = text.indexOf("-->", markerStart + FOLLOW_UP_MARKER.length);
  if (markerEnd < 0) return { answer, prompts: [] };
  const payload = text.slice(markerStart + FOLLOW_UP_MARKER.length, markerEnd).trim();
  try {
    const prompts = validPrompts(JSON.parse(payload));
    return { answer, prompts: prompts.length >= 2 ? prompts : [] };
  } catch {
    return { answer, prompts: [] };
  }
}

export function contextualReviewFollowUps(events: ReadonlyArray<{
  type: string;
  feedback?: { critic?: { suggested_follow_ups?: unknown } };
}>): string[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "verification.semantic_review") continue;
    const prompts = validPrompts(event.feedback?.critic?.suggested_follow_ups);
    if (prompts.length >= 2) return prompts;
  }
  return [];
}

/**
 * Conversation-aware prompts that remain useful across algorithms and frameworks.
 * They deliberately rely on the existing conversation instead of repeating or
 * guessing task-specific inputs, so selecting one continues the user's actual task.
 */
export function followUpPrompts(
  kind: FollowUpPromptKind,
  locale: PublicLocale = "en",
): readonly [string, string, string] {
  if (locale === "ja") {
    if (kind === "failure") {
      return [
        "今回の失敗原因を、影響の大きい順に説明してください。",
        "問題点を修正して、同じ目的でもう一度実行してください。",
        "実行できた部分を古典ベースラインで検証してください。",
      ];
    }
    if (kind === "result") {
      return [
        "この結果を古典ベースラインと比較すると、どの程度良いですか？",
        "精度とリソース効率を改善して、もう一度実行できますか？",
        "実機QPUで試す場合の変更点と注意点を教えてください。",
      ];
    }
    return [
      "この内容を具体的な量子回路として実装してください。",
      "具体例と数式を使って、もう少し詳しく説明してください。",
      "古典的な方法と比較して、利点と制約を説明してください。",
    ];
  }

  if (kind === "failure") {
    return [
      "Explain the causes of this failure in order of impact.",
      "Fix the identified problems and run the same objective again.",
      "Validate the parts that did run against a classical baseline.",
    ];
  }
  if (kind === "result") {
    return [
      "How does this result compare with a classical baseline?",
      "Can you improve the accuracy and resource efficiency, then run it again?",
      "What changes and caveats are needed to run this on a real QPU?",
    ];
  }
  return [
    "Implement this as a concrete quantum circuit.",
    "Explain this in more detail with an example and equations.",
    "Compare this with a classical approach and explain the benefits and limitations.",
  ];
}
