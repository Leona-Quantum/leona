import type { PublicLocale } from "./public-locale";
import type { HowItWorksCopy } from "../components/how-it-works";

export type HomeBenchmarkCopy = {
  label: string;
  title: string;
  body: string;
  /** The two bar colours, named: LeonaQ (our evaluation) and the models the sources report. */
  leonaLabel: string;
  reportedLabel: string;
  /**
   * One row per benchmark (or per framework of a multi-framework benchmark).
   * Exactly one score per row is `featured` — LeonaQ, our own evaluation; the
   * rest are the figures the cited sources report. The numbers are the
   * measurement: change them only against the source named in `badge`.
   */
  rows: Array<{
    name: string;
    detail?: string;
    scores: Array<{ model: string; detail?: string; score: number; badge: string; featured?: boolean }>;
  }>;
  note: string;
  sourcesLabel: string;
  sources: Array<{ label: string; href: string }>;
};

export const LOADING_COPY: Record<PublicLocale, {
  root: string;
  workspace: string;
  dashboard: string;
  repository: string;
  status: string;
}> = {
  en: {
    root: "Loading Leona Quantum",
    workspace: "Loading workspace",
    dashboard: "Loading dashboard",
    repository: "Loading Atlas",
    status: "Loading content",
  },
  ja: {
    root: "Leona Quantumを読み込んでいます",
    workspace: "ワークスペースを読み込んでいます",
    dashboard: "ダッシュボードを読み込んでいます",
    repository: "Atlasを読み込んでいます",
    status: "コンテンツを読み込んでいます",
  },
};

