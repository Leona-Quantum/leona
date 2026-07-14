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
    repository: "Loading repository",
    status: "Loading content",
  },
  ja: {
    root: "Leona Quantumを読み込んでいます",
    workspace: "ワークスペースを読み込んでいます",
    dashboard: "ダッシュボードを読み込んでいます",
    repository: "リポジトリを読み込んでいます",
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
  cta: { label: string; title: string; contact: string; pricing: string };
}> = {
  en: {
    hero: {
      title: "Evidence for quantum work.",
      lede: "Leona Quantum brings public research, a private workspace, and verified execution into one calm place.",
      primary: "Explore the repository",
      secondary: "Open the workspace",
      contact: "Get in touch",
      note: "For researchers and teams who need results they can inspect and revisit.",
    },
    visual: {
      label: "LEONA QUANTUM / PRODUCT",
      status: "EVIDENCE FIRST",
      pipeline: [
        { number: "01", label: "Repository", detail: "Public algorithms and sources" },
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
      body: "The next generation of quantum software will be built from research that can be inspected, experiments that can be repeated, and results whose assumptions stay visible. Leona Quantum is building that connective layer.",
    },
    product: {
      label: "Our product",
      title: "Two experiences. One standard of truth.",
      items: [
        { index: "01", title: "Public research", body: "Explore circuits and algorithms with classification, source context, verification boundaries, classical comparisons, and framework-aware code.", action: "Browse the repository" },
        { index: "02", title: "Personal workspace", body: "Turn a natural-language question into a visible plan, implementation, simulation, verification, and saved Library record.", action: "Open the workspace" },
        { index: "03", title: "Verified execution", body: "Use the supported simulator today, then add heavier compute lanes only when their cost, hardware, and evidence boundaries are clear.", action: "See how it works" },
      ],
    },
    principles: {
      label: "Our principles",
      title: "Built on principles that compound.",
      items: [
        { title: "Evidence first", body: "We value results you can inspect and reproduce." },
        { title: "Open by default", body: "Public research accelerates private discovery." },
        { title: "Privacy by design", body: "Your work is yours—secure by default, always." },
        { title: "Interoperable", body: "Open formats and APIs keep knowledge portable." },
      ],
    },
    cta: {
      label: "Contact",
      title: "Let’s build what’s next.",
      contact: "Get in touch",
      pricing: "See early-access plans",
    },
  },
  ja: {
    hero: {
      title: "量子研究に、検証できる根拠を。",
      lede: "Leona Quantumは、公開研究、個人ワークスペース、検証済みの実行をひとつの場所につなぎます。",
      primary: "リポジトリを見る",
      secondary: "ワークスペースを開く",
      contact: "お問い合わせ",
      note: "結果を確かめ、あとからもう一度たどりたい研究者とチームのために。",
    },
    visual: {
      label: "LEONA QUANTUM / PRODUCT",
      status: "根拠を優先",
      pipeline: [
        { number: "01", label: "リポジトリ", detail: "公開アルゴリズムと出典" },
        { number: "02", label: "ワークスペース", detail: "作成、編集、記録の保持" },
        { number: "03", label: "実行", detail: "シミュレーションと検証" },
        { number: "04", label: "計算", detail: "GPU・QPUへ拡張予定" },
      ],
      footer: "文脈とともに進める量子開発",
      meta: "公開 · 非公開 · 検証済み",
    },
    intro: {
      label: "会社情報",
      title: "量子研究には、根拠を置いておける場所が必要です。",
      body: "これからの量子ソフトウェアは、確認できる研究、繰り返せる実験、前提が見える結果から生まれます。Leona Quantumは、その間をつなぐ層をつくっています。",
    },
    product: {
      label: "プロダクト",
      title: "二つの体験。ひとつの基準。",
      items: [
        { index: "01", title: "公開研究", body: "分類、出典、検証の境界、古典比較、フレームワーク別コードを確認しながら回路とアルゴリズムを探索できます。", action: "リポジトリを見る" },
        { index: "02", title: "個人ワークスペース", body: "自然言語の問いを、計画、実装、シミュレーション、検証、保存できるLibraryの記録へ変えます。", action: "ワークスペースを開く" },
        { index: "03", title: "検証可能な実行", body: "まずは対応済みのシミュレータを使い、コスト、ハードウェア、根拠の境界が明確になった計算レーンを追加します。", action: "仕組みを見る" },
      ],
    },
    principles: {
      label: "原則",
      title: "積み重なる原則からつくる。",
      items: [
        { title: "根拠を先に", body: "確認と再現ができる結果を大切にします。" },
        { title: "まず開く", body: "公開研究が非公開の発見を加速します。" },
        { title: "プライバシーを設計に", body: "あなたの成果はあなたのもの。常に非公開を基本にします。" },
        { title: "相互運用性", body: "オープンな形式とAPIで知識を持ち運べます。" },
      ],
    },
    cta: {
      label: "お問い合わせ",
      title: "次の一歩を一緒につくりましょう。",
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
    hero: { title: "A clear path from first run to team work.", body: "Start free, keep private work in your Library, and move up when you need more verification capacity, export tooling, or shared R&D controls." },
    plans: [
      { name: "Free", price: "$0", cadence: "while early access is open", description: "A low-friction way to browse public evidence and try the workbench.", features: ["Public repository access", "Small verified-run allowance", "Private Library", "Limited Studio access"], action: "Try the preview", tone: "quiet" },
      { name: "Pro", price: "Early access", cadence: "for individual researchers", description: "More room for private research, stronger model tiers, and export-aware workflows.", features: ["Higher run limits", "Private artifacts and versions", "Baselines and export matrix", "Priority access to new capabilities"], action: "Join early access", tone: "featured" },
      { name: "Team", price: "Let’s talk", cadence: "for shared R&D and governance", description: "Shared workspaces, private corpora, auditability, and evaluation support as the product matures.", features: ["Team workspaces and roles", "Private corpus boundary", "Audit and governance workflows", "Design-partner conversations"], action: "Contact us", tone: "quiet" },
    ],
    note: { label: "A transparent starting point", title: "The product is live; paid billing is not.", body: "These plans describe the intended early-access packaging. Exact limits, credits, and checkout will be confirmed before paid billing is enabled. No card is required to explore the public repository or discuss a research workflow." },
  },
  ja: {
    hero: { title: "最初の実行からチームの研究まで、明確な道筋を。", body: "無料で始め、非公開の研究はLibraryに保存できます。検証量、エクスポート、共同R&Dの管理が必要になったら次の段階へ進めます。" },
    plans: [
      { name: "Free", price: "$0", cadence: "早期アクセス期間中", description: "公開された根拠を見ながら、ワークベンチを試すための入口です。", features: ["公開リポジトリ", "少量の検証実行", "非公開Library", "Studioの一部機能"], action: "プレビューを試す", tone: "quiet" },
      { name: "Pro", price: "早期アクセス", cadence: "個人研究者向け", description: "非公開研究、モデルの選択肢、エクスポートを意識したワークフローを広げます。", features: ["実行上限の拡張", "非公開アーティファクトと版管理", "ベースラインとエクスポート表", "新機能への優先アクセス"], action: "早期アクセスに参加", tone: "featured" },
      { name: "Team", price: "ご相談ください", cadence: "共同R&Dとガバナンス向け", description: "共有ワークスペース、非公開コーパス、監査性、評価支援を段階的に提供します。", features: ["チームと権限", "非公開コーパスの境界", "監査とガバナンス", "デザインパートナー対話"], action: "お問い合わせ", tone: "quiet" },
    ],
    note: { label: "透明なスタート", title: "プロダクトは稼働中。決済はまだです。", body: "ここに示すのは早期アクセスの想定パッケージです。上限、クレジット、決済は有効化前に確定します。公開リポジトリの閲覧や研究の相談にカードは必要ありません。" },
  },
};

export const CONTACT_COPY: Record<PublicLocale, {
  overline: string;
  title: string;
  body: string;
  panelTitle: string;
  reasons: string[];
  formLabel: string;
  formTitle: string;
  formBody: string;
  note: string;
  fields: { name: string; email: string; topic: string; message: string; placeholder: string; submit: string; status: string };
  topics: string[];
}> = {
  en: {
    overline: "Contact queue",
    title: "Tell us what you are trying to build or validate.",
    body: "Leona Quantum is building an evidence layer around quantum software: public research, private workspaces, and execution that can be inspected. Send a short brief and we’ll take it from there.",
    panelTitle: "Good reasons to write",
    reasons: ["Research workflows and early product access", "Enterprise R&D and private-corpus conversations", "Public research contributions and technical feedback", "Press, partnerships, and speaking"],
    formLabel: "Start a conversation",
    formTitle: "A short brief is enough.",
    formBody: "Tell us the question, the current workflow, and what evidence would help you move forward.",
    note: "Submitting opens a prepared email in your email app. The current queue is mailto-backed; server-side delivery and CRM routing will follow when the operating workflow is finalized.",
    fields: { name: "Name", email: "Email", topic: "What is this about?", message: "Message", placeholder: "What are you building, and what evidence or access would help?", submit: "Prepare inquiry", status: "Your email app should open with the inquiry prepared. Send it to add the note to the queue." },
    topics: ["Product access", "Research workflow", "Enterprise R&D", "Public research contribution", "Other"],
  },
  ja: {
    overline: "お問い合わせ",
    title: "つくりたいもの、確かめたいものを教えてください。",
    body: "Leona Quantumは、公開研究、非公開ワークスペース、確認できる実行をつなぐ量子ソフトウェアの根拠の層をつくっています。短い概要をお送りください。",
    panelTitle: "ご連絡いただける内容",
    reasons: ["研究ワークフローと早期アクセス", "企業R&Dと非公開コーパス", "公開研究への投稿と技術フィードバック", "取材、パートナーシップ、登壇"],
    formLabel: "対話を始める",
    formTitle: "短い概要で十分です。",
    formBody: "問い、現在のワークフロー、前に進むために必要な根拠を教えてください。",
    note: "送信すると、メールアプリで内容を準備したメールが開きます。現在はmailto方式で、サーバー配信とCRM連携は運用が固まり次第対応します。",
    fields: { name: "お名前", email: "メールアドレス", topic: "内容", message: "メッセージ", placeholder: "何をつくり、どんな根拠やアクセスが必要ですか？", submit: "問い合わせを準備", status: "メールアプリに内容を準備したメールが開きます。送信するとキューに追加されます。" },
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
    body: "Leona Quantum connects a guided workflow to a guarded simulator, verification evidence, Studio editing, and a personal Library. Every account starts with its own workspace; prompts, runs, and saved artifacts are private by default.",
    primary: "Request workspace access",
    secondary: "Start from the repository",
    loopLabel: "One personal loop",
    loopTitle: "Research, Studio, Library, and execution stay connected.",
    loop: [
      { kicker: "01 / RUN", title: "Ask in natural language", body: "Turn a question into a visible plan, generated implementation, simulation, verification, and a readable answer." },
      { kicker: "02 / STUDIO", title: "Inspect and continue", body: "Open a saved circuit, switch framework variants, edit the implementation, and send the next version through the same evidence path." },
      { kicker: "03 / LIBRARY", title: "Keep the record", body: "Private artifacts keep code, run records, verification, exports, provenance, resources, and limitations together." },
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
    title: "量子の問いを、あとから開ける研究へ。",
    body: "Leona Quantumは、ガイド付きのワークフローを保護されたシミュレータ、検証の根拠、Studio編集、個人Libraryにつなぎます。各アカウントは専用ワークスペースから始まり、問い、実行、保存アーティファクトは基本的に非公開です。",
    primary: "ワークスペースを相談する",
    secondary: "リポジトリから始める",
    loopLabel: "個人の研究ループ",
    loopTitle: "研究、Studio、Library、実行をひとつにつなぐ。",
    loop: [
      { kicker: "01 / RUN", title: "自然言語でたずねる", body: "問いを計画、実装、シミュレーション、検証、読みやすい回答へつなげます。" },
      { kicker: "02 / STUDIO", title: "確認して続ける", body: "保存した回路を開き、フレームワークを切り替え、同じ根拠の流れで次の版を試せます。" },
      { kicker: "03 / LIBRARY", title: "記録を残す", body: "コード、実行、検証、エクスポート、出典、リソース、制限を非公開アーティファクトにまとめます。" },
    ],
    computeLabel: "計算ロードマップ",
    computeTitle: "準備ができた計算レーンを選ぶ。",
    compute: [
      { title: "CPUシミュレーション", body: "小規模で再現可能な検証ワークフローを支える現在の対応パスです。" },
      { title: "GPUシミュレーション", body: "大きな回路向けの計算レーンを予定しています。プロバイダ、上限、コストを明示します。" },
      { title: "QPUアクセス", body: "見積り、アテステーション、利用前の確認を備えたハードウェアレーンを予定しています。" },
    ],
    note: "GPUとQPUの実行はロードマップ項目であり、現在の早期アクセスでは利用できません。",
    foundationsLabel: "開かれた基盤",
    foundationsTitle: "エンジニアリングの境界を読む。",
    foundationsBody: "公開研究は確認できる形で開き、認証済みワークスペース、資格情報、保存アーティファクトはアカウント単位で管理します。",
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
      { title: "2. How we use information", paragraphs: ["We use information to authenticate users, run and verify requested workflows, save and reopen Library artifacts, provide support, secure the service, diagnose failures, and improve reliability and product quality.", "We may use aggregated or de-identified operational information to understand performance. We do not present private workspace artifacts as public repository material without an explicit publish action."] },
      { title: "3. Service providers and infrastructure", paragraphs: ["Leona Quantum relies on specialized providers for hosting, authentication, databases, observability, model access, and isolated code execution. Those providers may process information only as needed to provide their services.", "Generated code is treated as untrusted input and is intended to run in an isolated, network-restricted execution environment. Do not submit secrets or information you are not authorized to process."] },
      { title: "4. Public and private work", paragraphs: ["Public repository entries are separate from private Libraries. A Library entry is private by default. Publishing is an explicit action that may make an artifact, its code, and its evidence available to other people; review the content before publishing."] },
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
    noteBody: "このページは現在のプロダクトと運用方法を説明します。Leona Quantumの成長、有料サービス、事業体制の正式化に合わせて更新します。",
    sections: [
      { title: "1. 受け取る情報", paragraphs: ["アカウントを作成または利用すると、メールアドレスや認証情報などのアカウント情報を受け取ることがあります。", "ワークベンチの利用時には、送信した問い、生成コード、回路データ、実行設定、シミュレーション結果、検証記録、保存アーティファクト、関連メタデータを処理することがあります。", "お問い合わせいただいた場合は、メッセージに含まれる情報と返信に必要な情報を受け取ります。"] },
      { title: "2. 情報の利用目的", paragraphs: ["認証、ワークフローの実行と検証、Libraryアーティファクトの保存と再開、サポート、セキュリティ、障害診断、信頼性と品質の改善に利用します。", "集計または匿名化した運用情報を性能理解と改善に利用することがあります。非公開ワークスペースのアーティファクトを、明示的な公開操作なしに公開リポジトリへ掲載することはありません。"] },
      { title: "3. サービスプロバイダとインフラ", paragraphs: ["Leona Quantumは、ホスティング、認証、データベース、可観測性、モデル利用、隔離されたコード実行のために専門プロバイダを利用します。プロバイダはサービス提供に必要な範囲で情報を処理します。", "生成コードは信頼できない入力として扱い、隔離されネットワーク制限された環境で実行することを想定しています。秘密情報や、処理する権限のない情報は送信しないでください。"] },
      { title: "4. 公開と非公開の研究", paragraphs: ["公開リポジトリのエントリは非公開Libraryと分離されています。Libraryの内容は基本的に非公開です。公開操作を行うと、アーティファクト、コード、根拠が他の人に見える可能性があるため、公開前に内容を確認してください。"] },
      { title: "5. 保持と選択肢", paragraphs: ["サービス提供、正当な運用、紛争解決、適用される義務への対応に必要な期間、アカウントとワークスペースの記録を保持します。保持期間は記録の種類やアカウント状態で異なることがあります。", "アカウントに関する情報の確認、該当する場合の訂正・削除、プライバシーに関する質問はお問い合わせページからご連絡ください。対応前に本人確認をお願いすることがあります。"] },
      { title: "6. Cookieとセキュリティ", paragraphs: ["認証済みプロダクトでは、安全なセッションを維持するためにCookieなどを利用します。公開サイトでも、ブラウザやホスティング基盤から通常の技術情報を受け取ることがあります。", "プロダクトの段階に応じた合理的な対策を講じますが、オンラインサービスが完全な安全性を保証することはできません。認証情報を管理し、APIキー、パスワード、規制対象データを問いや生成コードに入れないでください。"] },
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
    lede: "The rules for using the Leona Quantum website, workbench, Library, and public repository.",
    updated: "Last updated: July 15, 2026",
    noteLabel: "Early-access note:",
    noteBody: "These plain-language terms are a practical starting point for the current product. Additional commercial terms may apply when paid plans or enterprise agreements become available.",
    sections: [
      { title: "1. Using Leona Quantum", paragraphs: ["By accessing Leona Quantum, you agree to use the service lawfully, respect other users, and follow these terms. If you use it for an organization, you represent that you have authority to accept these terms on its behalf."] },
      { title: "2. Prohibited use", paragraphs: ["Do not use the service to violate law or third-party rights, exfiltrate secrets, attack infrastructure, bypass usage controls, submit malware, or interfere with the service or another person’s workspace. Do not use generated code or results as a substitute for professional review in safety-critical, financial, medical, or regulated settings."] },
      { title: "3. Generated work and verification", paragraphs: ["Leona Quantum helps generate, execute, and analyze technical work. Generated code can be incomplete or wrong. A verification result means that the documented checks passed for the recorded run and conditions; it is not a guarantee of correctness in every environment or a promise of algorithmic advantage."] },
      { title: "4. Your content", paragraphs: ["You keep the rights you have in content you submit. You grant Leona Quantum the limited permission needed to host, process, execute, display, back up, and improve the service for you. Private Library content is not public by default."] },
      { title: "5. Early-access packaging", paragraphs: ["Leona Quantum is currently an early-access product. The pricing page describes intended packaging; paid billing, limits, credits, and refunds will be governed by terms shown before a transaction is enabled."] },
      { title: "6. Disclaimers", paragraphs: ["To the extent permitted by law, the service is provided without warranties that it will be uninterrupted, error-free, secure, or suitable for a particular purpose. You use generated code, simulations, exports, and public artifacts at your own risk.", "Nothing on Leona Quantum is legal, medical, financial, or safety advice. Any limitation of liability or indemnity terms required for a paid or enterprise relationship will be stated in the applicable commercial agreement."] },
      { title: "7. Changes and contact", paragraphs: ["Use the contact page for questions about these terms. We may update them as the service adds accounts, paid plans, and new execution capabilities; the date above identifies the current version."] },
    ],
  },
  ja: {
    title: "利用規約",
    lede: "Leona Quantumの公開サイト、ワークベンチ、Library、公開リポジトリを利用するためのルールです。",
    updated: "最終更新日: 2026年7月15日",
    noteLabel: "早期アクセスに関する注記:",
    noteBody: "これは現在のプロダクトのための平易な出発点です。有料プランやエンタープライズ契約には追加の商用条件が適用されることがあります。",
    sections: [
      { title: "1. Leona Quantumの利用", paragraphs: ["Leona Quantumへアクセスすることで、適法に利用し、他の利用者を尊重し、本規約に従うことに同意します。組織のために利用する場合、その組織を代表して同意する権限があることを表明します。"] },
      { title: "2. 禁止される利用", paragraphs: ["法令や第三者の権利への違反、秘密情報の持ち出し、インフラへの攻撃、利用制限の回避、マルウェアの送信、サービスや他の人のワークスペースへの妨害に利用しないでください。安全性が重要な分野、金融、医療、規制対象の場面で、生成コードや結果を専門家の確認の代わりにしないでください。"] },
      { title: "3. 生成物と検証", paragraphs: ["Leona Quantumは技術的な作業の生成、実行、分析を支援します。生成コードは不完全または誤っている可能性があります。検証結果は、記録された実行と条件に対して文書化されたチェックが通ったことを示すもので、あらゆる環境での正しさやアルゴリズム上の優位性を保証しません。"] },
      { title: "4. 利用者のコンテンツ", paragraphs: ["送信したコンテンツについて、利用者が持つ権利は保持されます。Leona Quantumには、サービスを提供するためにホスト、処理、実行、表示、バックアップ、改善するための限定的な許諾を与えます。非公開Libraryの内容は基本的に公開されません。"] },
      { title: "5. 早期アクセスのパッケージ", paragraphs: ["Leona Quantumは現在早期アクセスのプロダクトです。料金ページは想定パッケージを示すもので、有料化前に表示される条件が決済、上限、クレジット、返金を定めます。"] },
      { title: "6. 免責事項", paragraphs: ["法令で許される範囲で、サービスが中断しないこと、エラーがないこと、安全であること、特定目的に適合することを保証しません。生成コード、シミュレーション、エクスポート、公開アーティファクトの利用は自己責任で行ってください。", "Leona Quantum上の情報は、法務、医療、金融、安全に関する助言ではありません。有料またはエンタープライズ関係に必要な責任制限や補償条件は、該当する商用契約に記載します。"] },
      { title: "7. 変更とお問い合わせ", paragraphs: ["規約に関する質問はお問い合わせページからお送りください。アカウント、有料プラン、新しい実行機能の追加に応じて更新することがあります。上記の日付が最新版を示します。"] },
    ],
  },
};
