import type { PublicLocale } from "./public-locale";

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
  hero: {
    title: string;
    lede: string;
    primary: string;
    secondary: string;
    contact: string;
    scrollCue: string;
  };
  visual: {
    label: string;
    status: string;
    pipeline: Array<{ number: string; label: string; detail: string }>;
    footer: string;
    meta: string;
  };
  intro: { label: string; title: string };
  product: {
    label: string;
    title: string;
    items: Array<{ index: string; title: string; body: string; action: string; href: string }>;
  };
  atlas: { label: string; title: string; body: string; action: string };
  trace: {
    label: string;
    title: string;
    body: string;
    items: Array<{ title: string; body: string }>;
  };
  frameworks: { label: string; title: string; body: string; items: string[] };
  // Required (not optional): PublicLocale parity for this field is enforced only
  // by TypeScript here — the JA object silently lost its principles section,
  // including its only privacy statement, when this was briefly `principles?:`
  // (2026-08-01 review). Do not reintroduce `?` without also adding a runtime
  // check, or a future locale can drop this section again with no compiler error.
  principles: {
    label: string;
    title: string;
    items: Array<{ title: string; body: string }>;
  };
  cta: { label: string; title: string; body: string; primary: string; secondary: string };
}> = {
  en: {
    hero: {
      title: "A self-evolving quantum solution platform.",
      lede: "Generate, run, and reuse quantum circuits.",
      primary: "Open the workspace",
      secondary: "Explore the Atlas",
      contact: "Get in touch",
      scrollCue: "Scroll",
    },
    visual: {
      label: "LEONA QUANTUM / PRODUCT",
      status: "AI-POWERED CIRCUIT DEVELOPMENT",
      pipeline: [
        { number: "01", label: "Describe", detail: "Express the circuit in natural language" },
        { number: "02", label: "Generate", detail: "Create the circuit, code, and diagram" },
        { number: "03", label: "Run & verify", detail: "Execute the circuit and review the checks" },
        { number: "04", label: "Save & use", detail: "Keep the work in your Studio workspace" },
      ],
      footer: "Quantum circuit development, in one flow",
      meta: "GENERATE · VERIFY · USE",
    },
    intro: {
      label: "The platform",
      title: "Generate, run, verify, and use quantum circuits in one environment.",
    },
    product: {
      label: "Our product",
      title: "Everything needed to develop and use quantum circuits.",
      items: [
        { index: "01", title: "AI quantum circuit generation", body: "Leona Quantum generates quantum circuits from natural-language input and outputs code and circuit diagrams.", action: "Open the workspace", href: "/workspace" },
        { index: "02", title: "Verified circuit execution", body: "Run generated or existing circuits on the supported simulator, then review the verification checks for that result before you rely on it.", action: "Open the workspace", href: "/workspace" },
        { index: "03", title: "Research and circuit repository", body: "Search and use quantum circuits, algorithms, and implementation code in the Atlas. Save your own code and execution settings in Studio for later editing and use.", action: "Explore the Atlas", href: "/repository" },
      ],
    },
    atlas: {
      label: "Atlas",
      title: "Put quantum circuits to work.",
      body: "Search and use quantum circuits, algorithms, and implementation code in one place with Atlas.",
      action: "Explore the Atlas",
    },
    trace: {
      label: "Execution record",
      title: "Trace how each result was produced.",
      body: "Leona Quantum keeps the circuit, execution settings, results, checks, and related information together. Review what was generated, how it was executed, and how the result was produced.",
      items: [
        { title: "Circuit", body: "The generated or selected quantum circuit." },
        { title: "Code", body: "The implementation used for the run." },
        { title: "Execution settings", body: "Framework, simulator, shots, seed, and other conditions." },
        { title: "Results", body: "The outputs returned by the recorded execution." },
        { title: "Checks", body: "The checks completed for that result." },
        { title: "Sources", body: "References and context connected to the work." },
      ],
    },
    frameworks: {
      label: "Frameworks",
      title: "Supports a range of quantum frameworks",
      body: "Generate and inspect quantum circuits using supported frameworks such as Qiskit, Cirq, and PennyLane. Select the framework that fits your development environment and purpose.",
      items: ["Qiskit", "Cirq", "PennyLane"],
    },
    principles: {
      label: "Our principles",
      title: "What we won't trade away.",
      items: [
        { title: "Evidence first", body: "A result you cannot inspect is a claim. The check ships with the answer, including when the check could not run." },
        { title: "Open by default", body: "The Atlas is public because shared groundwork makes private work faster." },
        { title: "Privacy by design", body: "Studio content is yours. Nothing you build there feeds anything public." },
        { title: "Supports a range of quantum frameworks", body: "Work with supported frameworks such as Qiskit, Cirq, and PennyLane, and choose the environment that fits the task." },
      ],
    },
    cta: {
      label: "Get started",
      title: "Develop your next quantum circuit with Leona Quantum.",
      body: "Start from natural language or use an existing circuit from the Atlas.",
      primary: "Open the workspace",
      secondary: "Explore the Atlas",
    },
  },
  ja: {
    hero: {
      title: "次世代\n量子コンピューティングプラットフォーム",
      lede: "量子回路の開発から活用まで、ひとつのプラットフォームで",
      primary: "ワークスペースを開く",
      secondary: "Atlasを見る",
      contact: "お問い合わせ",
      scrollCue: "スクロール",
    },
    visual: {
      label: "LEONA QUANTUM / PRODUCT",
      status: "AIで量子回路を生成",
      pipeline: [
        { number: "01", label: "自然言語で表現", detail: "生成したい量子回路を入力" },
        { number: "02", label: "量子回路を生成", detail: "コードや回路図を出力" },
        { number: "03", label: "実行・検証", detail: "回路を実行し、検証結果を確認" },
        { number: "04", label: "保存・活用", detail: "情報をStudioに保存" },
      ],
      footer: "量子回路の開発を、ひとつの流れに",
      meta: "生成 · 検証 · 活用",
    },
    intro: {
      label: "プラットフォーム",
      title: "量子回路の生成、実行、検証、活用までを一つの環境で実行",
    },
    product: {
      label: "プロダクト",
      title: "量子回路の開発から活用まで、ひとつのプラットフォームで",
      items: [
        { index: "01", title: "量子回路生成", body: "Leona Quantumは自然言語から量子回路を生成し、コードや回路図を出力", action: "ワークスペースを開く", href: "/workspace" },
        { index: "02", title: "検証済みの回路実行", body: "生成した回路や既存の回路を、対応シミュレータで実行　結果を利用する前に、検証内容を確認できます", action: "ワークスペースを開く", href: "/workspace" },
        { index: "03", title: "研究・量子回路リポジトリ", body: "Atlasで量子回路、アルゴリズム、実装コードをまとめて検索し、活用　コード、実行条件などの情報は、あとから編集・活用するためにStudioに保存", action: "Atlasを見る", href: "/repository" },
      ],
    },
    atlas: {
      label: "Atlas",
      title: "量子回路を活用する",
      body: "Atlasで量子回路、アルゴリズム、実装コードをまとめて検索し、活用",
      action: "Atlasを見る",
    },
    trace: {
      label: "実行記録",
      title: "結果に至った過程を確認",
      body: "量子回路、実行条件、実行結果、確認内容などをまとめて保存　何が生成され、どのように実行され、結果に至ったかをあとから確認",
      items: [
        { title: "量子回路", body: "生成または選択した量子回路" },
        { title: "コード", body: "実行に使用した実装コード" },
        { title: "実行条件", body: "フレームワーク、シミュレータ、ショット数、シードなどの条件" },
        { title: "実行結果", body: "記録された実行から得られた出力" },
        { title: "確認内容", body: "実行結果に対して完了した確認" },
        { title: "出典", body: "量子回路に関連する参考情報" },
      ],
    },
    frameworks: {
      label: "フレームワーク",
      title: "さまざまな量子フレームワークに対応",
      body: "Qiskit、Cirq、PennyLaneなど、さまざまな量子フレームワークに対応　開発環境や目的に合わせて、使用するフレームワークを選択",
      items: ["Qiskit", "Cirq", "PennyLane"],
    },
    principles: {
      label: "原則",
      title: "Leona Quantumが大切にすること",
      items: [
        { title: "結果だけでなく、検証内容も示す", body: "確認できない結果は、検証済みとして扱いません。検証できなかった場合も、そのまま記録します。" },
        { title: "公開できる研究は、誰でも確認できる形に", body: "共有された研究を再利用できるよう、Atlasは公開しています。" },
        { title: "非公開の研究データは、初めから保護", body: "Studioの内容は利用者のものです。非公開ワークスペースの作業が自動的に公開されることはありません。" },
        { title: "さまざまな量子フレームワークに対応", body: "Qiskit、Cirq、PennyLaneなど、対応フレームワークで作業し、目的に合った環境を選べます。" },
      ],
    },
    cta: {
      label: "始める",
      title: "次の量子回路開発を、Leona Quantumで",
      body: "Leona Quantumで全く新しい量子回路生成を体験",
      primary: "ワークスペースを開く",
      secondary: "Atlasを見る",
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
 * `account-tier.test.ts` ties every number on the Free, Plus and Professional
 * cards to `TIER_LIMITS`, in both languages, because prose that overstates an
 * allowance is a promise the product breaks the first time somebody reaches it.
 * Enterprise states capabilities and no allowances — there is nothing for a
 * test to tie it to, and a number on that card would be one nothing enforces.
 */
export const PRICING_COPY: Record<PublicLocale, {
  hero: { title: string; body: string };
  plans: Array<{ name: string; price: string; cadence: string; description: string; features: string[]; action: string; tone: "quiet" | "featured" }>;
  note: { label: string; title: string; body: string };
}> = {
  en: {
    hero: { title: "A clear path from first run to team work.", body: "Start free, keep private work in Studio, and move up when you need more verification capacity, export tooling, or shared R&D controls." },
    plans: [
      { name: "Free", price: "$0", cadence: "per user, per month", description: "Enough to browse the public evidence and put the workbench through a real problem.", features: ["The full public Atlas", "5 agent runs a week", "10 private artifacts", "Unlimited private projects, 50 artifacts in each", "Browser simulation up to 8 qubits"], action: "Try the preview", tone: "quiet" },
      { name: "Plus", price: "$50", cadence: "per user, per month", description: "Room to work at your own pace: enough runs to iterate on a problem all week, a Vault that holds the whole line of work, and a wider browser lane. Sharing a project with someone else starts at Professional.", features: ["75 agent runs a week", "75 private artifacts", "Unlimited private projects, 50 artifacts in each", "Browser simulation up to 12 qubits"], action: "Join early access", tone: "featured" },
      { name: "Professional", price: "$240", cadence: "per user, per month", description: "Share a project with someone outside your workspace — read-only, or read-and-edit so they can put work back — with a per-project limit you set.", features: ["Share a project with people outside your workspace", "Up to 4 shared projects per person — ones you share and ones shared with you", "Unlimited private projects, 50 artifacts in each", "250 agent runs a week", "250 private artifacts, not counting anything in a shared project", "Browser simulation up to 18 qubits"], action: "Contact us", tone: "quiet" },
      { name: "Enterprise", price: "$420+", cadence: "per user, per month", description: "Everything in Professional, with the allowances, review path, and terms agreed with your organisation rather than set here.", features: ["Everything in Professional", "Run and artifact allowances agreed with your organisation", "Private-corpus and internal-research conversations", "Named contact for onboarding and evaluation"], action: "Talk to sales", tone: "quiet" },
    ],
    note: { label: "A transparent starting point", title: "The prices are set; checkout is not live yet.", body: "These are the intended early-access prices, per user per month. No payment method can be added in this deployment — there is no card entry, checkout, or charge — so nothing here bills anyone today. Exact credits and enterprise terms are confirmed before paid billing is enabled." },
  },
  ja: {
    hero: { title: "まずは個人で試し、そのままチームで研究へ。", body: "無料で始め、非公開の研究はStudioに保存できます。検証できる実行回数、エクスポート、共同研究の管理が必要になったら次のプランへ進めます。" },
    plans: [
      { name: "Free", price: "$0", cadence: "1ユーザーあたり月額", description: "公開されている回路と検証結果を確認し、実際の課題で一連の操作を試せます。", features: ["公開Atlasのすべて", "週5回のエージェント実行", "非公開の回路・実行記録10件", "非共有プロジェクトは無制限。1プロジェクトあたり50件まで", "8量子ビットまでのブラウザ実行"], action: "プレビューを試す", tone: "quiet" },
      { name: "Plus", price: "$50", cadence: "1ユーザーあたり月額", description: "個人の非公開研究を自分のペースで進められます。1週間を通して試行を重ねられる実行回数と、その過程をまとめて残せる保存件数、そしてより広いブラウザ実行の枠を用意しています。他の人とのプロジェクト共有はProfessionalからです。", features: ["週75回のエージェント実行", "非公開の回路・実行記録75件", "非共有プロジェクトは無制限。1プロジェクトあたり50件まで", "12量子ビットまでのブラウザ実行"], action: "早期アクセスに参加", tone: "featured" },
      { name: "Professional", price: "$240", cadence: "1ユーザーあたり月額", description: "ワークスペースの外の相手にプロジェクトを共有できます。閲覧のみ、または編集可能（相手から回路を追加できます）を選べ、追加できる件数はプロジェクトごとに指定できます。", features: ["ワークスペース外の相手とプロジェクトを共有", "共有プロジェクトは1人あたり4件まで（自分が共有したものと、共有されたものの合計）", "非共有プロジェクトは無制限。1プロジェクトあたり50件まで", "週250回のエージェント実行", "非公開の回路・実行記録250件（共有プロジェクト内のものは含みません）", "18量子ビットまでのブラウザ実行"], action: "お問い合わせ", tone: "quiet" },
      { name: "Enterprise", price: "$420+", cadence: "1ユーザーあたり月額", description: "Professionalのすべての機能に加えて、利用上限、審査の進め方、契約条件を組織ごとに調整します。", features: ["Professionalのすべての機能", "実行回数と保存件数は組織ごとに調整", "社内データや非公開研究に関するご相談", "導入と評価を担当する窓口"], action: "営業担当に相談", tone: "quiet" },
    ],
    note: { label: "早期アクセス版の提供内容", title: "価格は確定していますが、決済はまだ開始していません。", body: "上記は早期アクセス期間の価格（1ユーザーあたり月額）です。現在の環境では支払い方法を登録できず、カード入力も決済も行われないため、請求は発生しません。クレジットの詳細と法人向け条件は、有料提供の開始前に確定します。" },
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
  fields: { name: string; email: string; topic: string; message: string; placeholder: string; submit: string; status: string };
  topics: string[];
}> = {
  en: {
    overline: "Contact queue",
    title: "Tell us what you are trying to build or validate.",
    body: "Leona Quantum is building an evidence layer around quantum software: public research, private workspaces, and execution that can be inspected. Send a short brief and we’ll take it from there.",
    panelTitle: "Good reasons to write",
    reasons: ["Research workflows and early product access", "Enterprise R&D and private-corpus conversations", "Public research contributions and technical feedback", "Press, partnerships, and speaking"],
    note: "Submitting opens a prepared email in your email app. The current queue is mailto-backed; server-side delivery and CRM routing will follow when the operating workflow is finalized.",
    measure: { label: "Measure a qubit" },
    fields: { name: "Name", email: "Email", topic: "What is this about?", message: "Message", placeholder: "What are you building, and what evidence or access would help?", submit: "Prepare inquiry", status: "Your email app should open with the inquiry prepared. Send it to add the note to the queue." },
    topics: ["Product access", "Research workflow", "Enterprise R&D", "Public research contribution", "Other"],
  },
  ja: {
    overline: "お問い合わせ",
    title: "つくりたいもの、確かめたいものを教えてください。",
    body: "Leona Quantumは、量子回路の作成から実行、検証、保存、共有までを支える研究基盤です。研究内容や必要な利用環境をお送りください。",
    panelTitle: "ご連絡いただける内容",
    reasons: ["研究ワークフローと早期アクセス", "企業・研究機関向けの導入相談", "公開研究への投稿と技術フィードバック", "取材、パートナーシップ、登壇"],
    note: "送信ボタンを押すと、入力内容を反映したメール作成画面が開きます。現在、お問い合わせはメールで受け付けています。",
    measure: { label: "量子ビットを測定" },
    fields: { name: "お名前", email: "メールアドレス", topic: "内容", message: "メッセージ", placeholder: "取り組んでいる研究テーマと、必要な実行・検証環境を教えてください。", submit: "メールを作成", status: "内容を確認してメールを送信してください。" },
    topics: ["プロダクトへのアクセス", "研究ワークフロー", "企業R&D", "公開研究への投稿", "その他"],
  },
};

export const WORKSPACE_LANDING_COPY: Record<PublicLocale, {
  overline: string;
  title: string;
  body: string;
  primary: string;
  secondary: string;
  loopLabel: string;
  loopTitle: string;
  loop: Array<{ kicker: string; title: string; body: string }>;
  computeLabel: string;
  computeTitle: string;
  compute: Array<{ title: string; body: string }>;
  note: string;
  foundationsLabel: string;
  foundationsTitle: string;
  foundationsBody: string;
  codeLink: string;
}> = {
  en: {
    overline: "Personal quantum workspace",
    title: "Turn a quantum question into work you can reopen.",
    body: "Leona Quantum connects a guided workflow to a guarded simulator, verification evidence, and a personal Studio for editing and keeping saved work. Every account starts with its own workspace; prompts, runs, and saved artifacts are private by default.",
    primary: "Request workspace access",
    secondary: "Start from the Atlas",
    loopLabel: "One personal loop",
    loopTitle: "Research, Studio, and execution stay connected.",
    loop: [
      { kicker: "01 / RUN", title: "Ask in natural language", body: "Turn a question into a visible plan, generated implementation, simulation, verification, and a readable answer." },
      { kicker: "02 / STUDIO", title: "Inspect and continue", body: "Open a saved circuit, switch framework variants, edit the implementation, and send the next version through the same evidence path." },
      { kicker: "03 / RECORD", title: "Keep the record", body: "Private artifacts keep code, run records, verification, exports, provenance, resources, and limitations together." },
    ],
    computeLabel: "Compute roadmap",
    computeTitle: "Use the right execution lane when the product is ready.",
    compute: [
      { title: "CPU simulation", body: "Current supported path for small, reproducible verified workflows." },
      { title: "GPU simulation", body: "Planned heavy-compute lane for larger circuits; provider, limits, and cost remain explicit." },
      { title: "QPU access", body: "Planned hardware lane with estimates, attestation, and confirmation before spend." },
    ],
    note: "GPU and QPU execution are roadmap items, not available services in this early-access slice.",
    foundationsLabel: "Open foundations",
    foundationsTitle: "Review the engineering boundary.",
    foundationsBody: "The public research surface is open for review, while authenticated workspaces, credentials, and saved artifacts remain account-scoped.",
    codeLink: "Read the public contribution notes",
  },
  ja: {
    overline: "個人量子ワークスペース",
    title: "量子の問いを、再現できる研究成果へ。",
    body: "Leona Quantumは、ガイド付きのワークフローをシミュレータ、検証記録、そして編集と保存を担う個人用Studioにつなぎます。各アカウントには専用ワークスペースが用意され、質問、実行、保存した回路・実行結果は初期状態で非公開です。",
    primary: "利用を相談する",
    secondary: "Atlasから始める",
    loopLabel: "個人の研究ループ",
    loopTitle: "RunとStudioをひとつにつなぐ。",
    loop: [
      { kicker: "01 / RUN", title: "自然言語でたずねる", body: "質問から回路の作成、シミュレーション、検証、回答までを一貫して支援します。" },
      { kicker: "02 / STUDIO", title: "確認して続ける", body: "保存した回路を開き、フレームワークを切り替えて編集し、同じ手順で再実行・再検証できます。" },
      { kicker: "03 / RECORD", title: "記録を残す", body: "コード、実行条件、検証結果、エクスポート、出典、利用した計算資源、制限事項を非公開の研究記録にまとめます。" },
    ],
    computeLabel: "計算ロードマップ",
    computeTitle: "用途に合わせて実行先を選べます。",
    compute: [
      { title: "CPUシミュレーション", body: "小規模で再現可能な検証に、現在利用できる実行環境です。" },
      { title: "GPUシミュレーション", body: "大きな回路向けの実行環境を予定しています。提供元、上限、費用を明示します。" },
      { title: "量子コンピュータで実行", body: "見積り、実行証明、利用前の確認を備えた実機実行を予定しています。" },
    ],
    note: "GPUとQPUの実行はロードマップ項目であり、現在の早期アクセスでは利用できません。",
    foundationsLabel: "公開技術を基盤に",
    foundationsTitle: "公開情報と非公開データの扱いを確認する。",
    foundationsBody: "Atlasの公開研究は誰でも確認できます。非公開ワークスペースの情報は、参加者だけがアクセスできます。",
    codeLink: "公開の貢献ガイドを見る",
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