export const HOME_COPY: Record<PublicLocale, {
  hero: { title: string; lede: string };
  /**
   * `prompts` rotate through the cover's box, typed and erased by the shared
   * composer ghost (`lib/composer-ghost.ts`). The same rules as the workspace
   * list apply and are asserted in `lib/landing-prompts.test.ts`: short enough
   * to type out, at least half free of quantum vocabulary, same count in both
   * languages.
   */
  promptDemo: { label: string; attach: string; mode: string; submit: string; retry: string; prompts: string[] };
  /** `demoLabel` names the walkthrough video; `demoDescription` is read to screen readers only. */
  visual: { demoLabel: string; demoDescription: string; demoFallback: string };
  /** The connected diagram of the five surfaces; `stages[i]` pairs with `product.items[i]`. */
  how: HowItWorksCopy;
  /** `items` is shared with the product page's map and list; `label`/`title` name that map there. */
  product: { label: string; title: string; items: Array<{ title: string; body: string; href: string }> };
  principles: { label: string; title: string; items: Array<{ title: string; body: string }> };
  frameworks: { label: string; items: string[] };
  benchmark: HomeBenchmarkCopy;
  cta: { title: string; body: string; primary: string; secondary: string };
}> = {
  en: {
    hero: {
      title: "A self-evolving quantum solution platform.",
      lede: "Generate, run, and reuse quantum circuits.",
    },
    promptDemo: {
      "label": "Describe a quantum task",
      "attach": "Add context in the workspace",
      "mode": "Plan",
      "submit": "Generate",
      "retry": "Try opening the workspace again.",
      "prompts": [
        "Build a Bell state and verify the measured distribution.",
        "Split 6 suppliers into two groups, cutting the fewest links.",
        "Pick 8 stocks for the best return at a fixed risk.",
        "Search 16 records for the one that matches.",
        "Find the ground-state energy of an H₂ molecule.",
        "Schedule 6 jobs on 3 machines to finish soonest."
      ]
    },
    visual: {
      "demoLabel": "See Leona in action",
      "demoDescription": "Follow a circuit from generation and verification to editing in Studio and reuse through the Atlas.",
      "demoFallback": "Open the product demo video"
    },
    how: {
      label: "How it fits together",
      title: "From a question to a result you can check.",
      lede: "Leona is five parts on one thread. You ask, build, look things up, learn and share, and each part hands its work to the next.",
      flowLabel: "The five parts of Leona",
      stages: [
        {
          figure: "nala",
          title: "Ask in plain words",
          body: "Describe what you want. Nala writes the circuit, runs it, and shows you the checks it passed, so you start from a working answer rather than a blank file.",
          link: "Open Nala",
        },
        {
          figure: "studio",
          title: "Edit, run, keep versions",
          body: "Every circuit opens in Studio. Change a gate, simulate it, verify it, and save the version. Your work stays private until you decide otherwise.",
          link: "Open Studio",
        },
        {
          figure: "atlas",
          title: "Look it up at the source",
          body: "A public reference of algorithms, papers and circuits, each tied to the paper it comes from. Pull one into Studio or cite it.",
          link: "Browse the Atlas",
        },
        {
          figure: "notebooks",
          title: "Learn by running it",
          body: "Turn a question into a Jupyter lesson with cells that run and exercises that check themselves.",
          link: "Open Notebooks",
        },
        {
          figure: "qapps",
          title: "Share it as a small app",
          body: "Wrap a circuit in a few inputs and a chart, then send the link. Anyone can try it without touching code.",
          link: "Open Qapps",
        },
      ],
    },
    product: {
      "label": "The workspace",
      "title": "Choose where to start",
      "items": [
        {
          "title": "Nala",
          "body": "Describe a problem, generate quantum code, and review its execution and checks.",
          "href": "/run"
        },
        {
          "title": "Studio",
          "body": "Edit circuits, run simulations, and organize your saved work.",
          "href": "/studio"
        },
        {
          "title": "Quantum Atlas",
          "body": "Browse quantum concepts, algorithms, and reference implementations.",
          "href": "/repository"
        },
        {
          "title": "Notebooks",
          "body": "Work through lessons and combine code, notes, and results.",
          "href": "/notebooks"
        },
        {
          "title": "Qapps",
          "body": "Explore quantum applications with guided inputs and results.",
          "href": "/qapps"
        }
      ]
    },
    principles: {
      "label": "Code and evidence",
      "title": "Keep the work behind each result",
      "items": [
        {
          "title": "Inspect the checks",
          "body": "Review the code, execution settings, results, and verification record. Checks that fail or could not run stay visible."
        },
        {
          "title": "Continue your research",
          "body": "Save a circuit in Studio, edit its implementation, and build on the next version. The public Atlas provides reusable references."
        },
        {
          "title": "Choose what to share",
          "body": "Your Studio work is private by default. Publishing is a separate action you control."
        }
      ]
    },
    frameworks: {
      "label": "Work in familiar frameworks:",
      "items": [
        "Qiskit",
        "Cirq",
        "PennyLane"
      ]
    },
    cta: {
      "title": "Start with a question or a circuit.",
      "body": "Describe your task to Nala, or find a starting point in the Atlas.",
      "primary": "Open workspace",
      "secondary": "Explore the Atlas"
    },
    benchmark: {
      label: "Benchmarks",
      title: "Measured on code that has to run.",
      body: "The share of tasks each model solved on its first attempt (pass@1), on two benchmarks that run the generated code. A longer bar means more tasks solved.",
      leonaLabel: "LeonaQ, our evaluation",
      reportedLabel: "Reported in the source",
      rows: [
        {
          name: "Qiskit HumanEval",
          detail: "Qiskit code generation, execution-based",
          scores: [
            { model: "LeonaQ", detail: "Leona Quantum", score: 55.0, badge: "Internal", featured: true },
            { model: "Qiskit Code Assistant", detail: "mistral-small-3.2-24b-qiskit", score: 47.0, badge: "Official model card" },
            { model: "Granite 8B Code QK", detail: "granite-8b-code-qk", score: 46.5, badge: "QHE paper" },
            { model: "DeepSeek Coder 33B", detail: "deepseek-coder-33b-base", score: 39.6, badge: "QHE paper" },
            { model: "CodeLlama 34B Python", detail: "codellama-34b-python-hf", score: 26.7, badge: "QHE paper" },
          ],
        },
        {
          name: "QuanBench+ · Qiskit",
          detail: "42 tasks",
          scores: [
            { model: "LeonaQ", score: 72.3, badge: "Internal", featured: true },
            { model: "Gemini", score: 59.5, badge: "QuanBench+ paper" },
            { model: "GPT", score: 57.1, badge: "QuanBench+ paper" },
            { model: "Claude", score: 45.2, badge: "QuanBench+ paper" },
          ],
        },
        {
          name: "QuanBench+ · Cirq",
          detail: "the same 42 tasks",
          scores: [
            { model: "LeonaQ", score: 71.4, badge: "Internal", featured: true },
            { model: "Gemini", score: 54.8, badge: "QuanBench+ paper" },
            { model: "GPT", score: 52.4, badge: "QuanBench+ paper" },
            { model: "Claude", score: 35.7, badge: "QuanBench+ paper" },
          ],
        },
        {
          name: "QuanBench+ · PennyLane",
          detail: "the same 42 tasks",
          scores: [
            { model: "LeonaQ", score: 66.7, badge: "Internal", featured: true },
            { model: "Gemini", score: 40.5, badge: "QuanBench+ paper" },
            { model: "GPT", score: 42.9, badge: "QuanBench+ paper" },
            { model: "Claude", score: 26.2, badge: "QuanBench+ paper" },
          ],
        },
      ],
      note: "LeonaQ's figures come from our own evaluation. The comparator figures are the ones reported in the Qiskit HumanEval paper, Qiskit's model card and the QuanBench+ paper. Gemini 3 Pro, GPT-5.1 and Claude 3.7 Sonnet appear here under their family names. Datasets, prompts and environments differ between those runs and ours, so treat this as directional rather than a controlled head-to-head.",
      sourcesLabel: "Sources",
      sources: [
        { label: "Qiskit HumanEval paper · Table II", href: "https://arxiv.org/abs/2406.14712" },
        { label: "Qiskit model card · benchmark table", href: "https://huggingface.co/Qiskit/mistral-small-3.2-24b-qiskit" },
        { label: "IBM Quantum · Qiskit Code Assistant", href: "https://quantum.cloud.ibm.com/docs/en/guides/qiskit-code-assistant" },
        { label: "QuanBench+ paper · Table 3", href: "https://arxiv.org/html/2604.08570v2" },
      ],
    },
  },
  ja: {
    hero: {
      title: "次世代\n量子コンピューティング\nプラットフォーム",
      lede: "量子回路の開発から活用まで、ひとつのプラットフォームで",
    },
    promptDemo: {
      "label": "量子コンピュータで取り組みたい課題を入力",
      "attach": "ワークスペースで参考資料を添付",
      "mode": "プラン",
      "submit": "生成する",
      "retry": "もう一度ワークスペースを開いてください。",
      "prompts": [
        "ベル状態を作り、測定分布を検証してください。",
        "6社を2組に分け、組をまたぐ取引を最小限にしてください。",
        "リスクを一定に保ち、8銘柄の最適な組み合わせを選んでください。",
        "16件のデータから条件に合う1件を探してください。",
        "H₂分子の基底状態エネルギーを求めてください。",
        "作業6件を機械3台に割り当て、最短で終わる計画を立ててください。"
      ]
    },
    visual: {
      "demoLabel": "Leonaの操作を見る",
      "demoDescription": "回路の生成と検証から、Studioでの編集、Atlasを使った再利用までを紹介します。",
      "demoFallback": "操作デモの動画を開く"
    },
    how: {
      label: "Leonaでできること",
      title: "課題の相談から、結果の検証まで。",
      lede: "Leonaでは、AIへの相談、回路の編集、文献調査、学習、アプリの共有をひとつの場所で進められます。5つの機能を行き来しながら、量子計算に取り組めます。",
      flowLabel: "Leonaの5つの機能",
      stages: [
        {
          figure: "nala",
          title: "やりたいことを言葉で伝える",
          body: "作りたいものを説明すると、Nalaが量子回路のコードを生成・実行し、検証結果を示します。そのコードをもとに、編集や実験を進められます。",
          link: "Nalaを開く",
        },
        {
          figure: "studio",
          title: "回路を編集・実行し、変更を記録する",
          body: "回路をStudioで開き、ゲートの変更、シミュレーション、検証を行えます。変更内容はバージョンごとに保存でき、自分で公開するまでは非公開です。",
          link: "Studioを開く",
        },
        {
          figure: "atlas",
          title: "論文や実装例を調べる",
          body: "アルゴリズムや回路を、出典の論文とあわせて調べられます。見つけた回路をStudioに取り込んだり、資料を引用したりできます。",
          link: "Atlasを見る",
        },
        {
          figure: "notebooks",
          title: "動かしながら学ぶ",
          body: "学びたいテーマに合わせて、Jupyter形式の教材を作成します。コードを実行しながら学べるほか、演習の自動採点にも対応しています。",
          link: "ノートブックを開く",
        },
        {
          figure: "qapps",
          title: "小さなアプリとして共有する",
          body: "回路に入力フォームやグラフを付けて、アプリとして共有できます。受け取った人は、コードを書かずにブラウザーで試せます。",
          link: "Qappsを開く",
        },
      ],
    },
    product: {
      "label": "ワークスペース",
      "title": "目的に合わせて始める",
      "items": [
        {
          "title": "Nala",
          "body": "課題を伝えて量子コードを生成し、実行結果と検証内容を確認できます。",
          "href": "/run"
        },
        {
          "title": "Studio",
          "body": "回路を編集してシミュレーションを実行し、保存した回路や実験結果を整理できます。",
          "href": "/studio"
        },
        {
          "title": "量子Atlas",
          "body": "量子の概念、アルゴリズム、実装例を調べられます。",
          "href": "/repository"
        },
        {
          "title": "ノートブック",
          "body": "教材で学びながら、コード、ノート、結果をまとめられます。",
          "href": "/notebooks"
        },
        {
          "title": "Qapps",
          "body": "フォームに値を入力して、量子計算を使ったアプリを試せます。",
          "href": "/qapps"
        }
      ]
    },
    principles: {
      "label": "コードと検証記録",
      "title": "結果に至る過程も残す",
      "items": [
        {
          "title": "検証内容を確認",
          "body": "コード、実行条件、結果、検証記録を確認できます。失敗した検証や実施できなかった検証も表示します。"
        },
        {
          "title": "研究を続ける",
          "body": "回路をStudioに保存し、実装を編集して次の実験へ進めます。公開Atlasでは再利用できる資料を探せます。"
        },
        {
          "title": "共有範囲を選ぶ",
          "body": "Studioの内容は初期状態では非公開です。公開するかどうかは、自分で決められます。"
        }
      ]
    },
    frameworks: {
      "label": "対応フレームワーク:",
      "items": [
        "Qiskit",
        "Cirq",
        "PennyLane"
      ]
    },
    cta: {
      "title": "アイデアを、量子回路に。",
      "body": "Nalaにやりたいことを伝えるか、Atlasで参考になる実装を探してみましょう。",
      "primary": "ワークスペースを開く",
      "secondary": "Atlasを見る"
    },
    benchmark: {
      label: "ベンチマーク",
      title: "動くコードで、モデルの実力を測る。",
      body: "生成したコードを実際に実行する2つのベンチマークで、最初の生成がテストに合格した割合（pass@1）です。棒が長いほど、解けた課題が多いことを表します。",
      leonaLabel: "LeonaQ（社内評価）",
      reportedLabel: "出典の公表値",
      rows: [
        {
          name: "Qiskit HumanEval",
          detail: "生成したQiskitコードを実行して評価",
          scores: [
            { model: "LeonaQ", detail: "Leona Quantum", score: 55.0, badge: "社内評価", featured: true },
            { model: "Qiskit Code Assistant", detail: "mistral-small-3.2-24b-qiskit", score: 47.0, badge: "公式モデルカード" },
            { model: "Granite 8B Code QK", detail: "granite-8b-code-qk", score: 46.5, badge: "QHE論文" },
            { model: "DeepSeek Coder 33B", detail: "deepseek-coder-33b-base", score: 39.6, badge: "QHE論文" },
            { model: "CodeLlama 34B Python", detail: "codellama-34b-python-hf", score: 26.7, badge: "QHE論文" },
          ],
        },
        {
          name: "QuanBench+ · Qiskit",
          detail: "42課題",
          scores: [
            { model: "LeonaQ", score: 72.3, badge: "社内評価", featured: true },
            { model: "Gemini", score: 59.5, badge: "QuanBench+論文" },
            { model: "GPT", score: 57.1, badge: "QuanBench+論文" },
            { model: "Claude", score: 45.2, badge: "QuanBench+論文" },
          ],
        },
        {
          name: "QuanBench+ · Cirq",
          detail: "同じ42課題",
          scores: [
            { model: "LeonaQ", score: 71.4, badge: "社内評価", featured: true },
            { model: "Gemini", score: 54.8, badge: "QuanBench+論文" },
            { model: "GPT", score: 52.4, badge: "QuanBench+論文" },
            { model: "Claude", score: 35.7, badge: "QuanBench+論文" },
          ],
        },
        {
          name: "QuanBench+ · PennyLane",
          detail: "同じ42課題",
          scores: [
            { model: "LeonaQ", score: 66.7, badge: "社内評価", featured: true },
            { model: "Gemini", score: 40.5, badge: "QuanBench+論文" },
            { model: "GPT", score: 42.9, badge: "QuanBench+論文" },
            { model: "Claude", score: 26.2, badge: "QuanBench+論文" },
          ],
        },
      ],
      note: "LeonaQの数値は社内評価です。比較値はQiskit HumanEval論文、Qiskit公式モデルカード、QuanBench+論文の公表値で、Gemini 3 Pro、GPT-5.1、Claude 3.7 Sonnetはモデル系列名で表記しています。データセットやプロンプト、実行環境が異なるため、同一条件での直接比較ではなく目安としてご覧ください。",
      sourcesLabel: "出典",
      sources: [
        { label: "Qiskit HumanEval論文 · Table II", href: "https://arxiv.org/abs/2406.14712" },
        { label: "Qiskit公式モデルカード · ベンチマーク表", href: "https://huggingface.co/Qiskit/mistral-small-3.2-24b-qiskit" },
        { label: "IBM Quantum · Qiskit Code Assistant", href: "https://quantum.cloud.ibm.com/docs/en/guides/qiskit-code-assistant" },
        { label: "QuanBench+論文 · Table 3", href: "https://arxiv.org/html/2604.08570v2" },
      ],
    },
  },
};

