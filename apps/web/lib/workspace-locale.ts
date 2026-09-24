import type { components } from "@majorana/contracts-gen";
import type { AccountTier } from "./account-tier";
import type { NotebookDiffCellStatus, NotebookDiffHeaderField } from "./notebook-diff";
import type { NotebookMastery } from "./notebook-mastery";
import type { CellRunChip } from "./notebook-ide";
import type { NotebookLintCopy } from "./notebook-lint";
import type { PublicLocale } from "./public-locale";

type NotebookKind = components["schemas"]["NotebookKind"];
type NotebookAudienceLevel = components["schemas"]["Audience"]["level"];
type NotebookMathLevel = components["schemas"]["Style"]["math_level"];
type NotebookStatusPillCopyKey = "queued" | "generating" | "ready" | "failed";
type NotebookCellStatusCopyKey = "ok" | "error" | "skipped" | "not_run";
type NotebookReviewVerdict = components["schemas"]["NotebookReview"]["verdict"];
type NotebookFindingSeverity = components["schemas"]["ReviewFinding"]["severity"];
type NotebookFindingCategory = components["schemas"]["ReviewFinding"]["category"];
type NotebookDiffHeaderFieldKey = NotebookDiffHeaderField["field"];
// Courses (`lib/course-types.ts` — local until Lane A's contracts-gen lands).
type CourseStatusCopyKey = "planning" | "planned" | "generating" | "ready" | "failed";
type CourseModuleStatusCopyKey = "planned" | "queued" | "generating" | "ready" | "failed";
type CourseModuleCountCopyKey = "auto" | "4" | "8" | "12";

/**
 * The notebook IDE's strings: the code editor, the per-cell toolbar, the notebook-level bar
 * (Run all, the error navigator, the outline), command-mode help, and the linter's
 * messages. Kept as one block, referenced once from each locale's `notebooks`, so the
 * whole surface can be read (and translated) in one place.
 *
 * Plain register throughout, and honest about what a run is: every run replays the
 * notebook from the top in a fresh sandbox (there is no kernel that remembers state), so
 * "Run to here" says so rather than implying one cell runs on its own.
 */
export interface NotebookIdeCopy {
  runToHereHint: string;
  runAll: string;
  runAllHint: string;
  chip: Record<CellRunChip, string>;
  duration: (ms: number) => string;
  durationHint: string;
  duplicate: string;
  convertToText: string;
  convertToCode: string;
  askNala: string;
  askNalaHint: string;
  fixWithNala: string;
  fixWithNalaHint: string;
  /** What "Ask Nala" puts in the chat box: the start of a message, which the reader finishes. */
  askNalaPrefix: (cellId: string) => string;
  /** The turn "Fix with Nala" sends for a cell that raised, with its traceback. */
  fixWithNalaTurn: (cellId: string, traceback: string) => string;
  toolbarLabel: (cellId: string) => string;
  cellLabel: (cellId: string) => string;
  barLabel: string;
  raised: (count: number) => string;
  goToRaised: (count: number) => string;
  outlineLabel: string;
  problemsLabel: (cellId: string) => string;
  problemsCount: (count: number) => string;
  problemAt: (line: number) => string;
  severity: Record<"error" | "warning", string>;
  editorKeys: string;
  commandKeys: string;
  lint: NotebookLintCopy;
}

