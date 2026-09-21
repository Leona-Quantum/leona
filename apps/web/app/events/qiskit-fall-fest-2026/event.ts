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
  organizerNames: ["鈴木類", "渡邉黎"],
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
        period: "09:30–10:00",
        title: "受付・環境確認",
        description: "IBM Quantum、Qiskit、Google Colab等を確認",
      },
      {
        period: "10:00–10:15",
        title: "開会",
        description: "イベント趣旨と2日間の流れを説明",
      },
      {
        period: "10:15–10:55",
        title: "Quanmatic講演",
        description: "齋藤善仁氏",
      },
      {
        period: "10:55–11:05",
        title: "質疑応答",
        description: "",
      },
      {
        period: "11:05–11:15",
        title: "休憩",
        description: "",
      },
      {
        period: "11:15–11:55",
        title: "Blueqat講演",
        description: "湊雄一郎氏",
      },
      {
        period: "11:55–12:05",
        title: "質疑応答",
        description: "",
      },
      {
        period: "12:05–13:05",
        title: "昼食",
        description: "",
      },
      {
        period: "13:05–14:05",
        title: "Qiskit 101",
        description: "QiskitとIBM Quantumの基本操作",
      },
      {
        period: "14:05–15:15",
        title: "SQDハンズオン",
        description: "",
      },
      {
        period: "15:15–15:25",
        title: "休憩",
        description: "",
      },
      {
        period: "15:25–15:40",
        title: "課題・審査基準説明",
        description: "課題、提出物、評価項目を説明",
      },
      {
        period: "15:40–16:10",
        title: "最適化ハンズオン",
        description: "最適化課題の立て方と実装の進め方を学ぶ",
      },
      {
        period: "16:10–16:25",
        title: "チーム編成",
        description: "テーマ選択、役割分担",
      },
      {
        period: "16:25–17:05",
        title: "ハッカソン準備",
        description: "テーマと実験計画を整理し、開発環境を準備",
      },
      {
        period: "17:05–17:50",
        title: "ハッカソン",
        description: "",
      },
      {
        period: "17:50–18:00",
        title: "チェックポイント",
        description: "進捗と質問事項をフォームで提出",
      },
    ],
    speakers: [
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
        period: "09:30–09:55",
        title: "小山尚彦先生 講演・質疑",
        description: "",
      },
      {
        period: "09:55–10:20",
        title: "IBM Quantum渡邉毅氏講演・質疑",
        description: "",
      },
      {
        period: "10:20–10:45",
        title: "田中宗先生 講演・質疑",
        description: "",
      },
      {
        period: "10:45–11:00",
        title: "休憩",
        description: "",
      },
      {
        period: "11:00–12:30",
        title: "ハッカソン",
        description: "",
      },
      {
        period: "12:30–13:15",
        title: "昼食",
        description: "希望チームは作業継続可能",
      },
      {
        period: "13:15–16:30",
        title: "ハッカソン",
        description: "",
      },
      {
        period: "16:30",
        title: "最終提出締切",
        description: "Notebook、成果物URL、発表用スライドを提出",
      },
      {
        period: "16:30–16:35",
        title: "提出確認",
        description: "リンクの閲覧可否のみ確認",
      },
      {
        period: "16:35–17:15",
        title: "チーム発表・質疑",
        description: "最大10チーム、各4分",
      },
      {
        period: "17:15–17:30",
        title: "審査",
        description: "15分間で採点を集計",
      },
      {
        period: "17:30–18:00",
        title: "表彰・閉会式・記念撮影",
        description: "受賞発表、講評、閉会と記念撮影",
      },
    ],
    speakers: [
      {
        name: "小山 尚彦",
        affiliation: "Bio2Q 特任教授",
        title: "量子機械学習について",
        note: "登壇予定 / 内容調整中",
      },
      {
        name: "渡邉 毅",
        affiliation: "IBM Quantum",
        title: "講演内容：調整中",
        note: "登壇予定",
      },
      {
        name: "田中 宗",
        affiliation: "慶應義塾大学教授",
        title: "量子アニーリングについて",
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
      period: session.period,
      title: t(session.title),
      description: session.description ? t(session.description) : "",
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