/**
 * The public plan ladder. Four cards; three of them are enforced tiers.
 *
 *   Free         → tier `free`
 *   Plus         → tier `pro`    ← the id is NOT the name
 *   Professional → tier `team`   ← nor here
 *   Enterprise   → no tier at all: a sales motion, negotiated per customer
 *
 * ## The cards carry no allowance numbers at all, and no tagline (ai-ops#82)
 *
 * > *"prices stay, 50 moves to /account. shorten each of the bullet points to
 * > be <=4 words each. no headliners like 'Enough to browse the public evidence
 * > and put the workbench through a real problem.'"* — owner, 2026-08-14
 *
 * Prices stayed; every allowance figure and every card tagline went. So did the
 * `description` field itself, in both languages and in both renderers, because
 * a field that exists is a field somebody refills.
 *
 * **The guard inverted with the copy.** `account-tier.test.ts` used to tie
 * every number on these three cards to `TIER_LIMITS` — prose that overstates an
 * allowance is a promise the product breaks the first time somebody reaches it.
 * Generic prose cannot be tied that way, so the pin became its opposite: the
 * Free, Plus and Professional feature lists must contain **no digits**, in
 * either language. That is the same protection from the other side. Numbers
 * came back onto this page one at a time before, and the failure was never
 * visible on the page — it was visible to the person who hit the cap.
 *
 * A bullet is at most four words, which is also asserted rather than merely
 * asked for. The ladder is legible without figures because each card opens with
 * "Everything in <the card below>" and states its differences as comparatives —
 * "More weekly runs", "Wider browser simulation" — every one of which is true
 * of `TIER_LIMITS` as it stands.
 *
 * Enterprise states capabilities and no allowances — there is nothing for a
 * test to tie it to, and a number on that card would be one nothing enforces.
 *
 * **The 50 moved to `/account`**, where a signed-in reader sees it beside their
 * own run and artifact allowances, read from `DEFAULT_PROJECT_ARTIFACT_LIMIT`.
 * A number that looks like it was already shown live in two places — the owner's
 * editable limit input in `components/project-share-dialog.tsx` and the
 * "N of M circuits" line in
 * `app/(app)/shared/[projectId]/shared-project-view.tsx`. Neither is this
 * constant: both render the PROJECT's own limit, which equals 50 only while
 * nobody has changed it, and both sit inside a project that is already shared —
 * the wrong moment to learn what the limit is.
 *
 * ## No card says "unlimited artifacts", however it is phrased (ai-ops#77)
 *
 * > *"10 artifacts is the cap and the unlimited line should go."* — owner,
 * > 2026-08-14
 *
 * Every card carried `"Unlimited private projects, 50 artifacts in each"`
 * directly under its own artifact cap. Free read "10 private artifacts" and then
 * offered unlimited projects holding fifty each; Plus said 75 and Professional
 * 250 with the same line under them. The multiplication is the problem: the
 * enforced cap is per account, so the second line advertised an allowance the
 * first line refuses, and a reader has no way to tell which one bills.
 *
 * The line is gone from all three enforced tiers rather than from Free alone.
 * The ruling names Free because that is the card the owner was reading, but the
 * reason it gives — the account cap is the cap — is not a fact about Free, and
 * leaving the sentence on the two paid cards would keep exactly the promise it
 * was struck for.
 *
 * What went with it is the true half: private projects really are uncapped, and
 * `50` really is a project's default artifact limit. The `50` is on `/account`
 * as of ai-ops#82. "Unlimited private projects" is still not on any enforced
 * card and is still the owner's call to reverse: now that the artifact figure
 * is gone from the bullet beside it, the word has nothing to contradict, but it
 * also has nothing to be read against — "unlimited" sitting next to "Private
 * artifacts" is the same misreading in a shorter sentence.
 *
 * ## Sharing appears on Professional and nowhere below it
 *
 * `projectSharing` is false for `free` and `pro`, and the control plane returns
 * 403 rather than counting anything — so a sharing line on either card is a
 * promise that breaks on the first click, not one that breaks at a cap.
 * `account-tier.test.ts` asserts its absence on both, which it did for Plus
 * only until ai-ops#82.
 */
