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
    note: string;
    scrollCue: string;
  };
  visual: {
    label: string;
    status: string;
    pipeline: Array<{ number: string; label: string; detail: string }>;
    footer: string;
    meta: string;
  };
  intro: { label: string; title: string; body: string };
  product: {
    label: string;
    title: string;
    items: Array<{ index: string; title: string; body: string; action?: string }>;
  };
  principles: {
    label: string;
    title: string;
    items: Array<{ title: string; body: string }>;
  };
  lioness: { label: string; title: string };
  measure: { label: string; title: string; body: string };
  cta: { label: string; title: string; contact: string; pricing: string };
}> = {
  en: {
    hero: {
      title: "Evidence for quantum work.",
      lede: "Public research, a private workspace, and execution that shows its working — in one place.",
      primary: "Explore the Atlas",
      secondary: "Open the workspace",
      contact: "Get in touch",
      note: "For researchers and teams who need results they can inspect and revisit.",
      scrollCue: "Scroll",
    },
    visual: {
      label: "LEONA QUANTUM / PRODUCT",
      status: "EVIDENCE FIRST",
      pipeline: [
        { number: "01", label: "Atlas", detail: "Public algorithms and sources" },
        { number: "02", label: "Workspace", detail: "Build, edit, and retain the record" },
        { number: "03", label: "Execute", detail: "Simulation and verification" },
        { number: "04", label: "Compute", detail: "GPU and QPU lanes ahead" },
      ],
      footer: "Quantum work, with context",
      meta: "PUBLIC · PRIVATE · VERIFIED",
    },
    intro: {
      label: "The company",
      title: "Quantum work needs somewhere for evidence to live.",
      body: "Quantum results are easy to produce and hard to trust. Papers are not runnable, notebooks go stale, and the assumptions behind a number rarely travel with it. Leona Quantum keeps the research, the code, the run, and the check in one record.",
    },
    product: {
      label: "Our product",
      title: "Three parts, one standard of evidence.",
      items: [
        { index: "01", title: "Public research", body: "Explore circuits and algorithms with classification, source context, verification boundaries, classical comparisons, and framework-aware code.", action: "Browse the Atlas" },
        { index: "02", title: "Personal workspace", body: "Turn a natural-language question into a visible plan, implementation, simulation, verification, and saved Vault record.", action: "Open the workspace" },
        { index: "03", title: "Verified execution", body: "Use the supported simulator today, then add heavier compute lanes only when their cost, hardware, and evidence boundaries are clear.", action: "See how it works" },
      ],
    },
    principles: {
      label: "Our principles",
      title: "What we won't trade away.",
      items: [
        { title: "Evidence first", body: "A result you cannot inspect is a claim. The check ships with the answer, including when the check could not run." },
        { title: "Open by default", body: "The Atlas is public because shared groundwork makes private work faster." },
        { title: "Privacy by design", body: "Vault content is yours. Nothing you build there feeds anything public." },
        { title: "Interoperable", body: "Open formats and APIs, so the record outlives the tool that made it." },
      ],
    },
    lioness: {
      label: "The mark",
      title: "She resolves from the noise.",
    },
    measure: {
      label: "How verification works",
      title: "Measured, not asserted.",
      body: "Every result resolves to a distribution, not a claim. Bias the state, take a shot, and watch the tally settle toward |α|², |β|² — the same honesty we hold execution to.",
    },
    cta: {
      label: "Contact",
      title: "Tell us what you’re working on.",
      contact: "Get in touch",
      pricing: "See early-access plans",
    },
  },
  ja: {
    hero: {
      title: "量子研究を、確かめられる成果へ。",
      lede: "公開研究、非公開ワークスペース、実行・検証をひとつに。",
      primary: "Atlasを見る",
      secondary: "ワークスペースを開く",
      contact: "お問い合わせ",
      note: "結果を確かめ、あとからもう一度たどりたい研究者とチームのために。",
      scrollCue: "スクロール",
    },
    visual: {
      label: "LEONA QUANTUM / PRODUCT",
      status: "実行結果まで確かめる",
      pipeline: [
        { number: "01", label: "Atlas", detail: "公開アルゴリズムと出典" },
        { number: "02", label: "ワークスペース", detail: "回路を作る、試す、履歴を残す" },
        { number: "03", label: "実行", detail: "シミュレーションと検証" },
        { number: "04", label: "計算", detail: "GPU・QPUへ拡張予定" },
      ],
      footer: "コード・実行条件・検証結果をひとつに",
      meta: "公開 · 非公開 · 検証済み",
    },
    intro: {
      label: "会社情報",
      title: "量子研究のコード、実行条件、結果、検証内容を、ひとつの記録に。",
      body: "量子計算の結果は、数値だけでは信頼性を判断できません。論文、コード、実行条件、結果、検証内容をひとつにまとめ、あとから確認・再現できる研究記録として残します。",
    },
    product: {
      label: "プロダクト",
      title: "研究・実行・検証を、ひとつの記録に。",
      items: [
        { index: "01", title: "公開された量子研究", body: "回路とアルゴリズムの分類、出典、検証範囲、古典計算との比較、フレームワーク別コードを確認できます。", action: "Atlasを見る" },
        { index: "02", title: "個人ワークスペース", body: "質問を入力すると、計画、回路の実装、シミュレーション、検証まで進み、結果をVaultに保存できます。", action: "ワークスペースを開く" },
        { index: "03", title: "検証できる実行", body: "まずは対応済みのシミュレータで実行できます。高性能な計算環境は、費用、利用条件、検証範囲を明示したうえで順次追加します。", action: "仕組みを見る" },
      ],
    },
    principles: {
      label: "原則",
      title: "Leona Quantumが大切にすること",
      items: [
        { title: "結果だけでなく、検証内容も示す", body: "確認できない結果は、検証済みとして扱いません。検証できなかった場合も、そのまま記録します。" },
        { title: "公開できる研究は、誰でも確認できる形に", body: "共有された研究を再利用できるよう、Atlasは公開しています。" },
        { title: "非公開の研究データは、初めから保護", body: "Vaultの内容は利用者のものです。非公開ワークスペースの作業が自動的に公開されることはありません。" },
        { title: "相互運用性", body: "オープンな形式とAPIに対応し、ツールが変わっても記録を再利用できます。" },
      ],
    },
    lioness: {
      label: "マーク",
      title: "ノイズの中から、確かな結果を見つける。",
    },
    measure: {
      label: "検証の仕組み",
      title: "主張ではなく、測定を。",
      body: "量子計算の結果は、断定ではなく測定値の分布として示します。状態を変えて測定を繰り返すと、集計は|α|²、|β|²へ近づきます。実行結果も、確認できる記録とともに示します。",
    },
    cta: {
      label: "お問い合わせ",
      title: "取り組んでいる研究や技術課題についてご相談ください。",
      contact: "お問い合わせ",
      pricing: "早期アクセスのプランを見る",
    },
  },
};