const NOTEBOOK_IDE_COPY: Record<PublicLocale, NotebookIdeCopy> = {
  en: {
    runToHereHint: "Runs every cell up to this one, from the top, in a fresh sandbox.",
    runAll: "Run all",
    runAllHint: "Runs the whole notebook from the top in a fresh sandbox.",
    chip: {
      ran: "Ran",
      raised: "Raised an error",
      not_run: "Not run",
      running: "Running…",
      edited: "Edited since last run",
      skipped: "Skipped",
    },
    duration: (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`),
    durationHint: "How long this cell took in the last run",
    duplicate: "Duplicate",
    convertToText: "Change to text",
    convertToCode: "Change to code",
    askNala: "Ask Nala",
    askNalaHint: "Ask Nala about this cell in the chat",
    fixWithNala: "Fix with Nala",
    fixWithNalaHint: "Ask Nala to fix the error in this cell",
    askNalaPrefix: (cellId) => `About cell ${cellId}: `,
    fixWithNalaTurn: (cellId, traceback) =>
      `Cell \`${cellId}\` raised this error:\n\`\`\`\n${traceback}\n\`\`\`\nFix the cell so it runs. Keep the rest of the notebook as it is.`,
    toolbarLabel: (cellId) => `Cell ${cellId} actions`,
    cellLabel: (cellId) => `Cell ${cellId}`,
    barLabel: "Notebook",
    raised: (count) => (count === 1 ? "1 cell raised an error." : `${count} cells raised an error.`),
    goToRaised: (count) => (count === 1 ? "Go to it" : "Go to the first"),
    outlineLabel: "Outline",
    problemsLabel: (cellId) => `Problems in cell ${cellId}`,
    problemsCount: (count) =>
      count === 1 ? "1 problem found before running" : `${count} problems found before running`,
    problemAt: (line) => `Line ${line}`,
    severity: { error: "Error", warning: "Warning" },
    editorKeys:
      "Tab indents and Shift+Tab outdents. Press Esc to leave the code, then Tab to move on. "
      + "Ctrl+Enter runs to here. Shift+Enter runs to here and moves to the next cell.",
    commandKeys:
      "Enter edits this cell. A or B adds a cell above or below. Press D twice to delete it. "
      + "M makes it text, Y makes it code. J and K move between cells. Z undoes the last change "
      + "to the list of cells.",
    lint: {
      gateReturnsInstructions: (shown) =>
        `\`${shown}\` adds the gate and returns an InstructionSet, not the circuit. Create the `
        + "circuit first (for example `qc = QuantumCircuit(1)`), apply the gate on its own line "
        + "(`qc.h(0)`), then use `qc`.",
      measureAllReturnsNone: (shown) =>
        `\`${shown}\` measures the circuit in place and returns None, not the circuit. Call it on `
        + "its own line and then use the circuit, or use `measure_all(inplace=False)` for a measured copy.",
      measuredCircuit: (name) =>
        `\`${name}\` has measurements, so it has no statevector or operator. Build the state from `
        + `the circuit before measuring it, or pass \`${name}.remove_final_measurements(inplace=False)\`.`,
      removedApi: {
        "qiskit.execute":
          "`qiskit.execute` was removed in Qiskit 1.0. Run circuits with a primitive: `StatevectorSampler().run([qc], shots=1000)`.",
        "qiskit.Aer":
          "`Aer` is no longer importable from `qiskit`. Use `from qiskit_aer import AerSimulator`, or `StatevectorSampler` from `qiskit.primitives`.",
        "qiskit.BasicAer": "`BasicAer` was removed in Qiskit 1.0. Use `StatevectorSampler` from `qiskit.primitives`.",
        "qiskit.IBMQ":
          "`IBMQ` was removed. Hardware access goes through `qiskit_ibm_runtime`, and on Leona through `leona_submit(qc)`.",
        "qiskit.primitives.Sampler": "The V1 `Sampler` was removed in Qiskit 2.0. Use `StatevectorSampler`.",
        "qiskit.primitives.Estimator": "The V1 `Estimator` was removed in Qiskit 2.0. Use `StatevectorEstimator`.",
        "qiskit.primitives.BackendSampler": "`BackendSampler` was removed in Qiskit 2.0. Use `BackendSamplerV2`.",
        "qiskit.primitives.BackendEstimator": "`BackendEstimator` was removed in Qiskit 2.0. Use `BackendEstimatorV2`.",
        "qiskit.opflow": "`qiskit.opflow` was removed. Use `SparsePauliOp` from `qiskit.quantum_info`.",
        "qiskit.algorithms":
          "`qiskit.algorithms` was removed. The algorithms moved to the separate `qiskit_algorithms` package, which this sandbox does not have. Write the loop directly with a primitive.",
        "qiskit.providers.aer": "`qiskit.providers.aer` was removed. Use `from qiskit_aer import AerSimulator`.",
        "qiskit.test": "`qiskit.test` was removed.",
        "qiskit.tools": "`qiskit.tools` was removed.",
        bind_parameters: "`bind_parameters` was removed in Qiskit 1.0. Use `assign_parameters`.",
        qasm: "`QuantumCircuit.qasm()` was removed in Qiskit 1.0. Use `qasm2.dumps(qc)` or `qasm3.dumps(qc)`.",
      },
    },
  },
  ja: {
    runToHereHint: "このセルまでのすべてのセルを、最初から新しいサンドボックスで実行します。",
    runAll: "すべて実行",
    runAllHint: "ノートブック全体を、最初から新しいサンドボックスで実行します。",
    chip: {
      ran: "実行済み",
      raised: "エラー",
      not_run: "未実行",
      running: "実行中…",
      edited: "実行後に編集",
      skipped: "スキップ",
    },
    duration: (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} 秒`),
    durationHint: "前回の実行でこのセルにかかった時間",
    duplicate: "複製",
    convertToText: "テキストに変更",
    convertToCode: "コードに変更",
    askNala: "Nalaに質問",
    askNalaHint: "このセルについてチャットでNalaに質問します",
    fixWithNala: "Nalaに修正を依頼",
    fixWithNalaHint: "このセルのエラーの修正をNalaに依頼します",
    askNalaPrefix: (cellId) => `セル ${cellId} について: `,
    fixWithNalaTurn: (cellId, traceback) =>
      `セル \`${cellId}\` で次のエラーが出ました:\n\`\`\`\n${traceback}\n\`\`\`\nこのセルが実行できるように直してください。ノートブックの他の部分はそのままにしてください。`,
    toolbarLabel: (cellId) => `セル ${cellId} の操作`,
    cellLabel: (cellId) => `セル ${cellId}`,
    barLabel: "ノートブック",
    raised: (count) => `${count}個のセルでエラーが出ました。`,
    goToRaised: (count) => (count === 1 ? "そのセルへ移動" : "最初のセルへ移動"),
    outlineLabel: "目次",
    problemsLabel: (cellId) => `セル ${cellId} の問題`,
    problemsCount: (count) => `実行前に${count}件の問題が見つかりました`,
    problemAt: (line) => `${line}行目`,
    severity: { error: "エラー", warning: "警告" },
    editorKeys:
      "Tabでインデント、Shift+Tabでインデントを戻します。Escでコードから抜け、続けてTabで次へ移動します。"
      + "Ctrl+Enterでここまで実行し、Shift+Enterでここまで実行して次のセルへ移動します。",
    commandKeys:
      "Enterでこのセルを編集します。AまたはBで上または下にセルを追加し、Dを2回押すと削除します。"
      + "Mでテキスト、Yでコードに変更します。JとKでセル間を移動し、Zでセル構成の直前の変更を元に戻します。",
    lint: {
      gateReturnsInstructions: (shown) =>
        `\`${shown}\` はゲートを追加して InstructionSet を返します。回路そのものではありません。`
        + "先に回路を作り（例：`qc = QuantumCircuit(1)`）、ゲートは別の行で適用して（`qc.h(0)`）、"
        + "そのあとで `qc` を使ってください。",
      measureAllReturnsNone: (shown) =>
        `\`${shown}\` は回路をその場で測定して None を返します。回路は返しません。`
        + "別の行で呼び出してから回路を使うか、測定済みのコピーが必要なら `measure_all(inplace=False)` を使ってください。",
      measuredCircuit: (name) =>
        `\`${name}\` には測定が含まれているため、状態ベクトルも演算子も持ちません。`
        + `測定する前の回路から状態を作るか、\`${name}.remove_final_measurements(inplace=False)\` を渡してください。`,
      removedApi: {
        "qiskit.execute":
          "`qiskit.execute` は Qiskit 1.0 で削除されました。回路はプリミティブで実行します：`StatevectorSampler().run([qc], shots=1000)`。",
        "qiskit.Aer":
          "`Aer` は `qiskit` からインポートできなくなりました。`from qiskit_aer import AerSimulator` か、`qiskit.primitives` の `StatevectorSampler` を使ってください。",
        "qiskit.BasicAer": "`BasicAer` は Qiskit 1.0 で削除されました。`qiskit.primitives` の `StatevectorSampler` を使ってください。",
        "qiskit.IBMQ":
          "`IBMQ` は削除されました。ハードウェアへは `qiskit_ibm_runtime` から、Leona では `leona_submit(qc)` からアクセスします。",
        "qiskit.primitives.Sampler": "V1 の `Sampler` は Qiskit 2.0 で削除されました。`StatevectorSampler` を使ってください。",
        "qiskit.primitives.Estimator": "V1 の `Estimator` は Qiskit 2.0 で削除されました。`StatevectorEstimator` を使ってください。",
        "qiskit.primitives.BackendSampler": "`BackendSampler` は Qiskit 2.0 で削除されました。`BackendSamplerV2` を使ってください。",
        "qiskit.primitives.BackendEstimator": "`BackendEstimator` は Qiskit 2.0 で削除されました。`BackendEstimatorV2` を使ってください。",
        "qiskit.opflow": "`qiskit.opflow` は削除されました。`qiskit.quantum_info` の `SparsePauliOp` を使ってください。",
        "qiskit.algorithms":
          "`qiskit.algorithms` は削除されました。アルゴリズムは別パッケージの `qiskit_algorithms` に移りましたが、このサンドボックスにはありません。プリミティブを使ってループを直接書いてください。",
        "qiskit.providers.aer": "`qiskit.providers.aer` は削除されました。`from qiskit_aer import AerSimulator` を使ってください。",
        "qiskit.test": "`qiskit.test` は削除されました。",
        "qiskit.tools": "`qiskit.tools` は削除されました。",
        bind_parameters: "`bind_parameters` は Qiskit 1.0 で削除されました。`assign_parameters` を使ってください。",
        qasm: "`QuantumCircuit.qasm()` は Qiskit 1.0 で削除されました。`qasm2.dumps(qc)` か `qasm3.dumps(qc)` を使ってください。",
      },
    },
  },
};

export const WORKSPACE_COPY: Record<PublicLocale, {
  surfaces: { brandedRun: string; preview: string };
  sidebar: {
    surfaceSwitch: string;
    run: string;
    studio: string;
    qapps: string;
    notebooks: string;
    allNotebooks: string;
    courses: string;
    atlas: string;
    openAtlas: string;
    myQapps: string;
    exploreQapps: string;
    createQapp: string;
    createQappStudio: string;
    library: string;
    /** The hardware-runs page, listed under Studio beside `library`. */
    hardwareRuns: string;
    projects: string;
    chats: string;
    artifacts: string;
    /** Run's folder section. Studio's artifact grouping keeps `projects`. */
    runFolders: string;
    renameFolder: (name: string) => string;
    deleteFolder: (name: string) => string;
    deleteFolderTitle: string;
    deleteFolderWarning: (name: string) => string;
    folderOptions: (name: string) => string;
    reorderFolder: (name: string) => string;
    folderMoveUp: (name: string) => string;
    folderMoveDown: (name: string) => string;
    folderOrderFailed: string;
    folderRenameFailed: string;
    folderDeleteFailed: string;
    /* Studio's Projects (migration 0041). Separate keys from the folder ones
       above, not shared: one locale key used to render both sections, so
       renaming it relabelled both — the owner's Folders/Projects distinction
       only survives while the two have their own words. Every key here is
       REQUIRED, never optional: `Record<PublicLocale, …>` is the whole of the
       Japanese-parity gate, and a `?` defeats it silently. */
    renameProject: (name: string) => string;
    deleteProject: (name: string) => string;
    deleteProjectTitle: string;
    deleteProjectWarning: (name: string) => string;
    projectMoveUp: (name: string) => string;
    projectMoveDown: (name: string) => string;
    projectCreateFailed: string;
    projectOrderFailed: string;
    projectRenameFailed: string;
    projectDeleteFailed: string;
    projectName: string;
    createProject: string;
    emptyProjects: string;
    recentsAbove: string;
    recentsBelow: string;
    recentsPositionLabel: string;
    collapseRecents: string;
    expandRecents: string;
    archivedMoved: string;
    archivedInSettings: string;
    undo: string;
    chatArchived: (title: string) => string;
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
    mentions: string;
    /** The bell button's own label; the count is read separately so a screen
     * reader hears "Notifications, 3 unread" rather than a number with no name. */
    notifications: string;
    notificationsUnread: (count: number) => string;
    notificationsEmpty: string;
    notificationsMarkAllRead: string;
    notificationsMarkRead: string;
    /** "N minutes/hours/days ago", for one notification's timestamp. */
    notificationsAgo: (value: number, unit: "minute" | "hour" | "day") => string;
    notificationsJustNow: string;
    usageRunsLeft: (remaining: number, limit: number) => string;
    usageRunsNone: string;
    usageRunsUnlimited: string;
    usageNextSlotOn: (date: string) => string;
    usageNextSlotWhen: (word: string) => string;
    signOut: string;
    /**
     * Plan name shown beside the person's first name in the sidebar footer.
     *
     * The PUBLIC name of the tier, which for two of them is not the id: `pro`
     * is Plus and `team` is Professional. See the mapping at the top of
     * lib/account-tier.ts — a label written from the id reads as the wrong
     * plan, one rung off, on the surface a person checks to see what they pay
     * for.
     */
    tierLabel: Record<AccountTier, string>;
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
    inconclusive: string;
    legacyUnknown: string;
    stale: string;
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
    // Project filtering in the discovery pane. Required in both locales — a
    // `?` here is defeated silently by `Record<PublicLocale, …>`.
    projectFilterLabel: string;
    projectAll: string;
    projectUngrouped: string;
    projectEmpty: string;
    ungroupedEmpty: string;
    workingCircuit: string;
    editingVersion: (version: string, framework: string) => string;
    newDraft: string;
    qappTitle: string;
    qappPrompt: string;
    qappPlaceholder: string;
    qappHelp: string;
    copyCode: string;
    copied: string;
    downloadExport: string;
    simulate: string;
    simulation: string;
    cpuLane: string;
    cpuEligible: string;
    cpuUnavailable: (reason: string) => string;
    sandboxFallbackExplainer: string;
    runInSandbox: string;
    openSimulation: string;
    simulationArtifactRequired: string;
    cpuInvalidShots: (maximum: number) => string;
    cpuInvalidSeed: (maximum: number) => string;
    simulationPersistenceUnavailable: string;
    cpuSimulationRecorded: string;
    simulationFailed: string;
    /** A CPU run the simulator worker did not finish within its time budget. */
    cpuSimulationTimedOut: string;
    simulationBoundary: string;
    sweep: {
      heading: string;
      intro: string;
      gate: string;
      qubit: string;
      start: string;
      end: string;
      points: string;
      run: string;
      running: string;
      openVisual: string;
      noAngle: string;
      outOfSync: string;
      incomplete: string;
      tooLarge: string;
      unavailable: Record<"width" | "operations" | "custom" | "measurement" | "angle" | "invalid", string>;
      boundary: string;
      chart: string;
      angleColumn: string;
      probabilityColumn: string;
      expectationColumn: string;
      downloadCsv: string;
      downloadJson: string;
      timedOut: string;
    };
    simulationArtifact: string;
    sourceFingerprint: string;
    interchangeFingerprint: string;
    simulationModel: string;
    directSourceModel: string;
    standardDecompositionModel: string;
    simulator: string;
    browserCpu: string;
    runCpuSimulation: string;
    rerunCpuSimulation: string;
    rerunPrompt: string;
    confirmRerun: string;
    cancel: string;
    hardwareLanes: string;
    qpuExecution: string;
    qpuUnavailable: string;
    simulationResults: string;
    simulationNoRecords: string;
    simulationRecord: string;
    artifactVersion: string;
    operations: string;
    resultCounts: string;
    simulationDistribution: string;
    simulationPeak: string;
    simulationOtherBar: (states: number) => string;
    simulationRecordSummary: (shots: string, qubits: number) => string;
    simulationDetails: string;
    readingConcentrated: (state: string, share: string) => string;
    readingPaired: (first: string, second: string, share: string) => string;
    readingSpread: (states: number, state: string, share: string) => string;
    hardwareCatalogLoading: string;
    hardwareCatalogUnavailable: string;
    hardwareDevice: string;
    hardwareAccessFree: string;
    hardwareAccessOnDemand: string;
    hardwareTaskFee: string;
    hardwareShotFees: (shots: string) => string;
    hardwareEstimatedTotal: string;
    hardwareRateConfirmed: (date: string) => string;
    hardwareRateSource: string;
    hardwareEstimating: string;
    hardwareEstimateFailed: string;
    hardwareRequestSubmission: string;
    hardwareVerifiedRequired: string;
    hardwareInterchangeRequired: string;
    hardwareJobStatus: string;
    hardwareJobId: string;
    /** The physical machine the provider ran the job on (`ibm_brisbane`). */
    hardwareMachine: string;
    hardwareJobError: string;
    hardwareRawCounts: string;
    hardwareIdealComparison: string;
    hardwareIdealTvd: string;
    hardwareIdealTvdGloss: string;
    hardwareIdealFidelity: string;
    hardwareIdealShotNoise: (share: string, shots: string) => string;
    hardwareIdealBitstring: string;
    hardwareIdealMeasuredShare: string;
    hardwareIdealIdealShare: string;
    hardwareIdealOtherOutcomes: string;
    hardwareIdealProvenance: string;
    hardwareIdealUnavailable: (reason: string) => string;
    /** Link from the hardware panel to the hardware-runs page. */
    hardwareRunHistory: string;
    /* Mitigation (proposal 5, increment 4). Zero-noise extrapolation is opt-in
       and its cost is shown before submitting; readout correction needs no
       opt-in. Both are computed from the raw counts and shown beside them. */
    hardwareZneOption: string;
    /** What opting in sends and what it uses, on IBM's free queue. */
    hardwareZneCost: (circuits: string, totalShots: string, shots: string) => string;
    /** Under a billed estimate: the fees above already cover every circuit. */
    hardwareZnePriced: (circuits: string, totalShots: string) => string;
    hardwareMitigationHeading: string;
    hardwareMitigationNote: string;
    hardwareReadoutCorrected: string;
    hardwareReadoutGloss: string;
    hardwareReadoutCalibratedAt: (date: string) => string;
    hardwareReadoutSymmetric: string;
    hardwareZneRichardson: string;
    hardwareZneLinear: string;
    hardwareZneGloss: string;
    hardwareZneClipped: (share: string) => string;
    hardwareZneGates: (base: string, three: string, five: string) => string;
    hardwareMitigationUnavailable: (reason: string) => string;
    /** Column heading in the measured-against-ideal table. */
    hardwareReadoutCorrectedShare: string;
    hardwarePricedOnly: string;
    hardwareBlockedReason: (reason: string) => string;
    /** "How busy is this device?" — the panel shown before submitting. */
    hardwareQueueTitle: string;
    hardwareQueueChecking: string;
    hardwareQueueJobsAhead: (count: string) => string;
    hardwareQueueNoneAhead: string;
    hardwareQueueMachine: (name: string) => string;
    //: The weekly hardware BUDGET is spent, which is not the same thing as the
    //: deployment being switched off — a person can act on this one. Takes the
    //: formatted amounts rather than raw numbers so the currency renders the
    //: same way as the estimate directly above it on screen.
    hardwareSpendExhausted: (estimate: string, limit: string, spent: string) => string;
    hardwareSpendFreeTier: (estimate: string) => string;
    //: The pre-submit noise estimate (lib/qpu-noise.ts). `access` is the
    //: device's QpuAccess, because a free-queue run costs allowance, not money.
    hardwarePreviewTitle: (access: string) => string;
    hardwarePreviewComputing: string;
    hardwarePreviewTvd: string;
    hardwarePreviewUniform: string;
    hardwarePreviewReading: (reading: string, share: string, shots: string) => string;
    hardwarePreviewRange: (count: number, min: string, max: string, machine: string) => string;
    hardwarePreviewEstimated: string;
    hardwarePreviewGates: (two: string, one: string, qubits: number) => string;
    hardwarePreviewFigures: (machine: string) => string;
    hardwarePreviewFigureLabel: (kind: string) => string;
    hardwarePreviewStatistic: (statistic: string) => string;
    hardwarePreviewNotPublished: string;
    hardwarePreviewFigureMeta: (statistic: string, date: string) => string;
    hardwarePreviewSource: string;
    hardwarePreviewMachines: string;
    hardwarePreviewCaveat: string;
    hardwarePreviewUnavailable: (reason: string) => string;
    verifySave: string;
    starting: string;
    bringYourOwn: string;
    bringingYourOwn: string;
    broughtInSaved: string;
    broughtInFailed: string;
    view: string;
    circuit: string;
    visual: string;
    code: string;
    summary: string;
    versions: string;
    openSummary: string;
    expandPanel: string;
    collapsePanel: string;
    computeLanes: string;
    cpuUnavailableShort: string;
    aboutConversions: string;
    conversionExplainer: string;
    conversionUnavailable: (target: string, source: string) => string;
    exportOnlyFramework: string;
    uncommittedEdits: string;
    uncommittedEditsNote: string;
    footer: string;
    openRun: string;
    /** How many rows the discovery list holds after the active filter. */
    countCircuits: (count: number) => string;
    /** Label for the artifact's last-changed date in the Summary fact strip. */
    updated: string;
    inspector: string;
    liveDraft: string;
    selectedGate: string;
    runContract: string;
    mode: string;
    source: string;
    evidence: string;
    evidencePhysical: string;
    evidenceStructural: string;
    evidenceCaveats: string;
    evidenceFailed: string;
    evidenceNotLoaded: string;
    openFullRecord: string;
    shots: string;
    seed: string;
    seedAuto: string;
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
    sourceReferenceHeading: (source: string, target: string) => string;
    versionHistory: string;
    repositoryView: string;
    currentVersion: (id: string) => string;
    draftNotSaved: string;
    currentVersionNote: string;
    draftVersionNote: string;
    verificationQueued: string;
    verificationAttach: (id: string) => string;
    // Version history. Every capability label below doubles as a loss label in
    // the restore dialog, so the list and the warning cannot describe the same
    // thing two different ways.
    versionLabel: (seq: number) => string;
    versionCurrentBadge: string;
    versionHistoryLoading: string;
    versionHistoryUnavailable: string;
    versionHistoryEmpty: string;
    versionShowOlder: string;
    versionOriginAgentRun: string;
    versionOriginStudioDraft: string;
    versionOriginImportedReference: string;
    versionOriginUserImport: string;
    versionOriginStarterExample: string;
    versionOriginUnknown: string;
    versionHolds: string;
    versionHoldsNothing: string;
    capabilityQasm: string;
    capabilityExport: string;
    capabilityResourceEstimates: string;
    capabilityFrameworkVariants: string;
    capabilityVerification: string;
    restore: string;
    restoring: string;
    restoreConfirmTitle: string;
    restoreConfirmBody: (seq: number) => string;
    restoreLossIntro: string;
    restoreCancel: string;
    restoreConfirmAnyway: string;
    restoreFailed: string;
    restoreDone: (seq: number) => string;
    frameworkNote: string;
    gateDescriptions: Record<string, string>;
    palette: string;
    builderHint: string;
    pickTarget: string;
    addQubit: string;
    removeQubit: string;
    undo: string;
    clearAll: string;
    clearedUndo: (count: number) => string;
    qubitRemovedWithGates: (count: number) => string;
    untitledCircuit: string;
    applyToCode: string;
    appliedToCode: string;
    compression: string;
    compressionIntro: string;
    optimizationLocal: string;
    optimizationExternal: string;
    compressionStrategy: string;
    compressionInverse: string;
    compressionInverseDescription: string;
    compressionRotations: string;
    compressionRotationsDescription: string;
    compressionPatterns: string;
    compressionPatternsDescription: string;
    compressionBalanced: string;
    compressionBalancedDescription: string;
    compressionOperations: string;
    compressionDepth: string;
    compressionTwoQubit: string;
    compressionNoChange: string;
    compressionApply: string;
    compressionConfirmApply: string;
    compressionUndo: string;
    compressionBoundary: string;
    compressionOverwrite: string;
    compressionApplied: (removed: number, beforeDepth: number, afterDepth: number) => string;
    compressionUndone: string;
    externalCompilation: string;
    externalIntro: string;
    externalLevel: string;
    externalCompiler: string;
    externalQiskit: string;
    externalCirq: string;
    externalPytket: string;
    externalPennyLane: string;
    externalPyZX: string;
    externalBqskit: string;
    externalRecommended: string;
    externalLevelHelp: string;
    externalLevelOption: (level: number) => string;
    externalBoundary: string;
    externalRun: string;
    externalRunSelected: (compiler: string) => string;
    externalRunning: string;
    externalOpenRun: string;
    externalFailed: string;
    externalConnectionLost: string;
    externalPreview: (compiler: string, version: string) => string;
    externalUnverified: string;
    externalApply: string;
    externalConfirmApply: string;
    externalApplied: (compiler: string, before: number, after: number) => string;
    synthesisHeading: string;
    synthesisIntro: string;
    synthesisTargetLabel: string;
    synthesisTargetGeneric: string;
    synthesisTargetDevice: string;
    synthesisConnectivityAllToAll: string;
    synthesisConnectivityLine: string;
    synthesisConnectivityGrid: string;
    synthesisConnectivityHeavyHex: string;
    synthesisDeviceLoading: string;
    synthesisDeviceUnavailable: string;
    synthesisObjectiveLabel: string;
    synthesisObjectiveDepth: string;
    synthesisObjectiveTwoQubit: string;
    synthesisObjectiveTCount: string;
    synthesisRun: string;
    synthesisRunning: string;
    synthesisOpenRun: string;
    synthesisFailed: string;
    synthesisConnectionLost: string;
    synthesisCandidates: string;
    synthesisColumnCompiler: string;
    synthesisColumnStatus: string;
    synthesisColumnDepth: string;
    synthesisColumnTwoQubit: string;
    synthesisColumnTCount: string;
    synthesisColumnGates: string;
    synthesisColumnEquivalence: string;
    synthesisStatusSucceeded: string;
    synthesisStatusUnsupported: string;
    synthesisStatusFailed: string;
    synthesisEquivalent: string;
    synthesisNotEquivalent: string;
    synthesisNotChecked: string;
    synthesisBest: string;
    synthesisUse: string;
    synthesisConfirmUse: string;
    synthesisApplied: (compiler: string) => string;
    synthesisUndo: string;
    synthesisUndone: string;
    synthesisCannotApply: string;
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
    closeBlock: (name: string) => string;
    blockOpaqueNote: string;
    editBlock: string;
    editBlockTitle: (name: string) => string;
    editBlockUses: (count: number) => string;
    editBlockSave: string;
    editBlockCancel: string;
    editBlockCycleError: string;
    ungroupBlock: string;
    ungrouped: (name: string) => string;
    blockSaved: (name: string, uses: number) => string;
    blocksPanelOpen: string;
    blocksPanelTitle: string;
    /** Link from the block library to the Atlas workflow planner. */
    blocksPlanLink: string;
    blockCategoryLabel: Record<"state-preparation" | "transforms" | "oracles" | "arithmetic" | "simulation" | "variational", string>;
    insertAtQubit: string;
    insertBlock: string;
    blockInserted: (name: string) => string;
    blockTooNarrow: (required: number, available: number) => string;
    addQubitsForBlock: string;
    galleryOpen: string;
    galleryTitle: string;
    exampleQubits: (count: number) => string;
    loadExample: string;
    unsavedChangesConfirm: string;
    exampleNotFound: string;
    atlasImporting: string;
    atlasImportFailed: string;
    expectationValue: (value: number) => string;
    askTitle: string;
    askPlaceholder: string;
    askSubmit: string;
    askCancel: string;
    askStageLabel: Record<"planned" | "coded" | "sandboxed" | "verified" | "saved", string>;
    askChangeSummary: (added: Array<{ gate: string; count: number }>, removed: Array<{ gate: string; count: number }>) => string;
    askGoBack: string;
    askDisconnected: string;
    askOpenRun: string;
    hideInspector: string;
    showInspector: string;
    circuitRestored: string;
    circuitReadOnly: string;
    circuitReadOnlyTruncated: (shown: number, total: number) => string;
    readOnly: string;
    readOnlyHint: string;
    circuitNotRebuildable: string;
    sourceFallbackNote: (target: string, source: string) => string;
    circuitTooLargeToDraw: string;
    canvasOutOfDate: string;
    canvasBeyondBuilder: string;
    rebuildFromCode: string;
    rebuiltFromCode: string;
    applyOverwritesEditedCode: string;
    applyOverwritesUnrepresentableCode: string;
    confirmApply: string;
    // UX pass 6 (2026-09-12): the circuit header, gate inspector, playhead,
    // code-beside-diagram view and the keyboard sheet.
    metaQubits: (count: number) => string;
    metaOperations: (count: number) => string;
    metaDepth: (depth: number) => string;
    metaSavedVersion: (id: string) => string;
    metaCpuRun: (when: string) => string;
    metaCpuRunStale: string;
    metaNoCpuRun: string;
    justNow: string;
    shortcutsOpen: string;
    shortcutsTitle: string;
    shortcutsClose: string;
    shortcutGroups: Record<"general" | "visual" | "simulation", string>;
    shortcutRows: Record<string, string>;
    paletteGroups: Record<"oneQubit" | "rotations" | "twoQubit" | "measure" | "more", string>;
    gateNames: Record<string, string>;
    inspectorActsOn: (qubits: string) => string;
    inspectorAngle: string;
    inspectorMatrix: string;
    inspectorBasis: (first: string, second: string) => string;
    inspectorNoMatrixMeasure: string;
    inspectorNoMatrixCustom: (qubits: number) => string;
    inspectorNoMatrixAngle: string;
    inspectorMoment: (moment: number) => string;
    playheadTitle: string;
    playheadAfter: (moment: number, total: number) => string;
    playheadStart: string;
    playheadBoundary: string;
    playheadStepBack: string;
    playheadStepForward: string;
    playheadToStart: string;
    playheadToEnd: string;
    playheadSlider: string;
    playheadBitOrder: (highest: number) => string;
    playheadUnavailable: (reason: string, limit: number) => string;
    playheadPhaseTitle: string;
    playheadPhaseNote: string;
    playheadPhaseColumn: string;
    playheadEffectLabel: string;
    splitShow: string;
    splitHide: string;
    liveSync: string;
    liveSyncHint: string;
    codeFollowedDiagram: string;
    laneReady: string;
    latestRecord: string;
  };
  notebooks: {
    title: string;
    lede: string;
    newNotebook: string;
    briefLabel: string;
    briefPlaceholder: string;
    create: string;
    creating: string;
    createFailed: string;
    kindLabel: string;
    kindOption: Record<NotebookKind, string>;
    startersLabel: string;
    showMoreBriefs: (count: number) => string;
    audienceLevelLabel: string;
    audienceLevelOption: Record<NotebookAudienceLevel, string>;
    analogiesLabel: string;
    mathLevelLabel: string;
    mathLevelOption: Record<NotebookMathLevel, string>;
    languageLabel: string;
    languageOption: Record<"en" | "ja", string>;
    frameworkLabel: string;
    seedAtlasLabel: string;
    seedAtlasPlaceholder: string;
    seedCircuitLabel: string;
    seedCircuitPlaceholder: string;
    importLabel: string;
    importHint: string;
    importFailed: string;

    listLoading: string;
    listLoadFailed: string;
    listEmpty: string;
    search: string;
    searchPlaceholder: string;
    noMatch: string;
    updated: string;
    statusPill: Record<NotebookStatusPillCopyKey, string>;
    open: string;

    backToNotebooks: string;
    loading: string;
    loadFailed: string;
    titleEditFailed: string;
    saveTitle: string;
    versionPickerLabel: string;
    versionLabel: (seq: number) => string;
    download: string;
    downloadFailed: string;
    runAgain: string;
    running: string;
    runAgainFailed: string;
    versionFailedHeadline: string;
    versionFailedHint: string;
    versionFailedNoCellsHeadline: string;
    versionFailedNoCellsHint: string;

    reviewLabel: string;
    reviewVerdict: Record<NotebookReviewVerdict, string>;
    reviewFindingsLabel: string;
    reviewSeverity: Record<NotebookFindingSeverity, string>;
    reviewCategory: Record<NotebookFindingCategory, string>;
    reviewNotEstablishedLabel: string;
    reviewNoReview: string;

    compareToggle: string;
    comparePickerLabel: string;
    diffStatus: Record<NotebookDiffCellStatus, string>;
    diffHeaderField: Record<NotebookDiffHeaderFieldKey, string>;
    diffLoading: string;
    diffLoadFailed: string;

    progressSummary: (mastery: NotebookMastery) => string;

    quizButtonLabel: string;
    quizButtonFailed: string;

    chatLabel: string;
    chatPlaceholder: string;
    chatSend: string;
    chatSending: string;
    chatEmpty: string;
    chatLoadFailed: string;
    chatSendFailed: string;
    runStreamLost: string;
    progressLabel: string;

    /** The "Live" lane's own copy (plan 10-notebook-ide): what to call each phase
     * while a notebook is developing in real time, and the banner shown during a
     * repair. Kept as its own nested object rather than flattened, since it is one
     * cohesive feature's worth of strings. */
    live: {
      phase: Record<
        "idle" | "outlining" | "drafting" | "checking" | "running" | "repairing" | "reviewing" | "done" | "failed",
        string
      >;
      /** sr-only label on the writing caret after the cell Nala is typing. */
      writingLabel: string;
      cellStatus: Record<"queued" | "ran" | "raised" | "not_run", string>;
      /** "Nala is fixing cell {cellId}: attempt {attempt} of {of}." */
      repairBanner: (cellId: string, attempt: number, of: number) => string;
      /** The pre-execution case: a lint finding is being fixed before the cell has
       * run at all, so there is no "attempt N of M" to show yet — only that Nala
       * is heading it off. */
      checkingBanner: (cellId: string) => string;
    };

    cellStatus: Record<NotebookCellStatusCopyKey, string>;
    cellStdout: string;
    cellStderr: string;
    cellTruncated: string;
    cellErrorLabel: string;

    actionExplain: string;
    actionSimplify: string;
    actionAddFigure: string;
    actionExercise: string;
    actionExplainError: string;
    actionCheckAttempt: string;
    actionCheckAttemptCancel: string;
    checkAttemptPlaceholder: string;
    checkAttemptSubmit: string;
    /** The submit label on a cell that has a real grader behind it. Deliberately
     * different from `checkAttemptSubmit`: one asks a model's opinion, the other
     * runs the author's assertion against the reader's code, and a reader is owed
     * the difference before they press it. */
    checkAttemptGrade: string;
    /** A `role=question` cell's own input. Separate from the code-attempt strings
     * above because the reader is answering a question, not submitting code, and
     * "Paste or write your attempt" is wrong for a multiple choice. */
    answerLegend: string;
    answerTextPlaceholder: string;
    answerNumericPlaceholder: string;
    answerRubricPlaceholder: string;
    answerSubmit: string;
    answerClear: string;
    answerModelGraded: string;
    gradePending: string;
    gradeVerdict: Record<"passed" | "failed" | "unattempted" | "ungradable", string>;
    gradeByCheck: string;
    gradeByModel: string;
    gradeFailed: string;
    gradeNotGraded: string;
    gradeSummaryLabel: string;
    gradeSummary: (passed: number, attempted: number) => string;
    gradeUngradable: (count: number) => string;
    gradeFromOlderVersion: (seq: number) => string;
    downloadWithSolutions: string;

    edit: string;
    editExit: string;
    editHint: string;
    editCellSourceLabel: (cellId: string) => string;
    editKindLabel: string;
    editKindOption: Record<"markdown" | "code", string>;
    editRoleLabel: string;
    editRoleNone: string;
    editExecuteLabel: string;
    editRaisesLabel: string;
    editAddMarkdown: string;
    editAddCode: string;
    editDelete: string;
    editMoveUp: string;
    editMoveDown: string;
    editEmpty: string;
    saveAndRun: string;
    saveWithoutRunning: string;
    runToHere: string;
    discard: string;
    discardConfirm: string;
    saving: string;
    saveFailed: string;
    unsavedWarning: string;
    structureNotesLabel: string;
    structureNotesHint: string;
    cellNotRunBadge: string;
    /** The notebook IDE: editor, cell toolbar, notebook bar, lint messages. */
    ide: NotebookIdeCopy;

    teachMeInNotebook: string;
  };
  /* The hardware-runs page (`app/(app)/studio/hardware`, proposal 5 increment 2).
     Every key REQUIRED, for the reason the sidebar block gives: the Record type is
     the whole of the Japanese-parity gate. */
  hardwareRuns: {
    title: string;
    intro: string;
    readingGuide: string;
    loading: string;
    loadFailed: string;
    retry: string;
    empty: string;
    emptyAction: string;
    unrecordedMachine: string;
    unrecordedMachineNote: string;
    machineRunCount: (count: number) => string;
    columnSubmitted: string;
    columnStatus: string;
    columnShots: string;
    columnDistance: string;
    columnShotNoise: string;
    columnFidelity: string;
    columnReadoutCorrected: string;
    columnZne: string;
    zneRequested: string;
    status: (status: string) => string;
    inProgress: string;
    endedWithoutCounts: string;
    /** A finished run whose comparison is still being computed in this tab. */
    workingOut: string;
    programMismatch: string;
    details: string;
    showOlder: string;
    loadingOlder: string;
    olderFailed: string;
  };
  courses: {
    title: string;
    lede: string;
    coursesTab: string;

    planLabel: string;
    briefLabel: string;
    briefPlaceholder: string;
    moduleCountLabel: string;
    moduleCountOption: Record<CourseModuleCountCopyKey, string>;
    startersLabel: string;
    create: string;
    creating: string;
    createFailed: string;

    listLoading: string;
    listLoadFailed: string;
    listEmpty: string;
    search: string;
    searchPlaceholder: string;
    noMatch: string;
    updated: string;
    statusPill: Record<CourseStatusCopyKey, string>;
    progress: (ready: number, total: number) => string;
    open: string;

    backToCourses: string;
    loading: string;
    loadFailed: string;
    titleEditFailed: string;
    saveTitle: string;

    generateAll: string;
    generatingAll: string;
    generateAllFailed: string;
    downloadRepo: string;
    downloadingRepo: string;
    downloadRepoFailed: string;
    downloadRepoDisabledHint: string;

    moduleStatusPill: Record<CourseModuleStatusCopyKey, string>;
    moduleSeqLabel: (seq: number) => string;
    topicLabel: string;
    keyConceptsLabel: string;
    objectivesLabel: string;
    deliverableLabel: string;
    durationLabel: (minutes: number) => string;
    durationUnknown: string;
    prerequisitesLabel: string;
    prerequisiteUnresolved: (slug: string) => string;
    generateModule: string;
    generatingModule: string;
    generateModuleFailed: string;
    openNotebook: string;
    moveUp: string;
    moveDown: string;
    reorderFailed: string;

    chatLabel: string;
    chatPlaceholder: string;
    chatSend: string;
    chatSending: string;
    chatEmpty: string;
    chatLoadFailed: string;
    chatSendFailed: string;
    progressLabel: string;

    /** The course creator's view: every member's latest graded attempt. */
    gradebookTitle: string;
    gradebookLede: string;
    gradebookEmpty: string;
    /** Anyone else's view of the same table: their own row only. */
    yourProgressTitle: string;
    yourProgressLede: string;
    yourProgressEmpty: string;
    gradebookLoading: string;
    gradebookLoadFailed: string;
    gradebookRefresh: string;
    gradebookMemberColumn: string;
    gradebookYou: string;
    gradebookTotalColumn: string;
    gradebookLastColumn: string;
    gradebookNotStarted: string;
    /** A course total that cannot be known yet: a module still has no ready notebook. */
    gradebookTotalUnknown: string;
    gradebookTotalsPending: string;
    gradebookScore: (passed: number, graded: number) => string;
    gradebookOlderVersion: string;
    gradebookOlderVersionHint: (seq: number) => string;
    gradebookDownloadCsv: string;
    gradebookDownloadingCsv: string;
    gradebookDownloadCsvFailed: string;

    /** A module's due date, in the viewer's zone: "Due Tue, Sep 30, 5:00 PM GMT+9". */
    dueLabel: (date: string) => string;
    /** The member's own module: past its due date with no graded attempt. */
    dueOverdue: string;
    /** The creator's control on each module card. */
    dueDateLabel: string;
    dueDateHint: string;
    saveDueDate: string;
    savingDueDate: string;
    clearDueDate: string;
    dueDateSaveFailed: string;
    /** Gradebook cell markers, and the legend that explains them. */
    gradebookLate: string;
    gradebookLateHint: (date: string) => string;
    gradebookMissing: string;
    gradebookMissingHint: (date: string) => string;
    gradebookLegend: string;
  };
}> = {
  en: {
    surfaces: { brandedRun: "Leona Run", preview: "Public preview" },
    sidebar: {
      surfaceSwitch: "Workspace mode",
      run: "Run",
      studio: "Studio",
      qapps: "Qapps",
      notebooks: "Notebooks",
      allNotebooks: "All notebooks",
      courses: "Courses",
      atlas: "Quantum Atlas",
      openAtlas: "Open Quantum Atlas",
      myQapps: "My Qapps",
      exploreQapps: "Explore Qapps",
      createQapp: "Create Qapp",
      createQappStudio: "Create from Studio",
      library: "All artifacts",
      hardwareRuns: "Hardware runs",
      projects: "Projects",
      chats: "Chats",
      artifacts: "Artifacts",
      runFolders: "Folders",
      renameFolder: (name) => `Rename ${name}`,
      deleteFolder: (name) => `Delete ${name}`,
      deleteFolderTitle: "Delete this folder?",
      deleteFolderWarning: (name) =>
        `“${name}” will be removed. The chats inside it stay in your workspace.`,
      folderOptions: (name) => `${name} options`,
      reorderFolder: (name) => `Reorder ${name}`,
      folderMoveUp: (name) => `Move ${name} up`,
      folderMoveDown: (name) => `Move ${name} down`,
      folderOrderFailed: "That order could not be saved.",
      folderRenameFailed: "That folder could not be renamed.",
      folderDeleteFailed: "That folder could not be deleted.",
      renameProject: (name) => `Rename ${name}`,
      deleteProject: (name) => `Delete ${name}`,
      deleteProjectTitle: "Delete this project?",
      deleteProjectWarning: (name) =>
        `“${name}” will be removed. The artifacts inside it stay in your workspace.`,
      projectMoveUp: (name) => `Move ${name} up`,
      projectMoveDown: (name) => `Move ${name} down`,
      projectCreateFailed: "That project could not be created.",
      projectOrderFailed: "That order could not be saved.",
      projectRenameFailed: "That project could not be renamed.",
      projectDeleteFailed: "That project could not be deleted.",
      projectName: "Project name",
      createProject: "Create project",
      emptyProjects: "Group artifacts by dragging them onto a project",
      recentsAbove: "Show recent chats above folders",
      recentsBelow: "Show recent chats below folders",
      recentsPositionLabel: "Recent chats position",
      collapseRecents: "Collapse recent chats",
      expandRecents: "Expand recent chats",
      archivedMoved: "Archived.",
      archivedInSettings: "View archived chats in settings",
      undo: "Undo",
      chatArchived: (title) => `${title} archived`,
      newArtifact: "New draft",
      viewLibrary: "View all artifacts",
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
      mentions: "Mentions",
      notifications: "Notifications",
      notificationsUnread: (count) => `Notifications, ${count} unread`,
      notificationsEmpty: "Nothing yet. A hardware run finishing or a mention will show up here.",
      notificationsMarkAllRead: "Mark all as read",
      notificationsMarkRead: "Mark as read",
      notificationsAgo: (value, unit) =>
        `${value} ${unit}${value === 1 ? "" : "s"} ago`,
      notificationsJustNow: "Just now",
      // The allowance window ROLLS. "Resets weekly" would be the natural thing
      // to write here and it would be false: runs come back one at a time,
      // seven days after each was spent, so the only honest sentence names a
      // day. See lib/usage-summary.describeNextSlot for why the two frames.
      usageRunsLeft: (remaining: number, limit: number) => `${remaining} of ${limit} runs left`,
      usageRunsNone: "No runs left",
      usageRunsUnlimited: "Unlimited runs",
      usageNextSlotOn: (date: string) => `1 more frees up on ${date}`,
      usageNextSlotWhen: (word: string) => `1 more frees up ${word}`,
      signOut: "Log out",
      tierLabel: {
        preview: "Preview",
        free: "Free",
        pro: "Plus",
        team: "Professional",
        developer: "Developer",
      },
    },
    run: {
      previewStatus: "Public preview · view-only",
      examplesTitle: "Try an example",
      // Short on purpose: the composer types these out character by character, so
      // length is time spent watching rather than reading. Most of them also name
      // no quantum method at all — someone who has never written a circuit should
      // be able to read the whole strip and see a problem they recognise. The
      // pipeline picks the method; stating one is the user's option, not the
      // price of entry.
      examples: [
        { title: "Split a supplier network in two", prompt: "Split 6 suppliers into two groups, cutting the fewest links." },
        { title: "Pick a portfolio at a set risk", prompt: "Pick 8 stocks for the best return at a fixed risk." },
        { title: "Schedule jobs across machines", prompt: "Schedule 6 jobs on 3 machines to finish soonest." },
        { title: "Search an unsorted list", prompt: "Search 16 records for the one that matches." },
        { title: "Build and verify a Bell state", prompt: "Build a Bell state and verify it." },
        { title: "Find H₂ ground-state energy", prompt: "Find the ground-state energy of an H₂ molecule." },
      ],
      morePrompts: [
        { title: "Route a delivery fleet", prompt: "Assign 12 vehicles to 40 stops at the lowest total cost, and check the answer against a classical baseline." },
        { title: "Price an option without Monte Carlo", prompt: "Price a European call option without classical Monte Carlo sampling, show the circuit, and state the speedup and its caveats." },
        { title: "Detect fraud in transaction features", prompt: "Classify transactions as fraudulent from 4 features, explain the model, and say honestly where this approach helps and where it does not." },
        { title: "Recover a marked state with Grover", prompt: "Use Grover to recover the marked state 1100 and verify the measured distribution." },
        { title: "Compare QAOA with a classical baseline", prompt: "Use QAOA to solve MaxCut on a 5-node ring and compare the result with an exact classical baseline." },
        { title: "Estimate a QFT resource profile", prompt: "Estimate the qubit count, depth, and gate profile for a QFT circuit on eight qubits." },
        { title: "Simulate credit-risk tails with QAE", prompt: "Model a small credit-portfolio loss distribution and show how quantum amplitude estimation would sample its tail risk versus classical Monte Carlo." },
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
      contextLabel: "Artifact context",
      viewArtifact: "View artifact",
      contextStatus: "Verified context retained",
      contextUnavailable: "Artifact context unavailable",
    },
    library: {
      title: "Artifacts",
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
      inconclusive: "Verification unavailable",
      legacyUnknown: "Legacy evidence unknown",
      stale: "Verification stale",
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
      backLibrary: "Back to artifacts",
      artifacts: "Artifacts",
      new: "New",
      search: "Search artifacts",
      searchPlaceholder: "Search by name, framework, or tag…",
      noSearchResults: "No artifacts match this search.",
      empty: "No saved artifacts yet. Start with the Bell-state draft.",
      projectFilterLabel: "Filter by project",
      projectAll: "All",
      projectUngrouped: "Ungrouped",
      projectEmpty: "Nothing filed under this project yet.",
      ungroupedEmpty: "Every circuit is filed under a project.",
      workingCircuit: "Working circuit",
      editingVersion: (version, framework) => `Editing version ${version} · ${framework}`,
      newDraft: "Unsaved draft",
      qappTitle: "Create a Qapp",
      qappPrompt: "Qapp prompt",
      qappPlaceholder: "e.g. adjustable phase and shots, with results shown as a pie chart",
      qappHelp: "Leave blank to auto-design it. Run opens after submission.",
      copyCode: "Copy code",
      copied: "Copied",
      downloadExport: "Download export",
      simulate: "Simulate",
      simulation: "Simulation",
      cpuLane: "CPU lane",
      cpuEligible: "CPU eligible",
      cpuUnavailable: (reason) => ({
        artifact_required: "Save this draft first.",
        framework_unavailable: "CPU execution supports only Qiskit, PennyLane, and Cirq source.",
        source_unavailable: "This circuit is outside the browser lane's supported gate shape.",
        source_limit: "This source is too large for the browser simulation lane.",
        qubit_limit: "This circuit is wider than your plan's browser simulation limit.",
        operation_limit: "This source exceeds the browser operation limit.",
      }[reason] ?? "CPU simulation is unavailable for this source."),
      sandboxFallbackExplainer: "The sandbox runs this exact source and reports the result, errors included.",
      runInSandbox: "Run this code for real",
      openSimulation: "Open simulation",
      simulationArtifactRequired: "Save this draft before creating an artifact-owned simulation record.",
      cpuInvalidShots: (maximum) => `Shots must be a whole number from 1 to ${maximum.toLocaleString("en-US")}.`,
      cpuInvalidSeed: (maximum) => `Seed must be a whole number from 0 to ${maximum.toLocaleString("en-US")}.`,
      simulationPersistenceUnavailable: "The CPU result was not recorded because this browser cannot store local simulation records.",
      cpuSimulationRecorded: "CPU simulation recorded in this browser. It did not start a Nala Run or verify this artifact.",
      simulationFailed: "CPU simulation failed before a record could be created.",
      cpuSimulationTimedOut: "The simulation took too long in this browser, so Leona stopped it before making a record.",
      simulationBoundary: "Runs in your browser on the parsed circuit. A local check, not verification.",
      sweep: {
        heading: "Parameter sweep",
        intro: "Vary one gate angle and see how a qubit responds. Useful for checking interference, entanglement, and circuit sensitivity.",
        gate: "Angle gate",
        qubit: "Observe qubit",
        start: "From (°)",
        end: "To (°)",
        points: "Points",
        run: "Run sweep",
        running: "Calculating…",
        openVisual: "Open Visual tab",
        noAngle: "Add an RX, RY, RZ, P, CP, or RZZ gate to explore its angle.",
        outOfSync: "The diagram differs from the source code. Rebuild or apply it on the Visual tab before sweeping.",
        incomplete: "This saved diagram omits operations from the source. A sweep of the partial circuit would give misleading results, so it is unavailable.",
        tooLarge: "This sweep is too large. Use fewer points or a shorter circuit.",
        unavailable: {
          width: "Sweep supports up to 12 qubits.",
          operations: "Sweep supports up to 512 operations.",
          custom: "Expand or ungroup custom gates before sweeping.",
          measurement: "Sweep needs terminal measurements; it cannot model mid-circuit collapse.",
          angle: "An angle in this circuit is not a fixed number or π expression.",
          invalid: "This diagram has an invalid gate or qubit reference.",
        },
        boundary: "Exact ideal statevector, no shots or noise. Local exploration only; this does not verify or save the circuit.",
        chart: "Probability of measuring 1 across the angle range",
        angleColumn: "Angle (°)",
        probabilityColumn: "P(1)",
        expectationColumn: "⟨Z⟩",
        downloadCsv: "Download CSV",
        downloadJson: "Download reproducible JSON",
        timedOut: "The sweep took too long in this browser and was stopped.",
      },
      simulationArtifact: "Artifact",
      sourceFingerprint: "Source fingerprint",
      interchangeFingerprint: "Interchange fingerprint",
      simulationModel: "Execution model",
      directSourceModel: "Direct parsed source",
      standardDecompositionModel: "OpenQASM standard-gate decomposition · global-phase caveat",
      simulator: "Simulator",
      browserCpu: "Browser CPU",
      runCpuSimulation: "Run CPU simulation",
      rerunCpuSimulation: "Run CPU simulation again",
      rerunPrompt: "This source already has a local record. Run again to add another, without overwriting it.",
      confirmRerun: "Confirm rerun",
      cancel: "Cancel",
      hardwareLanes: "Hardware lanes",
      qpuExecution: "QPU execution",
      qpuUnavailable: "QPU execution is planned. It remains unavailable until a provider, estimate, confirmation, and spend policy are in place.",
      simulationResults: "Simulation records",
      simulationNoRecords: "No CPU simulation record exists for this artifact in this browser.",
      simulationRecord: "CPU simulation record",
      artifactVersion: "Base saved version",
      operations: "Operations",
      resultCounts: "All sampled counts",
      simulationDistribution: "Sampled distribution",
      simulationPeak: "Peak state",
      simulationOtherBar: (states) => `${states} more states`,
      simulationRecordSummary: (shots, qubits) => `${shots} shots · ${qubits} qubits`,
      simulationDetails: "Record details",
      readingConcentrated: (state, share) => `${share} of shots landed on |${state}⟩, the dominant outcome.`,
      readingPaired: (first, second, share) => `Shots concentrated on |${first}⟩ and |${second}⟩ (${share} combined).`,
      readingSpread: (states, state, share) => `${states} distinct outcomes; the most frequent was |${state}⟩ at ${share}.`,
      hardwareCatalogLoading: "Loading the device catalog…",
      hardwareCatalogUnavailable: "The QPU device catalog is unavailable because the control plane could not be reached.",
      hardwareDevice: "Device",
      hardwareAccessFree: "Free queue",
      hardwareAccessOnDemand: "On-demand billing",
      hardwareTaskFee: "Per-task fee",
      hardwareShotFees: (shots) => `Shot fees (${shots} shots)`,
      hardwareEstimatedTotal: "Estimated total",
      hardwareRateConfirmed: (date) => `Vendor rate card, confirmed ${date}`,
      hardwareRateSource: "Rate source",
      hardwareEstimating: "Estimating…",
      hardwareEstimateFailed: "The estimate is unavailable because the control plane could not be reached.",
      hardwareRequestSubmission: "Request hardware submission",
      hardwareVerifiedRequired: "Requires a verified saved version of this circuit.",
      hardwareInterchangeRequired: "No OpenQASM export is stored for this version. Rerun Verify & save to produce one.",
      hardwareJobStatus: "Job status",
      hardwareJobId: "Provider job",
      hardwareMachine: "Machine",
      hardwareJobError: "Provider error",
      hardwareRawCounts: "Raw device counts",
      hardwareIdealComparison: "Measured against ideal",
      hardwareIdealTvd: "Total variation distance",
      hardwareIdealTvdGloss: "0 means the same distribution as this circuit's ideal outcome. 1 means no overlap at all.",
      hardwareIdealFidelity: "Hellinger fidelity",
      hardwareIdealShotNoise: (share, shots) =>
        `A perfect device would still show a distance of about ${share} at ${shots} shots, from sampling alone.`,
      hardwareIdealBitstring: "Outcome",
      hardwareIdealMeasuredShare: "Measured",
      hardwareIdealIdealShare: "Ideal",
      hardwareIdealOtherOutcomes: "Other outcomes",
      hardwareIdealProvenance: "Computed in this browser from the circuit that was submitted. This is a local reading, not a verification result.",
      hardwareIdealUnavailable: (reason) => ({
        circuit_changed: "The circuit has changed since this job was submitted, so there is no ideal outcome to compare it with.",
        no_counts: "No device counts are available yet for this job.",
        unparsable: "This circuit uses gates or a measurement layout the in-browser simulator cannot read, so no ideal outcome can be computed for it.",
        qubit_limit: "This circuit is wider than your plan's browser simulation limit, so no ideal outcome can be computed for it.",
        operation_limit: "This circuit exceeds the browser operation limit, so no ideal outcome can be computed for it.",
        register_mismatch: "The device counts do not match this circuit's measured qubits, so they cannot be compared to an ideal outcome.",
        timed_out: "The ideal outcome took too long to work out in this browser, so Leona stopped it.",
      }[reason] ?? "No ideal outcome could be computed for this job."),
      hardwareRunHistory: "See every hardware run in this workspace",
      hardwareZneOption: "Also run zero-noise extrapolation",
      hardwareZneCost: (circuits, totalShots, shots) =>
        `Sends ${circuits} circuits in one job: yours, and two copies with 3 and 5 times its gates. That is ${totalShots} shots instead of ${shots}, so it uses about three times as much of your IBM allowance, or a bit more, since the longer copies take longer to run.`,
      hardwareZnePriced: (circuits, totalShots) => `Priced for ${circuits} circuits, ${totalShots} shots in total.`,
      hardwareMitigationHeading: "Mitigated readings",
      hardwareMitigationNote: "Computed in this browser from the raw counts above, which stay exactly as the device returned them.",
      hardwareReadoutCorrected: "Readout corrected",
      hardwareReadoutGloss: "Undoes the readout errors IBM reported for the measured qubits when the job was sent, then adjusts the result to the nearest valid set of probabilities.",
      hardwareReadoutCalibratedAt: (date) => `IBM measured those error rates on ${date}.`,
      hardwareReadoutSymmetric: "IBM reported one error rate per qubit, so the same figure is used for reading 0 as 1 and 1 as 0.",
      hardwareZneRichardson: "Zero-noise estimate (Richardson)",
      hardwareZneLinear: "Zero-noise estimate (straight-line fit)",
      hardwareZneGloss: "Zero-noise extrapolation runs the circuit at three noise levels and follows the trend back to zero noise. The result is an estimate, and it can overshoot: a small change in the counts can move it a lot. When the two fits above disagree, neither is reliable.",
      hardwareZneClipped: (share) => `The fit went below zero for some outcomes (${share} in total). Those were set to zero and the rest scaled up, which is a sign the estimate overshot.`,
      hardwareZneGates: (base, three, five) => `Two-qubit gates on the device: ${base}, ${three} and ${five}.`,
      hardwareMitigationUnavailable: (reason) => ({
        no_calibration: "No readout calibration was recorded for this run, so no correction is shown.",
        calibration_mismatch: "The recorded calibration does not match the measured bits, so no correction is shown.",
        calibration_unusable: "A measured qubit reads wrong at least half the time, so no correction is shown.",
        zne_no_counts: "Zero-noise extrapolation was requested, but the counts for the longer circuits did not come back.",
        could_not_compute: "This correction could not be worked out from what was stored for this run. The raw reading above is unaffected.",
      }[reason] ?? "No mitigated reading could be computed for this run."),
      hardwareReadoutCorrectedShare: "Readout corrected",
      hardwarePricedOnly: "Leona can price this device but cannot send jobs to it yet. Only IBM devices can be run today.",
      hardwareBlockedReason: (reason) => ({
        provider_not_supported: "Leona cannot send jobs to this device yet. Only IBM devices can be run today.",
        submission_disabled: "Hardware submission is off in this deployment.",
        credentials_unconfigured: "No provider credentials are configured, so nothing can be submitted.",
        provider_dependency_missing: "The provider SDK is not installed, so nothing can be submitted.",
        queue_unavailable: "The device's queue could not be read just now.",
      }[reason] ?? "Hardware submission is unavailable in this deployment."),
      hardwareQueueTitle: "How busy is this device?",
      hardwareQueueChecking: "Checking the queue…",
      hardwareQueueJobsAhead: (count) => `${count} jobs ahead of yours`,
      hardwareQueueNoneAhead: "No jobs ahead of yours right now",
      hardwareQueueMachine: (name) => `on ${name}`,
      hardwareSpendExhausted: (estimate, limit, spent) =>
        `Estimated at ${estimate}. Your plan includes ${limit} of hardware time weekly, and ${spent} is already committed. Free-queue devices and browser simulation stay available.`,
      hardwareSpendFreeTier: (estimate) =>
        `Estimated at ${estimate}. Billed hardware is not part of the free plan; free-queue devices and browser simulation stay available.`,
      hardwarePreviewTitle: (access) => (access === "free_queue" ? "Before you use free time" : "Before you pay"),
      hardwarePreviewComputing: "Working out what this device's published figures predict…",
      hardwarePreviewTvd: "Expected distance from ideal",
      hardwarePreviewUniform: "Random bits, for comparison",
      hardwarePreviewReading: (reading, share, shots) => ({
        ideal_near_uniform: `This circuit's ideal answer is already about as spread out as random bits, so at ${shots} shots a run cannot show much difference between a good device and noise.`,
        closer_to_noise: `On these figures, the result would land ${share} of the way from the ideal answer to random bits. Past halfway it is closer to noise than to the answer, so it will likely be hard to tell apart from noise.`,
        ideal_stands_out: `On these figures, the result would land ${share} of the way from the ideal answer to random bits. That is short of halfway, so the ideal answer should still stand out.`,
      }[reading] ?? ""),
      hardwarePreviewRange: (count, min, max, machine) =>
        `The provider picks the machine when you submit. Across the ${count} machines it may pick from, the expected distance runs from ${min} to ${max}. The table uses the least favorable one, ${machine}.`,
      hardwarePreviewEstimated: "Estimated",
      hardwarePreviewGates: (two, one, qubits) =>
        `Gates counted as written: ${two} two-qubit, ${one} one-qubit. Qubits read out: ${qubits}.`,
      hardwarePreviewFigures: (machine) => `Figures used, as published for ${machine}:`,
      hardwarePreviewFigureLabel: (kind) => ({
        one_qubit: "One-qubit gate error",
        two_qubit: "Two-qubit gate error",
        readout: "Readout error",
      }[kind] ?? kind),
      hardwarePreviewStatistic: (statistic) => ({ median: "median", mean: "average", stated: "as published" }[statistic] ?? statistic),
      hardwarePreviewNotPublished: "not published, left out",
      hardwarePreviewFigureMeta: (statistic, date) => `(${statistic}, read ${date})`,
      hardwarePreviewSource: "Source",
      hardwarePreviewMachines: "Each machine",
      hardwarePreviewCaveat: "This is an estimate from the vendor's published figures. It does not predict any single run. Gates are counted as written, but hardware with limited wiring adds gates to route a circuit, idle qubits decay, and any figure a vendor did not publish is left out. A real run will likely be noisier.",
      hardwarePreviewUnavailable: (reason) => ({
        not_gate_model: "This device runs analog programs, not gate circuits, so there is no gate-noise estimate for it.",
        no_figures: "No published error figures are recorded for this device, so there is no estimate.",
        unparsable: "This circuit uses gates or a measurement layout the in-browser simulator cannot read, so there is no estimate.",
        qubit_limit: "This circuit is wider than your plan's browser simulation limit, so there is no estimate.",
        operation_limit: "This circuit exceeds the browser operation limit, so there is no estimate.",
        timed_out: "This estimate took too long to work out in this browser, so Leona stopped it.",
      }[reason] ?? "No estimate could be computed for this circuit."),
      verifySave: "Verify & save",
      starting: "Starting…",
      bringYourOwn: "Save without running",
      bringingYourOwn: "Saving…",
      broughtInSaved: "Saved to your Library as written. Nothing has been run, so it carries no verification evidence — use Verify & save when you want some.",
      broughtInFailed: "Could not save this circuit",
      view: "Studio view",
      circuit: "Circuit",
      visual: "Visual",
      code: "Code",
      summary: "Summary",
      versions: "Versions",
      openSummary: "Open the summary tab",
      expandPanel: "Expand this panel",
      collapsePanel: "Return this panel to the page",
      computeLanes: "Compute lanes",
      cpuUnavailableShort: "Not eligible",
      aboutConversions: "About these conversions",
      conversionExplainer: "Studio supports ten frameworks. Qiskit, PennyLane, and Cirq run here; the other seven are export-only.",
      conversionUnavailable: (target, source) => `No ${target} conversion could be produced from this circuit, so the ${source} source is shown instead. Exports and runs made here use ${source}.`,
      exportOnlyFramework: "Copy and export only. Running here needs Qiskit, PennyLane, or Cirq.",
      uncommittedEdits: "Edited since the last saved version",
      uncommittedEditsNote: "Local to this browser until a verification run saves the next version.",
      footer: "Edits stay in this browser until a verification run saves them as the next version.",
      openRun: "Open live run",
      countCircuits: (count) => (count === 1 ? "1 circuit" : `${count} circuits`),
      updated: "Updated",
      inspector: "Circuit inspector",
      liveDraft: "live draft",
      selectedGate: "Selected gate",
      runContract: "Verification contract",
      mode: "Mode",
      source: "Source",
      evidence: "Evidence",
      evidencePhysical: "Physical evidence — compared against what the physics should do",
      evidenceStructural: "Structural evidence — the shape of the answer was checked, not its physics",
      evidenceCaveats: "Public reference — verified with caveats",
      evidenceFailed: "Verification failed",
      evidenceNotLoaded: "Open the full record for this version's checks.",
      openFullRecord: "Open the full verification record",
      shots: "Shots",
      seed: "Seed",
      seedAuto: "auto",
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
      sourceReferenceHeading: (source, target) => `${source} source · no ${target} conversion`,
      versionHistory: "Version history",
      repositoryView: "atlas view",
      currentVersion: (id) => `Current · ${id}`,
      draftNotSaved: "Draft · not saved",
      currentVersionNote: "The current saved version remains unchanged until a passing verification run saves the next version.",
      draftVersionNote: "Run verification to create the first saved version.",
      verificationQueued: "Verification run queued",
      verificationAttach: (id) => `Run ${id} will attach evidence when it finishes.`,
      versionLabel: (seq) => `Version ${seq}`,
      versionCurrentBadge: "Current",
      versionHistoryLoading: "Loading version history…",
      versionHistoryUnavailable: "Version history could not be loaded.",
      versionHistoryEmpty: "No saved versions yet.",
      versionShowOlder: "Show older versions",
      versionOriginAgentRun: "From a verified run",
      versionOriginStudioDraft: "Your Studio edit",
      versionOriginImportedReference: "Imported reference",
      versionOriginUserImport: "A circuit you brought in",
      versionOriginStarterExample: "Starter example",
      versionOriginUnknown: "Origin not recorded",
      versionHolds: "Holds",
      versionHoldsNothing: "Source only — no OpenQASM, exports, estimates or verdict",
      capabilityQasm: "OpenQASM",
      capabilityExport: "exports",
      capabilityResourceEstimates: "resource estimates",
      capabilityFrameworkVariants: "framework variants",
      capabilityVerification: "a passing verdict",
      restore: "Restore",
      restoring: "Restoring…",
      restoreConfirmTitle: "Restore this version?",
      restoreConfirmBody: (seq) =>
        `Version ${seq} becomes current. Nothing is deleted; every version stays in this list.`,
      restoreLossIntro: "This artifact would no longer have:",
      restoreCancel: "Cancel",
      restoreConfirmAnyway: "Restore anyway",
      restoreFailed: "Could not restore that version. Please try again.",
      restoreDone: (seq) => `Version ${seq} is now current.`,
      frameworkNote: "Qiskit stays the default. Switch only when you want a different framework draft.",
      gateDescriptions: {
        H: "Hadamard creates an equal superposition on the selected qubit.",
        X: "Pauli-X flips the selected qubit between |0⟩ and |1⟩.",
        Y: "Pauli-Y combines a bit flip with a phase rotation.",
        Z: "Pauli-Z flips the phase of |1⟩ without changing probabilities.",
        S: "S applies a π/2 phase to |1⟩.",
        T: "T applies a π/4 phase — the non-Clifford workhorse.",
        SDG: "S† is the inverse of S: a −π/2 phase on |1⟩.",
        TDG: "T† is the inverse of T: a −π/4 phase on |1⟩.",
        RX: "RX rotates the qubit around the X axis by the chosen angle.",
        RY: "RY rotates the qubit around the Y axis by the chosen angle.",
        RZ: "RZ rotates the qubit around the Z axis by the chosen angle.",
        P: "Phase applies the chosen angle to |1⟩ and leaves |0⟩ unchanged.",
        CX: "Controlled-X entangles the target with the control qubit.",
        CZ: "Controlled-Z applies a phase when both qubits are |1⟩.",
        SWAP: "SWAP exchanges the states of two qubits.",
        CP: "Controlled phase applies the chosen angle only when both qubits are |1⟩.",
        RZZ: "ZZ rotation applies a phase set by the chosen angle, based on whether the two qubits agree or differ.",
        CCX: "Toffoli flips the target qubit when both control qubits are |1⟩.",
        M: "Measurement records the final computational-basis result.",
      },
      palette: "Gate palette",
      builderHint: "Pick a gate, then click a wire to place it.",
      pickTarget: "Now select the remaining qubits.",
      addQubit: "Add qubit",
      removeQubit: "Remove qubit",
      undo: "Undo",
      clearAll: "Clear",
      clearedUndo: (count) => `Cleared ${count} gate${count === 1 ? "" : "s"}. Undo brings ${count === 1 ? "it" : "them"} back.`,
      qubitRemovedWithGates: (count) => `Removed the qubit and ${count} gate${count === 1 ? "" : "s"} that touched it. Undo brings ${count === 1 ? "it" : "them"} back.`,
      untitledCircuit: "Untitled circuit",
      applyToCode: "Apply to code",
      appliedToCode: "Generated code applied to all framework drafts.",
      compression: "Circuit compression",
      compressionIntro: "Compare before and after, then apply the result you want.",
      optimizationLocal: "Quick exact rewrites",
      optimizationExternal: "Compiler optimization",
      compressionStrategy: "Compression strategy",
      compressionInverse: "Cancel inverse pairs",
      compressionInverseDescription: "Removes matching self-inverse gates when no operation on the same qubits lies between them.",
      compressionRotations: "Fold rotations",
      compressionRotationsDescription: "Combines consecutive RX, RY, or RZ angles on the same qubit and removes exact zero rotations.",
      compressionPatterns: "Rewrite identities",
      compressionPatternsDescription: "Folds phase powers, H-X-H / H-Z-H basis changes, and three-CX SWAP patterns.",
      compressionBalanced: "Balanced pipeline",
      compressionBalancedDescription: "Repeats cancellation, rotation folding, and identity rewrites until no further exact reduction is found.",
      compressionOperations: "Operations",
      compressionDepth: "Logical depth",
      compressionTwoQubit: "Two-qubit operations",
      compressionNoChange: "This strategy found no exact reduction for the current circuit.",
      compressionApply: "Compress circuit",
      compressionConfirmApply: "Replace code and compress",
      compressionUndo: "Undo compression",
      compressionBoundary: "Measurements and custom gates stay as rewrite boundaries; this is not hardware routing.",
      compressionOverwrite: "The Code tab no longer matches this diagram. Compression replaces it with generated code for the compressed diagram. Continue?",
      compressionApplied: (removed, beforeDepth, afterDepth) => `Compressed the circuit by ${removed} operations. Logical depth: ${beforeDepth} → ${afterDepth}. Framework drafts were regenerated.`,
      compressionUndone: "Compression was undone and the framework drafts were regenerated.",
      externalCompilation: "External compilers",
      externalIntro: "Queue a trusted compiler on the Worker, inspect its result, then decide whether to replace the Studio circuit.",
      externalLevel: "Optimization level",
      externalCompiler: "Compiler",
      externalQiskit: "Qiskit",
      externalCirq: "Cirq",
      externalPytket: "pytket",
      externalPennyLane: "PennyLane",
      externalPyZX: "PyZX",
      externalBqskit: "BQSKit",
      externalRecommended: "Recommended",
      externalLevelHelp: "1 is fastest, 2 is balanced, and 3 searches more thoroughly.",
      externalLevelOption: (level) => level === 1 ? "1 · Fast" : level === 2 ? "2 · Balanced" : "3 · Thorough",
      externalBoundary: "Only built-in gates are sent, never source code: up to 64 qubits / 1,024 operations (PyZX 16/512, Clifford+T only; BQSKit 8/128).",
      externalRun: "Run compiler",
      externalRunSelected: (compiler) => `Run ${compiler}`,
      externalRunning: "Compiling…",
      externalOpenRun: "Open compiler run",
      externalFailed: "The external compiler did not return a usable Studio circuit.",
      externalConnectionLost: "The compiler event stream closed before a result arrived.",
      externalPreview: (compiler, version) => `${compiler} ${version} result`,
      externalUnverified: "Compiler output, not verification evidence; verify the edited draft before relying on it.",
      externalApply: "Apply compiler result",
      externalConfirmApply: "Replace code with compiler result",
      externalApplied: (compiler, before, after) => `${compiler} result applied (${before} → ${after} gates). Framework drafts were regenerated; verification is stale.`,
      synthesisHeading: "Targeted synthesis",
      synthesisIntro: "Pick a target and what to minimize. Every compiler in the lane runs against it, and each result is checked for equivalence before you can use it.",
      synthesisTargetLabel: "Target",
      synthesisTargetGeneric: "Generic connectivity",
      synthesisTargetDevice: "Device",
      synthesisConnectivityAllToAll: "All-to-all (no constraint)",
      synthesisConnectivityLine: "Line",
      synthesisConnectivityGrid: "Grid",
      synthesisConnectivityHeavyHex: "Heavy-hex",
      synthesisDeviceLoading: "Loading devices…",
      synthesisDeviceUnavailable: "Device list unavailable.",
      synthesisObjectiveLabel: "Minimize",
      synthesisObjectiveDepth: "Depth",
      synthesisObjectiveTwoQubit: "Two-qubit gate count",
      synthesisObjectiveTCount: "T count",
      synthesisRun: "Run synthesis",
      synthesisRunning: "Running…",
      synthesisOpenRun: "Open run",
      synthesisFailed: "Synthesis failed.",
      synthesisConnectionLost: "Connection to the run was lost.",
      synthesisCandidates: "Candidates",
      synthesisColumnCompiler: "Compiler",
      synthesisColumnStatus: "Status",
      synthesisColumnDepth: "Depth",
      synthesisColumnTwoQubit: "2Q gates",
      synthesisColumnTCount: "T gates",
      synthesisColumnGates: "Gates",
      synthesisColumnEquivalence: "Equivalence",
      synthesisStatusSucceeded: "Compiled",
      synthesisStatusUnsupported: "Not supported",
      synthesisStatusFailed: "Failed",
      synthesisEquivalent: "Equivalent",
      synthesisNotEquivalent: "Not equivalent",
      synthesisNotChecked: "Not checked (too wide)",
      synthesisBest: "Best",
      synthesisUse: "Use this circuit",
      synthesisConfirmUse: "Replace circuit with this candidate",
      synthesisApplied: (compiler) => `Circuit replaced with ${compiler}'s output. Framework drafts were regenerated; verification is stale.`,
      synthesisUndo: "Undo",
      synthesisUndone: "Synthesis undone.",
      synthesisCannotApply: "Cannot be applied.",
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
      closeBlock: (name) => `Close ${name}`,
      blockOpaqueNote: "This operation cannot be opened.",
      editBlock: "Edit block",
      editBlockTitle: (name) => `Edit ${name}`,
      editBlockUses: (count) => count === 1 ? "Changes 1 use of this block." : `Changes ${count} uses of this block.`,
      editBlockSave: "Save",
      editBlockCancel: "Cancel",
      editBlockCycleError: "That would make this block contain itself. Remove the block first.",
      ungroupBlock: "Ungroup",
      ungrouped: (name) => `${name} was ungrouped.`,
      blockSaved: (name, uses) => uses === 1 ? `Saved ${name}. 1 use updated.` : `Saved ${name}. ${uses} uses updated.`,
      blocksPanelOpen: "Insert block",
      blocksPanelTitle: "Block library",
      blocksPlanLink: "Not sure which blocks you need? Describe the problem and plan the workflow in the Atlas",
      blockCategoryLabel: {
        "state-preparation": "State preparation",
        transforms: "Transforms",
        oracles: "Oracles",
        arithmetic: "Arithmetic",
        simulation: "Simulation",
        variational: "Variational",
      },
      insertAtQubit: "Insert at qubit",
      insertBlock: "Insert",
      blockInserted: (name) => `${name} added to the circuit.`,
      blockTooNarrow: (required, available) => `This block needs ${required} qubit${required === 1 ? "" : "s"}; only ${available} ${available === 1 ? "is" : "are"} free at this position.`,
      addQubitsForBlock: "Add qubits",
      galleryOpen: "Examples",
      galleryTitle: "Start from a known circuit",
      exampleQubits: (count) => `${count} qubit${count === 1 ? "" : "s"}`,
      loadExample: "Load",
      unsavedChangesConfirm: "This replaces the current draft. Continue?",
      exampleNotFound: "That example was not found. Starting a new circuit instead.",
      atlasImporting: "Adding this Atlas entry to your Studio…",
      atlasImportFailed: "This Atlas entry could not be added to your Studio.",
      expectationValue: (value) => `⟨H⟩ = ${value.toFixed(4)}`,
      askTitle: "Ask Leona",
      askPlaceholder: "Describe the change, for example: add a Hadamard on qubit 0",
      askSubmit: "Ask",
      askCancel: "Cancel",
      askStageLabel: { planned: "Planning", coded: "Writing code", sandboxed: "Running", verified: "Verifying", saved: "Saving" },
      askChangeSummary: (added, removed) => {
        const parts: string[] = [];
        if (added.length) parts.push(`added ${added.map((entry) => `${entry.count} ${entry.gate}`).join(", ")}`);
        if (removed.length) parts.push(`removed ${removed.map((entry) => `${entry.count} ${entry.gate}`).join(", ")}`);
        return parts.length ? `${parts.join("; ")}.` : "No gates changed.";
      },
      askGoBack: "Go back to the previous version",
      askDisconnected: "The connection closed before the run finished. It may still complete.",
      askOpenRun: "Open the run to see its result.",
      hideInspector: "Hide inspector",
      showInspector: "Inspector",
      circuitRestored: "Circuit loaded from the saved artifact. Edits stay in this draft until you verify & save.",
      circuitReadOnly: "This is the framework-native circuit that ran, read-only. The original code is unchanged.",
      circuitReadOnlyTruncated: (shown, total) => `Read-only preview: ${shown} of ${total} operations. The original code is unchanged.`,
      readOnly: "Read-only",
      readOnlyHint: "Inspect the executed circuit here. Edit the high-level program in the Code tab.",
      circuitNotRebuildable: "This artifact's code goes beyond the visual builder — edit it in the Code tab.",
      sourceFallbackNote: (target, source) => `No safe ${target} conversion exists for this circuit, so this tab shows the stored ${source} source — it is a source reference, not ${target} code. Exports and runs from this tab use ${source}.`,
      circuitTooLargeToDraw: "This circuit is too large to draw as a diagram — its qubit or gate count would render an unreadable canvas. The Code tab holds the full source to read and run.",
      canvasOutOfDate: "The Code tab changed since this diagram was drawn; it no longer shows what will run.",
      canvasBeyondBuilder: "This code is outside what the editor can draw. The code is what runs.",
      rebuildFromCode: "Rebuild from code",
      rebuiltFromCode: "Diagram rebuilt from the code in the Code tab.",
      applyOverwritesEditedCode: "The Code tab has changed since this diagram was drawn. Applying replaces that code with the diagram. Continue?",
      applyOverwritesUnrepresentableCode: "The Code tab holds source this editor cannot draw. Applying replaces it with the diagram, and the diagram cannot reproduce it. Continue?",
      confirmApply: "Replace the code",
      metaQubits: (count) => (count === 1 ? "1 qubit" : `${count} qubits`),
      metaOperations: (count) => (count === 1 ? "1 operation" : `${count} operations`),
      metaDepth: (depth) => `depth ${depth}`,
      metaSavedVersion: (id) => `Saved version ${id}`,
      metaCpuRun: (when) => `CPU run ${when}`,
      metaCpuRunStale: "Last CPU run used older code",
      metaNoCpuRun: "No CPU run yet",
      justNow: "just now",
      shortcutsOpen: "Keyboard shortcuts",
      shortcutsTitle: "Keyboard shortcuts",
      shortcutsClose: "Close",
      shortcutGroups: { general: "Anywhere in Studio", visual: "Visual", simulation: "Simulation" },
      shortcutRows: {
        tabs: "Switch tab",
        split: "Show the code beside the diagram",
        sheet: "Show this list",
        escape: "Close this list or a full-screen panel",
        oneQubit: "Pick a one-qubit gate",
        rotations: "Pick RX, RY or RZ",
        twoQubit: "Pick CX, CZ or SWAP",
        measure: "Pick measurement",
        undo: "Remove the last gate",
        delete: "Delete the selected gates",
        step: "Move the playhead one moment",
        runCpu: "Run the CPU simulation",
      },
      paletteGroups: { oneQubit: "One-qubit", rotations: "Rotations", twoQubit: "Two-qubit", measure: "Measure", more: "More gates" },
      gateNames: {
        H: "Hadamard",
        X: "Pauli-X",
        Y: "Pauli-Y",
        Z: "Pauli-Z",
        S: "S phase",
        T: "T phase",
        SDG: "S† phase",
        TDG: "T† phase",
        RX: "X rotation",
        RY: "Y rotation",
        RZ: "Z rotation",
        P: "Phase shift",
        CX: "Controlled-X (CNOT)",
        CZ: "Controlled-Z",
        SWAP: "Swap",
        CP: "Controlled phase",
        RZZ: "ZZ rotation",
        CCX: "Toffoli (CCX)",
        M: "Measurement",
      },
      inspectorActsOn: (qubits) => `on ${qubits}`,
      inspectorAngle: "Angle",
      inspectorMatrix: "Matrix",
      inspectorBasis: (first, second) => `Basis |${first} ${second}⟩: 00, 01, 10, 11`,
      inspectorNoMatrixMeasure: "Measurement is not unitary, so there is no matrix to show.",
      inspectorNoMatrixCustom: (qubits) => `Custom gate on ${qubits} qubits. Its matrix is the product of its steps.`,
      inspectorNoMatrixAngle: "Studio can't read this angle, so there is no matrix to show.",
      inspectorMoment: (moment) => `Moment ${moment}`,
      playheadTitle: "Probabilities",
      playheadAfter: (moment, total) => `After moment ${moment} of ${total}`,
      playheadStart: "Before the first gate",
      playheadBoundary: "These are ideal, noiseless values computed in your browser. They are not a run or a verification.",
      playheadStepBack: "Back one moment",
      playheadStepForward: "Forward one moment",
      playheadToStart: "Go to the start",
      playheadToEnd: "Go to the end",
      playheadSlider: "Playhead position",
      playheadBitOrder: (highest) => `Bits read q${highest} … q0`,
      playheadUnavailable: (reason, limit) => ({
        too_wide: `Live probabilities stop at ${limit} qubits.`,
        opaque_custom: "An opaque custom gate has no steps to apply, so live probabilities are off.",
        mid_circuit_measurement: "A gate follows a measurement on the same qubit, so live probabilities are off from here.",
        angle: "The browser simulator can't read one of these angles, so live probabilities are off.",
      }[reason] ?? "Live probabilities are unavailable for this circuit."),
      playheadPhaseTitle: "Amplitude and phase",
      playheadPhaseNote: "Phases are measured against the largest amplitude. A global phase is not observable, so only the differences carry meaning.",
      playheadPhaseColumn: "Relative phase",
      playheadEffectLabel: "What this moment did",
      splitShow: "Code beside diagram",
      splitHide: "Diagram only",
      liveSync: "Live",
      liveSyncHint: "The code is exactly what the diagram generates, so it updates as you place gates.",
      codeFollowedDiagram: "Code updated from the diagram.",
      laneReady: "Ready",
      latestRecord: "Latest",
    },
  notebooks: {
    title: "Notebooks",
    lede: "Create a Jupyter notebook with Nala, then edit, run, and download it.",
    newNotebook: "New notebook",
    briefLabel: "What do you want to learn or teach?",
    briefPlaceholder: "e.g. Explain Bell states to a Python engineer with a working circuit, measurement results, and a practice exercise.",
    create: "Create notebook",
    creating: "Starting…",
    createFailed: "The notebook could not be started.",
    kindLabel: "Kind",
    kindOption: {
      lesson: "Lesson",
      lab: "Lab",
      challenge: "Challenge",
      solution: "Solution",
      walkthrough: "Walkthrough",
      demo: "Demo",
      quiz: "Quiz",
      hardware: "Hardware",
      benchmark: "Benchmark",
      project: "Project",
      scratch: "Scratch",
    },
    startersLabel: "Start from a brief",
    showMoreBriefs: (count) => `Show ${count} more brief${count === 1 ? "" : "s"}`,
    audienceLevelLabel: "Level",
    audienceLevelOption: {
      newcomer: "Newcomer",
      engineer: "Engineer",
      student: "Student",
      researcher: "Researcher",
    },
    analogiesLabel: "Use analogies",
    mathLevelLabel: "Math",
    mathLevelOption: { none: "None", minimal: "Light", full: "Full" },
    languageLabel: "Language",
    languageOption: { en: "English", ja: "日本語" },
    frameworkLabel: "Framework",
    seedAtlasLabel: "Seed from an Atlas record",
    seedAtlasPlaceholder: "Atlas record slug",
    seedCircuitLabel: "Start from a circuit",
    seedCircuitPlaceholder: "Paste Qiskit code or OpenQASM 3",
    importLabel: "Import .ipynb",
    importHint: "Upload an existing notebook to keep editing it with Nala.",
    importFailed: "The notebook could not be imported.",

    listLoading: "Loading notebooks…",
    listLoadFailed: "Notebooks could not be loaded.",
    listEmpty: "You have not created a notebook yet.",
    search: "Search notebooks",
    searchPlaceholder: "Search by title",
    noMatch: "No notebooks match this search.",
    updated: "Updated",
    statusPill: {
      queued: "Queued",
      generating: "Generating…",
      ready: "Ready",
      failed: "Failed",
    },
    open: "Open notebook",

    backToNotebooks: "Back to Notebooks",
    loading: "Loading notebook…",
    loadFailed: "This notebook could not be loaded.",
    titleEditFailed: "The title could not be saved.",
    saveTitle: "Save",
    versionPickerLabel: "Version",
    versionLabel: (seq) => `Version ${seq}`,
    download: "Download .ipynb",
    downloadFailed: "The notebook could not be downloaded.",
    runAgain: "Run again",
    running: "Running…",
    runAgainFailed: "The notebook could not be re-run.",
    versionFailedHeadline: "Not every cell in this version ran.",
    versionFailedHint: "The cell that raised is marked below. Ask Nala to fix it, or edit it yourself and run it again.",
    versionFailedNoCellsHeadline: "Nala could not build this notebook.",
    versionFailedNoCellsHint: "Nothing was written yet, so there is nothing to fix. Start a new notebook with a shorter or more specific brief.",

    reviewLabel: "Nala's review",
    reviewVerdict: { ready: "Ready", "needs-attention": "Needs attention" },
    reviewFindingsLabel: "Findings",
    reviewSeverity: { blocker: "Blocker", "should-fix": "Should fix", nit: "Nit" },
    reviewCategory: {
      accuracy: "Accuracy",
      pedagogy: "Pedagogy",
      code: "Code",
      structure: "Structure",
      safety: "Safety",
      style: "Style",
    },
    reviewNotEstablishedLabel: "What this notebook does not establish",
    reviewNoReview: "This version has no review — it was imported or re-run without one.",

    compareToggle: "Compare with previous",
    comparePickerLabel: "Compare against",
    diffStatus: {
      added: "Added",
      removed: "Removed",
      changed: "Changed",
      unchanged: "Unchanged",
      moved: "Moved",
    },
    diffHeaderField: {
      title: "Title",
      summary: "Summary",
      objectives: "Objectives",
      duration_minutes: "Duration (minutes)",
    },
    diffLoading: "Loading the comparison…",
    diffLoadFailed: "That version could not be loaded for comparison.",

    progressSummary: (mastery) => {
      const parts: string[] = [];
      if (mastery.checkpointsTotal > 0) {
        const noun = mastery.checkpointsTotal === 1 ? "checkpoint" : "checkpoints";
        parts.push(`${mastery.checkpointsPassed} of ${mastery.checkpointsTotal} ${noun} pass`);
      }
      if (mastery.cellsErrored > 0) {
        parts.push(`${mastery.cellsErrored} cell${mastery.cellsErrored === 1 ? "" : "s"} errored`);
      }
      if (mastery.exercisesTotal > 0) {
        parts.push(`${mastery.exercisesTotal} exercise${mastery.exercisesTotal === 1 ? "" : "s"}`);
      }
      return parts.join(" · ");
    },

    quizButtonLabel: "Quiz me on this notebook",
    quizButtonFailed: "The quiz could not be started.",

    chatLabel: "Talk to Nala",
    chatPlaceholder: "Ask Nala to change this notebook…",
    chatSend: "Send",
    chatSending: "Sending…",
    chatEmpty: "Tell Nala what to change — a cell, an analogy, the difficulty, the language.",
    chatLoadFailed: "The conversation could not be loaded.",
    chatSendFailed: "The message could not be sent.",
    runStreamLost: "The live view of this run dropped out. Reload the page to see how it finished.",
    progressLabel: "Working",

    live: {
      phase: {
        idle: "Waiting to start",
        outlining: "Planning the notebook",
        drafting: "Writing the notebook",
        checking: "Checking a cell before running it",
        running: "Running the notebook",
        repairing: "Fixing a cell",
        reviewing: "Reviewing the result",
        done: "Done",
        failed: "Something went wrong",
      },
      writingLabel: "Nala is writing this cell",
      cellStatus: { queued: "Queued", ran: "Ran", raised: "Raised an error", not_run: "Not run" },
      repairBanner: (cellId, attempt, of) => `Nala is fixing cell ${cellId}: attempt ${attempt} of ${of}.`,
      checkingBanner: (cellId) => `Nala is checking cell ${cellId} before running it.`,
    },

    cellStatus: { ok: "Passed", error: "Error", skipped: "Skipped", not_run: "Not run yet" },
    cellStdout: "Output",
    cellStderr: "Error output",
    cellTruncated: "Some output was cut to fit the evidence budget.",
    cellErrorLabel: "Error",

    actionExplain: "Explain this cell",
    actionSimplify: "Simplify",
    actionAddFigure: "Add a figure here",
    actionExercise: "Turn this into an exercise",
    actionExplainError: "Explain this error",
    actionCheckAttempt: "Check my attempt",
    actionCheckAttemptCancel: "Cancel",
    checkAttemptPlaceholder: "Paste or write your attempt at this cell…",
    checkAttemptSubmit: "Ask Nala to check it",
    checkAttemptGrade: "Check my answer",
    answerLegend: "Your answer",
    answerTextPlaceholder: "Type your answer…",
    answerNumericPlaceholder: "A number",
    answerRubricPlaceholder: "Write your answer in a sentence or two…",
    answerSubmit: "Check my answer",
    answerClear: "Clear",
    answerModelGraded: "Nala grades this one, so the verdict is a judgement rather than a test.",
    gradePending: "Running your code…",
    gradeVerdict: {
      passed: "Correct.",
      failed: "Not right yet.",
      unattempted: "Not graded yet — this cell has not run.",
      ungradable: "This one needs Nala to grade it.",
    },
    gradeByCheck: "Checked by running the exercise's own test.",
    gradeByModel: "Nala's judgement, not a test — it can be wrong.",
    gradeFailed: "Could not check that answer. Try again in a moment.",
    gradeNotGraded: "This notebook has no exercises with a test behind them.",
    gradeSummaryLabel: "Your progress on the graded exercises",
    gradeSummary: (passed, attempted) => `${passed} of ${attempted} attempted exercises correct`,
    gradeUngradable: (count) =>
      count === 1
        ? "1 exercise could not be checked — it is not counted either way."
        : `${count} exercises could not be checked — they are not counted either way.`,
    gradeFromOlderVersion: (seq) =>
      `This score is from version ${seq}, which has since been revised — some of these `
      + `exercises may have changed.`,
    downloadWithSolutions: "Download with answers",

    edit: "Edit",
    editExit: "Done editing",
    editHint: "Change any cell, then run it. Every save becomes a new version.",
    editCellSourceLabel: (cellId) => `Source of cell ${cellId}`,
    editKindLabel: "Cell type",
    editKindOption: { markdown: "Text", code: "Code" },
    editRoleLabel: "Role",
    editRoleNone: "No role",
    editExecuteLabel: "Run this cell",
    editRaisesLabel: "Expected to raise",
    editAddMarkdown: "Add text below",
    editAddCode: "Add code below",
    editDelete: "Delete cell",
    editMoveUp: "Move up",
    editMoveDown: "Move down",
    editEmpty: "This notebook has no cells yet. Add one below.",
    saveAndRun: "Save & run",
    saveWithoutRunning: "Save without running",
    runToHere: "Run to here",
    discard: "Discard changes",
    discardConfirm: "Discard your changes to this notebook?",
    saving: "Saving…",
    saveFailed: "Your changes could not be saved.",
    unsavedWarning: "You have unsaved changes to this notebook.",
    structureNotesLabel: "Nala's structure notes",
    structureNotesHint: "Suggestions only — your version was saved as you wrote it.",
    cellNotRunBadge: "Not run",
    ide: NOTEBOOK_IDE_COPY.en,

    teachMeInNotebook: "Teach me this in a notebook",
  },
  hardwareRuns: {
    title: "Hardware runs",
    intro: "Every job this workspace has sent to a quantum computer, grouped by the machine that ran it. For each finished job, the distance compares what the machine measured with what a perfect, noiseless device would give for the same circuit.",
    readingGuide: "Distance goes from 0 (the same as the ideal) to 1 (no overlap at all). Even a perfect device shows some distance, because it only runs a finite number of shots. \"From sampling alone\" is how much to expect at that shot count, so distance well above it comes from the machine.",
    loading: "Loading hardware runs…",
    loadFailed: "Hardware runs could not be loaded because the server could not be reached.",
    retry: "Try again",
    empty: "No hardware runs yet. Jobs you send from the hardware panel in Studio will show up here.",
    emptyAction: "Open Studio",
    unrecordedMachine: "Machine not recorded",
    unrecordedMachineNote: "These jobs ran before Leona recorded which machine was used, or the provider did not say. They are listed on their own because Leona does not guess which machine ran them.",
    machineRunCount: (count) => (count === 1 ? "1 run" : `${count} runs`),
    columnSubmitted: "Submitted",
    columnStatus: "Status",
    columnShots: "Shots",
    columnDistance: "Distance from ideal",
    columnShotNoise: "From sampling alone",
    columnFidelity: "Hellinger fidelity",
    columnReadoutCorrected: "Distance after readout correction",
    columnZne: "Distance of the zero-noise estimate (Richardson)",
    zneRequested: "Zero-noise extrapolation",
    status: (status) => ({
      queued: "Queued",
      running: "Running",
      done: "Finished",
      error: "Failed",
      cancelled: "Cancelled",
    }[status] ?? status),
    inProgress: "Not finished yet",
    endedWithoutCounts: "No counts came back",
    workingOut: "Working out the comparison…",
    programMismatch: "The stored circuit does not match the one this job was submitted with, so no comparison is shown.",
    details: "Details",
    showOlder: "Show older runs",
    loadingOlder: "Loading…",
    olderFailed: "Older runs could not be loaded. Try again.",
  },
  courses: {
    title: "Courses",
    lede: "Plan a course with Nala, then work through each module as a notebook.",
    coursesTab: "Courses",

    planLabel: "Plan a course",
    briefLabel: "What should this course teach?",
    briefPlaceholder: "e.g. Take a Python engineer from classical bits to Shor's algorithm in about 8 modules, hands-on each time.",
    moduleCountLabel: "Modules",
    moduleCountOption: { auto: "Auto", "4": "4", "8": "8", "12": "12" },
    startersLabel: "Or start from a brief",
    create: "Plan course",
    creating: "Planning…",
    createFailed: "The course could not be planned.",

    listLoading: "Loading courses…",
    listLoadFailed: "Courses could not be loaded.",
    listEmpty: "You have not planned a course yet.",
    search: "Search courses",
    searchPlaceholder: "Search by title",
    noMatch: "No courses match this search.",
    updated: "Updated",
    statusPill: { planning: "Planning…", planned: "Planned", generating: "Generating…", ready: "Ready", failed: "Failed" },
    progress: (ready, total) => `${ready} of ${total} modules ready`,
    open: "Open course",

    backToCourses: "Back to Courses",
    loading: "Loading course…",
    loadFailed: "This course could not be loaded.",
    titleEditFailed: "The title could not be saved.",
    saveTitle: "Save",

    generateAll: "Generate all",
    generatingAll: "Generating…",
    generateAllFailed: "The modules could not be started.",
    downloadRepo: "Download as repository (.zip)",
    downloadingRepo: "Downloading…",
    downloadRepoFailed: "The course could not be downloaded.",
    downloadRepoDisabledHint: "Available once every module is ready.",

    moduleStatusPill: { planned: "Planned", queued: "Queued", generating: "Generating…", ready: "Ready", failed: "Failed" },
    moduleSeqLabel: (seq) => `Module ${seq}`,
    topicLabel: "Topic",
    keyConceptsLabel: "Key concepts",
    objectivesLabel: "Objectives",
    deliverableLabel: "Deliverable",
    durationLabel: (minutes) => `${minutes} min`,
    durationUnknown: "Duration not set",
    prerequisitesLabel: "Prerequisites",
    prerequisiteUnresolved: (slug) => `${slug} (not in this course)`,
    generateModule: "Generate this module",
    generatingModule: "Generating…",
    generateModuleFailed: "This module could not be started.",
    openNotebook: "Open notebook",
    moveUp: "Move earlier",
    moveDown: "Move later",
    reorderFailed: "The module order could not be saved.",

    chatLabel: "Talk to Nala",
    chatPlaceholder: "Ask Nala to change this course…",
    chatSend: "Send",
    chatSending: "Sending…",
    chatEmpty: "Tell Nala what to change — a module's scope, its order, the difficulty.",
    chatLoadFailed: "The conversation could not be loaded.",
    chatSendFailed: "The message could not be sent.",
    progressLabel: "Working",

    gradebookTitle: "Gradebook",
    gradebookLede:
      "The latest result each member got on each module. Only you can see everyone's results. "
      + "Other members see only their own.",
    gradebookEmpty: "No one has checked an exercise in this course yet.",
    yourProgressTitle: "Your progress",
    yourProgressLede: "Your latest result on each module. You and the person who made this course can see it.",
    yourProgressEmpty: "You have not checked an exercise in this course yet.",
    gradebookLoading: "Loading results…",
    gradebookLoadFailed: "The results could not be loaded.",
    gradebookRefresh: "Refresh",
    gradebookMemberColumn: "Member",
    gradebookYou: "You",
    gradebookTotalColumn: "Total",
    gradebookLastColumn: "Last checked",
    gradebookNotStarted: "Not started",
    gradebookTotalUnknown: "Not known yet",
    gradebookTotalsPending: "Some modules do not have a ready notebook yet, so totals are not known yet.",
    gradebookScore: (passed, graded) => `${passed} of ${graded} exercises correct`,
    gradebookOlderVersion: "Earlier version",
    gradebookOlderVersionHint: (seq) =>
      `Checked against version ${seq} of this notebook, which has since been revised.`,
    gradebookDownloadCsv: "Download CSV",
    gradebookDownloadingCsv: "Downloading…",
    gradebookDownloadCsvFailed: "The gradebook could not be downloaded.",

    dueLabel: (date) => `Due ${date}`,
    dueOverdue: "Overdue",
    dueDateLabel: "Due date",
    dueDateHint: "Enter it in your time zone. Each member sees it in their own.",
    saveDueDate: "Save due date",
    savingDueDate: "Saving…",
    clearDueDate: "Remove due date",
    dueDateSaveFailed: "The due date could not be saved.",
    gradebookLate: "Late",
    gradebookLateHint: (date) => `Nothing was checked by the due date, ${date}.`,
    gradebookMissing: "Missing",
    gradebookMissingHint: (date) => `Not started, and the due date (${date}) has passed.`,
    gradebookLegend: "Late: nothing was checked by the due date. Missing: not started, and the due date has passed.",
  },
  },
  ja: {
    surfaces: { brandedRun: "Leona Run", preview: "公開プレビュー" },
    sidebar: {
      surfaceSwitch: "ワークスペースモード",
      run: "Run",
      studio: "Studio",
      qapps: "Qapps",
      notebooks: "ノートブック",
      allNotebooks: "すべてのノートブック",
      courses: "コース",
      atlas: "量子アトラス",
      openAtlas: "量子アトラスを開く",
      myQapps: "自分のQapp",
      exploreQapps: "公開Qappを探す",
      createQapp: "Qappを作る",
      createQappStudio: "Studioから作る",
      library: "すべての回路・実行記録",
      hardwareRuns: "実機での実行履歴",
      projects: "プロジェクト",
      chats: "チャット",
      artifacts: "回路・実行記録",
      runFolders: "フォルダ",
      renameFolder: (name) => `${name}の名前を変更`,
      deleteFolder: (name) => `${name}を削除`,
      deleteFolderTitle: "このフォルダを削除しますか",
      deleteFolderWarning: (name) =>
        `「${name}」を削除します。中のチャットはワークスペースに残ります。`,
      folderOptions: (name) => `${name}のオプション`,
      reorderFolder: (name) => `${name}の並び替え`,
      folderMoveUp: (name) => `${name}を上へ`,
      folderMoveDown: (name) => `${name}を下へ`,
      folderOrderFailed: "並び順を保存できませんでした。",
      folderRenameFailed: "フォルダの名前を変更できませんでした。",
      folderDeleteFailed: "フォルダを削除できませんでした。",
      renameProject: (name) => `${name}の名前を変更`,
      deleteProject: (name) => `${name}を削除`,
      deleteProjectTitle: "このプロジェクトを削除しますか",
      deleteProjectWarning: (name) =>
        `「${name}」を削除します。中の回路・実行記録はワークスペースに残ります。`,
      projectMoveUp: (name) => `${name}を上へ`,
      projectMoveDown: (name) => `${name}を下へ`,
      projectCreateFailed: "プロジェクトを作成できませんでした。",
      projectOrderFailed: "並び順を保存できませんでした。",
      projectRenameFailed: "プロジェクトの名前を変更できませんでした。",
      projectDeleteFailed: "プロジェクトを削除できませんでした。",
      projectName: "プロジェクト名",
      createProject: "プロジェクトを作成",
      emptyProjects: "回路・実行記録をプロジェクトにドラッグしてまとめられます",
      recentsAbove: "最近のチャットをフォルダの上に表示",
      recentsBelow: "最近のチャットをフォルダの下に表示",
      recentsPositionLabel: "最近のチャットの位置",
      collapseRecents: "最近のチャットを閉じる",
      expandRecents: "最近のチャットを開く",
      archivedMoved: "アーカイブしました。",
      archivedInSettings: "アーカイブは設定から確認できます",
      undo: "元に戻す",
      chatArchived: (title) => `${title}をアーカイブしました`,
      newArtifact: "新しい下書き",
      viewLibrary: "すべての回路・実行記録を見る",
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
      emptyProject: "まだ項目がありません",
      emptyChats: "プロジェクトに属さないチャットがここに表示されます",
      emptyArtifacts: "プロジェクトに属さない回路・実行記録がここに表示されます",
      pinned: "ピン留め",
      archive: "アーカイブ済みチャット",
      archiveArtifacts: "アーカイブ済みの回路・実行記録",
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
      mentions: "メンション",
      notifications: "通知",
      notificationsUnread: (count) => `通知、未読${count}件`,
      notificationsEmpty: "まだ通知はありません。実機の実行が終わったときや、メンションされたときにここに表示されます。",
      notificationsMarkAllRead: "すべて既読にする",
      notificationsMarkRead: "既読にする",
      notificationsAgo: (value, unit) =>
        `${value}${{ minute: "分", hour: "時間", day: "日" }[unit]}前`,
      notificationsJustNow: "たった今",
      // 英語版と同じ理由：この枠は「週ごとにリセット」ではなくローリング7日間。
      // 使った実行が7日後に1回ずつ戻るので、曜日ではなく日付で言うしかない。
      usageRunsLeft: (remaining: number, limit: number) => `実行 残り ${remaining}/${limit}`,
      usageRunsNone: "実行の残りがありません",
      usageRunsUnlimited: "実行は無制限",
      usageNextSlotOn: (date: string) => `${date}に1回分が戻ります`,
      usageNextSlotWhen: (word: string) => `${word}1回分が戻ります`,
      signOut: "ログアウト",
      tierLabel: {
        preview: "プレビュー",
        free: "フリー",
        pro: "プラス",
        team: "プロフェッショナル",
        developer: "開発者",
      },
    },
    run: {
      previewStatus: "公開プレビュー · 閲覧のみ",
      examplesTitle: "例から始める",
      // 英語版と同じ意図：コンポーザーが1文字ずつ打ち出すため短く、そして大半は
      // 量子の用語を一切含まない。前提知識がなくても読める問題文にしてある。
      examples: [
        { title: "取引先ネットワークを2分割", prompt: "6社の取引先を2組に分け、切る取引を最少にしてください。" },
        { title: "リスク一定でポートフォリオ選択", prompt: "リスク一定で、8銘柄の最適な組み合わせを選んでください。" },
        { title: "作業を機械に割り当てる", prompt: "6件の作業を3台の機械に割り当て、最短で終わらせてください。" },
        { title: "未整列のデータを探索", prompt: "16件のデータから該当する1件を探してください。" },
        { title: "ベル状態を作って検証", prompt: "ベル状態を作って検証してください。" },
        { title: "H₂の基底状態エネルギー", prompt: "H₂分子の基底状態エネルギーを求めてください。" },
      ],
      morePrompts: [
        { title: "配送車両を割り当てる", prompt: "12台の車両を40か所の配送先に最小コストで割り当て、古典的なベースラインと照合してください。" },
        { title: "モンテカルロを使わず価格付け", prompt: "古典的なモンテカルロ法を使わずにヨーロピアンコールオプションを価格付けし、回路と高速化の条件・注意点を示してください。" },
        { title: "取引データから不正を検知", prompt: "4つの特徴量から取引の不正を判定するモデルを作り、仕組みを説明した上で、この手法が有効な場面とそうでない場面を正直に述べてください。" },
        { title: "Groverでマークされた状態を探す", prompt: "Groverでマークされた状態1100を見つけ、測定分布を検証してください。" },
        { title: "QAOAと古典ベースラインを比較", prompt: "5ノードのリンググラフのMaxCut問題をQAOAで解き、正確な古典ベースラインと比較してください。" },
        { title: "QFTのリソースを見積もる", prompt: "8量子ビットのQFT回路の量子ビット数、深さ、ゲート構成を見積もってください。" },
        { title: "QAEで信用リスクの裾を推定", prompt: "小規模な信用ポートフォリオの損失分布をモデル化し、量子振幅推定が古典モンテカルロと比べてテールリスクをどう推定するか示してください。" },
      ],
      examplesMore: "他のプロンプト",
      examplesClose: "閉じる",
      greetingMorning: "おはようございます。",
      greetingAfternoon: "こんにちは。",
      greetingEvening: "こんばんは。",
      confirmSendTitle: "保存した回路と入力内容をAIモデルに送信しますか？",
      confirmSendBody: (title) => `保存した回路「${title}」のコードと入力内容をAIモデルに送信します。確認するまで送信されません。`,
      confirmSend: "LLMに送信",
      confirmCancel: "キャンセル",
      attachmentsLabel: "添付ファイル",
      removeAttachment: (name) => `添付 ${name} を削除`,
      attachTooLarge: (name) => `${name} は64KBを超えています。必要な部分を貼り付けてください。`,
      attachUnsupported: (name) => `${name} は対応していないファイル形式です（.py、.txt、.md、.json、.qasm、.csvに対応しています）。`,
      attachReadFailed: (name) => `${name} を読み込めませんでした。`,
      attachLimit: "1メッセージに添付できるのは4件までです。",
      contextLabel: "参照中の回路",
      viewArtifact: "保存した回路を見る",
      contextStatus: "検証済みの回路を参照中",
      contextUnavailable: "保存済み回路を読み込めません",
    },
    library: {
      title: "回路・実行記録",
      lede: "保存した回路、バージョン、検証結果を管理します。",
      openStudio: "Studioを開く",
      newRun: "新しい実行",
      filterArtifacts: "保存した回路を絞り込む",
      search: "保存した回路を検索…",
      framework: "フレームワーク",
      verification: "検証",
      all: "すべて",
      verified: "検証済み",
      caveats: "注意付き",
      structural: "構造のみ検証",
      inconclusive: "検証結果なし",
      legacyUnknown: "旧形式・検証記録なし",
      stale: "要再検証",
      failed: "失敗",
      artifacts: "件",
      savedArtifacts: "保存した回路・実行記録",
      noMatch: "条件に一致する回路・実行記録がありません。",
      noMatchBody: "条件を解除するか、新しく実行して検証してください。",
      startRun: "実行を始める",
      askInRun: "この回路についてRunで質問",
      archive: "アーカイブ",
      delete: "削除",
      deleteConfirmTitle: "削除してもよいですか？",
      deleteWarning: (title) => `「${title}」は完全に削除され、元に戻せません。`,
      star: "保存した回路にスターを付ける",
      unstar: "保存した回路のスターを外す",
      previewFooter: "公開プレビューでは参考用の保存済み回路を表示しています。",
      unknown: "不明",
    },
    studio: {
      label: "量子R&D",
      title: "Studio",
      draftStatus: "検証して保存するまで、変更はこの下書きにのみ反映されます",
      backLibrary: "一覧に戻る",
      artifacts: "回路・実行記録",
      new: "新規",
      search: "保存した回路を検索",
      searchPlaceholder: "名前、フレームワーク、タグで検索…",
      noSearchResults: "検索に一致する回路・実行記録がありません。",
      empty: "保存された回路はありません。ベル状態の下書きから始められます。",
      projectFilterLabel: "プロジェクトで絞り込む",
      projectAll: "すべて",
      projectUngrouped: "未分類",
      projectEmpty: "このプロジェクトにはまだ何も入っていません。",
      ungroupedEmpty: "すべての回路がいずれかのプロジェクトに入っています。",
      workingCircuit: "作業中の回路",
      editingVersion: (version, framework) => `バージョン${version}を編集中 · ${framework}`,
      newDraft: "未保存の下書き",
      qappTitle: "Qappを作成",
      qappPrompt: "Qappプロンプト",
      qappPlaceholder: "例：位相とショット数を調整でき、結果を円グラフで表示するQapp",
      qappHelp: "空欄なら自動設計します。送信後はRunで進捗を確認できます。",
      copyCode: "コードをコピー",
      copied: "コピー済み",
      downloadExport: "エクスポートをダウンロード",
      simulate: "シミュレーション",
      simulation: "シミュレーション",
      cpuLane: "CPUシミュレーション",
      cpuEligible: "CPUで実行可能",
      cpuUnavailable: (reason) => ({
        artifact_required: "先に下書きを保存してください。",
        framework_unavailable: "CPU実行はQiskit、PennyLane、Cirqのソースでのみ利用できます。",
        source_unavailable: "この回路はブラウザ内シミュレーションの対応範囲外です。",
        source_limit: "このソースはブラウザシミュレーションには大きすぎます。",
        qubit_limit: "この回路は、お使いのプランのブラウザシミュレーション上限を超えています。",
        operation_limit: "このソースは操作数の上限を超えています。",
      }[reason] ?? "このソースではCPUシミュレーションを利用できません。"),
      sandboxFallbackExplainer: "サンドボックスはこのソースをそのまま実行し、エラーを含めて結果を表示します。",
      runInSandbox: "サンドボックスで実行",
      openSimulation: "シミュレーションを開く",
      simulationArtifactRequired: "この保存済み回路のシミュレーション記録を作成する前に、下書きを保存してください。",
      cpuInvalidShots: (maximum) => `ショット数は1から${maximum.toLocaleString("en-US")}までの整数にしてください。`,
      cpuInvalidSeed: (maximum) => `シードは0から${maximum.toLocaleString("en-US")}までの整数にしてください。`,
      simulationPersistenceUnavailable: "ブラウザにシミュレーション履歴を保存できなかったため、CPU結果を記録しませんでした。",
      cpuSimulationRecorded: "CPUシミュレーションをこのブラウザに記録しました。この結果は正式な検証結果ではありません。",
      simulationFailed: "記録を作成する前にCPUシミュレーションが失敗しました。",
      cpuSimulationTimedOut: "このブラウザではシミュレーションに時間がかかりすぎたため、記録を作成する前に中止しました。",
      simulationBoundary: "ブラウザー上で解析済みの回路を実行します。ローカルの確認であり、検証ではありません。",
      sweep: {
        heading: "パラメータ掃引",
        intro: "ゲート角度を変え、量子ビットの応答を調べます。干渉、もつれ、回路の感度を確認できます。",
        gate: "角度付きゲート",
        qubit: "観測する量子ビット",
        start: "開始角度 (°)",
        end: "終了角度 (°)",
        points: "点数",
        run: "掃引を実行",
        running: "計算中…",
        openVisual: "Visualタブを開く",
        noAngle: "RX、RY、RZ、P、CP、RZZのいずれかを追加してください。",
        outOfSync: "図とソースコードが異なります。Visualタブで図を再構築するか、図の変更をコードに反映してください。",
        incomplete: "この保存済みの図では、ソースコードの一部の操作が省略されています。不完全な回路で掃引すると誤解を招くため、利用できません。",
        tooLarge: "計算量が上限を超えます。点数か回路の長さを減らしてください。",
        unavailable: {
          width: "掃引は12量子ビットまで対応します。",
          operations: "掃引は512操作まで対応します。",
          custom: "カスタムゲートを展開してから掃引してください。",
          measurement: "測定は回路の最後に置いてください。途中の測定による状態の収縮は扱えません。",
          angle: "回路に数値またはπの式ではない角度があります。",
          invalid: "図に無効なゲートまたは量子ビット参照があります。",
        },
        boundary: "理想状態ベクトルの厳密計算です。ショット数やノイズは含みません。ローカルでの探索用で、回路の検証や保存はしません。",
        chart: "角度ごとの測定結果1の確率",
        angleColumn: "角度 (°)",
        probabilityColumn: "P(1)",
        expectationColumn: "⟨Z⟩",
        downloadCsv: "CSVをダウンロード",
        downloadJson: "再現可能なJSONをダウンロード",
        timedOut: "ブラウザ内での計算時間が上限を超えたため、掃引を中止しました。",
      },
      simulationArtifact: "保存した回路",
      sourceFingerprint: "ソース識別子",
      interchangeFingerprint: "変換後回路の識別子",
      simulationModel: "実行モデル",
      directSourceModel: "元のソースコードを直接解析",
      standardDecompositionModel: "OpenQASM標準ゲートに分解（グローバル位相は比較対象外）",
      simulator: "シミュレータ",
      browserCpu: "ブラウザCPU",
      runCpuSimulation: "CPUシミュレーションを実行",
      rerunCpuSimulation: "CPUシミュレーションをもう一度実行",
      rerunPrompt: "このソースの記録は既にあります。再実行すると上書きせず新しい記録を追加します。",
      confirmRerun: "再実行を確認",
      cancel: "キャンセル",
      hardwareLanes: "量子コンピュータで実行",
      qpuExecution: "QPU実行",
      qpuUnavailable: "量子コンピュータでの実行は計画中です。実機の提供元、料金、確認手順、利用条件が整うまで利用できません。",
      simulationResults: "シミュレーション記録",
      simulationNoRecords: "このブラウザには、この回路のCPUシミュレーション記録がありません。",
      simulationRecord: "CPUシミュレーション記録",
      artifactVersion: "実行元のバージョン",
      operations: "操作数",
      resultCounts: "測定結果の合計",
      simulationDistribution: "サンプル分布",
      simulationPeak: "ピーク状態",
      simulationOtherBar: (states) => `他 ${states} 状態`,
      simulationRecordSummary: (shots, qubits) => `${shots} ショット · ${qubits} 量子ビット`,
      simulationDetails: "記録の詳細",
      readingConcentrated: (state, share) => `ショットの${share}が |${state}⟩ に集中しました。`,
      readingPaired: (first, second, share) => `ショットは |${first}⟩ と |${second}⟩ に集中しました（合計${share}）。`,
      readingSpread: (states, state, share) => `${states}種類の結果があり、最頻は |${state}⟩（${share}）でした。`,
      hardwareCatalogLoading: "デバイスカタログを読み込み中…",
      hardwareCatalogUnavailable: "サーバーに接続できないため、量子コンピュータの一覧を利用できません。",
      hardwareDevice: "デバイス",
      hardwareAccessFree: "無料枠",
      hardwareAccessOnDemand: "オンデマンド課金",
      hardwareTaskFee: "タスク料金",
      hardwareShotFees: (shots) => `ショット料金（${shots} ショット）`,
      hardwareEstimatedTotal: "見積もり合計",
      hardwareRateConfirmed: (date) => `料金確認日: ${date}`,
      hardwareRateSource: "料金の出典",
      hardwareEstimating: "見積もり中…",
      hardwareEstimateFailed: "サーバーに接続できないため、見積もりを利用できません。",
      hardwareRequestSubmission: "ハードウェア実行をリクエスト",
      hardwareVerifiedRequired: "この回路の検証済み保存バージョンが必要です。",
      hardwareInterchangeRequired: "このバージョンにOpenQASMエクスポートがありません。「検証して保存」を再実行してください。",
      hardwareJobStatus: "ジョブの状態",
      hardwareJobId: "実機側のジョブID",
      hardwareMachine: "実行した実機",
      hardwareJobError: "プロバイダーのエラー",
      hardwareRawCounts: "測定結果（生データ）",
      hardwareIdealComparison: "理論値との比較",
      hardwareIdealTvd: "全変動距離",
      hardwareIdealTvdGloss: "0ならこの回路の理論上の分布と一致し、1なら重なりが全くないことを意味します。",
      hardwareIdealFidelity: "ヘリンガー忠実度",
      hardwareIdealShotNoise: (share, shots) =>
        `理想的な実機であっても、${shots}ショットではサンプリングのばらつきだけで約${share}の全変動距離が生じます。`,
      hardwareIdealBitstring: "測定結果",
      hardwareIdealMeasuredShare: "実測",
      hardwareIdealIdealShare: "理論値",
      hardwareIdealOtherOutcomes: "その他の結果",
      hardwareIdealProvenance: "このブラウザ内で、実行を依頼した回路から計算した値です。検証結果ではありません。",
      hardwareIdealUnavailable: (reason) => ({
        circuit_changed: "このジョブを依頼した後に回路が変更されたため、比較できる理論値がありません。",
        no_counts: "このジョブの実機測定結果がまだありません。",
        unparsable: "この回路はブラウザ内シミュレーションの対応範囲外のため、理論値を計算できません。",
        qubit_limit: "この回路は、お使いのプランのブラウザシミュレーション上限を超えているため、理論値を計算できません。",
        operation_limit: "この回路は操作数の上限を超えているため、理論値を計算できません。",
        register_mismatch: "実機の測定結果がこの回路の量子ビット数と一致しないため、理論値と比較できません。",
        timed_out: "このブラウザでは理論値の計算に時間がかかりすぎたため、計算を中止しました。",
      }[reason] ?? "このジョブの理論値を計算できませんでした。"),
      hardwareRunHistory: "このワークスペースの実機での実行履歴をすべて見る",
      hardwareZneOption: "ゼロノイズ外挿も実行する",
      hardwareZneCost: (circuits, totalShots, shots) =>
        `1つのジョブで${circuits}個の回路を送ります。元の回路と、ゲート数を3倍・5倍にした2つの複製です。ショット数は${shots}ではなく合計${totalShots}になるため、IBMの利用枠をおよそ3倍使います。長い複製は実行にも時間がかかるので、実際にはそれより少し多くなります。`,
      hardwareZnePriced: (circuits, totalShots) => `${circuits}個の回路、合計${totalShots}ショット分の料金です。`,
      hardwareMitigationHeading: "エラー緩和後の値",
      hardwareMitigationNote: "上の生の測定結果から、このブラウザ内で計算した値です。生の測定結果は実機が返したまま変更していません。",
      hardwareReadoutCorrected: "読み出し補正後",
      hardwareReadoutGloss: "ジョブ送信時にIBMが報告した、測定した量子ビットの読み出しエラーを打ち消し、結果を最も近い有効な確率分布に直した値です。",
      hardwareReadoutCalibratedAt: (date) => `このエラー率はIBMが${date}に測定したものです。`,
      hardwareReadoutSymmetric: "IBMは量子ビットごとに1つのエラー率しか報告していないため、0を1と読む誤りにも1を0と読む誤りにも同じ値を使っています。",
      hardwareZneRichardson: "ゼロノイズ推定（リチャードソン外挿）",
      hardwareZneLinear: "ゼロノイズ推定（直線フィット）",
      hardwareZneGloss: "ゼロノイズ外挿では、回路を3段階のノイズで実行し、その傾向からノイズがゼロの場合の値を推定します。測定値ではなく推定値で、行き過ぎることがあります。測定結果が少し変わるだけで大きく動くこともあります。2つのフィットの結果が食い違う場合は、どちらもあまり信頼できません。",
      hardwareZneClipped: (share) => `一部の測定結果でフィットがゼロを下回りました（合計${share}）。それらをゼロにして残りを拡大しています。推定が行き過ぎている兆候です。`,
      hardwareZneGates: (base, three, five) => `実機上の2量子ビットゲート数: ${base}、${three}、${five}`,
      hardwareMitigationUnavailable: (reason) => ({
        no_calibration: "この実行では読み出しの較正値が記録されていないため、補正は表示しません。",
        calibration_mismatch: "記録された較正値が測定したビットと一致しないため、補正は表示しません。",
        calibration_unusable: "測定した量子ビットの中に、半分以上の確率で読み間違えるものがあるため、補正は表示しません。",
        zne_no_counts: "ゼロノイズ外挿を指定しましたが、長い回路の測定結果が返ってきませんでした。",
        could_not_compute: "この実行で保存された内容からは、この補正を計算できませんでした。上の生の測定結果には影響ありません。",
      }[reason] ?? "この実行ではエラー緩和後の値を計算できませんでした。"),
      hardwareReadoutCorrectedShare: "読み出し補正後",
      hardwarePricedOnly: "この実機は料金の見積もりのみ対応しており、まだジョブを送信できません。現在実行できるのはIBMの実機のみです。",
      hardwareBlockedReason: (reason) => ({
        provider_not_supported: "この実機にはまだジョブを送信できません。現在実行できるのはIBMの実機のみです。",
        submission_disabled: "この環境ではハードウェア実行が無効になっています。",
        credentials_unconfigured: "実機提供元の認証情報が未設定のため、実行できません。",
        provider_dependency_missing: "この環境はこの実機提供元に対応していません。",
        queue_unavailable: "現在、この実機のキューを読み取れませんでした。",
      }[reason] ?? "現在の環境では量子コンピュータでの実行を利用できません。"),
      hardwareQueueTitle: "この実機の混み具合",
      hardwareQueueChecking: "キューを確認しています…",
      hardwareQueueJobsAhead: (count) => `あなたの前に${count}件のジョブが待っています`,
      hardwareQueueNoneAhead: "今なら、あなたの前に待っているジョブはありません",
      hardwareQueueMachine: (name) => `実機: ${name}`,
      hardwareSpendExhausted: (estimate, limit, spent) =>
        `見積もりは${estimate}です。プランの実機実行枠は週${limit}で、すでに${spent}を使用しています。無料キューとブラウザシミュレーションは引き続き利用できます。`,
      hardwareSpendFreeTier: (estimate) =>
        `見積もりは${estimate}です。有料の実機実行は無料プラン対象外です。無料キューとブラウザシミュレーションは引き続き利用できます。`,
      hardwarePreviewTitle: (access) => (access === "free_queue" ? "無料枠を使う前に" : "支払う前に"),
      hardwarePreviewComputing: "この実機の公表値から予想を計算しています…",
      hardwarePreviewTvd: "理論値からの予想距離",
      hardwarePreviewUniform: "比較: ランダムなビット列",
      hardwarePreviewReading: (reading, share, shots) => ({
        ideal_near_uniform: `この回路の理論上の結果は、もともとランダムなビット列とほぼ同じくらい散らばっています。${shots}ショットでは、性能の良い実機でもノイズとの違いはほとんど見えません。`,
        closer_to_noise: `この数値では、結果は理論上の答えからランダムなビット列までの${share}の位置になります。半分を超えると答えよりノイズに近いため、ノイズと見分けにくい結果になる可能性が高いです。`,
        ideal_stands_out: `この数値では、結果は理論上の答えからランダムなビット列までの${share}の位置になります。半分に届かないため、理論上の答えはまだ読み取れるはずです。`,
      }[reading] ?? ""),
      hardwarePreviewRange: (count, min, max, machine) =>
        `実機は送信時にプロバイダーが選びます。選ばれる可能性のある${count}台では、予想距離は${min}から${max}です。表には最も条件の悪い${machine}の値を示しています。`,
      hardwarePreviewEstimated: "推定",
      hardwarePreviewGates: (two, one, qubits) =>
        `書かれたとおりに数えたゲート数: 2量子ビットゲート${two}個、1量子ビットゲート${one}個。読み出す量子ビット: ${qubits}個。`,
      hardwarePreviewFigures: (machine) => `使った数値（${machine}の公表値）:`,
      hardwarePreviewFigureLabel: (kind) => ({
        one_qubit: "1量子ビットゲートのエラー率",
        two_qubit: "2量子ビットゲートのエラー率",
        readout: "読み出しエラー率",
      }[kind] ?? kind),
      hardwarePreviewStatistic: (statistic) => ({ median: "中央値", mean: "平均値", stated: "公表値" }[statistic] ?? statistic),
      hardwarePreviewNotPublished: "公表されていないため除外",
      hardwarePreviewFigureMeta: (statistic, date) => `（${statistic}、${date}確認）`,
      hardwarePreviewSource: "出典",
      hardwarePreviewMachines: "実機ごとの予想距離",
      hardwarePreviewCaveat: "これは実機メーカーが公表した数値にもとづく推定で、個々の実行を予測するものではありません。ゲートは書かれたとおりに数えていますが、配線の限られた実機では回路を配置するためにゲートが追加され、待機中の量子ビットも劣化します。公表されていない数値は除外しています。実際の実行はこれよりノイズが大きくなる可能性が高いです。",
      hardwarePreviewUnavailable: (reason) => ({
        not_gate_model: "この実機はゲート回路ではなくアナログのプログラムを実行するため、ゲートのノイズ見積もりはありません。",
        no_figures: "この実機には公表されたエラー率の記録がないため、見積もりはありません。",
        unparsable: "この回路はブラウザ内シミュレーションの対応範囲外のため、見積もりを計算できません。",
        qubit_limit: "この回路は、お使いのプランのブラウザシミュレーション上限を超えているため、見積もりを計算できません。",
        operation_limit: "この回路は操作数の上限を超えているため、見積もりを計算できません。",
        timed_out: "このブラウザではこの見積もりの計算に時間がかかりすぎたため、計算を中止しました。",
      }[reason] ?? "この回路の見積もりを計算できませんでした。"),
      verifySave: "検証して保存",
      starting: "開始中…",
      bringYourOwn: "実行せずに保存",
      bringingYourOwn: "保存中…",
      broughtInSaved: "書かれたままライブラリに保存しました。実行していないため検証結果はありません。必要になったら「検証して保存」を実行してください。",
      broughtInFailed: "この回路を保存できませんでした",
      view: "Studioの表示切り替え",
      circuit: "回路",
      visual: "回路図",
      code: "コード",
      summary: "概要",
      versions: "バージョン",
      openSummary: "概要タブを開く",
      expandPanel: "このパネルを広げる",
      collapsePanel: "このパネルを元に戻す",
      computeLanes: "実行環境",
      cpuUnavailableShort: "この回路では利用できません",
      aboutConversions: "変換について",
      conversionExplainer: "Studioは10種類のフレームワークに対応しています。実行できるのはQiskit、PennyLane、Cirqの3つで、残り7つは書き出し専用です。",
      conversionUnavailable: (target, source) => `この回路から${target}への変換は生成できなかったため、${source}のソースを表示しています。ここからの書き出しと実行は${source}として扱われます。`,
      exportOnlyFramework: "コピーと書き出し専用です。実行にはQiskit、PennyLane、Cirqが必要です。",
      uncommittedEdits: "保存済みバージョンから編集されています",
      uncommittedEditsNote: "検証を実行して次のバージョンとして保存するまで、このブラウザ内のみに存在します。",
      footer: "編集内容はこのブラウザ内にのみ保持されます。検証を実行すると次のバージョンとして保存されます。",
      openRun: "実行を開く",
      countCircuits: (count) => `${count} 件の回路`,
      updated: "更新",
      inspector: "回路の詳細",
      liveDraft: "編集中",
      selectedGate: "選択中のゲート",
      runContract: "検証条件",
      evidencePhysical: "物理結果まで検証 — 期待する物理結果と照合済み",
      evidenceStructural: "出力構造のみ検証 — 回答の形式を確認、物理は未検証",
      evidenceCaveats: "公開情報による検証 — 注意事項あり",
      evidenceFailed: "検証に失敗しました",
      evidenceNotLoaded: "検証記録でこのバージョンの内容を確認できます。",
      openFullRecord: "検証記録の全体を開く",
      shots: "ショット数",
      seed: "シード",
      seedAuto: "自動",
      mode: "モード",
      source: "ソース",
      evidence: "検証結果",
      execute: "実行",
      existingVersion: "既存バージョン",
      newDraftSource: "新しい下書き",
      sandboxVerifier: "サンドボックス + 検証器",
      selectedUnavailable: "選択した回路を読み込めませんでした。",
      loadingArtifacts: "選択した回路を読み込んでいます…",
      remoteSyncUnavailable: "サーバー上の回路を同期できませんでした。端末に保存された回路は利用できます。",
      persistenceUnavailable: "このブラウザにStudioの編集内容を保存できませんでした。",
      noCurrentVersion: "編集できる現在のバージョンがありません。",
      copyUnavailable: "このブラウザではコピーを利用できません。",
      codeCopied: (framework) => `${framework}のコードをコピーしました。`,
      editingDraft: (framework) => `${framework}の下書きを編集中です。検証済みとして保存するには実行してください。`,
      verificationStarted: "検証を開始しました。検証に合格すると、新しいバージョンとして保存されます。",
      actionStarted: (action) => `Leona Runで${action}を開始しました。`,
      submissionFailed: "実行の送信に失敗しました",
      canvasLabel: "回路キャンバス",
      starterTitle: "ベル状態のサンプル",
      qubits: "2量子ビット",
      circuitAria: (framework) => `${framework}の2量子ビット回路`,
      clickGate: "ゲートを選ぶと説明が表示されます。",
      sourceEditor: "ソースエディタ",
      sourceEditorInput: "ソースエディタ",
      implementation: (framework) => `${framework}の実装`,
      sourceReferenceHeading: (source, target) => `${source}ソース · ${target}への変換なし`,
      versionHistory: "バージョン履歴",
      repositoryView: "Atlasで見る",
      currentVersion: (id) => `現在 · ${id}`,
      draftNotSaved: "下書き · 未保存",
      currentVersionNote: "検証に合格した実行を新しいバージョンとして保存するまで、現在の保存済みバージョンは変更されません。",
      draftVersionNote: "検証を実行すると最初の保存バージョンが作成されます。",
      verificationQueued: "検証実行をキューに追加しました",
      verificationAttach: (id) => `実行 ${id} の完了後に検証結果が保存されます。`,
      versionLabel: (seq) => `バージョン ${seq}`,
      versionCurrentBadge: "現在",
      versionHistoryLoading: "バージョン履歴を読み込んでいます…",
      versionHistoryUnavailable: "バージョン履歴を読み込めませんでした。",
      versionHistoryEmpty: "保存済みのバージョンはまだありません。",
      versionShowOlder: "以前のバージョンを表示",
      versionOriginAgentRun: "検証付きの実行から作成",
      versionOriginStudioDraft: "Studioでの編集",
      versionOriginImportedReference: "外部から取り込んだ参考回路",
      versionOriginUserImport: "自分で持ち込んだ回路",
      versionOriginStarterExample: "はじめのサンプル",
      versionOriginUnknown: "作成元の記録なし",
      versionHolds: "含まれるもの",
      versionHoldsNothing: "ソースのみ（OpenQASM・書き出し・リソース見積り・検証結果はありません）",
      capabilityQasm: "OpenQASM",
      capabilityExport: "書き出し",
      capabilityResourceEstimates: "リソース見積り",
      capabilityFrameworkVariants: "他フレームワーク版",
      capabilityVerification: "合格した検証結果",
      restore: "この版に戻す",
      restoring: "戻しています…",
      restoreConfirmTitle: "このバージョンに戻しますか？",
      restoreConfirmBody: (seq) =>
        `バージョン ${seq} が現在のバージョンになります。削除はされず、一覧には残ります。`,
      restoreLossIntro: "この回路からは次が失われます：",
      restoreCancel: "キャンセル",
      restoreConfirmAnyway: "承知のうえで戻す",
      restoreFailed: "バージョンを戻せませんでした。もう一度お試しください。",
      restoreDone: (seq) => `バージョン ${seq} が現在のバージョンになりました。`,
      frameworkNote: "既定値はQiskitです。別のフレームワークの下書きを作るときだけ切り替えてください。",
      gateDescriptions: {
        H: "アダマールゲートは、選択した量子ビットに等しい重ね合わせ状態を作ります。",
        X: "パウリXは、選択した量子ビットの|0⟩と|1⟩を入れ替えます。",
        Y: "パウリYは、ビット反転と位相回転を組み合わせます。",
        Z: "パウリZは、確率を変えずに|1⟩の位相を反転します。",
        S: "Sゲートは|1⟩にπ/2の位相を与えます。",
        T: "Tゲートは|1⟩にπ/4の位相を与える非クリフォードゲートです。",
        SDG: "S†はSの逆ゲートで、|1⟩に−π/2の位相を与えます。",
        TDG: "T†はTの逆ゲートで、|1⟩に−π/4の位相を与えます。",
        RX: "RXは選択した角度だけX軸周りに回転します。",
        RY: "RYは選択した角度だけY軸周りに回転します。",
        RZ: "RZは選択した角度だけZ軸周りに回転します。",
        P: "位相ゲートは選択した角度を|1⟩に与え、|0⟩はそのままです。",
        CX: "制御Xゲートは、制御量子ビットと対象量子ビットをもつれさせます。",
        CZ: "制御Zゲートは、両方が|1⟩のとき位相を反転します。",
        SWAP: "SWAPゲートは2つの量子ビットの状態を交換します。",
        CP: "制御位相ゲートは、両方が|1⟩のときだけ選択した角度を与えます。",
        RZZ: "ZZ回転は、2つの量子ビットが一致するかどうかに応じて選択した角度の位相を与えます。",
        CCX: "トフォリゲートは、両方の制御量子ビットが|1⟩のとき対象量子ビットを反転します。",
        M: "測定は計算基底での最終結果を記録します。",
      },
      palette: "ゲートパレット",
      builderHint: "ゲートを選び、ワイヤをクリックして配置します。",
      pickTarget: "残りの量子ビットを選択してください。",
      addQubit: "量子ビットを追加",
      removeQubit: "量子ビットを削除",
      undo: "元に戻す",
      clearAll: "クリア",
      clearedUndo: (count) => `${count}個のゲートを消去しました。「元に戻す」で復元できます。`,
      qubitRemovedWithGates: (count) => `量子ビットと、それに掛かっていた${count}個のゲートを削除しました。「元に戻す」で復元できます。`,
      untitledCircuit: "無題の回路",
      applyToCode: "コードに反映",
      appliedToCode: "生成したコードを各フレームワークの下書きに反映しました。",
      compression: "量子回路を圧縮",
      compressionIntro: "圧縮前後を比較して、採用したい結果をStudioへ反映します。",
      optimizationLocal: "かんたん圧縮",
      optimizationExternal: "コンパイラ最適化",
      compressionStrategy: "圧縮方式",
      compressionInverse: "逆ゲートを相殺",
      compressionInverseDescription: "同じ量子ビット上に別の操作が挟まっていない自己逆ゲートの組を削除します。",
      compressionRotations: "回転ゲートを統合",
      compressionRotationsDescription: "同じ量子ビットのRX・RY・RZ回転角を足し合わせ、厳密に0となる回転を削除します。",
      compressionPatterns: "恒等式で書き換え",
      compressionPatternsDescription: "位相ゲートの累乗、H-X-H / H-Z-H、3つのCXによるSWAPを短い形へ変換します。",
      compressionBalanced: "バランス圧縮",
      compressionBalancedDescription: "逆ゲート相殺、回転統合、恒等式変換を、厳密な削減がなくなるまで繰り返します。",
      compressionOperations: "操作数",
      compressionDepth: "論理深さ",
      compressionTwoQubit: "2量子ビット操作",
      compressionNoChange: "この方式で厳密に削減できる箇所はありません。",
      compressionApply: "回路を圧縮",
      compressionConfirmApply: "コードを置き換えて圧縮",
      compressionUndo: "圧縮を元に戻す",
      compressionBoundary: "測定とカスタムゲートは変換境界として保持します。実機向けルーティングではありません。",
      compressionOverwrite: "コードタブは現在の図と一致していません。圧縮すると、圧縮後の図から生成したコードに置き換わります。続行しますか？",
      compressionApplied: (removed, beforeDepth, afterDepth) => `${removed}個の操作を削減しました。論理深さ: ${beforeDepth} → ${afterDepth}。各フレームワークのコードも再生成しました。`,
      compressionUndone: "圧縮を元に戻し、各フレームワークのコードを再生成しました。",
      externalCompilation: "外部コンパイラ",
      externalIntro: "Workerで実際のコンパイラを実行し、結果を比較してからStudioの回路へ反映できます。",
      externalLevel: "最適化レベル",
      externalCompiler: "コンパイラ",
      externalQiskit: "Qiskit",
      externalCirq: "Cirq",
      externalPytket: "pytket",
      externalPennyLane: "PennyLane",
      externalPyZX: "PyZX",
      externalBqskit: "BQSKit",
      externalRecommended: "おすすめ",
      externalLevelHelp: "1は高速、2は標準、3は時間をかけてより深く探索します。",
      externalLevelOption: (level) => level === 1 ? "1・高速" : level === 2 ? "2・標準" : "3・念入り",
      externalBoundary: "送信するのは組み込みゲートのみで、ソースコードは送りません。上限は64量子ビット/1,024操作（PyZXは16/512・Clifford+T角のみ、BQSKitは8/128）。",
      externalRun: "コンパイラを実行",
      externalRunSelected: (compiler) => `${compiler}で圧縮を実行`,
      externalRunning: "コンパイル中…",
      externalOpenRun: "コンパイル実行を開く",
      externalFailed: "外部コンパイラからStudioで扱える回路を取得できませんでした。",
      externalConnectionLost: "結果が届く前にコンパイラのイベント接続が切れました。",
      externalPreview: (compiler, version) => `${compiler} ${version} の結果`,
      externalUnverified: "コンパイラ出力であり、検証証拠ではありません。利用前に編集後の回路を再検証してください。",
      externalApply: "コンパイル結果を反映",
      externalConfirmApply: "コードをコンパイル結果で置換",
      externalApplied: (compiler, before, after) => `${compiler}の結果を反映しました（${before} → ${after}ゲート）。各フレームワークのコードを再生成し、検証状態を古いものとして扱います。`,
      synthesisHeading: "ターゲット指定合成",
      synthesisIntro: "ターゲットと最小化したい指標を選びます。レーン内の全コンパイラを実行し、結果はすべて使用前に等価性を確認します。",
      synthesisTargetLabel: "ターゲット",
      synthesisTargetGeneric: "汎用の接続性",
      synthesisTargetDevice: "デバイス",
      synthesisConnectivityAllToAll: "全結合(制約なし)",
      synthesisConnectivityLine: "ライン",
      synthesisConnectivityGrid: "グリッド",
      synthesisConnectivityHeavyHex: "ヘビーヘックス",
      synthesisDeviceLoading: "デバイスを読み込み中…",
      synthesisDeviceUnavailable: "デバイス一覧を取得できません。",
      synthesisObjectiveLabel: "最小化する指標",
      synthesisObjectiveDepth: "深さ",
      synthesisObjectiveTwoQubit: "2量子ビットゲート数",
      synthesisObjectiveTCount: "Tゲート数",
      synthesisRun: "合成を実行",
      synthesisRunning: "実行中…",
      synthesisOpenRun: "実行結果を開く",
      synthesisFailed: "合成に失敗しました。",
      synthesisConnectionLost: "実行への接続が切断されました。",
      synthesisCandidates: "候補",
      synthesisColumnCompiler: "コンパイラ",
      synthesisColumnStatus: "状態",
      synthesisColumnDepth: "深さ",
      synthesisColumnTwoQubit: "2量子ビットゲート",
      synthesisColumnTCount: "Tゲート",
      synthesisColumnGates: "ゲート数",
      synthesisColumnEquivalence: "等価性",
      synthesisStatusSucceeded: "コンパイル済み",
      synthesisStatusUnsupported: "非対応",
      synthesisStatusFailed: "失敗",
      synthesisEquivalent: "等価",
      synthesisNotEquivalent: "非等価",
      synthesisNotChecked: "未確認(量子ビット数が多すぎます)",
      synthesisBest: "最良",
      synthesisUse: "この回路を使う",
      synthesisConfirmUse: "この候補で回路を置き換える",
      synthesisApplied: (compiler) => `回路を${compiler}の結果に置き換えました。各フレームワークのコードを再生成し、検証状態を古いものとして扱います。`,
      synthesisUndo: "元に戻す",
      synthesisUndone: "合成を元に戻しました。",
      synthesisCannotApply: "使用できません。",
      angleLabel: "回転角",
      builderEmpty: "空の回路 — パレットからゲートを配置してください。",
      generatedPreview: "作成中の回路",
      selectedCount: (count) => `${count}個のゲートを選択中`,
      selectToGroup: "配置したゲートをクリックして選択。Shiftクリックで複数選択できます。",
      deleteSelected: "選択を削除",
      groupSelected: "カスタムゲートにまとめる",
      customGates: "カスタムゲート",
      customGateLabel: "カスタムゲート",
      customGateInspector: "このエディタで保存したカスタムゲートです。",
      customGatePlaceholder: "カスタムゲート名",
      createCustomGate: "カスタムゲートを作成",
      cancelCustomGate: "キャンセル",
      deleteCustomGate: (name) => `カスタムゲート${name}を削除`,
      customGateCreated: (name) => `${name}をパレットに追加しました。`,
      customGateCannotGroup: "カスタムゲートには、2つ以上の単一ゲートを選択してください。",
      closeBlock: (name) => `${name}を閉じる`,
      blockOpaqueNote: "この操作は開けません。",
      editBlock: "ブロックを編集",
      editBlockTitle: (name) => `${name}を編集`,
      editBlockUses: (count) => `このブロックの使用${count}件が変わります。`,
      editBlockSave: "保存",
      editBlockCancel: "キャンセル",
      editBlockCycleError: "このブロックが自分自身を含むことになります。先にそのブロックを削除してください。",
      ungroupBlock: "グループ解除",
      ungrouped: (name) => `${name}のグループを解除しました。`,
      blockSaved: (name, uses) => `${name}を保存しました。使用${uses}件を更新しました。`,
      blocksPanelOpen: "ブロックを挿入",
      blocksPanelTitle: "ブロックライブラリ",
      blocksPlanLink: "どのブロックが必要かわからない場合は、問題を書いてアトラスでワークフローを計画できます",
      blockCategoryLabel: {
        "state-preparation": "状態準備",
        transforms: "変換",
        oracles: "オラクル",
        arithmetic: "算術",
        simulation: "シミュレーション",
        variational: "変分",
      },
      insertAtQubit: "挿入する量子ビット",
      insertBlock: "挿入",
      blockInserted: (name) => `${name}を回路に追加しました。`,
      blockTooNarrow: (required, available) => `このブロックには${required}量子ビット必要ですが、この位置には${available}量子ビットしか空きがありません。`,
      addQubitsForBlock: "量子ビットを追加",
      galleryOpen: "サンプル回路",
      galleryTitle: "既知の回路から始める",
      exampleQubits: (count) => `${count}量子ビット`,
      loadExample: "読み込む",
      unsavedChangesConfirm: "現在の編集内容が置き換わります。続けますか？",
      exampleNotFound: "そのサンプルは見つかりませんでした。新しい回路を開始します。",
      atlasImporting: "このAtlasの項目をStudioに追加しています…",
      atlasImportFailed: "このAtlasの項目をStudioに追加できませんでした。",
      expectationValue: (value) => `⟨H⟩ = ${value.toFixed(4)}`,
      askTitle: "Leonaに依頼",
      askPlaceholder: "変更内容を記入してください。例：量子ビット0にアダマールを追加",
      askSubmit: "依頼する",
      askCancel: "キャンセル",
      askStageLabel: { planned: "計画中", coded: "コード生成中", sandboxed: "実行中", verified: "検証中", saved: "保存中" },
      askChangeSummary: (added, removed) => {
        const parts: string[] = [];
        if (added.length) parts.push(`追加: ${added.map((entry) => `${entry.gate}×${entry.count}`).join("、")}`);
        if (removed.length) parts.push(`削除: ${removed.map((entry) => `${entry.gate}×${entry.count}`).join("、")}`);
        return parts.length ? `${parts.join("、")}。` : "ゲートの変更はありません。";
      },
      askGoBack: "前のバージョンに戻す",
      askDisconnected: "実行が完了する前に接続が切れました。処理は継続している可能性があります。",
      askOpenRun: "実行結果を見る",
      hideInspector: "詳細を隠す",
      showInspector: "回路の詳細",
      circuitRestored: "保存済み回路を読み込みました。検証して保存するまで、編集はこの下書きにのみ反映されます。",
      circuitReadOnly: "実行されたフレームワーク固有の回路です。読み取り専用で、元コードは変更されません。",
      circuitReadOnlyTruncated: (shown, total) => `読み取り専用プレビュー：${total}個中${shown}個を表示。元コードは変更されません。`,
      readOnly: "読み取り専用",
      readOnlyHint: "実行後の回路を確認できます。高水準プログラムの編集はコードタブで行ってください。",
      circuitNotRebuildable: "この回路のコードは回路エディタの対応範囲を超えています。コードタブで編集してください。",
      sourceFallbackNote: (target, source) => `この回路を${target}へ安全に変換できないため、保存済みの${source}ソースを表示しています。変換後のコードではありません。書き出しと実行には${source}を使用します。`,
      circuitTooLargeToDraw: "この回路は図として描画するには大きすぎます — 量子ビット数またはゲート数が多く、キャンバスが判読不能になります。全ソースはコードタブで確認・実行できます。",
      canvasOutOfDate: "この図のあとにコードタブが変更され、実行内容と一致していません。",
      canvasBeyondBuilder: "このコードは描画範囲を超えています。実行されるのはコードです。",
      rebuildFromCode: "コードから再構築",
      rebuiltFromCode: "コードタブのコードから図を再構築しました。",
      applyOverwritesEditedCode: "この図を描いたあとにコードタブが変更されています。適用するとそのコードは図の内容で置き換えられます。続行しますか？",
      applyOverwritesUnrepresentableCode: "コードタブには、このエディタで描けないソースがあります。適用するとそのコードは図で置き換えられ、図から元に戻すことはできません。続行しますか？",
      confirmApply: "コードを置き換える",
      metaQubits: (count) => `${count}量子ビット`,
      metaOperations: (count) => `${count}操作`,
      metaDepth: (depth) => `深さ${depth}`,
      metaSavedVersion: (id) => `保存済みバージョン ${id}`,
      metaCpuRun: (when) => `CPUシミュレーション ${when}`,
      metaCpuRunStale: "CPU結果は以前のコードのものです",
      metaNoCpuRun: "CPUシミュレーション未実行",
      justNow: "たった今",
      shortcutsOpen: "キーボードショートカット",
      shortcutsTitle: "キーボードショートカット",
      shortcutsClose: "閉じる",
      shortcutGroups: { general: "Studio全体", visual: "ビジュアル", simulation: "シミュレーション" },
      shortcutRows: {
        tabs: "タブを切り替える",
        split: "図の横にコードを表示",
        sheet: "この一覧を表示",
        escape: "この一覧や全画面パネルを閉じる",
        oneQubit: "1量子ビットゲートを選ぶ",
        rotations: "RX・RY・RZを選ぶ",
        twoQubit: "CX・CZ・SWAPを選ぶ",
        measure: "測定を選ぶ",
        undo: "最後のゲートを取り消す",
        delete: "選択したゲートを削除",
        step: "再生位置を1モーメント動かす",
        runCpu: "CPUシミュレーションを実行",
      },
      paletteGroups: { oneQubit: "1量子ビット", rotations: "回転", twoQubit: "2量子ビット", measure: "測定", more: "その他のゲート" },
      gateNames: {
        H: "アダマール",
        X: "パウリX",
        Y: "パウリY",
        Z: "パウリZ",
        S: "S位相",
        T: "T位相",
        SDG: "S†位相",
        TDG: "T†位相",
        RX: "X軸回転",
        RY: "Y軸回転",
        RZ: "Z軸回転",
        P: "位相シフト",
        CX: "制御X（CNOT）",
        CZ: "制御Z",
        SWAP: "SWAP",
        CP: "制御位相",
        RZZ: "ZZ回転",
        CCX: "トフォリ（CCX）",
        M: "測定",
      },
      inspectorActsOn: (qubits) => `対象: ${qubits}`,
      inspectorAngle: "角度",
      inspectorMatrix: "行列",
      inspectorBasis: (first, second) => `基底 |${first} ${second}⟩: 00, 01, 10, 11`,
      inspectorNoMatrixMeasure: "測定はユニタリではないため、表示する行列はありません。",
      inspectorNoMatrixCustom: (qubits) => `${qubits}量子ビットのカスタムゲートです。行列は内部ステップの積です。`,
      inspectorNoMatrixAngle: "この角度はここでは評価できないため、行列を表示しません。",
      inspectorMoment: (moment) => `モーメント ${moment}`,
      playheadTitle: "確率",
      playheadAfter: (moment, total) => `モーメント ${moment}/${total} の後`,
      playheadStart: "最初のゲートの前",
      playheadBoundary: "ノイズなしの理想値で、ブラウザ内で計算しています。実行でも検証でもありません。",
      playheadStepBack: "1モーメント戻る",
      playheadStepForward: "1モーメント進む",
      playheadToStart: "最初へ",
      playheadToEnd: "最後へ",
      playheadSlider: "再生位置",
      playheadBitOrder: (highest) => `ビット順 q${highest} … q0`,
      playheadUnavailable: (reason, limit) => ({
        too_wide: `ライブ確率は${limit}量子ビットまでです。`,
        opaque_custom: "中身を持たないカスタムゲートがあるため、ライブ確率は表示できません。",
        mid_circuit_measurement: "測定のあとに同じ量子ビットへゲートがあるため、ここから先のライブ確率は表示できません。",
        angle: "ブラウザのシミュレータが読めない角度があるため、ライブ確率は表示できません。",
      }[reason] ?? "この回路ではライブ確率を表示できません。"),
      playheadPhaseTitle: "振幅と位相",
      playheadPhaseNote: "位相は最大振幅を基準とした相対値です。全体位相は観測できないため、意味を持つのは差だけです。",
      playheadPhaseColumn: "相対位相",
      playheadEffectLabel: "このモーメントで起きたこと",
      splitShow: "図の横にコード",
      splitHide: "図のみ",
      liveSync: "連動中",
      liveSyncHint: "コードは図から生成したものと同一なので、ゲートを置くたびに更新されます。",
      codeFollowedDiagram: "図に合わせてコードを更新しました。",
      laneReady: "実行可能",
      latestRecord: "最新",
    },
  notebooks: {
    title: "ノートブック",
    lede: "NalaとJupyterノートブックを作成し、編集・実行・ダウンロードできます。",
    newNotebook: "新しいノートブック",
    briefLabel: "何を学びたい、または教えたいですか？",
    briefPlaceholder: "例：Pythonエンジニア向けに、回路、測定結果、練習問題を使ってベル状態を説明してください。",
    create: "ノートブックを作成",
    creating: "開始しています…",
    createFailed: "ノートブックを開始できませんでした。",
    kindLabel: "種類",
    kindOption: {
      lesson: "レッスン",
      lab: "ラボ",
      challenge: "チャレンジ",
      solution: "解答",
      walkthrough: "ウォークスルー",
      demo: "デモ",
      quiz: "クイズ",
      hardware: "ハードウェア",
      benchmark: "ベンチマーク",
      project: "プロジェクト",
      scratch: "メモ",
    },
    startersLabel: "ブリーフから始める",
    showMoreBriefs: (count) => `他の${count}件を見る`,
    audienceLevelLabel: "レベル",
    audienceLevelOption: {
      newcomer: "初心者",
      engineer: "エンジニア",
      student: "学生",
      researcher: "研究者",
    },
    analogiesLabel: "たとえ話を使う",
    mathLevelLabel: "数式の量",
    mathLevelOption: { none: "なし", minimal: "最小限", full: "しっかり" },
    languageLabel: "言語",
    languageOption: { en: "English", ja: "日本語" },
    frameworkLabel: "フレームワーク",
    seedAtlasLabel: "Atlasの記録から始める",
    seedAtlasPlaceholder: "Atlas記録のスラッグ",
    seedCircuitLabel: "回路から始める",
    seedCircuitPlaceholder: "QiskitのコードまたはOpenQASM 3を貼り付け",
    importLabel: ".ipynbをインポート",
    importHint: "既存のノートブックをアップロードすると、Nalaと一緒に編集を続けられます。",
    importFailed: "ノートブックをインポートできませんでした。",

    listLoading: "ノートブックを読み込んでいます…",
    listLoadFailed: "ノートブックを読み込めませんでした。",
    listEmpty: "まだノートブックを作成していません。",
    search: "ノートブックを検索",
    searchPlaceholder: "タイトルで検索",
    noMatch: "検索条件に一致するノートブックはありません。",
    updated: "更新",
    statusPill: {
      queued: "待機中",
      generating: "生成中…",
      ready: "準備完了",
      failed: "失敗",
    },
    open: "ノートブックを開く",

    backToNotebooks: "ノートブック一覧に戻る",
    loading: "ノートブックを読み込んでいます…",
    loadFailed: "このノートブックを読み込めませんでした。",
    titleEditFailed: "タイトルを保存できませんでした。",
    saveTitle: "保存",
    versionPickerLabel: "バージョン",
    versionLabel: (seq) => `バージョン ${seq}`,
    download: ".ipynbをダウンロード",
    downloadFailed: "ノートブックをダウンロードできませんでした。",
    runAgain: "再実行",
    running: "実行中…",
    runAgainFailed: "ノートブックを再実行できませんでした。",
    versionFailedHeadline: "このバージョンには実行できなかったセルがあります。",
    versionFailedHint: "例外が出たセルに印が付いています。Nala に修正を頼むか、自分で編集してもう一度実行してください。",
    versionFailedNoCellsHeadline: "Nala はこのノートブックを作成できませんでした。",
    versionFailedNoCellsHint: "まだ何も書かれていないため、修正するものがありません。より短く具体的な説明で新しいノートブックを作成してください。",

    reviewLabel: "Nalaのレビュー",
    reviewVerdict: { ready: "準備完了", "needs-attention": "要確認" },
    reviewFindingsLabel: "指摘事項",
    reviewSeverity: { blocker: "重大", "should-fix": "要修正", nit: "軽微" },
    reviewCategory: {
      accuracy: "正確性",
      pedagogy: "教え方",
      code: "コード",
      structure: "構成",
      safety: "安全性",
      style: "スタイル",
    },
    reviewNotEstablishedLabel: "このノートブックが示していないこと",
    reviewNoReview: "このバージョンにはレビューがありません（インポートまたはレビューなしの再実行）。",

    compareToggle: "前のバージョンと比較",
    comparePickerLabel: "比較対象",
    diffStatus: {
      added: "追加",
      removed: "削除",
      changed: "変更",
      unchanged: "変更なし",
      moved: "移動",
    },
    diffHeaderField: {
      title: "タイトル",
      summary: "概要",
      objectives: "学習目標",
      duration_minutes: "所要時間（分）",
    },
    diffLoading: "比較を読み込んでいます…",
    diffLoadFailed: "比較用のバージョンを読み込めませんでした。",

    progressSummary: (mastery) => {
      const parts: string[] = [];
      if (mastery.checkpointsTotal > 0) {
        parts.push(`チェックポイント ${mastery.checkpointsPassed}/${mastery.checkpointsTotal} 合格`);
      }
      if (mastery.cellsErrored > 0) {
        parts.push(`エラー ${mastery.cellsErrored}セル`);
      }
      if (mastery.exercisesTotal > 0) {
        parts.push(`演習 ${mastery.exercisesTotal}問`);
      }
      return parts.join(" ・ ");
    },

    quizButtonLabel: "このノートブックでクイズを作る",
    quizButtonFailed: "クイズを開始できませんでした。",

    chatLabel: "Nalaに相談する",
    chatPlaceholder: "Nalaにこのノートブックの変更を依頼してください…",
    chatSend: "送信",
    chatSending: "送信しています…",
    chatEmpty: "セルの内容、たとえ話、難易度、言語など、変更したい点をNalaに伝えてください。",
    chatLoadFailed: "会話を読み込めませんでした。",
    chatSendFailed: "メッセージを送信できませんでした。",
    runStreamLost: "この実行のライブ表示が切断されました。結果を確認するにはページを再読み込みしてください。",
    progressLabel: "処理中",

    live: {
      phase: {
        idle: "開始を待っています",
        outlining: "ノートブックの構成を考えています",
        drafting: "ノートブックを書いています",
        checking: "実行前にセルを確認しています",
        running: "ノートブックを実行しています",
        repairing: "セルを修正しています",
        reviewing: "結果を確認しています",
        done: "完了しました",
        failed: "問題が発生しました",
      },
      writingLabel: "Nalaがこのセルを書いています",
      cellStatus: { queued: "実行待ち", ran: "実行済み", raised: "エラーが発生", not_run: "未実行" },
      repairBanner: (cellId, attempt, of) => `セル${cellId}を修正しています（${attempt}/${of}回目の試行）。`,
      checkingBanner: (cellId) => `セル${cellId}を実行前に確認しています。`,
    },

    cellStatus: { ok: "成功", error: "エラー", skipped: "スキップ", not_run: "未実行" },
    cellStdout: "出力",
    cellStderr: "エラー出力",
    cellTruncated: "一部の出力は容量の上限により省略されています。",
    cellErrorLabel: "エラー",

    actionExplain: "このセルを説明する",
    actionSimplify: "やさしくする",
    actionAddFigure: "ここに図を追加",
    actionExercise: "演習問題にする",
    actionExplainError: "このエラーを説明する",
    actionCheckAttempt: "自分の解答を確認する",
    actionCheckAttemptCancel: "キャンセル",
    checkAttemptPlaceholder: "このセルへの解答を貼り付けるか入力してください…",
    checkAttemptSubmit: "Nalaに確認してもらう",
    checkAttemptGrade: "解答を採点する",
    answerLegend: "あなたの解答",
    answerTextPlaceholder: "解答を入力してください…",
    answerNumericPlaceholder: "数値",
    answerRubricPlaceholder: "1〜2文で解答を書いてください…",
    answerSubmit: "解答を確認する",
    answerClear: "消去",
    answerModelGraded: "この問題は Nala が採点します。テストではなく判断による評価です。",
    gradePending: "コードを実行しています…",
    gradeVerdict: {
      passed: "正解です。",
      failed: "まだ正解ではありません。",
      unattempted: "未採点です。このセルはまだ実行されていません。",
      ungradable: "これはNalaによる採点が必要です。",
    },
    gradeByCheck: "演習に付属するテストを実行して確認しました。",
    gradeByModel: "テストではなくNalaの判断です。誤ることがあります。",
    gradeFailed: "採点できませんでした。少し時間をおいて再度お試しください。",
    gradeNotGraded: "このノートブックには、テスト付きの演習がありません。",
    gradeSummaryLabel: "採点付き演習の進捗",
    gradeSummary: (passed, attempted) => `解答した ${attempted} 問中 ${passed} 問が正解です`,
    gradeUngradable: (count) => `${count} 問は採点できませんでした。どちらにも数えていません。`,
    gradeFromOlderVersion: (seq) =>
      `この結果はバージョン ${seq} のものです。その後改訂されているため、問題が変わっている可能性があります。`,
    downloadWithSolutions: "解答付きでダウンロード",

    edit: "編集",
    editExit: "編集を終える",
    editHint: "どのセルでも編集して実行できます。保存するたびに新しいバージョンになります。",
    editCellSourceLabel: (cellId) => `セル ${cellId} の内容`,
    editKindLabel: "セルの種類",
    editKindOption: { markdown: "テキスト", code: "コード" },
    editRoleLabel: "役割",
    editRoleNone: "指定なし",
    editExecuteLabel: "このセルを実行する",
    editRaisesLabel: "例外が起きる想定",
    editAddMarkdown: "下にテキストを追加",
    editAddCode: "下にコードを追加",
    editDelete: "セルを削除",
    editMoveUp: "上へ移動",
    editMoveDown: "下へ移動",
    editEmpty: "このノートブックにはまだセルがありません。下から追加してください。",
    saveAndRun: "保存して実行",
    saveWithoutRunning: "実行せずに保存",
    runToHere: "ここまで実行",
    discard: "変更を破棄",
    discardConfirm: "このノートブックの変更を破棄しますか？",
    saving: "保存しています…",
    saveFailed: "変更を保存できませんでした。",
    unsavedWarning: "このノートブックに未保存の変更があります。",
    structureNotesLabel: "Nalaからの構成メモ",
    structureNotesHint: "提案のみです。バージョンは書かれたとおりに保存されています。",
    cellNotRunBadge: "未実行",
    ide: NOTEBOOK_IDE_COPY.ja,

    teachMeInNotebook: "ノートブックで学ぶ",
  },
  hardwareRuns: {
    title: "実機での実行履歴",
    intro: "このワークスペースから量子コンピュータに送ったジョブを、実行した実機ごとにまとめています。完了したジョブでは、同じ回路を雑音のない理想的な装置で実行した場合の分布と、実機で測定した分布との距離を示します。",
    readingGuide: "距離は0（理論値と一致）から1（重なりなし）までの値です。理想的な装置でも有限回のショットでは多少の距離が出るため、そのショット数で見込まれる大きさを「サンプリングのみ」に示しています。これを大きく上回る分は、サンプリングではなく実機に由来します。",
    loading: "実機での実行履歴を読み込み中…",
    loadFailed: "サーバーに接続できないため、実機での実行履歴を読み込めませんでした。",
    retry: "再試行",
    empty: "実機での実行はまだありません。Studioのハードウェアパネルから送ったジョブがここに表示されます。",
    emptyAction: "Studioを開く",
    unrecordedMachine: "実機名の記録なし",
    unrecordedMachineNote: "これらのジョブは、使った実機をLeonaが記録するようになる前に実行されたか、提供元が実機名を返しませんでした。どの実機で実行されたかを推測せず、別にまとめています。",
    machineRunCount: (count) => `${count}件の実行`,
    columnSubmitted: "送信日時",
    columnStatus: "状態",
    columnShots: "ショット数",
    columnDistance: "理論値との距離",
    columnShotNoise: "サンプリングのみ",
    columnFidelity: "ヘリンガー忠実度",
    columnReadoutCorrected: "読み出し補正後の距離",
    columnZne: "ゼロノイズ推定の距離（リチャードソン外挿）",
    zneRequested: "ゼロノイズ外挿あり",
    status: (status) => ({
      queued: "待機中",
      running: "実行中",
      done: "完了",
      error: "失敗",
      cancelled: "キャンセル",
    }[status] ?? status),
    inProgress: "まだ完了していません",
    endedWithoutCounts: "測定結果は返ってきませんでした",
    workingOut: "比較を計算しています…",
    programMismatch: "保存されている回路が、このジョブを送信したときの回路と一致しないため、比較は表示しません。",
    details: "詳細",
    showOlder: "さらに古い実行を表示",
    loadingOlder: "読み込み中…",
    olderFailed: "古い実行を読み込めませんでした。もう一度お試しください。",
  },
  courses: {
    title: "コース",
    lede: "Nalaとコースを計画し、各モジュールをノートブックで学習できます。",
    coursesTab: "コース",

    planLabel: "コースを計画する",
    briefLabel: "このコースで何を教えたいですか？",
    briefPlaceholder: "例：Pythonエンジニアを古典ビットからショアのアルゴリズムまで、8モジュール程度で、毎回手を動かしながら導いてください。",
    moduleCountLabel: "モジュール数",
    moduleCountOption: { auto: "自動", "4": "4", "8": "8", "12": "12" },
    startersLabel: "またはお題から始める",
    create: "コースを計画",
    creating: "計画しています…",
    createFailed: "コースを計画できませんでした。",

    listLoading: "コースを読み込んでいます…",
    listLoadFailed: "コースを読み込めませんでした。",
    listEmpty: "まだコースを作成していません。",
    search: "コースを検索",
    searchPlaceholder: "タイトルで検索",
    noMatch: "検索条件に一致するコースはありません。",
    updated: "更新",
    statusPill: { planning: "計画中…", planned: "計画済み", generating: "生成中…", ready: "準備完了", failed: "失敗" },
    progress: (ready, total) => `${total}モジュール中${ready}件が準備完了`,
    open: "コースを開く",

    backToCourses: "コース一覧に戻る",
    loading: "コースを読み込んでいます…",
    loadFailed: "このコースを読み込めませんでした。",
    titleEditFailed: "タイトルを保存できませんでした。",
    saveTitle: "保存",

    generateAll: "すべて生成",
    generatingAll: "生成しています…",
    generateAllFailed: "モジュールを開始できませんでした。",
    downloadRepo: "リポジトリとしてダウンロード（.zip）",
    downloadingRepo: "ダウンロードしています…",
    downloadRepoFailed: "コースをダウンロードできませんでした。",
    downloadRepoDisabledHint: "すべてのモジュールが準備完了になると利用できます。",

    moduleStatusPill: { planned: "計画済み", queued: "待機中", generating: "生成中…", ready: "準備完了", failed: "失敗" },
    moduleSeqLabel: (seq) => `モジュール ${seq}`,
    topicLabel: "トピック",
    keyConceptsLabel: "主要な概念",
    objectivesLabel: "到達目標",
    deliverableLabel: "成果物",
    durationLabel: (minutes) => `${minutes}分`,
    durationUnknown: "所要時間未設定",
    prerequisitesLabel: "前提モジュール",
    prerequisiteUnresolved: (slug) => `${slug}（このコースにはありません）`,
    generateModule: "このモジュールを生成",
    generatingModule: "生成しています…",
    generateModuleFailed: "このモジュールを開始できませんでした。",
    openNotebook: "ノートブックを開く",
    moveUp: "上へ移動",
    moveDown: "下へ移動",
    reorderFailed: "モジュールの順序を保存できませんでした。",

    chatLabel: "Nalaに相談する",
    chatPlaceholder: "Nalaにこのコースの変更を依頼してください…",
    chatSend: "送信",
    chatSending: "送信しています…",
    chatEmpty: "モジュールの範囲、順序、難易度など、変更したい点をNalaに伝えてください。",
    chatLoadFailed: "会話を読み込めませんでした。",
    chatSendFailed: "メッセージを送信できませんでした。",
    progressLabel: "処理中",

    gradebookTitle: "成績表",
    gradebookLede:
      "各メンバーが各モジュールで最後に採点を受けた結果です。全員の結果を見られるのはあなただけです。"
      + "ほかのメンバーには自分の結果だけが表示されます。",
    gradebookEmpty: "このコースの演習は、まだ誰も採点を受けていません。",
    yourProgressTitle: "あなたの進捗",
    yourProgressLede: "各モジュールで最後に採点を受けた結果です。あなたと、このコースを作成した人が見られます。",
    yourProgressEmpty: "このコースの演習は、まだ採点を受けていません。",
    gradebookLoading: "結果を読み込んでいます…",
    gradebookLoadFailed: "結果を読み込めませんでした。",
    gradebookRefresh: "更新",
    gradebookMemberColumn: "メンバー",
    gradebookYou: "あなた",
    gradebookTotalColumn: "合計",
    gradebookLastColumn: "最終採点",
    gradebookNotStarted: "未着手",
    gradebookTotalUnknown: "未確定",
    gradebookTotalsPending: "準備のできたノートブックがまだないモジュールがあるため、合計はまだ確定していません。",
    gradebookScore: (passed, graded) => `${graded} 問中 ${passed} 問が正解です`,
    gradebookOlderVersion: "以前の版",
    gradebookOlderVersionHint: (seq) => `このノートブックの版 ${seq} で採点された結果です。その後、内容が改訂されています。`,
    gradebookDownloadCsv: "CSVをダウンロード",
    gradebookDownloadingCsv: "ダウンロードしています…",
    gradebookDownloadCsvFailed: "成績表をダウンロードできませんでした。",

    dueLabel: (date) => `提出期限 ${date}`,
    dueOverdue: "期限切れ",
    dueDateLabel: "提出期限",
    dueDateHint: "あなたのタイムゾーンで入力してください。メンバーにはそれぞれのタイムゾーンで表示されます。",
    saveDueDate: "期限を保存",
    savingDueDate: "保存しています…",
    clearDueDate: "期限を削除",
    dueDateSaveFailed: "提出期限を保存できませんでした。",
    gradebookLate: "期限後",
    gradebookLateHint: (date) => `提出期限（${date}）までに採点された提出がありません。`,
    gradebookMissing: "未提出",
    gradebookMissingHint: (date) => `未着手のまま、提出期限（${date}）を過ぎています。`,
    gradebookLegend: "期限後：提出期限までに採点された提出がありません。未提出：未着手のまま提出期限を過ぎています。",
  },
  },
};

export const ACCOUNT_COPY: Record<PublicLocale, {
  title: string;
  lede: string;
  signOut: string;
  /** Dismissal of the settings modal. Its own key rather than the sidebar's
   * `cancel`, because "Cancel" is the wrong word for a surface that saves as
   * you go — nothing is being abandoned, a panel is being put away. */
  close: string;
  /** Names the modal's scrollable region, which a keyboard user can focus in
   * order to scroll it. The dialog's own name comes from the page's <h1>. */
  settingsRegion: string;
  /** Names the settings rail — the `<summary>` a narrow viewport collapses it
   * to, and the accessible name of the `<nav>` inside it (ai-ops 134). Not
   * `settingsRegion`: that one names the scroll container, and a screen reader
   * reading "Settings, settings" for two nested landmarks is the reason they
   * are separate strings. */
  sectionsLabel: string;
  preferences: string;
  language: string;
  languageHelp: string;
  theme: string;
  themeHelp: string;
  accent: string;
  accentHelp: string;
  identity: string;
  /** The Profile pane's label and heading. */
  profile: string;
  retry: string;
  usageUnavailable: string;
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
  autoKeep: string;
  autoKeepHelp: string;
  autoKeepOn: string;
  autoKeepOff: string;
  autoKeepFailed: string;
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
  usageSimulation: string;
  usageUnlimited: string;
  usageRunsPerWeek: (count: number) => string;
  usageArtifacts: (count: number) => string;
  usageQubits: (count: number) => string;
  // The per-project artifact limit, which is not a tier allowance and does not
  // live in `TierLimits`: it belongs to the project and its owner can change it.
  // It is stated here because ai-ops issue 82 took it off /pricing, where it read as
  // an allowance a plan grants, and this is the screen where it is neither the
  // largest number nor the surprising one. `DEFAULT_PROJECT_ARTIFACT_LIMIT` is
  // the source; the value says "by default" because the share dialog can raise
  // or lower it per project.
  usageProjectArtifacts: string;
  usageProjectArtifactsValue: (count: number) => string;
  usageNowTitle: string;
  // The weekly allowance meter. `meterTokens` names what the bar measures;
  // `meterTokensRuns` is the sentence that makes a six-figure token number mean
  // something to somebody who bought "5 runs a week". Both take their numbers
  // from the server so the screen and the refusal cannot state different ones.
  meterWeeklyTitle: string;
  meterTokens: string;
  meterTokensRuns: (runs: number) => string;
  meterTokensUnmetered: string;
  meterPercentUsed: (percent: number) => string;
  meterAmount: (used: string, limit: string) => string;
  meterResetsOn: (date: string) => string;
  meterResetsWhen: (word: string) => string;
  meterExhausted: string;
  // The two warnings before the wall (75% / 90%). Both say what is left rather
  // than what is spent — "37,500 left" is the fact a person acts on, and the
  // percentage is already on the row. The server decides which one applies;
  // this file only words them.
  meterApproaching: (remaining: string) => string;
  meterCritical: (remaining: string) => string;
  meterUpgradeHint: string;
  usageWorkspaces: string;
  usageSpent: (used: number, limit: number) => string;
  usageSpentUnmetered: (used: number) => string;
  usageWindow: (days: number) => string;
  usageArtifactsScope: string;
  usageEnforcedAs: (tier: string) => string;
  usageNextSlotOn: (date: string) => string;
  usageNextSlotWhen: (word: string) => string;
  // Shared projects. The scope line is not decoration: this allowance counts
  // shared projects only, from both directions, and "2 of 4" printed beside the
  // word "projects" reads as a cap on every project a person has. It is not
  // one — unshared projects are unlimited on every tier — and the sentence
  // saying so has to sit under the number rather than in a help page.
  usageSharedProjects: string;
  usageSharedProjectsScope: string;
  usageSharedProjectsNone: string;
  // Hardware spend, in dollars, per account. `usageHardwareAuthorized` is the
  // ORDINARY case: there is no weekly ceiling on any tier, so the sentence has
  // to read as a complete fact on its own rather than as half of a ratio.
  usageHardware: string;
  usageHardwareAuthorized: (amount: string, days: number) => string;
  usageHardwareRemaining: (remaining: string, limit: string) => string;
  usageHardwareExhausted: (limit: string) => string;
  usageHardwareFreeQueuesOnly: string;
  usageHardwareScope: string;
  // Model spend. Never optional — a `?` here is how the Japanese principles
  // section disappeared in PR 194, because `Record<PublicLocale, …>` cannot
  // catch a field one locale is allowed to omit.
  spendTitle: string;
  spendScope: (days: number) => string;
  spendEmpty: (days: number) => string;
  spendChat: string;
  spendRuns: string;
  spendTotal: string;
  spendTokens: (tokens: string, calls: number) => string;
  spendUnattributed: string;
  spendNotBilled: string;
  // `Record<AccountTier, …>` rather than a hand-written union of the same
  // strings. It was the second copy, and a second copy is what let a tier be
  // added to the product while this table silently kept describing the old set
  // — the failure surfacing far from here, at whichever line indexes into it.
  //
  // The PUBLIC plan name, which for two tiers is not the id: `pro` is **Plus**,
  // `team` is **Professional**. This table and `sidebar.tierLabel` are the only
  // two places a tier is named to a person, and account-tier.test.ts pins both
  // so that "fixing" `pro` to say Professional fails rather than telling every
  // Plus subscriber they are on the plan above.
  tierNames: Record<AccountTier, string>;
  usageEnforcement: string;
  billingTitle: string;
  billingHelp: string;
  billingPayments: string;
  billingPaymentsDisabled: string;
  billingBackend: string;
  billingBackendConfigured: string;
  billingBackendUnconfigured: string;
  billingUnavailable: string;
  billingPolicyTitle: string;
  billingPolicyHelp: string;
  billingPolicyFree: string;
  billingPolicyFreeValue: string;
  billingPolicyDemo: string;
  billingPolicyDemoValue: string;
  billingPolicyCpu: string;
  billingPolicyCpuValue: string;
  billingPolicyHardware: string;
  billingPolicyHardwareValue: string;
  billingEstimatesLink: string;
  billingUpgradeLink: string;
  /**
   * Connecting your own IBM Quantum key.
   *
   * There is no OAuth here and the copy must not imply one. IBM publishes no
   * way for a third-party application to obtain an API key on somebody's
   * behalf, so the honest surface is instructions, a paste field and a status —
   * and a "Connect with IBM" button that redirected nowhere would be worse than
   * three sentences of prose.
   *
   * The four failure sentences are four separate strings because they mean four
   * different things to the person reading them: fix the key, wait and retry,
   * stop (nothing you do here helps), and an unclassified failure. Collapsing
   * any two of them would send somebody to re-paste a key that was never the
   * problem.
   */
  qpuTitle: string;
  tokensTitle: string;
  tokensHelp: string;
  tokensName: string;
  tokensExpiry: string;
  tokensAllowRuns: string;
  tokensCreate: string;
  tokensLoading: string;
  tokensEmpty: string;
  tokensShownOnce: string;
  tokensShownOnceHelp: string;
  tokensDismiss: string;
  tokensRevoke: string;
  tokensRevoked: string;
  tokensExpired: string;
  tokensCanRun: string;
  tokensNeverUsed: string;
  tokensExpiresIn: (days: number) => string;
  tokensLoadError: string;
  tokensCreateError: string;
  tokensRevokeError: string;
  qpuHelp: string;
  qpuOpenPlan: string;
  qpuStepAccount: string;
  qpuStepKey: string;
  qpuStepPaste: string;
  qpuDashboardLink: string;
  qpuStorageNote: string;
  qpuKeyLabel: string;
  qpuKeyPlaceholder: string;
  qpuKeyLengthHint: (length: number) => string;
  qpuInstanceLabel: string;
  qpuInstanceHelp: string;
  qpuLabelLabel: string;
  qpuLabelHelp: string;
  qpuConnect: string;
  qpuConnecting: string;
  qpuLoading: string;
  qpuLoadFailed: string;
  qpuNotConnected: string;
  qpuConnectedTitle: string;
  qpuConnectedMessage: string;
  qpuStatusLabel: string;
  qpuStatusInstance: string;
  qpuStatusConnectedAt: string;
  qpuStatusVerified: string;
  qpuStatusUsed: string;
  qpuStatusNone: string;
  qpuNeverUsed: string;
  qpuDisconnect: string;
  qpuDisconnectConfirm: string;
  qpuDisconnectCancel: string;
  qpuDisconnecting: string;
  qpuDisconnectWarning: string;
  qpuDisconnected: string;
  qpuErrorRejected: string;
  qpuErrorVerificationUnavailable: string;
  qpuErrorStorageUnavailable: string;
  qpuErrorGeneric: string;
  qpuErrorDisconnect: string;
  /** IBM's own sentence, quoted rather than paraphrased. */
  qpuProviderDetail: (sentence: string) => string;
}> = {
  en: {
    title: "Settings",
    lede: "Your identity, your saved artifacts, the workspaces you can open, and display preferences.",
    signOut: "Sign out",
    close: "Close settings",
    settingsRegion: "Settings",
    sectionsLabel: "Sections",
    preferences: "Preferences",
    language: "Language",
    languageHelp: "Choose the language used for shared navigation and account settings.",
    theme: "Theme",
    themeHelp: "Light or dark, for the workspace and the public site alike.",
    accent: "Colour",
    accentHelp: "The one colour the workspace uses for links, buttons and the lioness.",
    identity: "Identity",
    profile: "Profile",
    retry: "Try again",
    usageUnavailable: "Usage is not available right now.",
    email: "Email",
    workspace: "Workspace",
    displayName: "Display name",
    yourName: "Your name",
    saveName: "Save name",
    saving: "Saving…",
    profileSaved: "Profile saved.",
    profileSaveFailed: "Profile could not be saved",
    personalWorkspace: "Personal workspace",
    personalWorkspaceHelp: "Your own workspace. Nobody else can open it unless you invite them below.",
    artifacts: "Artifacts",
    runs: "Runs",
    access: "Access",
    privateAccess: "Private",
    autoKeep: "Automatically save results",
    autoKeepHelp: "Off by default: a finished run asks before it is saved.",
    autoKeepOn: "New results will be saved automatically.",
    autoKeepOff: "New results will ask before saving.",
    autoKeepFailed: "Could not change that setting.",
    workspaceBoundaries: "Workspace boundaries",
    library: "Artifacts",
    libraryHelp: "Saved runs and public references stay in your personal workspace.",
    repositoryExport: "Atlas export",
    repositoryExportHelp: "Sign in to copy a public entry into this workspace and open it in Studio.",
    collaboration: "Collaboration",
    collaborationHelp: "Invite people by email into any workspace you own or administer. Roles are owner, admin, member and viewer.",
    loading: "Loading workspace data…",
    unavailable: "Workspace data is unavailable.",
    requestFailed: "Request failed",
    usageTitle: "Usage & limits",
    usageHelp: "No payment is collected during early access. Weekly run and storage allowances are enforced; contact us if you need more room.",
    usagePlan: "Plan",
    usagePlanValue: "Early access",
    usageRuns: "Runs",
    usageRunsValue: "Fair use — no hard cap during early access",
    usageStorage: "Artifact storage",
    usageStorageValue: "Fair use — artifacts and versions retained",
    usageSimulation: "Browser simulation",
    usageUnlimited: "Unlimited",
    usageRunsPerWeek: (count) => `${count} per week`,
    usageArtifacts: (count) => `${count} artifacts`,
    usageQubits: (count) => `Up to ${count} qubits`,
    usageProjectArtifacts: "Artifacts per project",
    usageProjectArtifactsValue: (count) => `${count} by default, set per project`,
    usageNowTitle: "Right now",
    meterWeeklyTitle: "Weekly limits",
    meterTokens: "Agent tokens",
    // "About", because it is: a run costs what it costs, and the number here is
    // a measured average. Promising an exact count would be the lie the whole
    // change exists to avoid.
    meterTokensRuns: (runs) => `about ${runs} verified runs`,
    meterTokensUnmetered: "No limit on your plan",
    meterPercentUsed: (percent) => `${percent}% used`,
    meterAmount: (used, limit) => `${used} of ${limit}`,
    meterResetsOn: (date) => `Frees up ${date}`,
    meterResetsWhen: (word) => `Frees up ${word}`,
    meterExhausted: "This week's allowance is used",
    meterApproaching: (remaining) => `${remaining} left this week`,
    meterCritical: (remaining) => `${remaining} left — a long run may not finish`,
    meterUpgradeHint: "See what more costs",
    usageWorkspaces: "Workspaces owned",
    usageSpent: (used, limit) => `${used} of ${limit} used`,
    usageSpentUnmetered: (used) => `${used} used — no limit on your plan`,
    // "Rolling" rather than "weekly": each run returns seven days after it was
    // spent, so there is no reset day, and saying there is one would send
    // people back on the wrong morning.
    usageWindow: (days) => `Rolling ${days}-day window`,
    usageArtifactsScope: "In this workspace",
    usageEnforcedAs: (tier) => `Enforced as ${tier}: these figures are the control plane's.`,
    usageNextSlotOn: (date) => `1 more frees up on ${date}`,
    usageNextSlotWhen: (word) => `1 more frees up ${word}`,
    usageSharedProjects: "Shared projects",
    usageSharedProjectsScope: "Shared ones only; private projects are unlimited.",
    usageSharedProjectsNone:
      "Sharing is not part of your plan. Projects you keep to yourself stay unlimited.",
    usageHardware: "Hardware spend",
    // The sentence stands on its own, because on every plan there is now no
    // weekly hardware ceiling: what you spend on your own provider account is
    // your decision. "$3.40 of unlimited" would be a ratio with nothing on the
    // other side of it.
    usageHardwareAuthorized: (amount, days) => `${amount} authorized in the last ${days} days`,
    usageHardwareRemaining: (remaining, limit) => `${remaining} left of your ${limit} ceiling`,
    usageHardwareExhausted: (limit) => `Your ${limit} ceiling for this window is used up`,
    // A zero ceiling is not a hardware ban, and saying so is the whole point of
    // this line: free-queue devices estimate nothing, count as $0.00, and are
    // never refused on it.
    usageHardwareFreeQueuesOnly:
      "Free queues only on your plan — priced hardware cannot be submitted, and free-queue devices are unaffected.",
    usageHardwareScope:
      "Estimated cost of the hardware you have authorized, for your whole account. Free-queue devices count as $0.00.",
    spendTitle: "Model usage",
    spendScope: (days) => `This workspace, last ${days} days`,
    spendEmpty: (days) => `No model usage in the last ${days} days`,
    spendChat: "Chat",
    spendRuns: "Agent runs",
    spendTotal: "Total",
    spendTokens: (tokens, calls) => `${tokens} tokens · ${calls} calls`,
    spendUnattributed: "Unattributed",
    // Said because a page that suddenly reports six-figure numbers reads like
    // a bill arriving. Nothing in this deployment prices a token.
    spendNotBilled: "For reference only. Nothing here is billed or counted against an allowance.",
    tierNames: {
      preview: "Preview",
      free: "Free",
      pro: "Plus",
      team: "Professional",
      developer: "Developer",
    },
    usageEnforcement: "These allowances are enforced when you submit a run. Browser simulation always stays available on your own hardware.",
    billingTitle: "Billing & credits",
    billingHelp: "How Leona Quantum will charge for agent runs and hardware. Shown for transparency — payments are not enabled.",
    billingPayments: "Payments",
    billingPaymentsDisabled: "Disabled. You can explore the full flow without adding a payment method — no card entry, checkout, or charge exists in this deployment.",
    billingBackend: "Billing backend",
    billingBackendConfigured: "Stripe is connected for future billing. It holds no payment methods and cannot charge anyone.",
    billingBackendUnconfigured: "Stripe is not configured in this deployment.",
    billingUnavailable: "Billing status is unavailable because the control plane could not be reached.",
    billingPolicyTitle: "Provisional credit policy",
    billingPolicyHelp: "Owner-ratified direction, shown for transparency. Not yet enforced — numbers may change before launch.",
    billingPolicyFree: "Free plan",
    billingPolicyFreeValue: "About 5 agent runs per week",
    billingPolicyDemo: "Demo credit",
    billingPolicyDemoValue: "About 15 agent runs, expiring about two weeks after first use",
    billingPolicyCpu: "Browser CPU simulation",
    billingPolicyCpuValue: "No charge — target of about 10 runs per 10 minutes",
    billingPolicyHardware: "GPU / QPU hardware",
    billingPolicyHardwareValue: "Owner-gated. Sourced cost estimates appear in Studio's hardware lane before any submission.",
    billingEstimatesLink: "See hardware estimates in Studio",
    billingUpgradeLink: "Compare plans",
    qpuTitle: "Connect IBM Quantum",
    tokensTitle: "Access tokens",
    tokensHelp: "Let a tool on your own computer — a code editor, or an AI assistant — read the Atlas and start verified runs as you, without opening this site. A token works in this workspace only. It cannot reach your IBM Quantum key, your billing, or this page.",
    tokensName: "What is it for?",
    tokensExpiry: "Days until it expires",
    tokensAllowRuns: "Also let it start verified runs",
    tokensCreate: "Create token",
    tokensLoading: "Loading your access tokens\u2026",
    tokensEmpty: "You have no access tokens.",
    tokensShownOnce: "Copy this now. You will not see it again.",
    tokensShownOnceHelp: "We keep only a scrambled copy, so there is no way to show it to you a second time. If you lose it, revoke it and make another.",
    tokensDismiss: "Done",
    tokensRevoke: "Revoke",
    tokensRevoked: "Revoked",
    tokensExpired: "Expired",
    tokensCanRun: "can start runs",
    tokensNeverUsed: "never used",
    tokensExpiresIn: (days) => (days === 1 ? "Expires tomorrow" : `Expires in ${days} days`),
    tokensLoadError: "We could not load your tokens. Try again in a moment.",
    tokensCreateError: "We could not create that token. Try again in a moment.",
    tokensRevokeError: "We could not revoke that token. Try again in a moment.",
    qpuHelp:
      "Run on IBM hardware with your own IBM account instead of the one Leona shares between everybody.",
    qpuOpenPlan:
      "IBM's free Open Plan gives roughly 10 minutes of QPU time per rolling 28 days. Connected here, that allowance is yours on your own IBM account — today every Leona user draws from a single shared pool, so a busy week for someone else is a queue you wait in.",
    qpuStepAccount: "Create a free account and open the IBM Quantum Platform dashboard.",
    qpuStepKey: "Create an API key there. It is 44 characters long.",
    qpuStepPaste: "Paste it below. Leona checks it with IBM before saving it.",
    qpuDashboardLink: "quantum.cloud.ibm.com",
    qpuStorageNote:
      "Leona stores the key encrypted and never shows it again. You can revoke it at any time from IBM's own dashboard, which cuts off this connection whether or not you disconnect it here.",
    qpuKeyLabel: "IBM API key",
    qpuKeyPlaceholder: "44 characters",
    // A hint, not a refusal. IBM decides whether a key is valid, and a length
    // this page hardcoded would start rejecting real keys the day that changes.
    qpuKeyLengthHint: (length) => `That is ${length} characters — an IBM API key is 44.`,
    qpuInstanceLabel: "Instance CRN (optional)",
    qpuInstanceHelp:
      "Only needed when your IBM account has more than one instance. Paste the CRN itself — it starts with “crn:” and an instance name is not accepted here. Open Plan instances exist only in IBM's us-east region.",
    qpuLabelLabel: "Label (optional)",
    qpuLabelHelp: "A name for your own reference. It is shown here and nowhere else.",
    qpuConnect: "Connect",
    qpuConnecting: "Checking with IBM…",
    qpuLoading: "Checking your connection…",
    qpuLoadFailed: "Could not check whether a key is connected. Reload the page to try again.",
    qpuNotConnected: "No IBM key is connected to your account.",
    qpuConnectedTitle: "Connected",
    qpuConnectedMessage: "IBM accepted the key. Leona stored it encrypted and will not show it again.",
    qpuStatusLabel: "Label",
    qpuStatusInstance: "Instance",
    qpuStatusConnectedAt: "Connected",
    qpuStatusVerified: "Last verified",
    qpuStatusUsed: "Last used",
    qpuStatusNone: "Not set",
    qpuNeverUsed: "Not yet used",
    qpuDisconnect: "Disconnect",
    qpuDisconnectConfirm: "Yes, disconnect",
    qpuDisconnectCancel: "Keep it",
    qpuDisconnecting: "Disconnecting…",
    qpuDisconnectWarning:
      "Queued hardware runs will stop submitting until a key is connected again. This removes the key from Leona; it does not revoke it at IBM.",
    qpuDisconnected: "Your IBM key was removed. Leona no longer holds it.",
    // Fix the key.
    qpuErrorRejected:
      "IBM did not accept that key. Check that you copied all 44 characters, and that the key has not been revoked or deleted on IBM's dashboard.",
    // Wait and try again — nothing was saved and nothing is wrong with the key.
    qpuErrorVerificationUnavailable:
      "Leona could not reach IBM to check the key. Nothing was saved and your key was not stored — try again in a few minutes.",
    // Stop. There is nothing the person reading this can do about it.
    qpuErrorStorageUnavailable:
      "This deployment cannot store credentials yet, so a key cannot be accepted here. Nothing is wrong with your key and there is nothing to retry — it needs a change on our side.",
    qpuErrorGeneric: "The key could not be saved.",
    qpuErrorDisconnect: "The key could not be removed. It is still connected.",
    qpuProviderDetail: (sentence) => `IBM said: ${sentence}`,
  },
  ja: {
    title: "設定",
    lede: "プロフィール、保存した回路・実行記録、ワークスペース、表示設定を管理します。",
    signOut: "サインアウト",
    close: "設定を閉じる",
    settingsRegion: "設定",
    sectionsLabel: "項目",
    preferences: "表示設定",
    language: "言語",
    languageHelp: "共通ナビゲーションとアカウント設定で使用する言語を選択します。",
    theme: "テーマ",
    themeHelp: "ライトかダークか。ワークスペースと公開サイトの両方に適用されます。",
    accent: "カラー",
    accentHelp: "リンク、ボタン、ライオネスに使うワークスペースの基調色です。",
    identity: "本人情報",
    profile: "プロフィール",
    retry: "再試行",
    usageUnavailable: "使用状況を取得できません。",
    email: "メールアドレス",
    workspace: "ワークスペース",
    displayName: "表示名",
    yourName: "名前",
    saveName: "名前を保存",
    saving: "保存中…",
    profileSaved: "プロフィールを保存しました。",
    profileSaveFailed: "プロフィールを保存できませんでした",
    personalWorkspace: "個人ワークスペース",
    personalWorkspaceHelp: "個人用のワークスペースです。招待しない限り、他の人には表示されません。",
    artifacts: "回路・実行記録",
    runs: "実行",
    access: "アクセス",
    privateAccess: "非公開",
    autoKeep: "結果を自動的に保存する",
    autoKeepHelp: "既定ではオフです。実行が終わると、保存するか確認します。",
    autoKeepOn: "今後の実行結果は自動的に保存されます。",
    autoKeepOff: "今後の実行結果は保存前に確認します。",
    autoKeepFailed: "設定を変更できませんでした。",
    workspaceBoundaries: "ワークスペースごとのデータ管理",
    library: "回路・実行記録",
    libraryHelp: "保存した実行結果や Atlas の公開資料は、個人用のワークスペースに保管されます。",
    repositoryExport: "Atlas から追加",
    repositoryExportHelp: "サインインすると、Atlas の公開資料をこのワークスペースに追加し、Studio で開けます。",
    collaboration: "共同作業",
    collaborationHelp: "オーナーまたは管理者であるワークスペースに、メールアドレスで招待できます。権限はオーナー・管理者・メンバー・閲覧者です。",
    loading: "ワークスペースデータを読み込んでいます…",
    unavailable: "ワークスペースデータを取得できません。",
    requestFailed: "リクエストに失敗しました",
    usageTitle: "使用状況と上限",
    usageHelp: "アーリーアクセス期間中は料金がかかりません。実行回数や保存容量を増やしたい場合はご相談ください。",
    usagePlan: "プラン",
    usagePlanValue: "アーリーアクセス",
    usageRuns: "実行",
    usageRunsValue: "フェアユース — アーリーアクセス中は固定上限なし",
    usageStorage: "保存容量",
    usageStorageValue: "フェアユース — 回路・実行記録と各バージョンを保持",
    usageSimulation: "ブラウザ実行",
    usageUnlimited: "無制限",
    usageRunsPerWeek: (count) => `週${count}回`,
    usageArtifacts: (count) => `${count}件`,
    usageQubits: (count) => `${count}量子ビットまで`,
    usageProjectArtifacts: "プロジェクトごとの回路数",
    usageProjectArtifactsValue: (count) => `既定で${count}件（プロジェクトごとに変更可）`,
    usageNowTitle: "現在の使用状況",
    meterWeeklyTitle: "週あたりの上限",
    meterTokens: "エージェントトークン",
    // 「約」を外さないこと。1回の実行にかかるトークン数は内容で変わり、ここの
    // 換算は実測の平均でしかない。正確な回数を約束する書き方にすると、この
    // 変更が避けようとしている嘘そのものになる。
    meterTokensRuns: (runs) => `検証付き実行 約${runs}回分`,
    meterTokensUnmetered: "現在のプランでは上限なし",
    meterPercentUsed: (percent) => `${percent}% 使用中`,
    meterAmount: (used, limit) => `${used} / ${limit}`,
    meterResetsOn: (date) => `${date}に回復`,
    meterResetsWhen: (word) => `${word}回復`,
    meterExhausted: "今週分の上限に達しました",
    meterApproaching: (remaining) => `今週の残りは${remaining}`,
    meterCritical: (remaining) => `残り${remaining} — 長い実行は完了しない可能性があります`,
    meterUpgradeHint: "上位プランを見る",
    usageWorkspaces: "所有ワークスペース",
    // 助数詞を持たない形にしてある。実行は「回」、アーティファクトは「件」、
    // ワークスペースは「つ」と数え方が違うので、三つの行で同じ関数を使う以上
    // 数字だけを見せるのが唯一正しく読める書き方になる。
    usageSpent: (used, limit) => `${used} / ${limit} 使用中`,
    usageSpentUnmetered: (used) => `${used} 使用中 — 現在のプランでは上限なし`,
    // 「毎週リセット」ではない。使った実行が7日後に1回ずつ戻るローリング方式で、
    // リセット曜日があると書くと違う日に戻ってこられてしまう。
    usageWindow: (days) => `直近${days}日間の集計`,
    usageArtifactsScope: "このワークスペース内",
    usageEnforcedAs: (tier) => `上限は ${tier} として適用されています。以下の数値はサーバー側の値です。`,
    usageNextSlotOn: (date) => `${date}に1回分が戻ります`,
    usageNextSlotWhen: (word) => `${word}1回分が戻ります`,
    usageSharedProjects: "共有プロジェクト",
    // 「2 / 4」だけを見ると全プロジェクトの上限に読めてしまう。共有していない
    // プロジェクトはどのプランでも無制限で、この数には入らない。
    usageSharedProjectsScope: "共有プロジェクトのみ。非公開のプロジェクトは無制限です。",
    usageSharedProjectsNone:
      "現在のプランでは共有をご利用いただけません。共有しないプロジェクトは引き続き無制限です。",
    usageHardware: "ハードウェア費用",
    // 上限はどのプランでも設けていない。自分のプロバイダアカウントで
    // いくら使うかは本人の判断、というのが方針。
    usageHardwareAuthorized: (amount, days) => `直近${days}日間で${amount}を承認`,
    usageHardwareRemaining: (remaining, limit) => `上限${limit}のうち${remaining}が残っています`,
    usageHardwareExhausted: (limit) => `この期間の上限${limit}を使い切りました`,
    // 上限0は「ハードウェア禁止」ではない。無料キューの実行は見積り0.00ドルとして
    // 数えられ、この上限で拒否されることはない。
    usageHardwareFreeQueuesOnly:
      "現在のプランでは無料キューのみご利用いただけます。有料のハードウェアには送信できませんが、無料キューへの送信は影響を受けません。",
    usageHardwareScope:
      "アカウント全体で承認したハードウェア実行の見積り費用です。無料キューの実行は $0.00 として数えます。",
    spendTitle: "モデル使用量",
    spendScope: (days) => `このワークスペース・直近${days}日間`,
    spendEmpty: (days) => `直近${days}日間のモデル使用はありません`,
    spendChat: "チャット",
    spendRuns: "エージェント実行",
    spendTotal: "合計",
    spendTokens: (tokens, calls) => `${tokens} トークン・${calls} 回の呼び出し`,
    spendUnattributed: "モデル不明",
    spendNotBilled: "参考表示です。課金や上限には数えられません。",
    // Japanese throughout, matching `sidebar.tierLabel` above. These two tables
    // name the same four tiers to the same reader, and they disagreed before —
    // フリー in the sidebar, "Free" in account settings.
    tierNames: {
      preview: "プレビュー",
      free: "フリー",
      pro: "プラス",
      team: "プロフェッショナル",
      developer: "開発者",
    },
    usageEnforcement: "これらの上限は実行の送信時に適用されます。ブラウザーでのシミュレーションはお使いの端末上で常に利用できます。",
    billingTitle: "請求とクレジット",
    billingHelp: "将来予定している Leona Run と量子コンピュータ実行の料金体系です。現在、支払いは発生しません。",
    billingPayments: "支払い",
    billingPaymentsDisabled: "現在は無効です。カード登録や決済はなく、料金は発生しません。",
    billingBackend: "請求バックエンド",
    billingBackendConfigured: "将来の請求に備えて Stripe を接続していますが、支払い方法は保存されておらず、請求も行われません。",
    billingBackendUnconfigured: "現在の環境では Stripe は設定されていません。",
    billingUnavailable: "サーバーに接続できないため、請求情報を取得できません。",
    billingPolicyTitle: "予定しているクレジット方針",
    billingPolicyHelp: "管理者が承認した現時点の方針です。まだ適用されておらず、正式提供までに変更される可能性があります。",
    billingPolicyFree: "無料プラン",
    billingPolicyFreeValue: "週あたり約5回のエージェント実行",
    billingPolicyDemo: "デモクレジット",
    billingPolicyDemoValue: "約15回のエージェント実行（初回使用から約2週間で失効）",
    billingPolicyCpu: "ブラウザCPUシミュレーション",
    billingPolicyCpuValue: "無料 — 10分あたり約10回を目安",
    billingPolicyHardware: "GPU・量子コンピュータ実行",
    billingPolicyHardwareValue: "管理者の承認が必要です。送信前に Studio で、出典付きの費用見積もりを確認できます。",
    billingEstimatesLink: "Studio でハードウェア見積もりを見る",
    billingUpgradeLink: "プランを比較する",
    qpuTitle: "IBM Quantum と接続",
    tokensTitle: "アクセストークン",
    tokensHelp: "お使いのコードエディタや AI アシスタントから、このサイトを開かずに Atlas を読んだり、検証付きの実行を開始したりできます。トークンが使えるのはこのワークスペースだけです。IBM Quantum のキー、請求、このページには一切届きません。",
    tokensName: "用途",
    tokensExpiry: "有効期限（日数）",
    tokensAllowRuns: "検証付きの実行も許可する",
    tokensCreate: "トークンを作成",
    tokensLoading: "アクセストークンを読み込んでいます…",
    tokensEmpty: "アクセストークンはありません。",
    tokensShownOnce: "今すぐコピーしてください。二度と表示されません。",
    tokensShownOnceHelp: "保存しているのはハッシュ化したものだけなので、もう一度表示する方法はありません。紛失した場合は無効化して作り直してください。",
    tokensDismiss: "完了",
    tokensRevoke: "無効化",
    tokensRevoked: "無効化済み",
    tokensExpired: "期限切れ",
    tokensCanRun: "実行の開始が可能",
    tokensNeverUsed: "未使用",
    tokensExpiresIn: (days) => (days === 1 ? "明日で期限切れ" : `あと ${days} 日で期限切れ`),
    tokensLoadError: "トークンを読み込めませんでした。少し時間をおいて再度お試しください。",
    tokensCreateError: "トークンを作成できませんでした。少し時間をおいて再度お試しください。",
    tokensRevokeError: "トークンを無効化できませんでした。少し時間をおいて再度お試しください。",
    qpuHelp:
      "全員で共有しているアカウントではなく、ご自身の IBM アカウントで IBM の量子コンピュータを実行できます。",
    qpuOpenPlan:
      "IBM の無料 Open Plan では、28日間のローリング期間ごとにおよそ10分の QPU 時間が使えます。ここで接続すると、その枠はご自身の IBM アカウントのものになります。現在は Leona の利用者全員が一つの共有枠を使っているため、他の人が多く使った週はその分だけ順番待ちが長くなります。",
    qpuStepAccount: "無料のアカウントを作成し、IBM Quantum Platform のダッシュボードを開きます。",
    qpuStepKey: "そこで API キーを作成します。キーは44文字です。",
    qpuStepPaste: "下の欄に貼り付けます。保存する前に Leona が IBM に照会して確認します。",
    qpuDashboardLink: "quantum.cloud.ibm.com",
    qpuStorageNote:
      "キーは暗号化して保存し、以後は表示しません。IBM のダッシュボードからいつでも無効化でき、無効化するとこの接続も使えなくなります。",
    qpuKeyLabel: "IBM API キー",
    qpuKeyPlaceholder: "44文字",
    // 目安であって拒否ではない。有効かどうかを決めるのは IBM 側。
    qpuKeyLengthHint: (length) => `現在${length}文字です。IBM の API キーは44文字です。`,
    qpuInstanceLabel: "インスタンス CRN（任意）",
    qpuInstanceHelp:
      "IBM アカウントに複数のインスタンスがある場合のみ必要です。「crn:」で始まる CRN をそのまま貼り付けてください（インスタンス名は登録できません）。Open Plan のインスタンスは IBM の us-east リージョンにのみ存在します。",
    qpuLabelLabel: "ラベル（任意）",
    qpuLabelHelp: "ご自身の覚え書き用の名前です。この画面にのみ表示されます。",
    qpuConnect: "接続する",
    qpuConnecting: "IBM に照会しています…",
    qpuLoading: "接続状況を確認しています…",
    qpuLoadFailed: "接続状況を確認できませんでした。ページを再読み込みしてください。",
    qpuNotConnected: "このアカウントには IBM のキーが接続されていません。",
    qpuConnectedTitle: "接続済み",
    qpuConnectedMessage: "IBM がキーを受理しました。暗号化して保存し、以後は表示しません。",
    qpuStatusLabel: "ラベル",
    qpuStatusInstance: "インスタンス",
    qpuStatusConnectedAt: "接続日時",
    qpuStatusVerified: "最終確認",
    qpuStatusUsed: "最終使用",
    qpuStatusNone: "未設定",
    qpuNeverUsed: "未使用",
    qpuDisconnect: "接続を解除",
    qpuDisconnectConfirm: "解除する",
    qpuDisconnectCancel: "そのままにする",
    qpuDisconnecting: "解除しています…",
    qpuDisconnectWarning:
      "解除すると、キーを再接続するまで待機中のハードウェア実行は送信されなくなります。解除は Leona からキーを削除する操作で、IBM 側でキーが無効化されるわけではありません。",
    qpuDisconnected: "IBM のキーを削除しました。Leona は保持していません。",
    // キーを直す。
    qpuErrorRejected:
      "IBM がこのキーを受理しませんでした。44文字すべてを貼り付けたか、IBM のダッシュボードでキーが無効化・削除されていないかをご確認ください。",
    // しばらく待って再試行する。キー自体には問題がなく、保存もされていない。
    qpuErrorVerificationUnavailable:
      "IBM に照会できなかったため確認できませんでした。キーは保存されていません。数分後にもう一度お試しください。",
    // ここで待っても直らない。利用者側にできることはない。
    qpuErrorStorageUnavailable:
      "この環境では資格情報をまだ保存できないため、キーを登録できません。キーに問題があるわけではなく、再試行しても変わりません。こちら側での対応が必要です。",
    qpuErrorGeneric: "キーを保存できませんでした。",
    qpuErrorDisconnect: "キーを削除できませんでした。接続は解除されていません。",
    qpuProviderDetail: (sentence) => `IBM からの応答: ${sentence}`,
  },
};

/**
 * Workspaces and members, on the Settings page.
 *
 * Kept out of ACCOUNT_COPY as its own record rather than growing a type that is
 * already sixty fields long — these strings appear in two panels that either
 * both render or neither does.
 *
 * The wording is deliberately blunt about what sharing exposes. A member reads
 * every run and every saved artifact in the workspace, including work saved
 * before they arrived, and there is no wording of that which is both softer and
 * true.
 */
/**
 * The notice an invited person sees, and the wording that makes it honest.
 *
 * "You can open it now" rather than "do you accept": the membership already
 * grants access by the time this renders, so a notice that read like a pending
 * offer would be describing a state the system does not have.
 *
 * `addedBy` and `added` are the same sentence with and without an author. The
 * authorless one is not a fallback nobody sees — a membership whose inviter's
 * account was deleted keeps its notice and loses the name.
 */
export const INVITE_COPY: Record<PublicLocale, {
  title: string;
  addedBy: (inviter: string, workspace: string, role: string) => string;
  added: (workspace: string, role: string) => string;
  memberAccess: string;
  viewerAccess: string;
  open: string;
  opening: string;
  dismiss: string;
  decline: string;
  declineConfirm: string;
  declining: string;
  cancel: string;
  declineWarning: (workspace: string) => string;
  failed: string;
}> = {
  en: {
    title: "New workspace",
    addedBy: (inviter, workspace, role) => `${inviter} added you to ${workspace} as a ${role}.`,
    added: (workspace, role) => `You were added to ${workspace} as a ${role}.`,
    memberAccess: "You can run, save and edit everything in it — including work saved before you arrived.",
    viewerAccess: "You can read everything in it, including work saved before you arrived. You cannot run or save.",
    open: "Open it",
    opening: "Opening…",
    dismiss: "Not now",
    decline: "Leave",
    declineConfirm: "Leave for good",
    declining: "Leaving…",
    cancel: "Keep it",
    declineWarning: (workspace) =>
      `Leaving ${workspace} gives up your access to it. Anything you already ran there stays — it belongs to the workspace. Only an admin can let you back in.`,
    failed: "Could not do that just now.",
  },
  ja: {
    title: "新しいワークスペース",
    addedBy: (inviter, workspace, role) => `${inviter}さんが、あなたを${workspace}に${role}として追加しました。`,
    added: (workspace, role) => `${workspace}に${role}として追加されました。`,
    memberAccess: "参加前に保存されたものも含め、すべての項目を実行・保存・編集できます。",
    viewerAccess: "参加前に保存されたものも含め、すべて閲覧できます。実行と保存はできません。",
    open: "開く",
    opening: "切り替え中…",
    dismiss: "あとで",
    decline: "退出",
    declineConfirm: "ワークスペースから退出",
    declining: "退出中…",
    cancel: "キャンセル",
    declineWarning: (workspace) =>
      `${workspace} から退出すると、アクセスできなくなります。すでに実行したものはワークスペースに残ります。再参加には管理者の招待が必要です。`,
    failed: "操作を完了できませんでした。",
  },
};

export type CommentTargetKindCopy = "run" | "notebook" | "artifact";

/**
 * Comments and mentions (proposal 9, first slice). Plain words: a comment is a
 * note one person leaves for the others, and the copy says what happens, not
 * what the feature is called. A viewer is told why there is no box to type in,
 * in the same terms INVITE_COPY used when they were added ("cannot run or save").
 */
export const COMMENTS_COPY: Record<PublicLocale, {
  title: string;
  loading: string;
  loadFailed: string;
  retry: string;
  empty: string;
  emptyWriter: string;
  viewerNote: string;
  placeholder: string;
  replyPlaceholder: string;
  post: string;
  posting: string;
  reply: string;
  edit: string;
  save: string;
  saving: string;
  cancel: string;
  delete: string;
  deleteConfirm: string;
  deleteConfirmHelp: string;
  deleting: string;
  deleted: string;
  edited: string;
  formerMember: string;
  showMore: string;
  mentionHint: string;
  suggestionsLabel: string;
  tooLong: (limit: number) => string;
  rateLimited: string;
  postFailed: string;
  editFailed: string;
  deleteFailed: string;
  parentDeleted: string;
  commentDeleted: string;
  count: (n: number) => string;
  mentionsTitle: string;
  mentionsLede: string;
  mentionsEmpty: string;
  mentionsFailed: string;
  mentionedYou: (author: string, target: CommentTargetKindCopy) => string;
  openTarget: (target: CommentTargetKindCopy) => string;
  targetKinds: Record<CommentTargetKindCopy, string>;
}> = {
  en: {
    title: "Comments",
    loading: "Loading comments…",
    loadFailed: "Could not load the comments.",
    retry: "Try again",
    empty: "No comments yet.",
    emptyWriter: "No comments yet. Leave a note for the people in this workspace.",
    viewerNote: "You can read the comments here. Viewers cannot write them.",
    placeholder: "Write a comment",
    replyPlaceholder: "Write a reply",
    post: "Comment",
    posting: "Posting…",
    reply: "Reply",
    edit: "Edit",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    delete: "Delete",
    deleteConfirm: "Delete this comment?",
    deleteConfirmHelp: "This removes it for everyone. Replies to it stay.",
    deleting: "Deleting…",
    deleted: "Comment deleted",
    edited: "edited",
    formerMember: "Former member",
    showMore: "Show more comments",
    mentionHint: "Type @ to mention someone in this workspace.",
    suggestionsLabel: "People you can mention",
    tooLong: (limit) => `Keep it under ${limit.toLocaleString("en")} characters.`,
    rateLimited: "You are posting quickly. Wait a moment, then try again.",
    postFailed: "Could not post that. Your text is still here.",
    editFailed: "Could not save your change. Your text is still here.",
    deleteFailed: "Could not delete the comment.",
    parentDeleted: "That comment was deleted, so you cannot reply to it.",
    commentDeleted: "That comment was deleted while you were editing it.",
    count: (n) => (n === 1 ? "1 comment" : `${n} comments`),
    mentionsTitle: "Mentions",
    mentionsLede: "Comments in this workspace that mention you, newest first.",
    mentionsEmpty: "Nobody has mentioned you in this workspace yet.",
    mentionsFailed: "Could not load your mentions.",
    mentionedYou: (author, target) =>
      `${author} mentioned you on a ${target === "artifact" ? "saved circuit" : target}`,
    openTarget: (target) =>
      target === "run" ? "Open the run" : target === "notebook" ? "Open the notebook" : "Open in Studio",
    targetKinds: { run: "run", notebook: "notebook", artifact: "saved circuit" },
  },
  ja: {
    title: "コメント",
    loading: "コメントを読み込み中…",
    loadFailed: "コメントを読み込めませんでした。",
    retry: "再試行",
    empty: "まだコメントはありません。",
    emptyWriter: "まだコメントはありません。このワークスペースのメンバーにメモを残せます。",
    viewerNote: "ここでコメントを読むことはできますが、閲覧者は書き込めません。",
    placeholder: "コメントを書く",
    replyPlaceholder: "返信を書く",
    post: "コメントする",
    posting: "送信中…",
    reply: "返信",
    edit: "編集",
    save: "保存",
    saving: "保存中…",
    cancel: "キャンセル",
    delete: "削除",
    deleteConfirm: "このコメントを削除しますか？",
    deleteConfirmHelp: "全員の画面から消えます。このコメントへの返信は残ります。",
    deleting: "削除中…",
    deleted: "削除されたコメント",
    edited: "編集済み",
    formerMember: "以前のメンバー",
    showMore: "さらに表示",
    mentionHint: "@ を入力すると、このワークスペースのメンバーをメンションできます。",
    suggestionsLabel: "メンションできるメンバー",
    tooLong: (limit) => `${limit.toLocaleString("ja")}文字以内にしてください。`,
    rateLimited: "短い間に続けて投稿しています。少し待ってからもう一度送信してください。",
    postFailed: "投稿できませんでした。入力した文章はそのまま残っています。",
    editFailed: "変更を保存できませんでした。入力した文章はそのまま残っています。",
    deleteFailed: "コメントを削除できませんでした。",
    parentDeleted: "そのコメントは削除されたため、返信できません。",
    commentDeleted: "編集中にそのコメントが削除されました。",
    count: (n) => `コメント ${n}件`,
    mentionsTitle: "メンション",
    mentionsLede: "このワークスペースで、あなたがメンションされたコメントです。新しい順に並んでいます。",
    mentionsEmpty: "このワークスペースでは、まだメンションされていません。",
    mentionsFailed: "メンションを読み込めませんでした。",
    mentionedYou: (author, target) =>
      `${author}さんが${target === "run" ? "実行" : target === "notebook" ? "ノートブック" : "保存した回路"}であなたをメンションしました`,
    openTarget: (target) =>
      target === "run" ? "実行を開く" : target === "notebook" ? "ノートブックを開く" : "Studioで開く",
    targetKinds: { run: "実行", notebook: "ノートブック", artifact: "保存した回路" },
  },
};

export const PRESENCE_COPY: Record<PublicLocale, {
  /** aria-label on the whole bar (role="group"): a screen reader gets the
   * full roster in one announcement, not one per avatar. */
  ariaLabel: (names: string[]) => string;
  /** Native tooltip (`title`) on one avatar. */
  viewing: (name: string) => string;
  /** Native tooltip on the "+N" overflow badge, joining the rest by name. */
  andMore: (names: string[]) => string;
}> = {
  en: {
    ariaLabel: (names) =>
      names.length === 1 ? `${names[0]} is also here` : `Also here: ${names.join(", ")}`,
    viewing: (name) => `${name} is looking at this`,
    andMore: (names) => `and ${names.join(", ")}`,
  },
  ja: {
    ariaLabel: (names) =>
      names.length === 1 ? `${names[0]}さんも見ています` : `他に見ている人: ${names.join("、")}`,
    viewing: (name) => `${name}さんがこれを見ています`,
    andMore: (names) => `他に${names.join("、")}`,
  },
};

/**
 * The "Run on hardware" card under a notebook cell that called `leona_submit`
 * (components/notebook-hardware-card.tsx). Only what the card says that Studio's
 * hardware panel does not: the device, the price table, the queue reading and every
 * refusal reason are Studio's own strings (`WORKSPACE_COPY[locale].studio.hardware*`),
 * reused so one refusal reads the same sentence in both places.
 */
export const NOTEBOOK_HARDWARE_COPY: Record<PublicLocale, {
  title: string;
  /** "bell pair · 2 qubits · 1,024 shots" — the label is optional. */
  summary: (qubits: number, shots: number, label: string | null) => string;
  nothingSent: string;
  seePrice: string;
  confirmPriced: (price: string) => string;
  confirmFree: string;
  /** A tier with a hardware ceiling: how much of it is used. */
  allowanceUsed: (used: string, limit: string, days: number) => string;
  /** A tier with no ceiling: what has been authorized, so the number is never hidden. */
  allowanceAuthorized: (amount: string, days: number) => string;
  submitPriced: (price: string) => string;
  submitFree: string;
  cancel: string;
  submitting: string;
  queued: string;
  running: string;
  done: string;
  measuredOn: (machine: string) => string;
  simulatorAbove: string;
  runAgain: string;
  tryAgain: string;
  credentialMissing: string;
  credentialLink: string;
  earlierVersion: (seq: number) => string;
}> = {
  en: {
    title: "Run on a real quantum computer",
    summary: (qubits, shots, label) =>
      `${label ? `${label} · ` : ""}${qubits === 1 ? "1 qubit" : `${qubits} qubits`} · ${shots.toLocaleString("en-US")} ${shots === 1 ? "shot" : "shots"}`,
    nothingSent: "Nothing is sent until you confirm, and you see the price first.",
    seePrice: "See the price",
    confirmPriced: (price) => `This run is estimated at ${price} on the provider's published rates.`,
    confirmFree: "This device runs on IBM's free Open Plan time, so there is no charge.",
    allowanceUsed: (used, limit, days) => `${used} of your ${limit} hardware allowance is used in the last ${days} days.`,
    allowanceAuthorized: (amount, days) => `You have authorized ${amount} of hardware time in the last ${days} days.`,
    submitPriced: (price) => `Submit for ${price}`,
    submitFree: "Submit to the free queue",
    cancel: "Cancel",
    submitting: "Sending the job…",
    queued: "Waiting in the device's queue. The result will show up here, even if you leave and come back.",
    running: "Running on the device…",
    done: "Finished.",
    measuredOn: (machine) => `Measured on ${machine}.`,
    simulatorAbove: "The simulator's output is above. This is what the device measured.",
    runAgain: "Run again",
    tryAgain: "Try again",
    credentialMissing: "To run this on hardware, connect your IBM Quantum key. Jobs go through your own IBM account.",
    credentialLink: "Add your IBM key",
    earlierVersion: (seq) => `This result is from version ${seq} of this notebook, which ran the same circuit.`,
  },
  ja: {
    title: "実機の量子コンピュータで実行",
    summary: (qubits, shots, label) =>
      `${label ? `${label}・` : ""}${qubits}量子ビット・${shots.toLocaleString("ja-JP")}ショット`,
    nothingSent: "確認するまで何も送信されません。先に料金が表示されます。",
    seePrice: "料金を確認する",
    confirmPriced: (price) => `この実行の見積もりは、プロバイダーの公表料金で${price}です。`,
    confirmFree: "このデバイスはIBMの無料枠（Open Plan）で動くため、料金はかかりません。",
    allowanceUsed: (used, limit, days) => `直近${days}日間で、実機の利用枠${limit}のうち${used}を使っています。`,
    allowanceAuthorized: (amount, days) => `直近${days}日間で${amount}分の実機利用を承認しています。`,
    submitPriced: (price) => `${price}で送信する`,
    submitFree: "無料枠で送信する",
    cancel: "キャンセル",
    submitting: "ジョブを送信しています…",
    queued: "デバイスの待ち行列に入っています。ページを離れても、結果はここに表示されます。",
    running: "デバイスで実行中です…",
    done: "完了しました。",
    measuredOn: (machine) => `${machine}で測定しました。`,
    simulatorAbove: "上はシミュレーターの出力です。こちらはデバイスで測定した結果です。",
    runAgain: "もう一度実行する",
    tryAgain: "やり直す",
    credentialMissing: "実機で実行するには、IBM QuantumのAPIキーを接続してください。ジョブはあなた自身のIBMアカウントで実行されます。",
    credentialLink: "IBMのキーを追加する",
    earlierVersion: (seq) => `この結果は、同じ回路を実行したこのノートブックのバージョン${seq}のものです。`,
  },
};

export const SHARING_COPY: Record<PublicLocale, {
  workspacesTitle: string;
  workspacesHelp: string;
  personalTag: string;
  activeTag: string;
  open: string;
  opening: string;
  createTitle: string;
  createPlaceholder: string;
  create: string;
  creating: string;
  createFailed: string;
  created: (name: string) => string;
  switchFailed: string;
  leave: string;
  leaveConfirm: string;
  leaveCancel: string;
  leaving: string;
  leaveFailed: string;
  left: (name: string) => string;
  deleteWorkspace: string;
  deleteConfirm: string;
  deleteCancel: string;
  deleting: string;
  deleteWarning: string;
  deleteFailed: string;
  deletedWorkspace: (name: string) => string;
  makeOwner: string;
  makeOwnerConfirm: (name: string) => string;
  makeOwnerCancel: string;
  transferring: string;
  transferHelp: string;
  transferFailed: string;
  transferred: (name: string) => string;
  membersTitle: string;
  membersHelp: string;
  membersShareWarning: string;
  invitePlaceholder: string;
  invite: string;
  inviting: string;
  inviteFailed: string;
  inviteUnknownAccount: string;
  invited: (email: string) => string;
  roleMember: string;
  roleViewer: string;
  roleAdmin: string;
  roleOwner: string;
  roleLabel: string;
  roleMemberHelp: string;
  roleViewerHelp: string;
  remove: string;
  removing: string;
  removeFailed: string;
  removed: (name: string) => string;
  roleChanged: (name: string) => string;
  roleChangeFailed: string;
  you: string;
  adminOnly: string;
  noMembers: string;
  sharedWith: (count: number) => string;
}> = {
  en: {
    workspacesTitle: "Workspaces",
    workspacesHelp: "Everything you run and save belongs to one workspace.",
    personalTag: "Personal",
    activeTag: "Active",
    open: "Open",
    opening: "Opening…",
    createTitle: "New shared workspace",
    createPlaceholder: "Ion trap group",
    create: "Create",
    creating: "Creating…",
    createFailed: "Could not create that workspace.",
    created: (name) => `${name} created. Open it when you are ready — you are still here for now.`,
    switchFailed: "Could not switch workspace.",
    leave: "Leave",
    leaveConfirm: "Leave for good",
    leaveCancel: "Stay",
    leaving: "Leaving…",
    leaveFailed: "Could not leave that workspace.",
    left: (name) => `You have left ${name}. Anything you ran there stays — it belongs to the workspace. Only an admin can let you back in.`,
    deleteWorkspace: "Delete",
    deleteConfirm: "Delete for good",
    deleteCancel: "Keep it",
    deleting: "Deleting…",
    deleteWarning:
      "Deleting a workspace takes it away from everyone in it, along with every run and saved artifact it holds. You cannot undo this here.",
    deleteFailed: "Could not delete that workspace.",
    deletedWorkspace: (name) => `${name} is gone. Everyone who was in it has been returned to their own workspace.`,
    makeOwner: "Make owner",
    makeOwnerConfirm: (name) => `Hand it to ${name}`,
    makeOwnerCancel: "Cancel",
    transferring: "Handing over…",
    transferHelp: "Only the owner can delete or hand over a workspace. After handing over, you stay as an admin.",
    transferFailed: "Could not hand the workspace over.",
    transferred: (name) => `${name} owns this workspace now. You are an admin of it, and you can leave whenever you like.`,
    membersTitle: "Members",
    membersHelp: "People who can act in the workspace you have open.",
    membersShareWarning: "Members see every run and saved artifact here, including earlier ones; viewers can read but not run or save.",
    invitePlaceholder: "colleague@university.edu",
    invite: "Invite",
    inviting: "Inviting…",
    inviteFailed: "Could not add that person.",
    inviteUnknownAccount:
      "No account here uses that address yet. Ask them to sign in once, then invite them again.",
    invited: (email) => `${email} can now open this workspace.`,
    roleMember: "Member",
    roleViewer: "Viewer",
    roleAdmin: "Admin",
    roleOwner: "Owner",
    roleLabel: "Role",
    roleMemberHelp: "Can run, save and edit.",
    roleViewerHelp: "Can read everything; cannot run or save.",
    remove: "Remove",
    removing: "Removing…",
    removeFailed: "Could not remove that person.",
    removed: (name) => `${name} no longer has access. Their runs and artifacts stay here.`,
    roleChanged: (name) => `${name}'s role was changed.`,
    roleChangeFailed: "Could not change that role.",
    you: "You",
    adminOnly: "Only an owner or admin can invite and remove people.",
    noMembers: "No one else is in this workspace.",
    sharedWith: (count) => (count === 1 ? "1 person" : `${count} people`),
  },
  ja: {
    workspacesTitle: "ワークスペース",
    workspacesHelp: "実行と保存はすべて、いずれかのワークスペースに属します。",
    personalTag: "個人",
    activeTag: "使用中",
    open: "開く",
    opening: "切り替え中…",
    createTitle: "共有ワークスペースを作成",
    createPlaceholder: "イオントラップ班",
    create: "作成",
    creating: "作成中…",
    createFailed: "ワークスペースを作成できませんでした。",
    created: (name) => `${name} を作成しました。現在のワークスペースは切り替わっていません。`,
    switchFailed: "ワークスペースを切り替えられませんでした。",
    leave: "退出",
    leaveConfirm: "退出する",
    leaveCancel: "キャンセル",
    leaving: "退出中…",
    leaveFailed: "退出できませんでした。",
    left: (name) => `${name} から退出しました。実行したものはワークスペースに残ります。再参加には管理者の招待が必要です。`,
    deleteWorkspace: "削除",
    deleteConfirm: "完全に削除する",
    deleteCancel: "キャンセル",
    deleting: "削除中…",
    deleteWarning:
      "ワークスペースを削除すると、参加者全員がアクセスできなくなり、保存された実行結果や回路もすべて削除されます。この操作は取り消せません。",
    deleteFailed: "ワークスペースを削除できませんでした。",
    deletedWorkspace: (name) => `${name} を削除しました。参加していた全員が自分のワークスペースに戻ります。`,
    makeOwner: "オーナーにする",
    makeOwnerConfirm: (name) => `${name} に譲渡する`,
    makeOwnerCancel: "やめる",
    transferring: "譲渡中…",
    transferHelp: "削除と譲渡ができるのはオーナーだけです。譲渡後は管理者として残ります。",
    transferFailed: "オーナーを変更できませんでした。",
    transferred: (name) => `${name} がこのワークスペースのオーナーになりました。あなたは管理者で、いつでも退出できます。`,
    membersTitle: "メンバー",
    membersHelp: "現在のワークスペースにアクセスできるメンバーです。",
    membersShareWarning: "メンバーは過去のものを含むすべての実行結果と保存済み回路を見られます。閲覧者は見るだけで、実行や保存はできません。",
    invitePlaceholder: "colleague@university.edu",
    invite: "招待",
    inviting: "招待中…",
    inviteFailed: "メンバーを追加できませんでした。",
    inviteUnknownAccount:
      "このアドレスのアカウントはまだありません。一度サインインしてもらってから、もう一度招待してください。",
    invited: (email) => `${email} がこのワークスペースを開けるようになりました。`,
    roleMember: "メンバー",
    roleViewer: "閲覧者",
    roleAdmin: "管理者",
    roleOwner: "オーナー",
    roleLabel: "権限",
    roleMemberHelp: "実行・保存・編集ができます。",
    roleViewerHelp: "すべて閲覧できますが、実行・保存はできません。",
    remove: "メンバーから外す",
    removing: "メンバーから外しています…",
    removeFailed: "メンバーから外せませんでした。",
    removed: (name) => `${name} のアクセスを解除しました。これまでの実行結果と保存済み回路はワークスペースに残ります。`,
    roleChanged: (name) => `${name} の権限を変更しました。`,
    roleChangeFailed: "権限を変更できませんでした。",
    you: "あなた",
    adminOnly: "招待と削除ができるのはオーナーと管理者だけです。",
    noMembers: "このワークスペースには他に誰もいません。",
    sharedWith: (count) => `${count}人`,
  },
};

/**
 * Project sharing (migration 0042). Separate from `SHARING_COPY`, which is about
 * WORKSPACE membership.
 *
 * The two are not one block on purpose, and the reason is the same one that
 * keeps Run's *Folders* and Studio's *Projects* apart: they are different words
 * for different things, and the last time two surfaces borrowed one another's
 * sentences a locale key stopped rendering a whole section. A member of your
 * workspace sees everything in it; someone a project is shared with sees one
 * project and nothing else, and the copy has to be able to say so without
 * hedging around a shared string.
 */
export const PROJECT_SHARE_COPY: Record<PublicLocale, {
  share: string;
  shareProject: (name: string) => string;
  title: (name: string) => string;
  help: string;
  outsideWarning: string;
  emailLabel: string;
  emailPlaceholder: string;
  roleLabel: string;
  roleViewer: string;
  roleEditor: string;
  roleViewerHelp: string;
  roleEditorHelp: string;
  expiryLabel: string;
  expiryNever: string;
  expiresOn: (date: string) => string;
  expiringSoon: (date: string) => string;
  expired: string;
  grant: string;
  granting: string;
  granted: (email: string) => string;
  grantFailed: string;
  loading: string;
  nobody: string;
  peopleWithAccess: string;
  invitedBy: (email: string) => string;
  remove: string;
  removing: string;
  removeFailed: string;
  removed: (email: string) => string;
  stopAll: string;
  stopAllConfirm: (count: number) => string;
  stopAllCancel: string;
  close: string;
  adminOnly: string;
  /** The caller's own plan does not include sharing. Keyed off the control
   *  plane's `project_sharing_not_in_plan`, never off its English sentence. */
  needsTeamPlan: string;
  /** Shown on the disabled share control, before anything is attempted. */
  needsTeamPlanHint: string;
  deleteWarning: (count: number) => string;
  sharedWithMe: string;
  sharedWithMeEmpty: string;
  sharedBy: (name: string) => string;
  fromWorkspace: (name: string) => string;
  circuits: (count: number) => string;
  open: string;
  readOnlyTag: string;
  canEditTag: string;
  copyHere: string;
  copying: string;
  copied: (title: string) => string;
  copyFailed: string;
  save: string;
  saving: string;
  saved: string;
  saveFailed: string;
  conflictTitle: string;
  conflictBody: string;
  reloadTheirs: string;
  changedElsewhere: string;
  refresh: string;
  loadFailed: string;
  noCircuits: string;
  backToStudio: string;
  addCircuit: string;
  addCircuitTitleLabel: string;
  addCircuitTitlePlaceholder: string;
  addCircuitCodeLabel: string;
  addCircuitSubmit: string;
  addCircuitSubmitting: string;
  addCircuitCancel: string;
  added: (title: string) => string;
  addFailed: string;
  roomLeft: (used: number, limit: number) => string;
  projectFull: string;
  limitLabel: string;
  limitHelp: string;
  limitZeroHelp: string;
  limitSaved: (limit: number) => string;
  limitFailed: string;
  /** Leaving a project somebody shared with you. Never offered to the owner —
   *  this whole block belongs to the grantee's view. */
  leave: string;
  leaveConfirm: string;
  leaveCancel: string;
  leaving: string;
  leaveFailed: string;
  /** Says what leaving does NOT do, because the reasonable fear is that work
   *  contributed into the project goes with it. It does not. */
  leaveHelp: string;
}> = {
  en: {
    share: "Share",
    shareProject: (name) => `Share ${name}`,
    title: (name) => `Share “${name}”`,
    help: "The people below can open this project's circuits. They see nothing else in this workspace.",
    outsideWarning:
      "Sharing reaches outside this workspace. Anyone here can read every circuit filed under this project, including ones you add later.",
    emailLabel: "Email address",
    emailPlaceholder: "colleague@university.edu",
    roleLabel: "They can",
    roleViewer: "Read",
    roleEditor: "Read and edit",
    roleViewerHelp: "Open the circuits and their history. Nothing they do changes anything here.",
    roleEditorHelp:
      "Open the circuits and save new versions of them. They still cannot rename, delete or publish anything.",
    expiryLabel: "Access ends",
    expiryNever: "Never",
    expiresOn: (date) => `Access ends ${date}`,
    expiringSoon: (date) => `Access ends ${date} — soon`,
    expired: "Access has ended",
    grant: "Share",
    granting: "Sharing…",
    granted: (email) => `${email} can now open this project.`,
    grantFailed: "This project could not be shared.",
    loading: "Reading who has access…",
    nobody: "This project is not shared with anyone.",
    peopleWithAccess: "People with access",
    invitedBy: (email) => `Shared by ${email}`,
    remove: "Remove access",
    removing: "Removing…",
    removeFailed: "Access could not be removed.",
    removed: (email) => `${email} can no longer open this project.`,
    stopAll: "Stop sharing with everyone",
    stopAllConfirm: (count) =>
      count === 1
        ? "One person loses access to this project. Continue?"
        : `${count} people lose access to this project. Continue?`,
    stopAllCancel: "Keep sharing",
    close: "Close",
    adminOnly: "Only an owner or admin can share a project.",
    needsTeamPlan: "Sharing a project with someone outside your workspace is part of the Team plan. Your current plan does not include it.",
    needsTeamPlanHint: "Sharing projects is part of the Team plan",
    deleteWarning: (count) =>
      count === 1
        ? "One person outside this workspace loses access when this project is deleted."
        : `${count} people outside this workspace lose access when this project is deleted.`,
    sharedWithMe: "Shared with me",
    sharedWithMeEmpty: "Nothing has been shared with you yet.",
    sharedBy: (name) => `Shared by ${name}`,
    fromWorkspace: (name) => `from ${name}`,
    circuits: (count) => (count === 1 ? "1 circuit" : `${count} circuits`),
    open: "Open",
    readOnlyTag: "Read only",
    canEditTag: "You can edit",
    copyHere: "Save a copy to my workspace",
    copying: "Copying…",
    copied: (title) => `${title} is now in your Studio. It carries no verification evidence of its own — re-run it.`,
    copyFailed: "That circuit could not be copied.",
    save: "Save",
    saving: "Saving…",
    saved: "Saved.",
    saveFailed: "That edit could not be saved.",
    conflictTitle: "Somebody else saved first",
    conflictBody:
      "This circuit changed while you were editing it. Open what they saved before replacing it — your text is still here.",
    reloadTheirs: "Open theirs",
    changedElsewhere: "This project changed since you opened it.",
    refresh: "Refresh",
    loadFailed: "This shared project could not be opened. The share may have been withdrawn.",
    noCircuits: "There are no circuits in this project yet.",
    backToStudio: "Back to Studio",
    addCircuit: "Add a circuit",
    addCircuitTitleLabel: "Name",
    addCircuitTitlePlaceholder: "GHZ state, 4 qubits",
    addCircuitCodeLabel: "Code",
    addCircuitSubmit: "Add to this project",
    addCircuitSubmitting: "Adding…",
    addCircuitCancel: "Cancel",
    added: (title) => `“${title}” was added to this project.`,
    addFailed: "That circuit could not be added.",
    roomLeft: (used, limit) => `${used} of ${limit} circuits`,
    projectFull: "This project is full. Its owner can raise the limit or remove a circuit.",
    limitLabel: "Circuits people you share with may add",
    limitHelp:
      "Anything added counts against this workspace's own artifact allowance, so this is the ceiling on what a share can spend.",
    limitZeroHelp: "Set to 0, so people you share with can edit these circuits but not add any.",
    limitSaved: (limit) => `Shares may grow this project to ${limit} circuits.`,
    limitFailed: "That limit could not be saved.",
    leave: "Leave project",
    leaveConfirm: "Leave this project?",
    leaveCancel: "Stay",
    leaving: "Leaving…",
    leaveFailed: "You could not be removed from this project.",
    leaveHelp:
      "You lose access to these circuits. Anything you added stays with the project, and its owner can share it with you again.",
  },
  ja: {
    share: "共有",
    shareProject: (name) => `${name} を共有`,
    title: (name) => `「${name}」を共有`,
    help: "以下の人はこのプロジェクトの回路を開けます。このワークスペースの他のものは見えません。",
    outsideWarning:
      "共有はこのワークスペースの外に及びます。ここに追加した人は、このプロジェクトに入っている回路をすべて閲覧できます。後から追加した回路も含みます。",
    emailLabel: "メールアドレス",
    emailPlaceholder: "colleague@university.edu",
    roleLabel: "できること",
    roleViewer: "閲覧",
    roleEditor: "閲覧と編集",
    roleViewerHelp: "回路とその履歴を開けます。こちらの内容は一切変わりません。",
    roleEditorHelp:
      "回路を開き、新しいバージョンを保存できます。名前の変更・削除・公開はできません。",
    expiryLabel: "アクセス期限",
    expiryNever: "なし",
    expiresOn: (date) => `${date} にアクセスが終了します`,
    expiringSoon: (date) => `${date} にアクセスが終了します — まもなくです`,
    expired: "アクセスは終了しました",
    grant: "共有する",
    granting: "共有中…",
    granted: (email) => `${email} がこのプロジェクトを開けるようになりました。`,
    grantFailed: "このプロジェクトを共有できませんでした。",
    loading: "アクセスできる人を読み込んでいます…",
    nobody: "このプロジェクトはまだ誰とも共有されていません。",
    peopleWithAccess: "アクセスできる人",
    invitedBy: (email) => `${email} が共有`,
    remove: "アクセスを解除",
    removing: "解除中…",
    removeFailed: "アクセスを解除できませんでした。",
    removed: (email) => `${email} はこのプロジェクトを開けなくなりました。`,
    stopAll: "全員との共有をやめる",
    stopAllConfirm: (count) => `${count}人がこのプロジェクトを開けなくなります。続けますか？`,
    stopAllCancel: "共有を続ける",
    close: "閉じる",
    adminOnly: "プロジェクトを共有できるのはオーナーと管理者だけです。",
    needsTeamPlan: "ワークスペース外の相手への共有は Team プランの機能です。現在のプランには含まれていません。",
    needsTeamPlanHint: "プロジェクトの共有は Team プランの機能です",
    deleteWarning: (count) =>
      `このプロジェクトを削除すると、ワークスペース外の${count}人がアクセスできなくなります。`,
    sharedWithMe: "共有されたもの",
    sharedWithMeEmpty: "まだ何も共有されていません。",
    sharedBy: (name) => `${name} が共有`,
    fromWorkspace: (name) => `${name} より`,
    circuits: (count) => `回路 ${count} 件`,
    open: "開く",
    readOnlyTag: "閲覧のみ",
    canEditTag: "編集できます",
    copyHere: "自分のワークスペースに複製",
    copying: "複製中…",
    copied: (title) => `${title} を Studio に複製しました。検証の記録は引き継がれません — 実行し直してください。`,
    copyFailed: "この回路を複製できませんでした。",
    save: "保存",
    saving: "保存中…",
    saved: "保存しました。",
    saveFailed: "この編集を保存できませんでした。",
    conflictTitle: "他の人が先に保存しました",
    conflictBody:
      "編集中にこの回路が変更されました。上書きする前に、保存された内容を確認してください。入力した内容は残っています。",
    reloadTheirs: "保存された内容を開く",
    changedElsewhere: "開いてからこのプロジェクトが変更されました。",
    refresh: "再読み込み",
    loadFailed: "この共有プロジェクトを開けませんでした。共有が解除された可能性があります。",
    noCircuits: "このプロジェクトにはまだ回路がありません。",
    backToStudio: "Studio に戻る",
    addCircuit: "回路を追加",
    addCircuitTitleLabel: "名前",
    addCircuitTitlePlaceholder: "GHZ状態・4量子ビット",
    addCircuitCodeLabel: "コード",
    addCircuitSubmit: "このプロジェクトに追加",
    addCircuitSubmitting: "追加中…",
    addCircuitCancel: "キャンセル",
    added: (title) => `「${title}」をこのプロジェクトに追加しました。`,
    addFailed: "この回路を追加できませんでした。",
    roomLeft: (used, limit) => `${limit}件中${used}件の回路`,
    projectFull:
      "このプロジェクトは上限に達しています。上限の引き上げまたは回路の削除は所有者のみ行えます。",
    limitLabel: "共有相手が追加できる回路数",
    limitHelp:
      "追加された回路はこのワークスペースのアーティファクト上限を消費します。共有によって使われる量の上限です。",
    limitZeroHelp: "0 の場合、共有相手は既存の回路を編集できますが、追加はできません。",
    limitSaved: (limit) => `共有相手はこのプロジェクトを${limit}件まで増やせます。`,
    limitFailed: "上限を保存できませんでした。",
    leave: "このプロジェクトから抜ける",
    leaveConfirm: "このプロジェクトから抜けますか？",
    leaveCancel: "そのまま残る",
    leaving: "処理中…",
    leaveFailed: "このプロジェクトから抜けられませんでした。",
    leaveHelp:
      "これらの回路にはアクセスできなくなります。あなたが追加した回路はプロジェクトに残り、所有者が再度共有することもできます。",
  },
};

// ---- Guided tours (TUTORIAL.md, ai-ops 298) --------------------------------
// Every word the tour guide says, English and Japanese side by side. Step copy
// is keyed `track.step`; lib/tour/targets.test.ts fails if a step lacks either
// language. Kept at the end of the file so parallel edits above do not collide.
import type { TourShowId, TourTrackId } from "./tour/types";

export type TourStepCopy = {
  title: string;
  action: string;
  /** Said when the reader clicks the step's `wrongTarget` instead. */
  wrong?: string;
  /** What "Do it for me" types into the field. */
  fill?: string;
};

export type TourPlaceKey = "run" | "studio" | "notebooks" | "courses" | "qapps" | "atlas" | "settings" | "workspace";

export type ToursCopy = {
  name: string;
  helpButton: string;
  invite: { label: string; line: string; start: string; choose: string; notNow: string };
  chooser: {
    title: string;
    lede: string;
    tracks: string;
    showMe: string;
    showMeLede: string;
    start: string;
    resume: string;
    restart: string;
    done: string;
    progress: (step: number, total: number) => string;
    minutes: (count: number) => string;
    close: string;
  };
  tracks: Record<TourTrackId, { title: string; forWhom: string; keeps: string }>;
  shows: Record<TourShowId, string>;
  card: {
    label: string;
    stepOf: (step: number, total: number) => string;
    back: string;
    next: string;
    finish: string;
    skipTour: string;
    skipStep: string;
    doItForMe: string;
    takeMeThere: string;
    backToTour: string;
    pause: string;
    resume: string;
    paused: string;
    close: string;
    finished: (title: string) => string;
    chooseAnother: string;
    skipAhead: string;
    ask: string;
    hideAsk: string;
  };
  status: {
    success: string;
    notQuite: (thing: string) => string;
    notQuiteGeneric: string;
    nudge: string;
    ownPrompt: string;
    ownValue: string;
    wandered: (place: string) => string;
    away: (place: string) => string;
    hidden: string;
    covered: string;
    offline: string;
    offlineSkipped: (count: number) => string;
    doing: string;
    working: string;
  };
  places: Record<TourPlaceKey, string>;
  targets: Record<string, string>;
  ask: {
    label: string;
    placeholder: string;
    submit: string;
    match: (title: string) => string;
    showMe: string;
    noMatch: string;
    askNala: string;
    cost: string;
    asking: string;
    answered: string;
    openAnswer: string;
    notReady: string;
    offline: string;
    failed: string;
    context: (tour: string, step: string, question: string) => string;
  };
  settings: { label: string; lede: string; perDevice: string; showMe: string; inviteAgain: string; inviteAgainDone: string };
  steps: Record<string, TourStepCopy>;
};

export const TOURS_COPY: Record<PublicLocale, ToursCopy> = {
  en: {
    name: "Guided tours",
    helpButton: "Guided tours and help",
    invite: {
      label: "Guided tour",
      line: "New here? A three-minute look around?",
      start: "Start",
      choose: "Choose a track",
      notNow: "Not now",
    },
    chooser: {
      title: "Guided tours",
      lede: "Each tour runs on the real workspace. Leave at any step and pick up where you stopped.",
      tracks: "Tours",
      showMe: "Show me",
      showMeLede: "Each one takes about thirty seconds.",
      start: "Start",
      resume: "Resume",
      restart: "Start again",
      done: "Done",
      progress: (step, total) => `Step ${step} of ${total}`,
      minutes: (count) => `${count} min`,
      close: "Close",
    },
    tracks: {
      around: { title: "Around the workspace", forWhom: "For everyone: where things are.", keeps: "Nothing to keep, but you will know your way around." },
      "first-light": { title: "First light", forWhom: "New to quantum computing.", keeps: "A saved Bell-state circuit." },
      build: { title: "Build", forWhom: "You want to develop algorithms.", keeps: "A versioned circuit, rewritten in Cirq and simulated." },
      teach: { title: "Teach", forWhom: "You teach a class or a course.", keeps: "A lesson and a course plan." },
      read: { title: "Read", forWhom: "You want to explore the Atlas.", keeps: "Nothing to keep, but you will know how to read an entry." },
    },
    shows: {
      "show-cirq": "Convert code to Cirq",
      "show-visual": "Edit a circuit visually",
      "show-simulate": "Simulate a circuit",
      "show-export": "Export OpenQASM",
      "show-mode": "Choose how Nala answers",
      "show-framework": "Pick a framework",
      "show-attach": "Attach a file",
      "show-usage": "Check usage and limits",
      "show-theme": "Change theme or language",
      "show-lesson": "Make a lesson",
      "show-qapp": "Make a Qapp",
      "show-atlas": "Search the Atlas",
    },
    card: {
      label: "Tour guide",
      stepOf: (step, total) => `${step} of ${total}`,
      back: "Back",
      next: "Next",
      finish: "Finish",
      skipTour: "Skip tour",
      skipStep: "Skip this step",
      doItForMe: "Do it for me",
      takeMeThere: "Take me there",
      backToTour: "Back to the tour",
      pause: "Pause here",
      resume: "Resume",
      paused: "Tour paused",
      close: "Close",
      finished: (title) => `That's the end of ${title}.`,
      chooseAnother: "Choose another",
      skipAhead: "Skip ahead",
      ask: "Ask a question",
      hideAsk: "Hide",
    },
    status: {
      success: "That's it.",
      notQuite: (thing) => `That's the ${thing}. Try the highlighted one.`,
      notQuiteGeneric: "Not that one. Try the highlighted control.",
      nudge: "Take your time. When you're ready, it's the highlighted control.",
      ownPrompt: "You wrote your own prompt. Good, the tour will follow yours.",
      ownValue: "You typed your own. That works too.",
      wandered: (place) => `You're on ${place} now. Go back to the tour, or pause here?`,
      away: (place) => `Next stop: ${place}.`,
      hidden: "That control isn't on screen at this window size. You can skip this step.",
      covered: "Something is open on top of this step. Close it to carry on.",
      offline: "This step needs the workspace online, so it's skipped here.",
      offlineSkipped: (count) => (count === 1 ? "Skipped one step that needs the workspace online." : `Skipped ${count} steps that need the workspace online.`),
      doing: "Doing it for you.",
      working: "Waiting for it to appear.",
    },
    places: {
      run: "Run",
      studio: "Studio",
      notebooks: "Notebooks",
      courses: "Courses",
      qapps: "Qapps",
      atlas: "the Atlas",
      settings: "Settings",
      workspace: "another page",
    },
    targets: {
      "rail-run": "Run link",
      "rail-studio": "Studio link",
      "rail-notebooks": "Notebooks link",
      "rail-qapps": "Qapps link",
      "rail-atlas": "Atlas link",
      "sidebar-search": "search box",
      "sidebar-new-chat": "New chat button",
      "sidebar-projects": "projects list",
      "account-menu": "account menu",
      "menu-usage": "usage link",
      "menu-settings": "Settings link",
      "tour-help": "help button",
      "run-starter-bell": "Bell state starter",
      "run-starter": "other starter",
      "run-prompt": "message box",
      "run-mode": "response mode picker",
      "run-framework": "framework picker",
      "run-submit": "Send button",
      "run-attach": "attach button",
      "run-activity": "run's progress",
      "run-final-output": "result",
      "run-artifact-link": "Studio link",
      "studio-tab-code": "Code tab",
      "studio-tab-visual": "Visual tab",
      "studio-tab-simulation": "Simulation tab",
      "studio-tab-summary": "Summary tab",
      "studio-framework": "framework picker",
      "studio-builder": "gate palette",
      "studio-compress": "compression panel",
      "studio-simulation-panel": "simulation panel",
      "studio-qpu": "hardware lane",
      "studio-download-export": "Download export button",
      "studio-verify-save": "Verify & save button",
      "studio-split": "Code beside diagram button",
      "studio-playhead": "probabilities panel",
      "studio-cpu-run": "last CPU run line",
      "studio-shortcuts": "shortcuts button",
      "notebooks-brief": "brief box",
      "notebooks-starters": "ready-made briefs",
      "notebooks-options": "Notebook options",
      "notebooks-fields": "notebook settings",
      "notebooks-create": "Create notebook button",
      "notebooks-courses": "Courses link",
      "courses-composer": "course planner",
      "qapps-create-run": "Create in Run button",
      "atlas-search": "search box",
      "atlas-filters": "filter menus",
      "atlas-entry-link": "entry",
      "atlas-entry-topics": "topics",
      "atlas-entry-source": "source link",
      "atlas-entry-map": "map link",
      "atlas-views": "Atlas views",
    },
    ask: {
      label: "Ask about this page",
      placeholder: "For example: how do I export OpenQASM?",
      submit: "Ask",
      match: (title) => `There's a short walkthrough for that: ${title}.`,
      showMe: "Show me",
      noMatch: "There's no walkthrough for that yet.",
      askNala: "Ask Nala",
      cost: "Starts a chat with Nala in Run. It counts toward your plan's usage.",
      asking: "Nala is answering…",
      answered: "Nala says:",
      openAnswer: "Open the full answer",
      notReady: "The answer is still being written. It will be in your chats.",
      offline: "Asking Nala needs the workspace online.",
      failed: "Nala couldn't answer that just now.",
      context: (tour, step, question) => `I'm on the guided tour "${tour}", at the step "${step}". In a few sentences: ${question}`,
    },
    settings: {
      label: "Guided tours",
      lede: "A guide walks you through the workspace. Tours use the real product, and you can stop at any step.",
      perDevice: "Progress is saved in this browser.",
      showMe: "Show me",
      inviteAgain: "Show the welcome prompt again",
      inviteAgainDone: "It will appear the next time you open Run.",
    },
    steps: {
      "around.rail": { title: "The rail", action: "Run, Studio, Notebooks, Qapps and the Atlas are each one click from here. Run is where you ask Nala for code." },
      "around.search": { title: "Search", action: "Finds chats and saved circuits by name." },
      "around.new-chat": { title: "New chat", action: "Starts a fresh conversation. Recent chats and folders are listed below it." },
      "around.account": { title: "Your account", action: "Open the menu at the bottom of the rail." },
      "around.usage": { title: "Usage and limits", action: "Shows how much of your plan is left and when it resets." },
      "around.settings": { title: "Settings", action: "Open Settings." },
      "around.preferences": { title: "Preferences", action: "Theme, accent colour and language are here." },
      "around.tours": { title: "Guided tours", action: "Restart any tour here, or from the ? at the top of the page. Theme and language are under Preferences." },

      "first-light.hello": { title: "First light", action: "You build a circuit on two qubits and see a real result. It takes about four minutes and needs no maths." },
      "first-light.starter": { title: "A Bell state", action: "The simplest thing two qubits can do together. Press Build a Bell state.", wrong: "That one is for later. Build a Bell state is the first button in the row." },
      "first-light.run": { title: "Run it", action: "The prompt is in the box now, and you can change it. Press Send: Nala plans the circuit, writes the code and checks the result." },
      "first-light.watch": { title: "Watch it work", action: "Each line is a stage: plan, code, checks. It usually takes under a minute." },
      "first-light.answer": { title: "The result", action: "A Bell state measures as 00 or 11, about half the time each, and almost never 01 or 10. That pairing is entanglement." },
      "first-light.saved": { title: "Keep it", action: "Keep the result if it asks, then open it in Studio." },
      "first-light.visual": { title: "See the circuit", action: "Open the Visual tab. It draws the circuit as gates on wires." },
      "first-light.gates": { title: "Two gates", action: "A Bell state needs two. H puts the first qubit into an even mix of 0 and 1. CNOT ties the second qubit to it, so the two always agree." },

      "build.mode": { title: "Response mode", action: "Execute writes code and runs it. Auto lets Nala decide from your message. Choose Execute.", wrong: "That's the framework picker. Response mode is the one to its left." },
      "build.framework": { title: "Circuit framework", action: "The library the code is written in. Qiskit is the default; Cirq, PennyLane and others are in the list." },
      "build.prompt": { title: "Describe the algorithm", action: "Say what to solve and how to check it. For example: QAOA for MaxCut on a 5-node ring, compared with the exact answer.", fill: "Use QAOA to solve MaxCut on a 5-node ring and compare it with an exact classical baseline." },
      "build.run": { title: "Run it", action: "Press Send. The plan comes first, then the code." },
      "build.plan": { title: "Plan and contract", action: "The plan names the algorithm and why it was chosen. The contract says what the result has to show to count." },
      "build.result": { title: "RESULT", action: "What the code measured, checked against the contract. The mark shows whether it passed." },
      "build.studio": { title: "Open in Studio", action: "Each run's circuit is saved with its versions. Keep it if asked, then open it in Studio." },
      "build.code": { title: "Code", action: "Open the Code tab. Keys 1 to 4 switch between the four tabs." },
      "build.convert": { title: "Convert to Cirq", action: "Choose Cirq here. Studio rewrites the circuit in Cirq." },
      "build.visual": { title: "Visual builder", action: "Open the Visual tab. The palette above the diagram groups gates by kind: pick a gate, then click a wire to place it." },
      "build.playhead": { title: "Probabilities", action: "The playhead steps through the circuit one moment at a time and shows the probabilities after each. The [ and ] keys move it too." },
      "build.split": { title: "Code beside diagram", action: "Turn this on to edit the code with the diagram next to it." },
      "build.simulation": { title: "Simulation", action: "Open the Simulation tab. The CPU lane simulates in this browser, within your plan's qubit limit. Running the code for real happens in an isolated sandbox." },
      "build.summary": { title: "Summary", action: "Open the Summary tab. The evidence and every saved version are here." },
      "build.export": { title: "Export", action: "Download export gives you the code, with OpenQASM where the circuit has it." },
      "build.save": { title: "Verify & save", action: "Checks the code in the sandbox and saves a new version." },

      "teach.brief": { title: "What to teach", action: "Describe the lesson. For example: Grover's search for first-year undergraduates.", fill: "Grover's search for first-year undergraduates" },
      "teach.options": { title: "Kind and level", action: "Open Notebook options." },
      "teach.fields": { title: "Lesson, lab or quiz", action: "Kind sets the format. Audience and Math set the level. Language can be English or Japanese." },
      "teach.create": { title: "Create", action: "Press Create notebook. Exercises in the notebook check answers on their own." },
      "teach.courses": { title: "Courses", action: "A course puts lessons and quizzes in order. Open Courses." },
      "teach.course": { title: "Plan a course", action: "Describe the course and Nala proposes the modules. You review them before anything is written." },
      "teach.qapps": { title: "A classroom demo", action: "A Qapp turns a circuit into a page students can use. Make one from Run, or from a circuit in Studio." },
      "teach.make": { title: "Make one", action: "Start from Run, or from a circuit in Studio." },

      "read.search": { title: "Search the Atlas", action: "Search by method, problem or paper. Try: phase estimation.", fill: "phase estimation" },
      "read.filters": { title: "Narrow it down", action: "These menus filter by topic and more. The address changes with them, so a filtered view can be shared." },
      "read.entry": { title: "Open an entry", action: "Pick any entry in the list." },
      "read.source": { title: "Source", action: "Every entry names the paper it comes from. Its topics link to everything else on the same subject." },
      "read.map": { title: "On the map", action: "Open on the map shows where this method sits among the others." },

      "show-mode.mode": { title: "Response mode", action: "Auto lets Nala decide from your message. Execute always writes and runs code. Learn and Explain answer in words without running anything. Qapp builds an interactive page." },
      "show-attach.attach": { title: "Attach files", action: "Add code or notes to your message. Nala reads them along with what you type." },
    },
  },
  ja: {
    name: "ガイドツアー",
    helpButton: "ガイドツアーとヘルプ",
    invite: {
      label: "ガイドツアー",
      line: "はじめてですか？3分でワークスペースをご案内します。",
      start: "始める",
      choose: "ツアーを選ぶ",
      notNow: "今はしない",
    },
    chooser: {
      title: "ガイドツアー",
      lede: "ツアーは実際のワークスペースで進みます。どのステップでも中断でき、続きから再開できます。",
      tracks: "ツアー",
      showMe: "操作を見る",
      showMeLede: "どれも30秒ほどで終わります。",
      start: "始める",
      resume: "続きから",
      restart: "最初から",
      done: "完了",
      progress: (step, total) => `ステップ ${step}/${total}`,
      minutes: (count) => `${count}分`,
      close: "閉じる",
    },
    tracks: {
      around: { title: "ワークスペース案内", forWhom: "すべての方へ。どこに何があるか。", keeps: "保存するものはありません。迷わず操作できるようになります。" },
      "first-light": { title: "はじめての量子", forWhom: "量子コンピューティングが初めての方へ。", keeps: "保存したBell状態の回路。" },
      build: { title: "開発", forWhom: "アルゴリズムを開発したい方へ。", keeps: "Cirqに書き換えてシミュレーションした、バージョン管理された回路。" },
      teach: { title: "教える", forWhom: "授業や講座を担当する方へ。", keeps: "レッスンとコースの計画。" },
      read: { title: "読む", forWhom: "アトラスを調べたい方へ。", keeps: "保存するものはありませんが、項目の読み方がわかります。" },
    },
    shows: {
      "show-cirq": "コードをCirqに変換",
      "show-visual": "回路を図で編集",
      "show-simulate": "回路をシミュレーション",
      "show-export": "OpenQASMを書き出す",
      "show-mode": "Nalaの応答方法を選ぶ",
      "show-framework": "フレームワークを選ぶ",
      "show-attach": "ファイルを添付",
      "show-usage": "使用状況と上限を確認",
      "show-theme": "テーマや言語を変更",
      "show-lesson": "レッスンを作る",
      "show-qapp": "Qappを作る",
      "show-atlas": "アトラスを検索",
    },
    card: {
      label: "ツアーガイド",
      stepOf: (step, total) => `${step}/${total}`,
      back: "戻る",
      next: "次へ",
      finish: "完了",
      skipTour: "ツアーを終了",
      skipStep: "このステップを飛ばす",
      doItForMe: "代わりに操作する",
      takeMeThere: "移動する",
      backToTour: "ツアーに戻る",
      pause: "ここで一時停止",
      resume: "再開",
      paused: "ツアーを一時停止中",
      close: "閉じる",
      finished: (title) => `「${title}」はここまでです。`,
      chooseAnother: "別のツアーを選ぶ",
      skipAhead: "先へ進む",
      ask: "質問する",
      hideAsk: "閉じる",
    },
    status: {
      success: "できました。",
      notQuite: (thing) => `それは${thing}です。光っている部分を操作してください。`,
      notQuiteGeneric: "そこではありません。光っている部分を操作してください。",
      nudge: "ゆっくりで大丈夫です。準備ができたら、光っている部分を操作してください。",
      ownPrompt: "ご自身でプロンプトを書きましたね。ツアーはその内容で進めます。",
      ownValue: "ご自身の入力でも大丈夫です。",
      wandered: (place) => `今は${place}にいます。ツアーに戻りますか？それともここで一時停止しますか？`,
      away: (place) => `次は${place}です。`,
      hidden: "この画面幅ではその操作が表示されていません。このステップは飛ばせます。",
      covered: "このステップの上に別の画面が開いています。閉じると続けられます。",
      offline: "このステップにはワークスペースへの接続が必要なため、ここでは飛ばします。",
      offlineSkipped: (count) => `ワークスペースへの接続が必要な${count}つのステップを飛ばしました。`,
      doing: "代わりに操作しています。",
      working: "表示されるのを待っています。",
    },
    places: {
      run: "Run",
      studio: "Studio",
      notebooks: "ノートブック",
      courses: "コース",
      qapps: "Qapps",
      atlas: "アトラス",
      settings: "設定",
      workspace: "別のページ",
    },
    targets: {
      "rail-run": "Runのリンク",
      "rail-studio": "Studioのリンク",
      "rail-notebooks": "ノートブックのリンク",
      "rail-qapps": "Qappsのリンク",
      "rail-atlas": "アトラスのリンク",
      "sidebar-search": "検索欄",
      "sidebar-new-chat": "新しいチャットのボタン",
      "sidebar-projects": "プロジェクト一覧",
      "account-menu": "アカウントメニュー",
      "menu-usage": "使用状況のリンク",
      "menu-settings": "設定のリンク",
      "tour-help": "ヘルプボタン",
      "run-starter-bell": "Bell状態のボタン",
      "run-starter": "別のボタン",
      "run-prompt": "入力欄",
      "run-mode": "応答モードの選択",
      "run-framework": "回路フレームワークの選択",
      "run-submit": "送信ボタン",
      "run-attach": "添付ボタン",
      "run-activity": "実行の進み具合",
      "run-final-output": "結果",
      "run-artifact-link": "Studioへのリンク",
      "studio-tab-code": "「コード」タブ",
      "studio-tab-visual": "「回路図」タブ",
      "studio-tab-simulation": "「シミュレーション」タブ",
      "studio-tab-summary": "「概要」タブ",
      "studio-framework": "フレームワークの選択",
      "studio-builder": "ゲートの一覧",
      "studio-compress": "圧縮パネル",
      "studio-simulation-panel": "シミュレーションパネル",
      "studio-qpu": "ハードウェアの欄",
      "studio-download-export": "「エクスポートをダウンロード」ボタン",
      "studio-verify-save": "「検証して保存」ボタン",
      "studio-split": "「図の横にコード」ボタン",
      "studio-playhead": "確率のパネル",
      "studio-cpu-run": "CPUシミュレーションの行",
      "studio-shortcuts": "ショートカットのボタン",
      "notebooks-brief": "内容の入力欄",
      "notebooks-starters": "用意された内容",
      "notebooks-options": "ノートブックの設定",
      "notebooks-fields": "ノートブックの設定項目",
      "notebooks-create": "「ノートブックを作成」ボタン",
      "notebooks-courses": "コースのリンク",
      "courses-composer": "コースの計画欄",
      "qapps-create-run": "「Runで作る」ボタン",
      "atlas-search": "検索欄",
      "atlas-filters": "絞り込みメニュー",
      "atlas-entry-link": "項目",
      "atlas-entry-topics": "トピック",
      "atlas-entry-source": "出典のリンク",
      "atlas-entry-map": "地図のリンク",
      "atlas-views": "アトラスの表示",
    },
    ask: {
      label: "このページについて質問",
      placeholder: "例：OpenQASMを書き出すには？",
      submit: "質問",
      match: (title) => `その操作には短い案内があります：${title}`,
      showMe: "見せて",
      noMatch: "その質問に合う案内はまだありません。",
      askNala: "Nalaに聞く",
      cost: "RunでNalaとのチャットを始めます。プランの使用量に含まれます。",
      asking: "Nalaが回答しています…",
      answered: "Nalaの回答：",
      openAnswer: "回答をすべて見る",
      notReady: "回答はまだ作成中です。チャット一覧に表示されます。",
      offline: "Nalaに聞くには、ワークスペースへの接続が必要です。",
      failed: "今はその質問に回答できませんでした。",
      context: (tour, step, question) => `ガイドツアー「${tour}」のステップ「${step}」を見ています。数文で答えてください：${question}`,
    },
    settings: {
      label: "ガイドツアー",
      lede: "ガイドがワークスペースを案内します。ツアーは実際の画面で進み、どのステップでも中断できます。",
      perDevice: "進み具合はこのブラウザに保存されます。",
      showMe: "操作を見る",
      inviteAgain: "ようこそ案内をもう一度表示",
      inviteAgainDone: "次にRunを開いたときに表示されます。",
    },
    steps: {
      "around.rail": { title: "レール", action: "Run、Studio、ノートブック、Qapps、アトラスへは、ここから移動できます。RunはNalaにコードを頼む場所です。" },
      "around.search": { title: "検索", action: "チャットや保存した回路を名前で探せます。" },
      "around.new-chat": { title: "新しいチャット", action: "新しい会話を始めます。最近のチャットやフォルダはこの下に並びます。" },
      "around.account": { title: "アカウント", action: "レールの一番下にあるメニューを開いてください。" },
      "around.usage": { title: "使用状況と上限", action: "プランの残りと、次にリセットされる時期がわかります。" },
      "around.settings": { title: "設定", action: "設定を開いてください。" },
      "around.preferences": { title: "表示設定", action: "テーマ、アクセントカラー、言語はここで変えられます。" },
      "around.tours": { title: "ガイドツアー", action: "ツアーはここ、またはページ上部の「?」からいつでもやり直せます。テーマと言語は「表示設定」にあります。" },

      "first-light.hello": { title: "はじめての量子", action: "2つの量子ビットで回路を作り、本物の結果を見ます。約4分で、数式は使いません。" },
      "first-light.starter": { title: "Bell状態", action: "2つの量子ビットが一緒にできる、いちばんシンプルな動きです。「Bell状態を作る」を押してください。", wrong: "それは後で使います。「Bell状態を作る」は並びの最初のボタンです。" },
      "first-light.run": { title: "実行する", action: "入力欄にプロンプトが入りました。書き換えてもかまいません。「送信」を押すと、Nalaが回路を計画し、コードを書き、結果を確認します。" },
      "first-light.watch": { title: "進み具合", action: "1行が1つの段階です。計画、コード、確認。たいてい1分以内に終わります。" },
      "first-light.answer": { title: "結果", action: "Bell状態を測ると、00と11がほぼ半分ずつ出て、01や10はほとんど出ません。この結びつきがエンタングルメントです。" },
      "first-light.saved": { title: "保存する", action: "保存を求められたら保存し、Studioで開いてください。" },
      "first-light.visual": { title: "回路を見る", action: "「回路図」タブを開いてください。回路を線とゲートで描きます。" },
      "first-light.gates": { title: "2つのゲート", action: "Bell状態に必要なのは2つです。Hで1つ目の量子ビットを0と1が半々の状態にし、CNOTで2つ目を1つ目に結びつけます。だから2つはいつも同じ値になります。" },

      "build.mode": { title: "応答モード", action: "「実行」はコードを書いて実行します。「自動」はメッセージからNalaが判断します。「実行」を選んでください。", wrong: "それは回路フレームワークの選択です。応答モードはその左です。" },
      "build.framework": { title: "回路フレームワーク", action: "コードを書くライブラリです。標準はQiskitで、CirqやPennyLaneなども選べます。" },
      "build.prompt": { title: "アルゴリズムを説明", action: "何を解き、どう確認するかを書いてください。例：5ノードのリングのMaxCutをQAOAで解き、厳密解と比べる", fill: "QAOAで5ノードのリングのMaxCutを解き、古典的な厳密解と比較してください。" },
      "build.run": { title: "実行する", action: "「送信」を押してください。まず計画、次にコードが出てきます。" },
      "build.plan": { title: "計画と契約", action: "計画は、使うアルゴリズムと選んだ理由を示します。契約は、結果が何を示せば正しいと言えるかを決めます。" },
      "build.result": { title: "RESULT", action: "コードが測った値を、契約に照らして確認したものです。印で合否がわかります。" },
      "build.studio": { title: "Studioで開く", action: "実行した回路はバージョンつきで保存されます。保存を求められたら保存し、Studioで開いてください。" },
      "build.code": { title: "コード", action: "「コード」タブを開いてください。1から4のキーで4つのタブを切り替えられます。" },
      "build.convert": { title: "Cirqに変換", action: "ここでCirqを選ぶと、Studioが回路をCirqのコードに書き換えます。" },
      "build.visual": { title: "回路図", action: "「回路図」タブを開いてください。図の上のパレットはゲートを種類ごとにまとめています。ゲートを選び、ワイヤをクリックして配置します。" },
      "build.playhead": { title: "確率", action: "再生位置で回路を1ステップずつ進め、各時点の確率を確認できます。[ と ] のキーでも動かせます。" },
      "build.split": { title: "図の横にコード", action: "オンにすると、回路図を横に表示したままコードを編集できます。" },
      "build.simulation": { title: "シミュレーション", action: "「シミュレーション」タブを開いてください。CPUシミュレーションはこのブラウザ内で、プランの量子ビット数の範囲で動きます。コードを実際に動かすのは、隔離されたサンドボックスです。" },
      "build.summary": { title: "概要", action: "「概要」タブを開いてください。証拠と、保存したすべてのバージョンがあります。" },
      "build.export": { title: "エクスポート", action: "「エクスポートをダウンロード」でコードを書き出します。回路が対応していればOpenQASMも含まれます。" },
      "build.save": { title: "検証して保存", action: "サンドボックスでコードを確認し、新しいバージョンとして保存します。" },

      "teach.brief": { title: "教える内容", action: "レッスンの内容を書いてください。例：大学1年生向けのGroverの探索", fill: "大学1年生向けのGroverの探索" },
      "teach.options": { title: "形式とレベル", action: "「ノートブックの設定」を開いてください。" },
      "teach.fields": { title: "レッスン、ラボ、クイズ", action: "種類で形式を、対象と数学でレベルを決めます。言語は英語か日本語です。" },
      "teach.create": { title: "作成", action: "「ノートブックを作成」を押してください。ノートブックの演習は、答えを自動で確認します。" },
      "teach.courses": { title: "コース", action: "コースはレッスンとクイズを順番に並べます。コースを開いてください。" },
      "teach.course": { title: "コースを計画", action: "コースの内容を書くと、Nalaが単元を提案します。作成の前に確認できます。" },
      "teach.qapps": { title: "授業のデモ", action: "Qappは回路を、学生が操作できるページにします。Runから、またはStudioの回路から作れます。" },
      "teach.make": { title: "作ってみる", action: "Runから、またはStudioの回路から作れます。" },

      "read.search": { title: "アトラスを検索", action: "手法、問題、論文で検索できます。例：位相推定", fill: "位相推定" },
      "read.filters": { title: "絞り込む", action: "トピックなどで絞り込めます。アドレスも一緒に変わるので、絞り込んだ表示をそのまま共有できます。" },
      "read.entry": { title: "項目を開く", action: "一覧からどれか1つ選んでください。" },
      "read.source": { title: "出典", action: "どの項目にも、元になった論文が書かれています。トピックから、同じテーマのほかの項目に移れます。" },
      "read.map": { title: "地図で見る", action: "「地図で開く」で、この手法がほかの手法の中のどこにあるかがわかります。" },

      "show-mode.mode": { title: "応答モード", action: "「自動」はメッセージからNalaが判断します。「実行」は必ずコードを書いて実行します。「学ぶ」と「解説」は何も実行せず文章で答えます。「Qapp」は操作できるページを作ります。" },
      "show-attach.attach": { title: "ファイルを添付", action: "コードやメモをメッセージに添えられます。Nalaは入力した文と一緒に読みます。" },
    },
  },
};