export const PRICING_COPY: Record<PublicLocale, {
  hero: { title: string; body: string };
  // No `description`: the per-card tagline is gone by ruling, and a field left
  // in place is a field the next copy pass fills back in.
  plans: Array<{ name: string; price: string; cadence: string; features: string[]; action: string; tone: "quiet" | "featured" }>;
}> = {
  en: {
    hero: { title: "A clear path from first run to team work.", body: "Explore plans for your research needs. Pricing is still under consideration, and features may change. Contact us to discuss your needs." },
    plans: [
      { name: "Free", price: "TBD", cadence: "Proposed plan · subject to change", features: ["Full public Atlas", "Weekly agent runs", "Private artifacts", "Browser simulation"], action: "Try the preview", tone: "quiet" },
      { name: "Plus", price: "TBD", cadence: "Proposed plan · subject to change", features: ["Everything in Free", "More weekly runs", "More private artifacts", "Wider browser simulation"], action: "Contact us", tone: "featured" },
      { name: "Professional", price: "TBD", cadence: "Proposed plan · subject to change", features: ["Everything in Plus", "Share outside your workspace", "Read-only or editable sharing", "More runs and artifacts", "Widest browser simulation"], action: "Contact us", tone: "quiet" },
      { name: "Enterprise", price: "TBD", cadence: "Proposed plan · subject to change", features: ["Everything in Professional", "Allowances agreed with you", "Private-corpus conversations", "Named onboarding contact"], action: "Contact us", tone: "quiet" },
    ],
  },
  ja: {
    hero: { title: "まずは個人で試し、そのままチームで研究へ。", body: "研究の用途に合わせたプランをご紹介します。料金は現在検討中で、機能構成は今後変更する場合があります。ご利用についてはお問い合わせください。" },
    plans: [
      { name: "Free", price: "未定", cadence: "プラン内容は検討中です", features: ["公開Atlasのすべて", "週ごとのエージェント実行", "非公開の回路・実行記録", "ブラウザ実行"], action: "プレビューを試す", tone: "quiet" },
      { name: "Plus", price: "未定", cadence: "プラン内容は検討中です", features: ["Freeのすべて", "実行回数を拡大", "保存件数を拡大", "より広いブラウザ実行"], action: "お問い合わせ", tone: "featured" },
      { name: "Professional", price: "未定", cadence: "プラン内容は検討中です", features: ["Plusのすべて", "ワークスペース外への共有", "閲覧のみ／編集可を選択", "実行と保存をさらに拡大", "最も広いブラウザ実行"], action: "お問い合わせ", tone: "quiet" },
      { name: "Enterprise", price: "未定", cadence: "プラン内容は検討中です", features: ["Professionalのすべて", "利用上限は個別に調整", "社内データに関する相談", "導入と評価の担当窓口"], action: "お問い合わせ", tone: "quiet" },
    ],
  },
};

