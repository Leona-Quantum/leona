import type { PublicLocale } from "./public-locale";

export const WORKSPACE_COPY: Record<PublicLocale, {
  surfaces: { brandedRun: string; preview: string };
  sidebar: {
    newChat: string;
    recent: string;
    folders: string;
    synced: string;
    localOnly: string;
    noFolder: string;
    folderName: string;
    allChats: string;
    viewAll: string;
    settings: string;
    workspaceNav: string;
    readOnlyData: string;
    personalWorkspace: string;
    yesterday: string;
    daysAgo: (days: number) => string;
    publicPreview: string;
    localDeveloper: string;
    workspaceOptions: string;
    recentChats: string;
    moveToFolder: (title: string) => string;
    chatFolders: string;
    createChatFolder: string;
    saveFolder: string;
    cancelFolder: string;
  };
  run: {
    title: string;
    lede: string;
    previewStatus: string;
    readyStatus: string;
    workflowTitle: string;
    workflowBody: string;
    capabilities: Array<{ title: string; body: string }>;
    examplesTitle: string;
    examples: Array<{ title: string; prompt: string }>;
    contextLabel: string;
    viewArtifact: string;
    contextStatus: string;
    contextUnavailable: string;
  };
  library: {
    title: string;
    lede: string;
    openStudio: string;
    newRun: string;
    filterArtifacts: string;
    search: string;
    framework: string;
    verification: string;
    all: string;
    verified: string;
    caveats: string;
    failed: string;
    artifacts: string;
    connected: string;
    savedArtifacts: string;
    noMatch: string;
    noMatchBody: string;
    startRun: string;
    previewFooter: string;
    workspaceFooter: string;
    unknown: string;
  };
  studio: {
    label: string;
    title: string;
    draftStatus: string;
    backLibrary: string;
    artifacts: string;
    new: string;
    empty: string;
    sidebarNote: string;
    workingCircuit: string;
    editingVersion: (version: string, framework: string) => string;
    newDraft: string;
    copyCode: string;
    copied: string;
    simulate: string;
    verifySave: string;
    starting: string;
    view: string;
    circuit: string;
    code: string;
    versions: string;
    footer: string;
    openRun: string;
    inspector: string;
    liveDraft: string;
    selectedGate: string;
    runContract: string;
    mode: string;
    source: string;
    evidence: string;
    execute: string;
    existingVersion: string;
    newDraftSource: string;
    sandboxVerifier: string;
    selectedUnavailable: string;
    noCurrentVersion: string;
    copyUnavailable: string;
    codeCopied: (framework: string) => string;
    editingDraft: (framework: string) => string;
    verificationStarted: string;
    actionStarted: (action: string) => string;
    submissionFailed: string;
    canvasLabel: string;
    starterTitle: string;
    qubits: string;
    circuitAria: (framework: string) => string;
    clickGate: string;
    sourceEditor: string;
    implementation: (framework: string) => string;
    editorNote: string;
    versionHistory: string;
    repositoryView: string;
    currentVersion: (id: string) => string;
    draftNotSaved: string;
    currentVersionNote: string;
    draftVersionNote: string;
    verificationQueued: string;
    verificationAttach: (id: string) => string;
    frameworkNote: string;
    gateDescriptions: Record<string, string>;
  };
}> = {
  en: {
    surfaces: { brandedRun: "Leona Run", preview: "Public preview" },
    sidebar: {
      newChat: "New chat",
      recent: "Recent",
      folders: "Folders",
      synced: "Synced",
      localOnly: "Local only",
      noFolder: "No folder",
      folderName: "Folder name",
      allChats: "All chats",
      viewAll: "View all",
      settings: "Settings",
      workspaceNav: "Workspace",
      readOnlyData: "Read-only fixture data",
      personalWorkspace: "Personal workspace",
      yesterday: "Yesterday",
      daysAgo: (days) => `${days}d ago`,
      publicPreview: "Public preview",
      localDeveloper: "Local developer",
      workspaceOptions: "Workspace options",
      recentChats: "Recent chats",
      moveToFolder: (title) => `Move ${title} to folder`,
      chatFolders: "Chat folders",
      createChatFolder: "Create chat folder",
      saveFolder: "Save folder",
      cancelFolder: "Cancel folder creation",
    },
    run: {
      title: "What are you working on?",
      lede: "Leona turns a natural-language question into a visible plan, implementation, simulation, verification, and saved Library record.",
      previewStatus: "Public preview · view-only",
      readyStatus: "DeepSeek · ready",
      workflowTitle: "A visible path from question to evidence",
      workflowBody: "Every run keeps its plan, generated code, checks, results, and saved artifact addressable. Return to an older chat without losing the work in progress.",
      capabilities: [
        { title: "Plan first", body: "Choose a method and state the verification target before compute." },
        { title: "Show the work", body: "Watch model output, code, compilation, and checks arrive as evidence." },
        { title: "Save to Library", body: "Verified runs become reusable artifacts in the connected Library." },
      ],
      examplesTitle: "Try an example",
      examples: [
        { title: "Recover a marked state with Grover", prompt: "Use Grover to recover the marked state 1100 and verify the measured distribution." },
        { title: "Compare QAOA with a classical baseline", prompt: "Use QAOA to solve MaxCut on a 5-node ring and compare the result with an exact classical baseline." },
        { title: "Build and verify a Bell state", prompt: "Build a Bell state in Qiskit, simulate it, and verify the expected 00/11 distribution." },
        { title: "Estimate a QFT resource profile", prompt: "Estimate the qubit count, depth, and gate profile for a QFT circuit on eight qubits." },
      ],
      contextLabel: "Library context",
      viewArtifact: "View artifact",
      contextStatus: "Verified context retained",
      contextUnavailable: "Artifact context unavailable",
    },
    library: {
      title: "Library",
      lede: "Saved circuits, versions, and verification evidence. Open an artifact in Studio to edit or simulate it.",
      openStudio: "Open Studio",
      newRun: "New run",
      filterArtifacts: "Filter artifacts",
      search: "Search artifacts…",
      framework: "Framework",
      verification: "Verification",
      all: "All",
      verified: "Verified",
      caveats: "Caveats",
      failed: "Failed",
      artifacts: "artifacts",
      connected: "Connected to the workspace repository",
      savedArtifacts: "Saved artifacts",
      noMatch: "No artifacts match these filters.",
      noMatchBody: "Clear a filter or start a new verified run.",
      startRun: "Start a run",
      previewFooter: "Reference artifacts are shown in the public preview.",
      workspaceFooter: "Verified runs saved from this workspace appear here automatically.",
      unknown: "Unknown",
    },
    studio: {
      label: "R&D workspace",
      title: "Studio",
      draftStatus: "Draft changes are local until verified",
      backLibrary: "Back to Library",
      artifacts: "Artifacts",
      new: "New",
      empty: "No saved artifacts yet. Start with the Bell-state draft.",
      sidebarNote: "Library stores saved artifacts. Studio is where drafts become evidence.",
      workingCircuit: "Working circuit",
      editingVersion: (version, framework) => `Editing version ${version} · ${framework}`,
      newDraft: "A clean draft for exploring a circuit before it enters Library.",
      copyCode: "Copy code",
      copied: "Copied",
      simulate: "Simulate",
      verifySave: "Verify & save",
      starting: "Starting…",
      view: "Studio view",
      circuit: "Circuit",
      code: "Code",
      versions: "Versions",
      footer: "Select a gate to inspect it, or switch to Code to edit the source.",
      openRun: "Open live run",
      inspector: "Circuit inspector",
      liveDraft: "live draft",
      selectedGate: "Selected gate",
      runContract: "Run contract",
      mode: "Mode",
      source: "Source",
      evidence: "Evidence",
      execute: "Execute",
      existingVersion: "Existing version",
      newDraftSource: "New draft",
      sandboxVerifier: "Sandbox + verifier",
      selectedUnavailable: "The selected artifact could not be loaded.",
      noCurrentVersion: "That artifact has no current version to edit.",
      copyUnavailable: "Copy is unavailable in this browser context.",
      codeCopied: (framework) => `${framework} code copied.`,
      editingDraft: (framework) => `Editing the ${framework} draft. Run it before treating it as verified.`,
      verificationStarted: "Verification started. A passing run will become the next saved version.",
      actionStarted: (action) => `${action} started in Leona Run.`,
      submissionFailed: "Run submission failed",
      canvasLabel: "Circuit canvas",
      starterTitle: "Bell-state starter",
      qubits: "2 qubits",
      circuitAria: (framework) => `${framework} circuit with two qubits`,
      clickGate: "Click a gate to inspect its role.",
      sourceEditor: "Source editor",
      implementation: (framework) => `${framework} implementation`,
      editorNote: "Edit the draft directly. Simulate or verify it to produce evidence before it becomes a saved Library version.",
      versionHistory: "Version history",
      repositoryView: "repository view",
      currentVersion: (id) => `Current · ${id}`,
      draftNotSaved: "Draft · not saved",
      currentVersionNote: "The current Library version remains unchanged until a passing verification run saves the next version.",
      draftVersionNote: "Run verification to create the first durable artifact version.",
      verificationQueued: "Verification run queued",
      verificationAttach: (id) => `Run ${id} will attach evidence when it finishes.`,
      frameworkNote: "Qiskit stays the default. Switch only when you want a different framework draft.",
      gateDescriptions: {
        H: "Hadamard creates an equal superposition on the selected qubit.",
        CX: "Controlled-X entangles the target with the control qubit.",
        M: "Measurement records the final computational-basis result.",
      },
    },
  },
  ja: {
    surfaces: { brandedRun: "Leona 実行", preview: "公開プレビュー" },
    sidebar: {
      newChat: "新しいチャット",
      recent: "最近",
      folders: "フォルダ",
      synced: "同期済み",
      localOnly: "ローカルのみ",
      noFolder: "フォルダなし",
      folderName: "フォルダ名",
      allChats: "すべてのチャット",
      viewAll: "すべて表示",
      settings: "設定",
      workspaceNav: "ワークスペース",
      readOnlyData: "読み取り専用データ",
      personalWorkspace: "個人ワークスペース",
      yesterday: "昨日",
      daysAgo: (days) => `${days}日前`,
      publicPreview: "公開プレビュー",
      localDeveloper: "ローカル開発者",
      workspaceOptions: "ワークスペース設定",
      recentChats: "最近のチャット",
      moveToFolder: (title) => `${title}をフォルダへ移動`,
      chatFolders: "チャットフォルダ",
      createChatFolder: "チャットフォルダを作成",
      saveFolder: "フォルダを保存",
      cancelFolder: "フォルダ作成をキャンセル",
    },
    run: {
      title: "何を研究していますか？",
      lede: "Leonaは自然言語の問いを、計画、実装、シミュレーション、検証、保存できるLibraryの記録へつなげます。",
      previewStatus: "公開プレビュー · 閲覧のみ",
      readyStatus: "DeepSeek · 準備完了",
      workflowTitle: "問いから根拠までを見える形に",
      workflowBody: "各実行の計画、生成コード、チェック、結果、保存アーティファクトをたどれます。途中の作業を失わず、過去のチャットに戻れます。",
      capabilities: [
        { title: "先に計画", body: "計算の前に方法と検証対象を選びます。" },
        { title: "作業を表示", body: "モデル出力、コード、コンパイル、チェックを根拠として確認します。" },
        { title: "Libraryに保存", body: "検証済みの実行を再利用できるアーティファクトとして残します。" },
      ],
      examplesTitle: "例から始める",
      examples: [
        { title: "Groverでマーク状態を探す", prompt: "Groverでマークされた状態1100を見つけ、測定分布を検証してください。" },
        { title: "QAOAと古典ベースラインを比較", prompt: "5ノードのリングにQAOAを使い、正確な古典ベースラインと比較してください。" },
        { title: "ベル状態を作って検証", prompt: "Qiskitでベル状態を作り、シミュレーションして00/11分布を検証してください。" },
        { title: "QFTのリソースを見積もる", prompt: "8量子ビットのQFT回路の量子ビット数、深さ、ゲート構成を見積もってください。" },
      ],
      contextLabel: "Libraryのコンテキスト",
      viewArtifact: "アーティファクトを見る",
      contextStatus: "検証済みコンテキストを保持",
      contextUnavailable: "アーティファクトのコンテキストを取得できません",
    },
    library: {
      title: "Library",
      lede: "保存した回路、バージョン、検証の根拠です。Studioでアーティファクトを編集またはシミュレーションできます。",
      openStudio: "Studioを開く",
      newRun: "新しい実行",
      filterArtifacts: "アーティファクトを絞り込む",
      search: "アーティファクトを検索…",
      framework: "フレームワーク",
      verification: "検証",
      all: "すべて",
      verified: "検証済み",
      caveats: "注意付き",
      failed: "失敗",
      artifacts: "件",
      connected: "ワークスペースのリポジトリに接続済み",
      savedArtifacts: "保存したアーティファクト",
      noMatch: "条件に一致するアーティファクトがありません。",
      noMatchBody: "条件を解除するか、新しい検証実行を始めてください。",
      startRun: "実行を始める",
      previewFooter: "公開プレビューではリファレンスアーティファクトを表示しています。",
      workspaceFooter: "このワークスペースで保存した検証済み実行がここに表示されます。",
      unknown: "不明",
    },
    studio: {
      label: "R&Dワークスペース",
      title: "Studio",
      draftStatus: "下書きの変更は検証されるまでローカルです",
      backLibrary: "Libraryに戻る",
      artifacts: "アーティファクト",
      new: "新規",
      empty: "保存されたアーティファクトはありません。ベル状態の下書きから始められます。",
      sidebarNote: "Libraryは保存したアーティファクトを置く場所です。Studioで下書きを根拠へ変えます。",
      workingCircuit: "作業中の回路",
      editingVersion: (version, framework) => `バージョン${version}を編集中 · ${framework}`,
      newDraft: "Libraryに入れる前の回路を試すための新しい下書きです。",
      copyCode: "コードをコピー",
      copied: "コピー済み",
      simulate: "シミュレーション",
      verifySave: "検証して保存",
      starting: "開始中…",
      view: "Studio表示",
      circuit: "回路",
      code: "コード",
      versions: "バージョン",
      footer: "ゲートを選んで確認するか、コード表示に切り替えて編集します。",
      openRun: "実行を開く",
      inspector: "回路インスペクタ",
      liveDraft: "ライブ下書き",
      selectedGate: "選択中のゲート",
      runContract: "実行コントラクト",
      mode: "モード",
      source: "ソース",
      evidence: "根拠",
      execute: "実行",
      existingVersion: "既存バージョン",
      newDraftSource: "新しい下書き",
      sandboxVerifier: "サンドボックス + 検証器",
      selectedUnavailable: "選択したアーティファクトを読み込めませんでした。",
      noCurrentVersion: "編集できる現在のバージョンがありません。",
      copyUnavailable: "このブラウザではコピーを利用できません。",
      codeCopied: (framework) => `${framework}のコードをコピーしました。`,
      editingDraft: (framework) => `${framework}の下書きを編集中です。検証済みとみなす前に実行してください。`,
      verificationStarted: "検証を開始しました。合格した実行が次の保存バージョンになります。",
      actionStarted: (action) => `Leona実行で${action}を開始しました。`,
      submissionFailed: "実行の送信に失敗しました",
      canvasLabel: "回路キャンバス",
      starterTitle: "ベル状態スターター",
      qubits: "2量子ビット",
      circuitAria: (framework) => `${framework}の2量子ビット回路`,
      clickGate: "ゲートをクリックして役割を確認します。",
      sourceEditor: "ソースエディタ",
      implementation: (framework) => `${framework}の実装`,
      editorNote: "下書きを直接編集できます。保存済みLibraryバージョンにする前に、シミュレーションまたは検証を実行してください。",
      versionHistory: "バージョン履歴",
      repositoryView: "リポジトリ表示",
      currentVersion: (id) => `現在 · ${id}`,
      draftNotSaved: "下書き · 未保存",
      currentVersionNote: "検証に合格した実行で次のバージョンを保存するまで、現在のLibraryバージョンは変更されません。",
      draftVersionNote: "検証を実行すると、最初の永続アーティファクトバージョンが作成されます。",
      verificationQueued: "検証実行をキューに追加しました",
      verificationAttach: (id) => `実行 ${id} の完了後に根拠が添付されます。`,
      frameworkNote: "既定値はQiskitです。別のフレームワークの下書きを作るときだけ切り替えてください。",
      gateDescriptions: {
        H: "アダマールゲートは、選択した量子ビットに均等な重ね合わせを作ります。",
        CX: "制御Xゲートは、制御量子ビットと対象量子ビットをもつれさせます。",
        M: "測定は計算基底での最終結果を記録します。",
      },
    },
  },
};

