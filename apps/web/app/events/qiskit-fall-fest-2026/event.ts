import type { PublicLocale } from "../../../lib/public-locale";
import { eventText } from "./copy";

/** Owner-supplied event facts. Unconfirmed operational details stay explicit. */
export const event = {
  title: "Qiskit Fall Fest 2026 @ Keio",
  path: "/events/qiskit-fall-fest-2026",
  registrationUrl: "https://forms.gle/Fir3TT1umiuWGnGu9" as string | null,
  contactEmail: "rei.watanabe@keio.jp",
  venueDetails: null as string | null,
  venueMapUrl: null as string | null,
  organizers: ["慶應義塾大学", "IBM Quantum"],
  supporters: ["Leona Quantum", "Quanmatic", "Blueqat"],
  // Enabled at the owner's explicit request; this flag does not assert test completion.
  registrationEnabled: true,
};

export const days = [
  {
    id: "saturday",
    date: "10.17",
    weekday: "土",
    english: "Saturday",
    description:
      "基礎講義とハンズオンで学び、チームで最初の実験に取り組みます。",
    schedule: [
      {
        period: "午前",
        title: "Quantum／Qiskit 101 — 基礎講義",
        description:
          "受付・環境確認のあと、量子ビット・ゲート・測定の基礎を学び、Qiskitで最初の量子回路を動かします。",
      },
      {
        period: "午前・午後",
        title: "講演・質疑応答",
        description:
          "研究や産業での活用事例を紹介する講演です。講演後には、登壇者に質問できる時間を設けます。",
      },
      {
        period: "午後",
        title: "SQD入門・ハンズオン",
        description:
          "入門講義のあと、原則2人1組でノートブックを使った実習に取り組みます。",
      },
      {
        period: "午後",
        title: "課題の説明・チーム分け",
        description:
          "課題、提出形式、審査基準を確認。4〜5名のチームを組み、役割を分担します。",
      },
      {
        period: "夕方",
        title: "ミニハッカソン — 制作スタート",
        description:
          "課題を選び、基本となるコードを実行します。実験の計画を立て、進んだところや疑問点を整理して翌日に備えます。",
      },
    ],
    speakers: [
      {
        name: "渡邉 毅",
        affiliation: "IBM Quantum",
        title: "講演内容：調整中",
        note: "登壇予定",
      },
      {
        name: "齋藤 善仁",
        affiliation: "Quanmatic",
        title: "量子ビット数制約下における部分グローバー適応探索手法",
        note: "登壇予定 / 仮題",
      },
      {
        name: "湊 雄一郎",
        affiliation: "Blueqat",
        title: "講演内容調整中",
        note: "登壇予定",
      },
    ],
  },
  {
    id: "sunday",
    date: "10.18",
    weekday: "日",
    english: "Sunday",
    description:
      "講演で知識を深め、チームでの実験・実装を進めます。最後に、取り組んだ内容と結果を発表します。",
    schedule: [
      {
        period: "午前",
        title: "講演・質疑応答",
        description:
          "量子計算の研究や応用をテーマにした講演を通して、学びを深めます。",
      },
      {
        period: "午前・午後",
        title: "ミニハッカソン — 実験・実装",
        description:
          "メンターに相談しながら、チームで実験や実装を進めます。条件による結果の違いを比較し、グラフなどにまとめます。",
      },
      {
        period: "午後",
        title: "ノートブックの提出・発表準備",
        description:
          "実行結果と考察をノートブックにまとめて提出します。発表資料はスライド3枚以内で準備します。",
      },
      {
        period: "夕方",
        title: "成果発表",
        description:
          "各チームが3分間で取り組みを発表し、その後2分間の質疑応答を行います。",
      },
      {
        period: "夕方",
        title: "講評・表彰・閉会",
        description:
          "各チームの成果に対する講評と表彰を行い、2日間を振り返ります。閉会後には交流の時間を設ける予定です。",
      },
    ],
    speakers: [
      {
        name: "田中 宗",
        affiliation: "慶應義塾大学教授",
        title: "量子アニーリングについて",
        note: "登壇予定 / 内容調整中",
      },
      {
        name: "小山 尚彦",
        affiliation: "Bio2Q 特任教授",
        title: "量子機械学習について",
        note: "登壇予定 / 内容調整中",
      },
    ],
  },
] as const;

export function getEventDays(locale: PublicLocale) {
  const t = (text: Parameters<typeof eventText>[1]) => eventText(locale, text);
  return days.map((day) => ({
    ...day,
    weekday: t(day.weekday),
    description: t(day.description),
    schedule: day.schedule.map((session) => ({
      period: t(session.period),
      title: t(session.title),
      description: t(session.description),
    })),
    speakers: day.speakers.map((speaker) => ({
      ...speaker,
      affiliation: speaker.affiliation === "慶應義塾大学教授" || speaker.affiliation === "Bio2Q 特任教授"
        ? t(speaker.affiliation)
        : speaker.affiliation,
      title: t(speaker.title),
      note: t(speaker.note),
    })),
  }));
}