/**
 * The signed-in upgrade surface.
 *
 * Deliberately thin. Every price, cadence and feature line on this screen is
 * read from `PRICING_COPY` above — the cards a person already saw before they
 * signed up, and the ones `account-tier.test.ts` ties to `TIER_LIMITS`. This
 * table holds only the words that are new here: whose plan it is, what they are
 * currently using, and the fact that nothing on the page can charge them yet.
 *
 * A second plan table on this screen was the obvious way to build it and the
 * wrong one. The pricing page and the upgrade page quoting different numbers is
 * not a hypothetical in this codebase — the tier ladder alone had three copies
 * of itself, two of them wrong, inside one month.
 */
export const UPGRADE_COPY: Record<PublicLocale, {
  title: string;
  lede: string;
  currentLabel: string;
  currentSuffix: string;
  usageTitle: string;
  usageApproaching: string;
  usageCritical: string;
  usageExhausted: string;
  topOfLadderTitle: string;
  topOfLadderBody: string;
  developerTitle: string;
  developerBody: string;
  checkoutTitle: string;
  checkoutBody: string;
  enterpriseName: string;
  cta: string;
  backToAccount: string;
}> = {
  en: {
    title: "Plans under review",
    lede: "Pricing and future plan details have not been finalized and may change.",
    currentLabel: "Your plan",
    currentSuffix: "— what you have today",
    usageTitle: "Where you are this week",
    usageApproaching: "Three quarters of this week's tokens are spent.",
    usageCritical: "Nine tenths of this week's tokens are spent. A long run may not finish.",
    usageExhausted: "This week's allowance is used. Browser simulation in Studio stays available.",
    topOfLadderTitle: "You are on the top published plan.",
    topOfLadderBody:
      "Professional is the highest current account tier. Future pricing and plan details remain under review. Contact us about larger allowances or organisation-specific needs.",
    developerTitle: "Your account is unmetered.",
    developerBody:
      "Your developer account has no weekly usage limit.",
    checkoutTitle: "Checkout is not live yet.",
    checkoutBody:
      "No payment method can be added in this deployment — there is no card entry, checkout, or charge. Get in touch and your plan is changed by hand in the meantime.",
    enterpriseName: "Enterprise",
    cta: "Get in touch",
    backToAccount: "Back to account",
  },
  ja: {
    title: "検討中のプラン",
    lede: "料金と今後のプラン内容はまだ決まっておらず、変更する場合があります。",
    currentLabel: "現在のプラン",
    currentSuffix: "— 現在ご利用中の内容",
    usageTitle: "今週の使用状況",
    usageApproaching: "今週のトークンの4分の3を使用しました。",
    usageCritical: "今週のトークンの9割を使用しました。長い実行は完了しない可能性があります。",
    usageExhausted:
      "今週分の上限に達しました。Studioのブラウザ実行は引き続きご利用いただけます。",
    topOfLadderTitle: "公開されている最上位のプランをご利用中です。",
    topOfLadderBody:
      "現在のアカウント区分ではProfessionalが最上位です。今後の料金とプラン内容は検討中です。利用上限や組織ごとのご要望についてはお問い合わせください。",
    developerTitle: "このアカウントには上限がありません。",
    developerBody:
      "この開発者アカウントには、週ごとの利用上限がありません。",
    checkoutTitle: "決済はまだ開始していません。",
    checkoutBody:
      "現在の環境では支払い方法を登録できず、カード入力も決済も行われません。それまでの間はお問い合わせいただければ手動でプランを変更します。",
    enterpriseName: "Enterprise",
    cta: "お問い合わせ",
    backToAccount: "アカウントに戻る",
  },
};

