import type { PublicLocale } from "./public-locale";

export const WORKSPACE_COPY: Record<PublicLocale, {
  surfaces: { brandedRun: string; preview: string };
  sidebar: {
    surfaceSwitch: string;
    run: string;
    studio: string;
    library: string;
    projects: string;
    chats: string;
    artifacts: string;
    newArtifact: string;
    viewLibrary: string;
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
    createArtifactFolder: string;
    emptyProject: string;
    emptyChats: string;
    emptyArtifacts: string;
    pinned: string;
    archive: string;
    archiveArtifacts: string;
    archiveRetention: string;
    archiveEmpty: string;
    daysLeft: (days: number) => string;
    pinChat: (title: string) => string;
    unpinChat: (title: string) => string;
    archiveChat: (title: string) => string;
    deleteChat: (title: string) => string;
    restoreChat: (title: string) => string;
    pinArtifact: (title: string) => string;
    unpinArtifact: (title: string) => string;
    archiveArtifact: (title: string) => string;
    deleteArtifact: (title: string) => string;
    deleteConfirmTitle: string;
    deleteChatWarning: (title: string) => string;
    deleteArtifactWarning: (title: string) => string;
    cancel: string;
    delete: string;
    rename: (title: string) => string;
    renamePlaceholder: string;
    renameSave: string;
    menuRename: string;
    menuPin: string;
    menuUnpin: string;
    menuArchive: string;
    menuDelete: string;
    projectLabel: string;
    dropOutside: string;
    accountMenu: string;
    usageLimits: string;
    signOut: string;
  };
  run: {
    previewStatus: string;
    examplesTitle: string;
    examples: Array<{ title: string; prompt: string }>;
    morePrompts: Array<{ title: string; prompt: string }>;
    examplesMore: string;
    examplesClose: string;
    greetingMorning: string;
    greetingAfternoon: string;
    greetingEvening: string;
    confirmSendTitle: string;
    confirmSendBody: (title: string) => string;
    confirmSend: string;
    confirmCancel: string;
    attachmentsLabel: string;
    removeAttachment: (name: string) => string;
    attachTooLarge: (name: string) => string;
    attachUnsupported: (name: string) => string;
    attachReadFailed: (name: string) => string;
    attachLimit: string;
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
    structural: string;
    failed: string;
    artifacts: string;
    savedArtifacts: string;
    noMatch: string;
    noMatchBody: string;
    startRun: string;
    askInRun: string;
    archive: string;
    delete: string;
    deleteConfirmTitle: string;
    deleteWarning: (title: string) => string;
    star: string;
    unstar: string;
    previewFooter: string;
    unknown: string;
  };
  studio: {
    label: string;
    title: string;
    draftStatus: string;
    backLibrary: string;
    artifacts: string;
    new: string;
    search: string;
    searchPlaceholder: string;
    noSearchResults: string;
    empty: string;
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
    loadingArtifacts: string;
    remoteSyncUnavailable: string;
    persistenceUnavailable: string;
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
    sourceEditorInput: string;
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
    palette: string;
    builderHint: string;
    pickTarget: string;
    addQubit: string;
    removeQubit: string;
    undo: string;
    clearAll: string;
    applyToCode: string;
    appliedToCode: string;
    angleLabel: string;
    builderEmpty: string;
    generatedPreview: string;
    selectedCount: (count: number) => string;
    selectToGroup: string;
    deleteSelected: string;
    groupSelected: string;
    customGates: string;
    customGateLabel: string;
    customGateInspector: string;
    customGatePlaceholder: string;
    createCustomGate: string;
    cancelCustomGate: string;
    deleteCustomGate: (name: string) => string;
    customGateCreated: (name: string) => string;
    customGateCannotGroup: string;
    hideInspector: string;
    showInspector: string;
    circuitRestored: string;
    circuitNotRebuildable: string;
  };
}> = {
  en: {
    surfaces: { brandedRun: "Leona Run", preview: "Public preview" },
    sidebar: {
      surfaceSwitch: "Workspace mode",
      run: "Run",
      studio: "Studio",
      library: "Vault",
      projects: "Projects",
      chats: "Chats",
      artifacts: "Artifacts",
      newArtifact: "New draft",
      viewLibrary: "View Vault",
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
      createArtifactFolder: "Create artifact project",
      emptyProject: "No items yet",
      emptyChats: "Chats without a project appear here",
      emptyArtifacts: "Artifacts without a project appear here",
      pinned: "Pinned",
      archive: "Archived chats",
      archiveArtifacts: "Archived artifacts",
      archiveRetention: "Archived items are deleted after 14 days.",
      archiveEmpty: "Nothing archived",
      daysLeft: (days) => `${days}d left`,
      pinChat: (title) => `Pin ${title}`,
      unpinChat: (title) => `Unpin ${title}`,
      archiveChat: (title) => `Archive ${title}`,
      deleteChat: (title) => `Delete ${title}`,
      restoreChat: (title) => `Restore ${title}`,
      pinArtifact: (title) => `Pin ${title}`,
      unpinArtifact: (title) => `Unpin ${title}`,
      archiveArtifact: (title) => `Archive ${title}`,
      deleteArtifact: (title) => `Delete ${title}`,
      deleteConfirmTitle: "Are you sure?",
      deleteChatWarning: (title) => `“${title}” will be removed from your workspace and not saved.`,
      deleteArtifactWarning: (title) => `“${title}” will be removed from your workspace and not saved.`,
      cancel: "Cancel",
      delete: "Delete",
      rename: (title) => `Rename ${title}`,
      renamePlaceholder: "New name",
      renameSave: "Save name",
      menuRename: "Rename",
      menuPin: "Pin",
      menuUnpin: "Unpin",
      menuArchive: "Archive",
      menuDelete: "Delete",
      projectLabel: "Project",
      dropOutside: "Drop here to remove from project",
      accountMenu: "Account menu",
      usageLimits: "Usage & limits",
      signOut: "Log out",
    },
    run: {
      previewStatus: "Public preview · view-only",
      examplesTitle: "Try an example",
      examples: [
        { title: "Recover a marked state with Grover", prompt: "Use Grover to recover the marked state 1100 and verify the measured distribution." },
        { title: "Compare QAOA with a classical baseline", prompt: "Use QAOA to solve MaxCut on a 5-node ring and compare the result with an exact classical baseline." },
        { title: "Build and verify a Bell state", prompt: "Build a Bell state in the selected framework, simulate it, and verify the expected 00/11 distribution." },
        { title: "Estimate a QFT resource profile", prompt: "Estimate the qubit count, depth, and gate profile for a QFT circuit on eight qubits." },
      ],
      morePrompts: [
        { title: "Route a delivery fleet as a QUBO", prompt: "Formulate a delivery-route assignment for 12 vehicles and 40 stops as a QUBO, then build a QAOA circuit sized for a simulator and report the best cut found." },
        { title: "Price an option with amplitude estimation", prompt: "Price a European call option with quantum amplitude estimation instead of classical Monte Carlo, show the circuit, and state the expected quadratic speedup and its caveats." },
        { title: "Optimize a portfolio under a risk budget", prompt: "Select an optimal 8-asset portfolio under a fixed risk budget by encoding it as a QUBO, solve it with QAOA, and compare against a classical greedy baseline." },
        { title: "Estimate H₂ ground-state energy with VQE", prompt: "Estimate the ground-state energy of the H₂ molecule with a two-qubit VQE ansatz, report the convergence curve, and compare with the exact diagonalization value." },
        { title: "Schedule jobs on machines as a QUBO", prompt: "Encode a 6-job, 3-machine job-shop scheduling instance as a QUBO with makespan penalties and propose a variational circuit to explore it." },
        { title: "Sketch a quantum kernel for fraud features", prompt: "Build a quantum kernel classifier sketch for 4 transaction-fraud features, explain the feature map, and state honestly where quantum helps and where it does not." },
        { title: "Simulate credit-risk tails with QAE", prompt: "Model a small credit-portfolio loss distribution and show how quantum amplitude estimation would sample its tail risk versus classical Monte Carlo." },
        { title: "Cut a supply network with MaxCut", prompt: "Model a 6-node supplier network partition as MaxCut, solve it with QAOA at p=2, and verify the result against brute force." },
      ],
      examplesMore: "More prompts",
      examplesClose: "Close",
      greetingMorning: "Good morning.",
      greetingAfternoon: "Good afternoon.",
      greetingEvening: "Good evening.",
      confirmSendTitle: "Send this artifact context and prompt to the LLM?",
      confirmSendBody: (title) => `The saved artifact “${title}” (its code) and your prompt below will be sent to the model. Nothing is sent until you confirm.`,
      confirmSend: "Send to LLM",
      confirmCancel: "Cancel",
      attachmentsLabel: "Attachments",
      removeAttachment: (name) => `Remove attachment ${name}`,
      attachTooLarge: (name) => `${name} is larger than 64 KB — paste the relevant part instead.`,
      attachUnsupported: (name) => `${name} is not a supported text attachment (.py, .txt, .md, .json, .qasm, .csv).`,
      attachReadFailed: (name) => `${name} could not be read.`,
      attachLimit: "Up to 4 attachments per message.",
      contextLabel: "Vault context",
      viewArtifact: "View artifact",
      contextStatus: "Verified context retained",
      contextUnavailable: "Artifact context unavailable",
    },
    library: {
      title: "Vault",
      lede: "Saved circuits, versions, and evidence.",
      openStudio: "Open Studio",
      newRun: "New run",
      filterArtifacts: "Filter artifacts",
      search: "Search artifacts…",
      framework: "Framework",
      verification: "Verification",
      all: "All",
      verified: "Verified",
      caveats: "Caveats",
      structural: "Structurally verified",
      failed: "Failed",
      artifacts: "artifacts",
      savedArtifacts: "Saved artifacts",
      noMatch: "No artifacts match these filters.",
      noMatchBody: "Clear a filter or start a new verified run.",
      startRun: "Start a run",
      askInRun: "Ask in Run",
      archive: "Archive",
      delete: "Delete",
      deleteConfirmTitle: "Are you sure?",
      deleteWarning: (title) => `“${title}” will be removed from your workspace and not saved.`,
      star: "Star artifact",
      unstar: "Remove artifact star",
      previewFooter: "Reference artifacts are shown in the public preview.",
      unknown: "Unknown",
    },
    studio: {
      label: "Quantum R&D",
      title: "Studio",
      draftStatus: "Draft changes are local until verified",
      backLibrary: "Back to Vault",
      artifacts: "Artifacts",
      new: "New",
      search: "Search artifacts",
      searchPlaceholder: "Search by name, framework, or tag…",
      noSearchResults: "No artifacts match this search.",
      empty: "No saved artifacts yet. Start with the Bell-state draft.",
      workingCircuit: "Working circuit",
      editingVersion: (version, framework) => `Editing version ${version} · ${framework}`,
      newDraft: "A clean draft for exploring a circuit before it enters Vault.",
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
      loadingArtifacts: "Loading the selected artifact…",
      remoteSyncUnavailable: "Remote artifacts could not be synchronized. Local artifacts remain available.",
      persistenceUnavailable: "Studio edits could not be saved in this browser.",
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
      sourceEditorInput: "source editor",
      implementation: (framework) => `${framework} implementation`,
      editorNote: "Edit the draft directly. Simulate or verify it to produce evidence before it becomes a saved Vault version.",
      versionHistory: "Version history",
      repositoryView: "atlas view",
      currentVersion: (id) => `Current · ${id}`,
      draftNotSaved: "Draft · not saved",
      currentVersionNote: "The current Vault version remains unchanged until a passing verification run saves the next version.",
      draftVersionNote: "Run verification to create the first durable artifact version.",
      verificationQueued: "Verification run queued",
      verificationAttach: (id) => `Run ${id} will attach evidence when it finishes.`,
      frameworkNote: "Qiskit stays the default. Switch only when you want a different framework draft.",
      gateDescriptions: {
        H: "Hadamard creates an equal superposition on the selected qubit.",
        X: "Pauli-X flips the selected qubit between |0⟩ and |1⟩.",
        Y: "Pauli-Y combines a bit flip with a phase rotation.",
        Z: "Pauli-Z flips the phase of |1⟩ without changing probabilities.",
        S: "S applies a π/2 phase to |1⟩.",
        T: "T applies a π/4 phase — the non-Clifford workhorse.",
        RX: "RX rotates the qubit around the X axis by the chosen angle.",
        RY: "RY rotates the qubit around the Y axis by the chosen angle.",
        RZ: "RZ rotates the qubit around the Z axis by the chosen angle.",
        CX: "Controlled-X entangles the target with the control qubit.",
        CZ: "Controlled-Z applies a phase when both qubits are |1⟩.",
        SWAP: "SWAP exchanges the states of two qubits.",
        M: "Measurement records the final computational-basis result.",
      },
      palette: "Gate palette",
      builderHint: "Pick a gate, then click a wire to place it. Click a placed gate to select it; Shift-click to select multiple.",
      pickTarget: "Now select the remaining qubits.",
      addQubit: "Add qubit",
      removeQubit: "Remove qubit",
      undo: "Undo",
      clearAll: "Clear",
      applyToCode: "Apply to code",
      appliedToCode: "Generated code applied to all framework drafts.",
      angleLabel: "Rotation angle",
      builderEmpty: "Empty circuit — place gates from the palette.",
      generatedPreview: "Built circuit",
      selectedCount: (count) => `${count} gates selected`,
      selectToGroup: "Click a placed gate to select it. Shift-click to select multiple.",
      deleteSelected: "Delete selected",
      groupSelected: "Group as custom gate",
      customGates: "Custom gates",
      customGateLabel: "Custom gate",
      customGateInspector: "A saved custom gate from this composer.",
      customGatePlaceholder: "Custom gate name",
      createCustomGate: "Create custom gate",
      cancelCustomGate: "Cancel",
      deleteCustomGate: (name) => `Delete custom gate ${name}`,
      customGateCreated: (name) => `${name} is ready in the gate palette.`,
      customGateCannotGroup: "Select two or more unitary gates to create a custom gate.",
      hideInspector: "Hide inspector",
      showInspector: "Inspector",
      circuitRestored: "Circuit loaded from the saved artifact. Edits stay in this draft until you verify & save.",
      circuitNotRebuildable: "This artifact's code goes beyond the visual builder — edit it in the Code tab.",
    },
  },
  ja: {
    surfaces: { brandedRun: "Leona 実行", preview: "公開プレビュー" },
    sidebar: {
      surfaceSwitch: "ワークスペースモード",
      run: "実行",
      studio: "Studio",
      library: "ボールト",
      projects: "プロジェクト",
      chats: "チャット",
      artifacts: "アーティファクト",
      newArtifact: "新しい下書き",
      viewLibrary: "ボールトを見る",
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
      createArtifactFolder: "アーティファクトプロジェクトを作成",
      emptyProject: "まだ項目がありません",
      emptyChats: "プロジェクトに属さないチャットがここに表示されます",
      emptyArtifacts: "プロジェクトに属さないアーティファクトがここに表示されます",
      pinned: "ピン留め",
      archive: "アーカイブ済みチャット",
      archiveArtifacts: "アーカイブ済みアーティファクト",
      archiveRetention: "アーカイブした項目は14日後に削除されます。",
      archiveEmpty: "アーカイブはありません",
      daysLeft: (days) => `残り${days}日`,
      pinChat: (title) => `${title}をピン留め`,
      unpinChat: (title) => `${title}のピン留めを解除`,
      archiveChat: (title) => `${title}をアーカイブ`,
      deleteChat: (title) => `${title}を削除`,
      restoreChat: (title) => `${title}を復元`,
      pinArtifact: (title) => `${title}をピン留め`,
      unpinArtifact: (title) => `${title}のピン留めを解除`,
      archiveArtifact: (title) => `${title}をアーカイブ`,
      deleteArtifact: (title) => `${title}を削除`,
      deleteConfirmTitle: "削除してもよいですか？",
      deleteChatWarning: (title) => `「${title}」はワークスペースから削除され、保存されません。`,
      deleteArtifactWarning: (title) => `「${title}」はワークスペースから削除され、保存されません。`,
      cancel: "キャンセル",
      delete: "削除",
      rename: (title) => `「${title}」の名前を変更`,
      renamePlaceholder: "新しい名前",
      renameSave: "名前を保存",
      menuRename: "名前を変更",
      menuPin: "ピン留め",
      menuUnpin: "ピン留めを外す",
      menuArchive: "アーカイブ",
      menuDelete: "削除",
      projectLabel: "プロジェクト",
      dropOutside: "ここにドロップしてプロジェクトから外す",
      accountMenu: "アカウントメニュー",
      usageLimits: "使用状況と上限",
      signOut: "ログアウト",
    },
    run: {
      previewStatus: "公開プレビュー · 閲覧のみ",
      examplesTitle: "例から始める",
      examples: [
        { title: "Groverでマーク状態を探す", prompt: "Groverでマークされた状態1100を見つけ、測定分布を検証してください。" },
        { title: "QAOAと古典ベースラインを比較", prompt: "5ノードのリングにQAOAを使い、正確な古典ベースラインと比較してください。" },
        { title: "ベル状態を作って検証", prompt: "選択したフレームワークでベル状態を作り、シミュレーションして00/11分布を検証してください。" },
        { title: "QFTのリソースを見積もる", prompt: "8量子ビットのQFT回路の量子ビット数、深さ、ゲート構成を見積もってください。" },
      ],
      morePrompts: [
        { title: "配送ルートをQUBOで最適化", prompt: "12台の車両と40の配送先のルート割当をQUBOとして定式化し、シミュレータ向けのQAOA回路を作って最良カットを報告してください。" },
        { title: "振幅推定でオプション価格を計算", prompt: "古典モンテカルロの代わりに量子振幅推定でヨーロピアンコールオプションの価格を計算し、回路と二次加速の条件・注意点を示してください。" },
        { title: "リスク制約付きポートフォリオ最適化", prompt: "リスク予算の制約下で8資産のポートフォリオ選択をQUBOに符号化し、QAOAで解いて古典的な貪欲法ベースラインと比較してください。" },
        { title: "VQEでH₂の基底状態エネルギーを推定", prompt: "2量子ビットのVQE ansatzでH₂分子の基底状態エネルギーを推定し、収束曲線を報告して厳密対角化の値と比較してください。" },
        { title: "ジョブスケジューリングをQUBOに変換", prompt: "6ジョブ・3マシンのジョブショップスケジューリングをメイクスパンペナルティ付きQUBOに符号化し、探索用の変分回路を提案してください。" },
        { title: "不正検知の量子カーネルを設計", prompt: "取引不正の4特徴量に対する量子カーネル分類器の設計を示し、特徴マップを説明した上で、量子が役立つ場面と役立たない場面を正直に述べてください。" },
        { title: "QAEで信用リスクの裾を推定", prompt: "小規模な信用ポートフォリオの損失分布をモデル化し、量子振幅推定が古典モンテカルロと比べて裾リスクをどうサンプルするか示してください。" },
        { title: "サプライ網の分割をMaxCutで解く", prompt: "6ノードのサプライヤー網の分割をMaxCutとしてモデル化し、p=2のQAOAで解いて総当たりと照合してください。" },
      ],
      examplesMore: "他のプロンプト",
      examplesClose: "閉じる",
      greetingMorning: "おはようございます。",
      greetingAfternoon: "こんにちは。",
      greetingEvening: "こんばんは。",
      confirmSendTitle: "このアーティファクトのコンテキストとプロンプトをLLMに送信しますか？",
      confirmSendBody: (title) => `保存済みアーティファクト「${title}」のコードと下のプロンプトがモデルに送信されます。確認するまで何も送信されません。`,
      confirmSend: "LLMに送信",
      confirmCancel: "キャンセル",
      attachmentsLabel: "添付ファイル",
      removeAttachment: (name) => `添付 ${name} を削除`,
      attachTooLarge: (name) => `${name} は64KBを超えています。必要な部分を貼り付けてください。`,
      attachUnsupported: (name) => `${name} は対応するテキスト添付ではありません（.py, .txt, .md, .json, .qasm, .csv）。`,
      attachReadFailed: (name) => `${name} を読み込めませんでした。`,
      attachLimit: "1メッセージに添付できるのは4件までです。",
      contextLabel: "ボールトのコンテキスト",
      viewArtifact: "アーティファクトを見る",
      contextStatus: "検証済みコンテキストを保持",
      contextUnavailable: "アーティファクトのコンテキストを取得できません",
    },
    library: {
      title: "ボールト",
      lede: "保存した回路、バージョン、そして根拠。",
      openStudio: "Studioを開く",
      newRun: "新しい実行",
      filterArtifacts: "アーティファクトを絞り込む",
      search: "アーティファクトを検索…",
      framework: "フレームワーク",
      verification: "検証",
      all: "すべて",
      verified: "検証済み",
      caveats: "注意付き",
      structural: "構造のみ検証",
      failed: "失敗",
      artifacts: "件",
      savedArtifacts: "保存したアーティファクト",
      noMatch: "条件に一致するアーティファクトがありません。",
      noMatchBody: "条件を解除するか、新しい検証実行を始めてください。",
      startRun: "実行を始める",
      askInRun: "実行で質問",
      archive: "アーカイブ",
      delete: "削除",
      deleteConfirmTitle: "削除してもよいですか？",
      deleteWarning: (title) => `「${title}」はワークスペースから削除され、保存されません。`,
      star: "アーティファクトにスターを付ける",
      unstar: "アーティファクトのスターを外す",
      previewFooter: "公開プレビューではリファレンスアーティファクトを表示しています。",
      unknown: "不明",
    },
    studio: {
      label: "量子R&D",
      title: "Studio",
      draftStatus: "下書きの変更は検証されるまでローカルです",
      backLibrary: "ボールトに戻る",
      artifacts: "アーティファクト",
      new: "新規",
      search: "アーティファクトを検索",
      searchPlaceholder: "名前、フレームワーク、タグで検索…",
      noSearchResults: "検索に一致するアーティファクトがありません。",
      empty: "保存されたアーティファクトはありません。ベル状態の下書きから始められます。",
      workingCircuit: "作業中の回路",
      editingVersion: (version, framework) => `バージョン${version}を編集中 · ${framework}`,
      newDraft: "ボールトに入れる前の回路を試すための新しい下書きです。",
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
      loadingArtifacts: "選択したアーティファクトを読み込んでいます…",
      remoteSyncUnavailable: "リモートのアーティファクトを同期できませんでした。ローカルのアーティファクトは利用できます。",
      persistenceUnavailable: "このブラウザにStudioの編集内容を保存できませんでした。",
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
      sourceEditorInput: "ソースエディタ",
      implementation: (framework) => `${framework}の実装`,
      editorNote: "下書きを直接編集できます。保存済みボールトバージョンにする前に、シミュレーションまたは検証を実行してください。",
      versionHistory: "バージョン履歴",
      repositoryView: "Atlas表示",
      currentVersion: (id) => `現在 · ${id}`,
      draftNotSaved: "下書き · 未保存",
      currentVersionNote: "検証に合格した実行で次のバージョンを保存するまで、現在のボールトバージョンは変更されません。",
      draftVersionNote: "検証を実行すると、最初の永続アーティファクトバージョンが作成されます。",
      verificationQueued: "検証実行をキューに追加しました",
      verificationAttach: (id) => `実行 ${id} の完了後に根拠が添付されます。`,
      frameworkNote: "既定値はQiskitです。別のフレームワークの下書きを作るときだけ切り替えてください。",
      gateDescriptions: {
        H: "アダマールゲートは、選択した量子ビットに均等な重ね合わせを作ります。",
        X: "パウリXは、選択した量子ビットを|0⟩と|1⟩の間で反転します。",
        Y: "パウリYは、ビット反転と位相回転を組み合わせます。",
        Z: "パウリZは、確率を変えずに|1⟩の位相を反転します。",
        S: "Sゲートは|1⟩にπ/2の位相を与えます。",
        T: "Tゲートは|1⟩にπ/4の位相を与える非クリフォードゲートです。",
        RX: "RXは選択した角度だけX軸周りに回転します。",
        RY: "RYは選択した角度だけY軸周りに回転します。",
        RZ: "RZは選択した角度だけZ軸周りに回転します。",
        CX: "制御Xゲートは、制御量子ビットと対象量子ビットをもつれさせます。",
        CZ: "制御Zゲートは、両方が|1⟩のとき位相を反転します。",
        SWAP: "SWAPゲートは2つの量子ビットの状態を交換します。",
        M: "測定は計算基底での最終結果を記録します。",
      },
      palette: "ゲートパレット",
      builderHint: "ゲートを選び、ワイヤをクリックして配置します。配置済みのゲートをクリックして選択し、Shiftクリックで複数選択できます。",
      pickTarget: "残りの量子ビットを選択してください。",
      addQubit: "量子ビットを追加",
      removeQubit: "量子ビットを削除",
      undo: "元に戻す",
      clearAll: "クリア",
      applyToCode: "コードに反映",
      appliedToCode: "生成コードをすべてのフレームワーク下書きに反映しました。",
      angleLabel: "回転角",
      builderEmpty: "空の回路 — パレットからゲートを配置してください。",
      generatedPreview: "作成中の回路",
      selectedCount: (count) => `${count}個のゲートを選択中`,
      selectToGroup: "配置したゲートをクリックして選択。Shiftクリックで複数選択できます。",
      deleteSelected: "選択を削除",
      groupSelected: "カスタムゲートにまとめる",
      customGates: "カスタムゲート",
      customGateLabel: "カスタムゲート",
      customGateInspector: "このComposerで保存したカスタムゲートです。",
      customGatePlaceholder: "カスタムゲート名",
      createCustomGate: "カスタムゲートを作成",
      cancelCustomGate: "キャンセル",
      deleteCustomGate: (name) => `カスタムゲート${name}を削除`,
      customGateCreated: (name) => `${name}をパレットに追加しました。`,
      customGateCannotGroup: "カスタムゲートには、2つ以上の単一ゲートを選択してください。",
      hideInspector: "インスペクタを隠す",
      showInspector: "インスペクタ",
      circuitRestored: "保存済みアーティファクトから回路を読み込みました。検証して保存するまで、編集はこの下書きに留まります。",
      circuitNotRebuildable: "このアーティファクトのコードはビジュアルビルダーの範囲を超えています。コードタブで編集してください。",
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
  usageTitle: string;
  usageHelp: string;
  usagePlan: string;
  usagePlanValue: string;
  usageRuns: string;
  usageRunsValue: string;
  usageStorage: string;
  usageStorageValue: string;
}> = {
  en: {
    title: "Settings",
    lede: "Your identity, private Vault, personal workspace data, and display preferences.",
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
    library: "Vault",
    libraryHelp: "Saved runs and public references stay in your personal Vault.",
    repositoryExport: "Atlas export",
    repositoryExportHelp: "Sign in to copy a public entry into this workspace and open it in Studio.",
    collaboration: "Collaboration",
    collaborationHelp: "Deferred until shared access, invitations, and permissions are productized.",
    loading: "Loading workspace data…",
    unavailable: "Workspace data is unavailable.",
    requestFailed: "Request failed",
    usageTitle: "Usage & limits",
    usageHelp: "Early access has no metered billing. These are the current soft boundaries; contact us if you need more.",
    usagePlan: "Plan",
    usagePlanValue: "Early access",
    usageRuns: "Runs",
    usageRunsValue: "Fair use — no hard cap during early access",
    usageStorage: "Vault storage",
    usageStorageValue: "Fair use — artifacts and versions retained",
  },
  ja: {
    title: "設定",
    lede: "本人情報、非公開ボールト、個人ワークスペースのデータ、表示設定を管理します。",
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
    library: "ボールト",
    libraryHelp: "保存した実行と公開リファレンスは、個人ボールトに保持されます。",
    repositoryExport: "Atlasから保存",
    repositoryExportHelp: "サインインすると、公開エントリをこのワークスペースへコピーしてStudioで開けます。",
    collaboration: "共同利用",
    collaborationHelp: "共有アクセス、招待、権限の正式対応まで利用できません。",
    loading: "ワークスペースデータを読み込んでいます…",
    unavailable: "ワークスペースデータを取得できません。",
    requestFailed: "リクエストに失敗しました",
    usageTitle: "使用状況と上限",
    usageHelp: "アーリーアクセス期間中は従量課金はありません。現在の目安の上限は以下のとおりです。追加が必要な場合はご連絡ください。",
    usagePlan: "プラン",
    usagePlanValue: "アーリーアクセス",
    usageRuns: "実行",
    usageRunsValue: "フェアユース — アーリーアクセス中は固定上限なし",
    usageStorage: "ボールト保存",
    usageStorageValue: "フェアユース — アーティファクトとバージョンを保持",
  },
};
