import type { PublicLocale } from "../../lib/public-locale";

/* Copy for the exploration surface. Japanese is written to read as Japanese,
 * not as a translation of the English: the emphasis lands on a different word
 * ("実際に" rather than "actually"), and sentences are split where Japanese
 * wants a break rather than mirroring the English clause order. */
export const LAB_COPY: Record<PublicLocale, {
  nav: { atlas: string; workspace: string; pricing: string; shipped: string };
  hero: {
    eyebrow: string;
    titleLead: string;
    titleEmphasis: string;
    titleTail: string;
    lede: string;
    primary: string;
    secondary: string;
  };
  panel: { file: string; qubits: string; shots: string; sample: string };
  statement: { lead: string; tail: string };
  pipeline: { heading: string; stages: Array<{ title: string; body: string }> };
  evidence: {
    eyebrow: string;
    heading: string;
    lead: { title: string; body: string };
    metric: { value: string; title: string; body: string };
    backend: { title: string; body: string };
  };
  cta: { heading: string; primary: string; secondary: string };
  foot: { note: string };
}> = {
  en: {
    nav: { atlas: "Atlas", workspace: "Workspace", pricing: "Pricing", shipped: "Shipped design" },
    hero: {
      eyebrow: "Evidence layer for quantum work",
      titleLead: "Prove what your circuit ",
      titleEmphasis: "actually",
      titleTail: " did.",
      lede: "Run circuits on simulators and real hardware, and keep an inspectable record of every result.",
      primary: "Browse the Atlas",
      secondary: "Open the workspace",
    },
    panel: { file: "bell-pair.qasm", qubits: "2 qubits", shots: "4096 shots", sample: "sample run" },
    statement: { lead: "A result you cannot inspect is ", tail: "a claim, not a measurement." },
    pipeline: {
      heading: "One circuit, from first idea to a record someone else can rerun.",
      stages: [
        { title: "Compose", body: "Describe the circuit in plain language or write the gates yourself. The agent keeps both in sync." },
        { title: "Run", body: "Send the same circuit to a local simulator and to real hardware without rewriting it for each backend." },
        { title: "Verify", body: "Compare the run against a classical baseline and against the ideal state, with the gap stated in numbers." },
        { title: "Publish", body: "Keep it private in Studio or attach it to the public Atlas so others can rerun exactly what you ran." },
      ],
    },
    evidence: {
      eyebrow: "What gets recorded",
      heading: "Every run keeps the state it produced.",
      lead: {
        title: "The state vector, not just the counts",
        body: "Amplitudes are kept alongside the shot histogram, so a run can be checked against the ideal state rather than only against itself.",
      },
      metric: {
        value: "16",
        title: "Qubits in the browser",
        body: "Simulate up to sixteen qubits locally before spending a single shot of hardware time.",
      },
      backend: {
        title: "The backend it actually ran on",
        body: "Device, calibration window, transpiled depth, and shot count travel with the result, so a rerun a year later is comparable.",
      },
    },
    cta: {
      heading: "Start with a circuit someone already verified.",
      primary: "Browse the Atlas",
      secondary: "Talk to us",
    },
    foot: { note: "Exploration surface. Not the shipped design." },
  },
  ja: {
    nav: { atlas: "Atlas", workspace: "ワークスペース", pricing: "料金", shipped: "公開中のデザイン" },
    hero: {
      eyebrow: "量子回路の実行と検証",
      titleLead: "その回路が",
      titleEmphasis: "実際に",
      titleTail: "何をしたか、確かめられる。",
      lede: "シミュレータでも実機でも、同じ回路のまま動かせます。結果は後から検証できる形で残ります。",
      primary: "Atlasを見る",
      secondary: "ワークスペースを開く",
    },
    panel: { file: "bell-pair.qasm", qubits: "2量子ビット", shots: "4096ショット", sample: "サンプル実行" },
    statement: { lead: "確かめられない結果は、", tail: "測定ではなくただの主張だ。" },
    pipeline: {
      heading: "思いついた回路が、他の人も再現できる記録になるまで。",
      stages: [
        { title: "作成", body: "文章で書いても、ゲートを直接書いても構いません。どちらを直しても、もう片方に反映されます。" },
        { title: "実行", body: "手元のシミュレータにも実機にも、同じ回路のまま送れます。書き換えは要りません。" },
        { title: "検証", body: "古典計算の結果と理想状態の両方に照らして、どれだけずれたかを数値で出します。" },
        { title: "公開", body: "Studioに置いたままでも、Atlasに公開して誰でも再実行できるようにしても構いません。" },
      ],
    },
    evidence: {
      eyebrow: "何が残るか",
      heading: "どの実行も、出てきた状態ごと残ります。",
      lead: {
        title: "回数だけでなく、状態ベクトルまで",
        body: "ショット数の分布と一緒に振幅も保存します。だから、実行結果を理想状態と直接つき合わせられます。",
      },
      metric: {
        value: "16",
        title: "ブラウザで動く量子ビット",
        body: "実機の時間を使う前に、手元で16量子ビットまで試せます。",
      },
      backend: {
        title: "どの実機で動いたか",
        body: "装置名、較正の時刻、変換後の回路の深さ、ショット数まで結果と一緒に残ります。1年後に走らせても比べられます。",
      },
    },
    cta: {
      heading: "誰かが確かめた回路から始める。",
      primary: "Atlasを見る",
      secondary: "お問い合わせ",
    },
    foot: { note: "デザイン検討用の画面です。公開中のデザインではありません。" },
  },
};