export const CONTACT_COPY: Record<PublicLocale, {
  overline: string;
  title: string;
  body: string;
  panelTitle: string;
  reasons: string[];
  note: string;
  measure: { label: string };
  // `submit`/`status`/`note` describe the mailto path, which is what the form
  // still falls back to while no transactional sender is configured. The
  // `send*` keys describe the real one. Both sets exist because the form only
  // learns which it is on at runtime, from `/api/contact` (ai-ops issue 125).
  fields: {
    name: string;
    email: string;
    topic: string;
    message: string;
    placeholder: string;
    submit: string;
    status: string;
    send: string;
    sending: string;
    sent: string;
    failed: string;
  };
  noteSends: string;
  topics: string[];
}> = {
  en: {
    overline: "Contact",
    title: "Tell us what you are working on.",
    body: "Get in touch about product access, a research project, or working together.",
    panelTitle: "How we can help",
    reasons: ["Research workflows and early product access", "Enterprise R&D and private-corpus conversations", "Public research contributions and technical feedback", "Press, partnerships, and speaking"],
    // One sentence, and it is the one a sender needs: what the button does.
    // The clause that used to follow it ("the current queue is mailto-backed;
    // server-side delivery and CRM routing will follow…") described our own
    // unfinished plumbing to the person deciding whether to write in. How the
    // note reaches us is ours to know; that the button opens their mail client
    // is theirs.
    note: "Submitting opens a prepared email in your email app.",
    measure: { label: "Measure a qubit" },
    fields: {
      name: "Name",
      email: "Email",
      topic: "What is this about?",
      message: "Message",
      placeholder: "What are you building, and what evidence or access would help?",
      submit: "Prepare inquiry",
      status: "Your message is ready in your email app. Review it and send it there.",
      send: "Send inquiry",
      sending: "Sending…",
      sent: "Your message has been sent. We will reply to the email address you provided.",
      failed: "Your message could not be sent. Your text is still here; please try again.",
    },
    noteSends: "We use the details you provide to respond to your inquiry.",
    topics: ["Product access", "Research workflow", "Enterprise R&D", "Public research contribution", "Other"],
  },
  ja: {
    overline: "お問い合わせ",
    title: "つくりたいもの、確かめたいものを教えてください。",
    body: "Leona Quantumは、量子回路の作成から実行、検証、保存、共有までを支える研究基盤です。研究内容や必要な利用環境をお送りください。",
    panelTitle: "ご連絡いただける内容",
    reasons: ["研究ワークフローと早期アクセス", "企業・研究機関向けの導入相談", "公開研究への投稿と技術フィードバック", "取材、パートナーシップ、登壇"],
    note: "送信ボタンを押すと、入力内容を反映したメール作成画面が開きます。",
    measure: { label: "量子ビットを測定" },
    fields: {
      name: "お名前",
      email: "メールアドレス",
      topic: "内容",
      message: "メッセージ",
      placeholder: "取り組んでいる研究テーマと、必要な実行・検証環境を教えてください。",
      submit: "メールを作成",
      status: "内容を確認してメールを送信してください。",
      send: "送信",
      sending: "送信中…",
      sent: "送信しました。ご記入のメールアドレスに返信します。",
      failed: "送信できませんでした。しばらくしてからもう一度お試しください。",
    },
    noteSends: "お問い合わせへの返信に、ご記入の情報を使用します。",
    topics: ["プロダクトへのアクセス", "研究ワークフロー", "企業R&D", "公開研究への投稿", "その他"],
  },
};

export const WORKSPACE_LANDING_COPY: Record<PublicLocale, {
  overline: string; title: string; body: string; primary: string; secondary: string;
  loopLabel: string; loopTitle: string;
  loop: Array<{ title: string; body: string }>;
}> = {
  en: {
    overline: "Your quantum workspace",
    title: "Build, inspect, and continue your research.",
    body: "Use Nala to develop quantum code, Studio to edit and run circuits, and notebooks to keep notes alongside your results. Your work is private by default.",
    primary: "Open workspace",
    secondary: "Explore the Atlas",
    loopLabel: "From question to saved work",
    loopTitle: "Keep each experiment connected",
    loop: [
      { title: "Describe the task", body: "Give Nala the problem, constraints, and framework you want to use. Review the plan before execution." },
      { title: "Inspect the result", body: "Read the code, execution settings, outputs, and checks for the recorded run, including failures and limitations." },
      { title: "Save and continue", body: "Organize circuits in Studio, edit the next version, and choose what to share." },
    ],
  },
  ja: {
    overline: "量子ワークスペース",
    title: "作成、検証から、次の研究へ。",
    body: "Nalaで量子コードを作成し、Studioで回路を編集・実行。ノートブックで結果とノートをまとめられます。作業内容は初期状態では非公開です。",
    primary: "ワークスペースを開く",
    secondary: "Atlasを見る",
    loopLabel: "問いから研究記録へ",
    loopTitle: "実験の過程をつなぐ",
    loop: [
      { title: "課題を伝える", body: "Nalaに課題、条件、使用するフレームワークを伝え、実行前に計画を確認します。" },
      { title: "結果を確認する", body: "コード、実行条件、出力、検証内容を確認できます。失敗や制限事項も記録します。" },
      { title: "保存して続ける", body: "Studioで回路を整理し、次のバージョンを編集。共有する内容も自分で選べます。" },
    ],
  },
};