export const ACCOUNT_COPY: Record<PublicLocale, {
  title: string;
  lede: string;
  signOut: string;
  preferences: string;
  language: string;
  languageHelp: string;
  identity: string;
  email: string;
  workspace: string;
  displayName: string;
  yourName: string;
  saveName: string;
  saving: string;
  profileSaved: string;
  profileSaveFailed: string;
  personalWorkspace: string;
  personalWorkspaceHelp: string;
  artifacts: string;
  runs: string;
  access: string;
  privateAccess: string;
  workspaceBoundaries: string;
  library: string;
  libraryHelp: string;
  repositoryExport: string;
  repositoryExportHelp: string;
  collaboration: string;
  collaborationHelp: string;
  loading: string;
  unavailable: string;
  requestFailed: string;
}> = {
  en: {
    title: "Settings",
    lede: "Your identity, private Library, personal workspace data, and display preferences.",
    signOut: "Sign out",
    preferences: "Preferences",
    language: "Language",
    languageHelp: "Choose the language used for shared navigation and account settings.",
    identity: "Identity",
    email: "Email",
    workspace: "Workspace",
    displayName: "Display name",
    yourName: "Your name",
    saveName: "Save name",
    saving: "Saving…",
    profileSaved: "Profile saved.",
    profileSaveFailed: "Profile could not be saved",
    personalWorkspace: "Personal workspace",
    personalWorkspaceHelp: "This workspace belongs only to you. Collaboration and shared workspaces are planned, but not enabled yet.",
    artifacts: "Artifacts",
    runs: "Runs",
    access: "Access",
    privateAccess: "Private",
    workspaceBoundaries: "Workspace boundaries",
    library: "Library",
    libraryHelp: "Saved runs and public references stay in your personal Library.",
    repositoryExport: "Repository export",
    repositoryExportHelp: "Sign in to copy a public entry into this workspace and open it in Studio.",
    collaboration: "Collaboration",
    collaborationHelp: "Deferred until shared access, invitations, and permissions are productized.",
    loading: "Loading workspace data…",
    unavailable: "Workspace data is unavailable.",
    requestFailed: "Request failed",
  },
  ja: {
    title: "設定",
    lede: "本人情報、非公開ライブラリ、個人ワークスペースのデータ、表示設定を管理します。",
    signOut: "サインアウト",
    preferences: "表示設定",
    language: "言語",
    languageHelp: "共通ナビゲーションとアカウント設定で使用する言語を選択します。",
    identity: "本人情報",
    email: "メールアドレス",
    workspace: "ワークスペース",
    displayName: "表示名",
    yourName: "名前",
    saveName: "名前を保存",
    saving: "保存中…",
    profileSaved: "プロフィールを保存しました。",
    profileSaveFailed: "プロフィールを保存できませんでした",
    personalWorkspace: "個人ワークスペース",
    personalWorkspaceHelp: "このワークスペースはあなただけが利用できます。共同利用と共有ワークスペースは今後対応予定です。",
    artifacts: "アーティファクト",
    runs: "実行",
    access: "アクセス",
    privateAccess: "非公開",
    workspaceBoundaries: "ワークスペースの範囲",
    library: "ライブラリ",
    libraryHelp: "保存した実行と公開リファレンスは、個人ライブラリに保持されます。",
    repositoryExport: "リポジトリから保存",
    repositoryExportHelp: "サインインすると、公開エントリをこのワークスペースへコピーしてStudioで開けます。",
    collaboration: "共同利用",
    collaborationHelp: "共有アクセス、招待、権限の正式対応まで利用できません。",
    loading: "ワークスペースデータを読み込んでいます…",
    unavailable: "ワークスペースデータを取得できません。",
    requestFailed: "リクエストに失敗しました",
  },
};