export const PRICING_COPY: Record<PublicLocale, {
  hero: { title: string; body: string };
  plans: Array<{ name: string; price: string; cadence: string; description: string; features: string[]; action: string; tone: "quiet" | "featured" }>;
  note: { label: string; title: string; body: string };
}> = {
  en: {
    hero: { title: "A clear path from first run to team work.", body: "Start free, keep private work in your Vault, and move up when you need more verification capacity, export tooling, or shared R&D controls." },
    plans: [
      { name: "Free", price: "$0", cadence: "while early access is open", description: "Enough to browse the public evidence and put the workbench through a real problem.", features: ["The full public Atlas", "5 agent runs a week", "25 private Vault artifacts", "Browser simulation up to 16 qubits"], action: "Try the preview", tone: "quiet" },
      { name: "Pro", price: "Early access", cadence: "for individual researchers", description: "More room for private research, stronger model tiers, and export-aware workflows.", features: ["Higher run limits", "Private artifacts and versions", "Baselines and export matrix", "Priority access to new capabilities"], action: "Join early access", tone: "featured" },
      { name: "Team", price: "Let’s talk", cadence: "for shared R&D and governance", description: "Shared workspaces, private corpora, auditability, and evaluation support as the product matures.", features: ["Team workspaces and roles", "Private corpus boundary", "Audit and governance workflows", "Design-partner conversations"], action: "Contact us", tone: "quiet" },
    ],
    note: { label: "A transparent starting point", title: "The product is live; paid billing is not.", body: "These plans describe the intended early-access packaging. Exact limits, credits, and checkout will be confirmed before paid billing is enabled. No card is required to explore the public Atlas or discuss a research workflow." },
  },
  ja: {
    hero: { title: "まずは個人で試し、そのままチームで研究へ。", body: "無料で始め、非公開の研究はVaultに保存できます。検証できる実行回数、エクスポート、共同研究の管理が必要になったら次のプランへ進めます。" },
    plans: [
      { name: "Free", price: "$0", cadence: "早期アクセス期間中", description: "公開されている回路と検証結果を確認し、実際の課題で一連の操作を試せます。", features: ["公開Atlasのすべて", "週5回のエージェント実行", "非公開の回路・実行記録25件", "16量子ビットまでのブラウザ実行"], action: "プレビューを試す", tone: "quiet" },
      { name: "Pro", price: "早期アクセス", cadence: "個人研究者向け", description: "非公開研究、上位AIモデル、エクスポート機能を利用できます。", features: ["実行上限の拡張", "非公開の回路・実行記録とバージョン管理", "古典計算との比較・各形式での書き出し", "新機能への優先アクセス"], action: "早期アクセスに参加", tone: "featured" },
      { name: "Team", price: "ご相談ください", cadence: "共同研究と管理機能向け", description: "共有ワークスペース、非公開データ、監査、評価支援を段階的に提供します。", features: ["チームと権限", "非公開データの分離", "監査とガバナンス", "共同開発・導入相談"], action: "お問い合わせ", tone: "quiet" },
    ],
    note: { label: "早期アクセス版の提供内容", title: "サービスは利用できますが、有料プランの決済はまだ開始していません。", body: "ここに示すのは提供予定のプラン内容です。利用上限、クレジット、決済条件は、有料提供の開始前に確定します。公開Atlasの閲覧や研究の相談にカードは必要ありません。" },
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
    body: "Leona Quantum connects a guided workflow to a guarded simulator, verification evidence, Studio editing, and a personal Vault. Every account starts with its own workspace; prompts, runs, and saved artifacts are private by default.",
    primary: "Request workspace access",
    secondary: "Start from the Atlas",
    loopLabel: "One personal loop",
    loopTitle: "Research, Studio, Vault, and execution stay connected.",
    loop: [
      { kicker: "01 / RUN", title: "Ask in natural language", body: "Turn a question into a visible plan, generated implementation, simulation, verification, and a readable answer." },
      { kicker: "02 / STUDIO", title: "Inspect and continue", body: "Open a saved circuit, switch framework variants, edit the implementation, and send the next version through the same evidence path." },
      { kicker: "03 / VAULT", title: "Keep the record", body: "Private artifacts keep code, run records, verification, exports, provenance, resources, and limitations together." },
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
    body: "Leona Quantumは、ガイド付きのワークフローをシミュレータ、検証記録、Studio、個人用Vaultにつなぎます。各アカウントには専用ワークスペースが用意され、質問、実行、保存した回路・実行結果は初期状態で非公開です。",
    primary: "利用を相談する",
    secondary: "Atlasから始める",
    loopLabel: "個人の研究ループ",
    loopTitle: "Run、Studio、Vaultをひとつにつなぐ。",
    loop: [
      { kicker: "01 / RUN", title: "自然言語でたずねる", body: "質問から回路の作成、シミュレーション、検証、回答までを一貫して支援します。" },
      { kicker: "02 / STUDIO", title: "確認して続ける", body: "保存した回路を開き、フレームワークを切り替えて編集し、同じ手順で再実行・再検証できます。" },
      { kicker: "03 / VAULT", title: "記録を残す", body: "コード、実行条件、検証結果、エクスポート、出典、利用した計算資源、制限事項を非公開の研究記録にまとめます。" },
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
      { title: "2. How we use information", paragraphs: ["We use information to authenticate users, run and verify requested workflows, save and reopen Vault artifacts, provide support, secure the service, diagnose failures, and improve reliability and product quality.", "We may use aggregated or de-identified operational information to understand performance. We do not present private workspace artifacts as public Atlas material without an explicit publish action."] },
      { title: "3. Service providers and infrastructure", paragraphs: ["Leona Quantum relies on specialized providers for hosting, authentication, databases, observability, model access, and isolated code execution. Those providers may process information only as needed to provide their services.", "Generated code is treated as untrusted input and is intended to run in an isolated, network-restricted execution environment. Do not submit secrets or information you are not authorized to process."] },
      { title: "4. Public and private work", paragraphs: ["Public Atlas entries are separate from private Vaults. A Vault entry is private by default. Publishing is an explicit action that may make an artifact, its code, and its evidence available to other people; review the content before publishing."] },
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
      { title: "2. 情報の利用目的", paragraphs: ["認証、ワークフローの実行と検証、Vaultへの保存と再表示、サポート、セキュリティ、障害診断、信頼性と品質の改善に利用します。", "集計または匿名化した運用情報を性能の把握と改善に利用することがあります。非公開ワークスペースの内容を、明示的な公開操作なしに公開Atlasへ掲載することはありません。"] },
      { title: "3. サービスプロバイダとインフラ", paragraphs: ["Leona Quantumは、ホスティング、認証、データベース、稼働状況の監視、AIモデルの利用、隔離されたコード実行のために専門プロバイダを利用します。プロバイダはサービス提供に必要な範囲で情報を処理します。", "生成コードは信頼できない入力として扱い、ネットワークアクセスを制限した隔離環境で実行することを想定しています。秘密情報や、処理する権限のない情報は送信しないでください。"] },
      { title: "4. 公開と非公開の研究", paragraphs: ["Atlasの公開資料と非公開Vaultの内容は分けて管理されます。Vaultの内容は初期状態では非公開です。公開すると、保存した回路、コード、検証結果が他の利用者に表示される場合があります。公開前に内容を確認してください。"] },
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
    lede: "The rules for using the Leona Quantum website, workbench, Vault, and public Atlas.",
    updated: "Last updated: July 15, 2026",
    noteLabel: "Early-access note:",
    noteBody: "These plain-language terms are a practical starting point for the current product. Additional commercial terms may apply when paid plans or enterprise agreements become available.",
    sections: [
      { title: "1. Using Leona Quantum", paragraphs: ["By accessing Leona Quantum, you agree to use the service lawfully, respect other users, and follow these terms. If you use it for an organization, you represent that you have authority to accept these terms on its behalf."] },
      { title: "2. Prohibited use", paragraphs: ["Do not use the service to violate law or third-party rights, exfiltrate secrets, attack infrastructure, bypass usage controls, submit malware, or interfere with the service or another person’s workspace. Do not use generated code or results as a substitute for professional review in safety-critical, financial, medical, or regulated settings."] },
      { title: "3. Generated work and verification", paragraphs: ["Leona Quantum helps generate, execute, and analyze technical work. Generated code can be incomplete or wrong. A verification result means that the documented checks passed for the recorded run and conditions; it is not a guarantee of correctness in every environment or a promise of algorithmic advantage."] },
      { title: "4. Your content", paragraphs: ["You keep the rights you have in content you submit. You grant Leona Quantum the limited permission needed to host, process, execute, display, back up, and improve the service for you. Private Vault content is not public by default."] },
      { title: "5. Early-access packaging", paragraphs: ["Leona Quantum is currently an early-access product. The pricing page describes intended packaging; paid billing, limits, credits, and refunds will be governed by terms shown before a transaction is enabled."] },
      { title: "6. Disclaimers", paragraphs: ["To the extent permitted by law, the service is provided without warranties that it will be uninterrupted, error-free, secure, or suitable for a particular purpose. You use generated code, simulations, exports, and public artifacts at your own risk.", "Nothing on Leona Quantum is legal, medical, financial, or safety advice. Any limitation of liability or indemnity terms required for a paid or enterprise relationship will be stated in the applicable commercial agreement."] },
      { title: "7. Changes and contact", paragraphs: ["Use the contact page for questions about these terms. We may update them as the service adds accounts, paid plans, and new execution capabilities; the date above identifies the current version."] },
    ],
  },
  ja: {
    title: "利用規約",
    lede: "Leona Quantumの公開サイト、ワークベンチ、Vault、Atlasを利用するためのルールです。",
    updated: "最終更新日: 2026年7月15日",
    noteLabel: "早期アクセスに関する注記:",
    noteBody: "これは現在のサービスに適用する基本条件です。有料プランや法人向け契約には、追加の商用条件が適用されることがあります。",
    sections: [
      { title: "1. Leona Quantumの利用", paragraphs: ["Leona Quantumへアクセスすることで、本サービスを適法に利用し、他の利用者を尊重し、本規約に従うことに同意します。組織のために利用する場合、その組織を代表して同意する権限があることを表明します。"] },
      { title: "2. 禁止される利用", paragraphs: ["法令や第三者の権利への違反、秘密情報の持ち出し、インフラへの攻撃、利用制限の回避、マルウェアの送信、サービスや他の人のワークスペースへの妨害に利用しないでください。安全性が重要な分野、金融、医療、規制対象の場面で、生成コードや結果を専門家の確認の代わりにしないでください。"] },
      { title: "3. 生成物と検証", paragraphs: ["Leona Quantumは技術的な作業の生成、実行、分析を支援します。生成コードは不完全または誤っている可能性があります。検証結果は、記録された条件で所定の検証に合格したことを示すもので、あらゆる環境での正しさやアルゴリズム上の優位性を保証しません。"] },
      { title: "4. 利用者のコンテンツ", paragraphs: ["利用者は、送信したコンテンツについて、自らが保有する権利を引き続き保持します。Leona Quantumには、サービスを提供するためにホスト、処理、実行、表示、バックアップ、改善するための限定的な許諾を与えます。非公開Vaultの内容は初期状態で公開されません。"] },
      { title: "5. 早期アクセスの提供条件", paragraphs: ["Leona Quantumは現在、早期アクセス版のサービスです。料金ページは提供予定のプラン内容を示しています。決済、利用上限、クレジット、返金の条件は、有料サービスの申込み前に表示します。"] },
      { title: "6. 免責事項", paragraphs: ["法令で許される範囲で、サービスが中断しないこと、エラーがないこと、安全であること、特定目的に適合することを保証しません。生成コード、シミュレーション、エクスポート、公開されている回路・実行記録の利用は自己責任で行ってください。", "Leona Quantum上の情報は、法務、医療、金融、安全に関する助言ではありません。有料または法人向け契約に必要な責任制限や補償条件は、該当する商用契約に記載します。"] },
      { title: "7. 変更とお問い合わせ", paragraphs: ["規約に関する質問はお問い合わせページからお送りください。アカウント、有料プラン、新しい実行機能の追加に応じて更新することがあります。上記の日付が最新版を示します。"] },
    ],
  },
};