export const PRIVACY_COPY: Record<PublicLocale, {
  title: string;
  lede: string;
  updated: string;
  noteLabel: string;
  noteBody: string;
  sections: Array<{ title: string; paragraphs: string[] }>;
}> = {
  en: {
    title: "Privacy policy",
    lede: "How Leona Quantum handles information on the public website and early-access product.",
    updated: "Last updated: July 15, 2026",
    noteLabel: "Early-access note:",
    noteBody: "This page describes the current product and operating practices. It will be updated as Leona Quantum grows, adds paid services, and formalizes its operating entity.",
    sections: [
      { title: "1. Information we receive", paragraphs: ["We may receive account information such as your email address and authentication details when you create or use an account.", "When you use the workbench, we may process prompts, generated code, circuit data, run settings, simulation results, verification records, saved artifacts, and related metadata that you choose to submit.", "If you contact us, we receive the information you include in that message and the reply details needed to respond."] },
      { title: "2. How we use information", paragraphs: ["We use information to authenticate users, run and verify requested workflows, save and reopen Studio artifacts, provide support, secure the service, diagnose failures, and improve reliability and product quality.", "We may use aggregated or de-identified operational information to understand performance. We do not present private workspace artifacts as public Atlas material without an explicit publish action."] },
      { title: "3. Service providers and infrastructure", paragraphs: ["Leona Quantum relies on specialized providers for hosting, authentication, databases, observability, model access, and isolated code execution. Those providers may process information only as needed to provide their services.", "Generated code is treated as untrusted input and is intended to run in an isolated, network-restricted execution environment. Do not submit secrets or information you are not authorized to process."] },
      { title: "4. Public and private work", paragraphs: ["Public Atlas entries are separate from private Studio workspaces. A Studio entry is private by default. Publishing is an explicit action that may make an artifact, its code, and its evidence available to other people; review the content before publishing."] },
      { title: "5. Retention and your choices", paragraphs: ["We retain account and workspace records for as long as needed to provide the service, meet legitimate operational needs, resolve disputes, and comply with applicable obligations. Retention may vary by record type and account status.", "You can ask about the information associated with your account, request correction or deletion where applicable, or ask a privacy question through the contact page. We may need to verify your request before acting on it."] },
      { title: "6. Cookies and security", paragraphs: ["The authenticated product uses cookies or similar technologies to maintain a secure session. The public site may also receive ordinary technical information from your browser and hosting infrastructure.", "We use reasonable technical and organizational measures for the stage of the product, but no online service can promise perfect security. Keep account credentials private and do not place API keys, passwords, or regulated data in prompts or generated code."] },
      { title: "7. Changes and contact", paragraphs: ["We may update this policy when the service changes. The date above identifies the latest version published on this page. Use the contact page for questions."] },
    ],
  },
  ja: {
    title: "プライバシーポリシー",
    lede: "公開サイトと早期アクセスのプロダクトで、Leona Quantumが情報をどのように扱うかを説明します。",
    updated: "最終更新日: 2026年7月15日",
    noteLabel: "早期アクセスに関する注記:",
    noteBody: "このページは現在のサービスと運用方法を説明します。Leona Quantumの成長、有料サービス、事業体制の正式化に合わせて更新します。",
    sections: [
      { title: "1. 受け取る情報", paragraphs: ["アカウントを作成または利用すると、メールアドレスや認証情報などのアカウント情報を受け取ることがあります。", "ワークベンチの利用時には、入力した内容、生成コード、回路データ、実行設定、シミュレーション結果、検証記録、保存した回路・実行結果、関連メタデータを処理することがあります。", "お問い合わせいただいた場合は、メッセージに含まれる情報と返信に必要な情報を受け取ります。"] },
      { title: "2. 情報の利用目的", paragraphs: ["認証、ワークフローの実行と検証、Studioへの保存と再表示、サポート、セキュリティ、障害診断、信頼性と品質の改善に利用します。", "集計または匿名化した運用情報を性能の把握と改善に利用することがあります。非公開ワークスペースの内容を、明示的な公開操作なしに公開Atlasへ掲載することはありません。"] },
      { title: "3. サービスプロバイダとインフラ", paragraphs: ["Leona Quantumは、ホスティング、認証、データベース、稼働状況の監視、AIモデルの利用、隔離されたコード実行のために専門プロバイダを利用します。プロバイダはサービス提供に必要な範囲で情報を処理します。", "生成コードは信頼できない入力として扱い、ネットワークアクセスを制限した隔離環境で実行することを想定しています。秘密情報や、処理する権限のない情報は送信しないでください。"] },
      { title: "4. 公開と非公開の研究", paragraphs: ["Atlasの公開資料と非公開Studioの内容は分けて管理されます。Studioの内容は初期状態では非公開です。公開すると、保存した回路、コード、検証結果が他の利用者に表示される場合があります。公開前に内容を確認してください。"] },
      { title: "5. 保存期間と利用者の選択", paragraphs: ["サービス提供、サービスの適切な運用、紛争解決、法令上の義務への対応に必要な期間、アカウントとワークスペースの記録を保持します。保持期間は記録の種類やアカウント状態で異なることがあります。", "アカウントに関する情報の確認、該当する場合の訂正・削除、プライバシーに関する質問はお問い合わせページからご連絡ください。対応前に本人確認をお願いすることがあります。"] },
      { title: "6. Cookieとセキュリティ", paragraphs: ["認証済みサービスでは、安全なセッションを維持するためにCookieなどを利用します。公開サイトでも、ブラウザやホスティング基盤から通常の技術情報を受け取ることがあります。", "サービスの現段階で合理的に可能な対策を講じますが、オンラインサービスが完全な安全性を保証することはできません。認証情報を管理し、APIキー、パスワード、規制対象データを入力内容や生成コードに含めないでください。"] },
      { title: "7. 変更とお問い合わせ", paragraphs: ["サービスの変更に応じて本ポリシーを更新することがあります。上記の日付がこのページの最新版を示します。質問はお問い合わせページからお送りください。"] },
    ],
  },
};

export const TERMS_COPY: Record<PublicLocale, {
  title: string;
  lede: string;
  updated: string;
  noteLabel: string;
  noteBody: string;
  sections: Array<{ title: string; paragraphs: string[] }>;
}> = {
  en: {
    title: "Terms of service",
    lede: "The rules for using the Leona Quantum website, workbench, Studio, and public Atlas.",
    updated: "Last updated: July 15, 2026",
    noteLabel: "Early-access note:",
    noteBody: "These plain-language terms are a practical starting point for the current product. Additional commercial terms may apply when paid plans or enterprise agreements become available.",
    sections: [
      { title: "1. Using Leona Quantum", paragraphs: ["By accessing Leona Quantum, you agree to use the service lawfully, respect other users, and follow these terms. If you use it for an organization, you represent that you have authority to accept these terms on its behalf."] },
      { title: "2. Prohibited use", paragraphs: ["Do not use the service to violate law or third-party rights, exfiltrate secrets, attack infrastructure, bypass usage controls, submit malware, or interfere with the service or another person’s workspace. Do not use generated code or results as a substitute for professional review in safety-critical, financial, medical, or regulated settings."] },
      { title: "3. Generated work and verification", paragraphs: ["Leona Quantum helps generate, execute, and analyze technical work. Generated code can be incomplete or wrong. A verification result means that the documented checks passed for the recorded run and conditions; it is not a guarantee of correctness in every environment or a promise of algorithmic advantage."] },
      { title: "4. Your content", paragraphs: ["You keep the rights you have in content you submit. You grant Leona Quantum the limited permission needed to host, process, execute, display, back up, and improve the service for you. Private Studio content is not public by default."] },
      { title: "5. Early-access packaging", paragraphs: ["Leona Quantum is currently an early-access product. The pricing page describes intended packaging; paid billing, limits, credits, and refunds will be governed by terms shown before a transaction is enabled."] },
      { title: "6. Disclaimers", paragraphs: ["To the extent permitted by law, the service is provided without warranties that it will be uninterrupted, error-free, secure, or suitable for a particular purpose. You use generated code, simulations, exports, and public artifacts at your own risk.", "Nothing on Leona Quantum is legal, medical, financial, or safety advice. Any limitation of liability or indemnity terms required for a paid or enterprise relationship will be stated in the applicable commercial agreement."] },
      { title: "7. Changes and contact", paragraphs: ["Use the contact page for questions about these terms. We may update them as the service adds accounts, paid plans, and new execution capabilities; the date above identifies the current version."] },
    ],
  },
  ja: {
    title: "利用規約",
    lede: "Leona Quantumの公開サイト、ワークベンチ、Studio、Atlasを利用するためのルールです。",
    updated: "最終更新日: 2026年7月15日",
    noteLabel: "早期アクセスに関する注記:",
    noteBody: "これは現在のサービスに適用する基本条件です。有料プランや法人向け契約には、追加の商用条件が適用されることがあります。",
    sections: [
      { title: "1. Leona Quantumの利用", paragraphs: ["Leona Quantumへアクセスすることで、本サービスを適法に利用し、他の利用者を尊重し、本規約に従うことに同意します。組織のために利用する場合、その組織を代表して同意する権限があることを表明します。"] },
      { title: "2. 禁止される利用", paragraphs: ["法令や第三者の権利への違反、秘密情報の持ち出し、インフラへの攻撃、利用制限の回避、マルウェアの送信、サービスや他の人のワークスペースへの妨害に利用しないでください。安全性が重要な分野、金融、医療、規制対象の場面で、生成コードや結果を専門家の確認の代わりにしないでください。"] },
      { title: "3. 生成物と検証", paragraphs: ["Leona Quantumは技術的な作業の生成、実行、分析を支援します。生成コードは不完全または誤っている可能性があります。検証結果は、記録された条件で所定の検証に合格したことを示すもので、あらゆる環境での正しさやアルゴリズム上の優位性を保証しません。"] },
      { title: "4. 利用者のコンテンツ", paragraphs: ["利用者は、送信したコンテンツについて、自らが保有する権利を引き続き保持します。Leona Quantumには、サービスを提供するためにホスト、処理、実行、表示、バックアップ、改善するための限定的な許諾を与えます。非公開Studioの内容は初期状態で公開されません。"] },
      { title: "5. 早期アクセスの提供条件", paragraphs: ["Leona Quantumは現在、早期アクセス版のサービスです。料金ページは提供予定のプラン内容を示しています。決済、利用上限、クレジット、返金の条件は、有料サービスの申込み前に表示します。"] },
      { title: "6. 免責事項", paragraphs: ["法令で許される範囲で、サービスが中断しないこと、エラーがないこと、安全であること、特定目的に適合することを保証しません。生成コード、シミュレーション、エクスポート、公開されている回路・実行記録の利用は自己責任で行ってください。", "Leona Quantum上の情報は、法務、医療、金融、安全に関する助言ではありません。有料または法人向け契約に必要な責任制限や補償条件は、該当する商用契約に記載します。"] },
      { title: "7. 変更とお問い合わせ", paragraphs: ["規約に関する質問はお問い合わせページからお送りください。アカウント、有料プラン、新しい実行機能の追加に応じて更新することがあります。上記の日付が最新版を示します。"] },
    ],
  },
};

/**
 * The 404 page. Reached by a typo, a stale bookmark, a crawler, or a
 * `notFound()` inside a route that has no closer boundary of its own — so the
 * copy names what happened without guessing why, and offers the two doors a
 * lost visitor can always take: the home page and the public Atlas.
 */
export const NOT_FOUND_COPY: Record<PublicLocale, {
  label: string;
  title: string;
  body: string;
  home: string;
  repository: string;
  /**
   * The accessible name of the wordmark link, which has no text of its own.
   *
   * Deliberately the same string as `PUBLIC_COPY.brandHome`, not a second
   * wording of it — the two links do the same thing and a screen reader meets
   * them one navigation apart. It is duplicated rather than imported because
   * this copy object is the only one the standalone 404 may reach: the error
   * document Next synthesises has an empty head, so this component is bundled
   * on its own and pulling in the public-site copy would pull the public site.
   */
  brandHome: string;
}> = {
  en: {
    label: "404",
    title: "This page does not exist.",
    body: "The address you followed does not match anything on Leona Quantum. It may have been mistyped, or the page may have moved since it was linked.",
    home: "Return home",
    repository: "Browse the Atlas",
    brandHome: "Leona Quantum home",
  },
  ja: {
    label: "404",
    title: "このページは存在しません。",
    body: "お探しのアドレスに一致するページはありません。入力に誤りがあるか、リンクされた後にページが移動した可能性があります。",
    home: "ホームに戻る",
    repository: "Atlasを見る",
    brandHome: "Leona Quantum ホーム",
  },
};
