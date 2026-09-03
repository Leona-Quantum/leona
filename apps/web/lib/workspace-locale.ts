import type { components } from "@majorana/contracts-gen";
import type { AccountTier } from "./account-tier";
import type { NotebookDiffCellStatus, NotebookDiffHeaderField } from "./notebook-diff";
import type { NotebookMastery } from "./notebook-mastery";
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

export const WORKSPACE_COPY: Record<PublicLocale, {
  surfaces: { brandedRun: string; preview: string };
  sidebar: {
    surfaceSwitch: string;
    run: string;
    studio: string;
    qapps: string;
    notebooks: string;
    myQapps: string;
    exploreQapps: string;
    createQapp: string;
    createQappStudio: string;
    library: string;
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
    simulationBoundary: string;
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
    simulationContextDetails: string;
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
    hardwareJobError: string;
    hardwareRawCounts: string;
    hardwareBlockedReason: (reason: string) => string;
    //: The weekly hardware BUDGET is spent, which is not the same thing as the
    //: deployment being switched off — a person can act on this one. Takes the
    //: formatted amounts rather than raw numbers so the currency renders the
    //: same way as the estimate directly above it on screen.
    hardwareSpendExhausted: (estimate: string, limit: string, spent: string) => string;
    hardwareSpendFreeTier: (estimate: string) => string;
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
    gpuLane: string;
    gpuPending: string;
    gpuExplainer: string;
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
    samplingNote: string;
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
    editorNote: string;
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
    applyToCode: string;
    appliedToCode: string;
    compression: string;
    compressionIntro: string;
    optimizationWorkflowLabel: string;
    optimizationStepChoose: string;
    optimizationStepCompare: string;
    optimizationStepApply: string;
    optimizationLocal: string;
    optimizationLocalDescription: string;
    optimizationExternal: string;
    optimizationExternalDescription: string;
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
    externalQiskitDescription: string;
    externalCirq: string;
    externalCirqDescription: string;
    externalPytket: string;
    externalPytketDescription: string;
    externalPennyLane: string;
    externalPennyLaneDescription: string;
    externalPyZX: string;
    externalPyZXDescription: string;
    externalBqskit: string;
    externalBqskitDescription: string;
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
    progressLabel: string;

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

    teachMeInNotebook: string;
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
      myQapps: "My Qapps",
      exploreQapps: "Explore Qapps",
      createQapp: "Create Qapp",
      createQappStudio: "Create from Studio",
      library: "All artifacts",
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
      newDraft: "A clean draft for exploring a circuit before it is saved.",
      copyCode: "Copy code",
      copied: "Copied",
      downloadExport: "Download export",
      simulate: "Simulate",
      simulation: "Simulation",
      cpuLane: "CPU lane",
      cpuEligible: "CPU eligible",
      cpuUnavailable: (reason) => ({
        artifact_required: "Save this draft before creating an artifact-owned simulation record.",
        framework_unavailable: "CPU execution is available only for Qiskit, PennyLane, and Cirq source.",
        source_unavailable: "The in-browser lane can only rebuild circuits written in Studio's own gate shape, and this one is beyond it — so nothing is simulated here rather than a result being invented.",
        source_limit: "This source is too large for the bounded CPU simulation lane.",
        qubit_limit: "This circuit is wider than the browser simulation lane can run on your plan.",
        operation_limit: "This source exceeds the bounded CPU operation limit.",
      }[reason] ?? "CPU simulation is unavailable for this source."),
      sandboxFallbackExplainer: "Run it for real instead: the sandbox executes this exact source and reports whatever it produces, including the error if it does not work.",
      runInSandbox: "Run this code for real",
      openSimulation: "Open simulation",
      simulationArtifactRequired: "Save this draft before creating an artifact-owned simulation record.",
      cpuInvalidShots: (maximum) => `Shots must be a whole number from 1 to ${maximum.toLocaleString("en-US")}.`,
      cpuInvalidSeed: (maximum) => `Seed must be a whole number from 0 to ${maximum.toLocaleString("en-US")}.`,
      simulationPersistenceUnavailable: "The CPU result was not recorded because this browser cannot store local simulation records.",
      cpuSimulationRecorded: "CPU simulation recorded in this browser. It did not start a Nala Run or verify this artifact.",
      simulationFailed: "CPU simulation failed before a record could be created.",
      simulationBoundary: "This bounded statevector runs in this browser from the parsed gate model. It records the exact draft fingerprint; unsaved edits do not update a saved version. Its local record is not verification, a Nala Run, or hardware execution.",
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
      rerunPrompt: "This exact source already has a local simulation record. Confirm to create another record; it will not overwrite the earlier result.",
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
      simulationContextDetails: "Provenance & eligibility details",
      readingConcentrated: (state, share) => `${share} of shots landed on |${state}⟩ — a single dominant outcome in this sample.`,
      readingPaired: (first, second, share) => `Shots concentrated on |${first}⟩ and |${second}⟩ (${share} combined) — the correlated-pair signature.`,
      readingSpread: (states, state, share) => `${states} distinct outcomes in this sample; the most frequent was |${state}⟩ at ${share}.`,
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
      hardwareVerifiedRequired: "Hardware submission will require a verified saved version of this circuit.",
      hardwareInterchangeRequired: "This version stores no OpenQASM interchange export, which is what hardware runs. Rerun Verify & save to produce one.",
      hardwareJobStatus: "Job status",
      hardwareJobId: "Provider job",
      hardwareJobError: "Provider error",
      hardwareRawCounts: "Raw device counts",
      hardwareBlockedReason: (reason) => ({
        submission_disabled: "Hardware submission is switched off in this deployment by the owner. The device, rates, and estimate above are exactly what a real submission will use.",
        credentials_unconfigured: "No provider credentials are configured in this deployment, so nothing can be submitted.",
        provider_dependency_missing: "The provider SDK is not installed in this deployment, so nothing can be submitted.",
      }[reason] ?? "Hardware submission is unavailable in this deployment."),
      hardwareSpendExhausted: (estimate, limit, spent) =>
        `This run is estimated at ${estimate}. Your plan includes ${limit} of hardware time per week and ${spent} is already committed. Free-queue devices and browser simulation stay available.`,
      hardwareSpendFreeTier: (estimate) =>
        `This run is estimated at ${estimate}, and billed hardware is not part of the free plan. Free-queue devices and browser simulation stay available.`,
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
      gpuLane: "GPU lane",
      gpuPending: "No provider connected",
      gpuExplainer: "A GPU simulation provider is being arranged. Nothing is wired to it yet, so this lane cannot run a circuit and there is no control here to press. When the provider is connected, this lane gains a run control and its own cost and limit figures.",
      aboutConversions: "About these conversions",
      conversionExplainer: "Each framework tab is generated from this circuit's own stored source through a bounded gate set. Where a conversion goes through standard-gate decomposition, the note above says so; stored native source is never rewritten and carries no note. Four of the eight are export formats — they can be produced and downloaded, but Leona Quantum executes only Qiskit, PennyLane, and Cirq.",
      conversionUnavailable: (target, source) => `No ${target} conversion could be produced from this circuit, so the ${source} source is shown instead. Exports and runs made here use ${source}.`,
      exportOnlyFramework: "This format is for copy and export. Sandbox execution is limited to Qiskit, PennyLane, and Cirq.",
      uncommittedEdits: "Edited since the last saved version",
      uncommittedEditsNote: "These edits exist only in this browser until a verification run saves them as the next version.",
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
      evidenceNotLoaded: "Open the full record to load this version's checks.",
      openFullRecord: "Open the full verification record",
      shots: "Shots",
      seed: "Seed",
      seedAuto: "auto",
      samplingNote: "CPU simulation uses these inputs; Verify & save passes them through to the run planner. Leave seed blank to record a browser-chosen seed.",
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
      editorNote: "Edit the draft directly. Simulate or verify it to produce evidence before it becomes a saved version.",
      versionHistory: "Version history",
      repositoryView: "atlas view",
      currentVersion: (id) => `Current · ${id}`,
      draftNotSaved: "Draft · not saved",
      currentVersionNote: "The current saved version remains unchanged until a passing verification run saves the next version.",
      draftVersionNote: "Run verification to create the first durable artifact version.",
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
        `Version ${seq} becomes the current version. Nothing is deleted — every version stays in this list.`,
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
      compression: "Circuit compression",
      compressionIntro: "Choose a method, compare before and after, then apply only the result you want to keep.",
      optimizationWorkflowLabel: "Circuit optimization workflow",
      optimizationStepChoose: "Choose a method",
      optimizationStepCompare: "Compare the result",
      optimizationStepApply: "Apply to Studio",
      optimizationLocal: "Quick exact rewrites",
      optimizationLocalDescription: "Runs instantly in the browser. Best for obvious cancellations and rotation folding.",
      optimizationExternal: "Compiler optimization",
      optimizationExternalDescription: "Runs one of six real compiler SDKs on the Worker and returns an editable Studio circuit.",
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
      compressionBoundary: "Measurements and custom gates stay as rewrite boundaries on their qubits. Compression does not claim hardware routing or device-native optimization.",
      compressionOverwrite: "The Code tab no longer matches this diagram. Compression replaces it with generated code for the compressed diagram. Continue?",
      compressionApplied: (removed, beforeDepth, afterDepth) => `Compressed the circuit by ${removed} operations. Logical depth: ${beforeDepth} → ${afterDepth}. Framework drafts were regenerated.`,
      compressionUndone: "Compression was undone and the framework drafts were regenerated.",
      externalCompilation: "External compilers",
      externalIntro: "Queue a trusted compiler on the Worker, inspect its result, then decide whether to replace the Studio circuit.",
      externalLevel: "Optimization level",
      externalCompiler: "Compiler",
      externalQiskit: "Qiskit",
      externalQiskitDescription: "IBM's preset pass manager with a deterministic seed and Studio-compatible basis gates.",
      externalCirq: "Cirq",
      externalCirqDescription: "Google Quantum AI's merge, target-gateset decomposition, and cleanup transformer pipeline.",
      externalPytket: "pytket",
      externalPytketDescription: "Quantinuum's peephole compiler with implicit wire swaps disabled before rebasing to Studio gates.",
      externalPennyLane: "PennyLane",
      externalPennyLaneDescription: "Xanadu's compile transform: commuting, inverse cancellation, and rotation merging over repeated passes.",
      externalPyZX: "PyZX",
      externalPyZXDescription: "ZX-calculus and phase-polynomial optimization for bounded Clifford+T circuits.",
      externalBqskit: "BQSKit",
      externalBqskitDescription: "Berkeley's synthesis-based compiler for deeper optimization of small circuits.",
      externalRecommended: "Recommended",
      externalLevelHelp: "1 is fastest, 2 is balanced, and 3 searches more thoroughly.",
      externalLevelOption: (level) => level === 1 ? "1 · Fast" : level === 2 ? "2 · Balanced" : "3 · Thorough",
      externalBoundary: "Only bound built-in gates are sent—never source code. General jobs are limited to 64 qubits and 1,024 operations. PyZX is limited to 16 qubits / 512 operations and Clifford+T angles; BQSKit to 8 qubits / 128 operations.",
      externalRun: "Run compiler",
      externalRunSelected: (compiler) => `Run ${compiler}`,
      externalRunning: "Compiling…",
      externalOpenRun: "Open compiler run",
      externalFailed: "The external compiler did not return a usable Studio circuit.",
      externalConnectionLost: "The compiler event stream closed before a result arrived.",
      externalPreview: (compiler, version) => `${compiler} ${version} result`,
      externalUnverified: "This is compiler output, not verification evidence. Equivalence is reported up to global phase; verify the edited draft before relying on it.",
      externalApply: "Apply compiler result",
      externalConfirmApply: "Replace code with compiler result",
      externalApplied: (compiler, before, after) => `${compiler} result applied (${before} → ${after} gates). Framework drafts were regenerated; verification is stale.`,
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
      circuitReadOnly: "This is the framework-native circuit that ran. Unsupported operations are preserved as named blocks, so the diagram is read-only and the original code remains unchanged.",
      circuitReadOnlyTruncated: (shown, total) => `Read-only preview: showing ${shown} of ${total} framework operations. The original code remains complete and unchanged.`,
      readOnly: "Read-only",
      readOnlyHint: "Inspect the executed circuit here. Edit the high-level program in the Code tab.",
      circuitNotRebuildable: "This artifact's code goes beyond the visual builder — edit it in the Code tab.",
      sourceFallbackNote: (target, source) => `No safe ${target} conversion exists for this circuit, so this tab shows the stored ${source} source — it is a source reference, not ${target} code. Exports and runs from this tab use ${source}.`,
      circuitTooLargeToDraw: "This circuit is too large to draw as a diagram — its qubit or gate count would render an unreadable canvas. The Code tab holds the full source to read and run.",
      canvasOutOfDate: "The Code tab has changed since this diagram was drawn, so the diagram no longer shows what will run.",
      canvasBeyondBuilder: "The code in the Code tab is outside what this editor can draw, so the diagram below is not a picture of it. The code is what runs.",
      rebuildFromCode: "Rebuild from code",
      rebuiltFromCode: "Diagram rebuilt from the code in the Code tab.",
      applyOverwritesEditedCode: "The Code tab has changed since this diagram was drawn. Applying replaces that code with the diagram. Continue?",
      applyOverwritesUnrepresentableCode: "The Code tab holds source this editor cannot draw. Applying replaces it with the diagram, and the diagram cannot reproduce it. Continue?",
      confirmApply: "Replace the code",
    },
  notebooks: {
    title: "Notebooks",
    lede: "Ask Nala for a Jupyter lesson, then keep talking to change it. Every turn runs in the sandbox before you see it.",
    newNotebook: "New notebook",
    briefLabel: "What do you want to learn or teach?",
    briefPlaceholder: "e.g. Teach a Python engineer the Bell state and why it can't be simulated classically, with a coin-flip analogy and a checkpoint that would fail if the code were wrong.",
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
    startersLabel: "Or start from a brief",
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
    versionFailedHeadline: "This version did not finish generating.",
    versionFailedHint: "Ask Nala below to fix it, or run it again.",

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
    progressLabel: "Working",

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

    teachMeInNotebook: "Teach me this in a notebook",
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
      myQapps: "自分のQapp",
      exploreQapps: "公開Qappを探す",
      createQapp: "Qappを作る",
      createQappStudio: "Studioから作る",
      library: "すべての回路・実行記録",
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
      newDraft: "保存する前の回路を試すための新しい下書きです。",
      copyCode: "コードをコピー",
      copied: "コピー済み",
      downloadExport: "エクスポートをダウンロード",
      simulate: "シミュレーション",
      simulation: "シミュレーション",
      cpuLane: "CPUシミュレーション",
      cpuEligible: "CPUで実行可能",
      cpuUnavailable: (reason) => ({
        artifact_required: "この保存済み回路のシミュレーション記録を作成する前に、下書きを保存してください。",
        framework_unavailable: "CPU実行はQiskit、PennyLane、Cirqのソースでのみ利用できます。",
        source_unavailable: "この回路はブラウザ内では実行できません。対応していない回路の結果は表示しません。",
        source_limit: "このソースはブラウザ内CPUシミュレーションには大きすぎます。",
        qubit_limit: "この回路は、お使いのプランでブラウザシミュレーションを実行できる幅を超えています。",
        operation_limit: "このソースは限定CPU操作数の上限を超えています。",
      }[reason] ?? "このソースではCPUシミュレーションを利用できません。"),
      sandboxFallbackExplainer: "代わりにサンドボックスで実行できます。ソースをそのまま実行し、動作しない場合はエラーも含めて結果を表示します。",
      runInSandbox: "サンドボックスで実行",
      openSimulation: "シミュレーションを開く",
      simulationArtifactRequired: "この保存済み回路のシミュレーション記録を作成する前に、下書きを保存してください。",
      cpuInvalidShots: (maximum) => `ショット数は1から${maximum.toLocaleString("en-US")}までの整数にしてください。`,
      cpuInvalidSeed: (maximum) => `シードは0から${maximum.toLocaleString("en-US")}までの整数にしてください。`,
      simulationPersistenceUnavailable: "ブラウザにシミュレーション履歴を保存できなかったため、CPU結果を記録しませんでした。",
      cpuSimulationRecorded: "CPUシミュレーションをこのブラウザに記録しました。この結果は正式な検証結果ではありません。",
      simulationFailed: "記録を作成する前にCPUシミュレーションが失敗しました。",
      simulationBoundary: "対応しているゲートをもとに、ブラウザ上で状態ベクトルシミュレーションを実行します。実行した下書きの識別情報は記録しますが、未保存の編集は保存済みバージョンを更新しません。この履歴はローカルシミュレーションの結果であり、正式な検証結果や実機の実行結果ではありません。",
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
      rerunPrompt: "同じソースコードのシミュレーション記録があります。確認すると、以前の結果を上書きせずに新しい記録を作成します。",
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
      simulationContextDetails: "実行元と実行条件",
      readingConcentrated: (state, share) => `ショットの${share}が |${state}⟩ に集中しました。この状態が最も多く観測されました。`,
      readingPaired: (first, second, share) => `ショットは |${first}⟩ と |${second}⟩ に集中しました（合計${share}）。2つの状態に測定結果が集中しています。`,
      readingSpread: (states, state, share) => `このサンプルでは${states}種類の結果が観測され、最頻は |${state}⟩（${share}）でした。`,
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
      hardwareVerifiedRequired: "量子コンピュータで実行するには、この回路を検証して保存してください。",
      hardwareInterchangeRequired: "このバージョンにはハードウェア実行に使うOpenQASMエクスポートが保存されていません。「検証して保存」を再実行してください。",
      hardwareJobStatus: "ジョブの状態",
      hardwareJobId: "実機側のジョブID",
      hardwareJobError: "プロバイダーのエラー",
      hardwareRawCounts: "測定結果（生データ）",
      hardwareBlockedReason: (reason) => ({
        submission_disabled: "現在の環境では、管理者が量子コンピュータでの実行を無効にしています。上記の実機、料金、見積もりは、実行機能の有効化後に使用されます。",
        credentials_unconfigured: "現在の環境には実機提供元の認証情報が設定されていないため、実行できません。",
        provider_dependency_missing: "現在の環境は、この実機提供元に対応していません。",
      }[reason] ?? "現在の環境では量子コンピュータでの実行を利用できません。"),
      hardwareSpendExhausted: (estimate, limit, spent) =>
        `この実行の見積もりは${estimate}です。現在のプランに含まれる実機の実行枠は週あたり${limit}で、すでに${spent}を使用しています。無料キューの実機とブラウザ上のシミュレーションは引き続き利用できます。`,
      hardwareSpendFreeTier: (estimate) =>
        `この実行の見積もりは${estimate}です。有料の実機実行は無料プランには含まれていません。無料キューの実機とブラウザ上のシミュレーションは引き続き利用できます。`,
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
      gpuLane: "GPU",
      gpuPending: "接続前",
      gpuExplainer: "GPUシミュレーションの提供元を準備中です。まだ接続していないため、この環境では回路を実行できず、操作ボタンもありません。接続が完了した時点で、実行ボタンと料金・上限の情報がここに表示されます。",
      aboutConversions: "変換について",
      conversionExplainer: "各フレームワークのコードは、この回路に保存されているソースから、対応するゲートの範囲内で生成しています。標準ゲートに分解して変換した場合はその旨を上に表示します。元から保存されているコードは書き換えないため、注記は付きません。8種類のうち4種類は書き出し専用です。Leona Quantum が実行できるのは Qiskit、PennyLane、Cirq のみです。",
      conversionUnavailable: (target, source) => `この回路から${target}への変換は生成できなかったため、${source}のソースを表示しています。ここからの書き出しと実行は${source}として扱われます。`,
      exportOnlyFramework: "この形式はコピーと書き出し用です。サンドボックスでの実行は Qiskit、PennyLane、Cirq に限定されています。",
      uncommittedEdits: "保存済みバージョンから編集されています",
      uncommittedEditsNote: "この編集はブラウザ内にのみ存在します。検証を実行すると次のバージョンとして保存されます。",
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
      evidenceNotLoaded: "このバージョンの検証内容は、詳細な検証記録で確認できます。",
      openFullRecord: "検証記録の全体を開く",
      shots: "ショット数",
      seed: "シード",
      seedAuto: "自動",
      samplingNote: "CPUシミュレーションはこれらの値を使用します。正式な検証実行にも同じ値を使用します。シードを空欄にすると、ブラウザで選ばれた値を記録します。",
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
      editorNote: "下書きを直接編集できます。新しいバージョンとして保存するには、シミュレーションまたは検証を実行してください。",
      versionHistory: "バージョン履歴",
      repositoryView: "Atlasで見る",
      currentVersion: (id) => `現在 · ${id}`,
      draftNotSaved: "下書き · 未保存",
      currentVersionNote: "検証に合格した実行を新しいバージョンとして保存するまで、現在の保存済みバージョンは変更されません。",
      draftVersionNote: "検証を実行すると、最初の保存バージョンが作成されます。",
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
        `バージョン ${seq} が現在のバージョンになります。削除は行われず、どのバージョンも一覧に残ります。`,
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
      appliedToCode: "生成したコードを各フレームワークの下書きに反映しました。",
      compression: "量子回路を圧縮",
      compressionIntro: "方式を選び、圧縮前後を比較して、採用したい結果だけをStudioへ反映できます。",
      optimizationWorkflowLabel: "量子回路最適化の流れ",
      optimizationStepChoose: "方式を選ぶ",
      optimizationStepCompare: "結果を比較",
      optimizationStepApply: "Studioへ反映",
      optimizationLocal: "かんたん圧縮",
      optimizationLocalDescription: "ブラウザですぐ実行。明らかな相殺や回転ゲートの統合に向いています。",
      optimizationExternal: "コンパイラで最適化",
      optimizationExternalDescription: "6種類の実コンパイラをWorkerで動かし、編集可能なStudio回路として結果を返します。",
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
      compressionBoundary: "測定とカスタムゲートは、その量子ビット上の変換境界として保持します。実機向けルーティングやデバイス固有最適化を行ったとは扱いません。",
      compressionOverwrite: "コードタブは現在の図と一致していません。圧縮すると、圧縮後の図から生成したコードに置き換わります。続行しますか？",
      compressionApplied: (removed, beforeDepth, afterDepth) => `${removed}個の操作を削減しました。論理深さ: ${beforeDepth} → ${afterDepth}。各フレームワークのコードも再生成しました。`,
      compressionUndone: "圧縮を元に戻し、各フレームワークのコードを再生成しました。",
      externalCompilation: "外部コンパイラ",
      externalIntro: "Workerで実際のコンパイラを実行し、結果を比較してからStudioの回路へ反映できます。",
      externalLevel: "最適化レベル",
      externalCompiler: "コンパイラ",
      externalQiskit: "Qiskit",
      externalQiskitDescription: "決定的なシードとStudio対応ゲート集合を使うIBMのプリセット・パスマネージャです。",
      externalCirq: "Cirq",
      externalCirqDescription: "Google Quantum AIのゲート統合・ターゲット分解・クリーンアップ変換を実行します。",
      externalPytket: "pytket",
      externalPytketDescription: "暗黙の配線入れ替えを禁止し、Studioゲートへ戻すQuantinuumのピープホールコンパイラです。",
      externalPennyLane: "PennyLane",
      externalPennyLaneDescription: "可換移動、逆ゲート相殺、回転統合を反復するXanaduのcompile変換です。",
      externalPyZX: "PyZX",
      externalPyZXDescription: "小規模なClifford+T回路向けのZX計算・位相多項式最適化です。",
      externalBqskit: "BQSKit",
      externalBqskitDescription: "小規模回路をより深く最適化するBerkeleyの合成ベースコンパイラです。",
      externalRecommended: "おすすめ",
      externalLevelHelp: "1は高速、2は標準、3は時間をかけてより深く探索します。",
      externalLevelOption: (level) => level === 1 ? "1・高速" : level === 2 ? "2・標準" : "3・念入り",
      externalBoundary: "送信するのは値が確定した組み込みゲートだけで、ソースコードは送りません。通常上限は64量子ビット・1,024操作です。PyZXは16量子ビット・512操作・Clifford+T角、BQSKitは8量子ビット・128操作に限定されます。",
      externalRun: "コンパイラを実行",
      externalRunSelected: (compiler) => `${compiler}で圧縮を実行`,
      externalRunning: "コンパイル中…",
      externalOpenRun: "コンパイル実行を開く",
      externalFailed: "外部コンパイラからStudioで扱える回路を取得できませんでした。",
      externalConnectionLost: "結果が届く前にコンパイラのイベント接続が切れました。",
      externalPreview: (compiler, version) => `${compiler} ${version} の結果`,
      externalUnverified: "これはコンパイラ出力であり、検証証拠ではありません。同値性は大域位相を除いて扱われます。利用前に編集後の回路を再検証してください。",
      externalApply: "コンパイル結果を反映",
      externalConfirmApply: "コードをコンパイル結果で置換",
      externalApplied: (compiler, before, after) => `${compiler}の結果を反映しました（${before} → ${after}ゲート）。各フレームワークのコードを再生成し、検証状態を古いものとして扱います。`,
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
      hideInspector: "詳細を隠す",
      showInspector: "回路の詳細",
      circuitRestored: "保存済み回路を読み込みました。検証して保存するまで、編集はこの下書きにのみ反映されます。",
      circuitReadOnly: "実行されたフレームワーク固有の回路を表示しています。未対応の演算も名前付きの箱として保持するため、この図は読み取り専用で、元コードは変更されません。",
      circuitReadOnlyTruncated: (shown, total) => `読み取り専用プレビュー：${total}個のフレームワーク演算のうち${shown}個を表示しています。元コードは完全な状態で変更されません。`,
      readOnly: "読み取り専用",
      readOnlyHint: "実行後の回路を確認できます。高水準プログラムの編集はコードタブで行ってください。",
      circuitNotRebuildable: "この回路のコードは回路エディタの対応範囲を超えています。コードタブで編集してください。",
      sourceFallbackNote: (target, source) => `この回路を${target}へ安全に変換できないため、保存済みの${source}ソースを表示しています。変換後のコードではありません。書き出しと実行には${source}を使用します。`,
      circuitTooLargeToDraw: "この回路は図として描画するには大きすぎます — 量子ビット数またはゲート数が多く、キャンバスが判読不能になります。全ソースはコードタブで確認・実行できます。",
      canvasOutOfDate: "この図を描いたあとにコードタブが変更されました。図は実行される内容と一致していません。",
      canvasBeyondBuilder: "コードタブのコードはこのエディタで描ける範囲を超えているため、下の図はその内容を表していません。実行されるのはコードです。",
      rebuildFromCode: "コードから再構築",
      rebuiltFromCode: "コードタブのコードから図を再構築しました。",
      applyOverwritesEditedCode: "この図を描いたあとにコードタブが変更されています。適用するとそのコードは図の内容で置き換えられます。続行しますか？",
      applyOverwritesUnrepresentableCode: "コードタブには、このエディタで描けないソースがあります。適用するとそのコードは図で置き換えられ、図から元に戻すことはできません。続行しますか？",
      confirmApply: "コードを置き換える",
    },
  notebooks: {
    title: "ノートブック",
    lede: "Nalaに依頼してJupyterレッスンを作成し、対話しながら編集できます。各バージョンは表示前にサンドボックスで実行されています。",
    newNotebook: "新しいノートブック",
    briefLabel: "何を学びたい、または教えたいですか？",
    briefPlaceholder: "例：Pythonエンジニアにベル状態と、それが古典的にシミュレートできない理由を、コイン投げのたとえと、コードが間違っていれば失敗するチェックポイント付きで教えてください。",
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
    startersLabel: "またはお題から始める",
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
    versionFailedHeadline: "このバージョンの生成は完了しませんでした。",
    versionFailedHint: "下のNalaに修正を依頼するか、もう一度実行してください。",

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
    progressLabel: "処理中",

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

    teachMeInNotebook: "ノートブックで学ぶ",
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
  // It is stated here because ai-ops#82 took it off /pricing, where it read as
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
    personalWorkspaceHelp: "Your own workspace. Nobody else can open it unless you invite them below.",
    artifacts: "Artifacts",
    runs: "Runs",
    access: "Access",
    privateAccess: "Private",
    autoKeep: "Automatically save results",
    autoKeepHelp:
      "Off by default. When off, a finished run asks before it saves — the result is still there to open, convert and build on, it just does not join your saved artifacts unless you keep it.",
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
    usageWindow: (days) => `Rolling ${days} days — each run returns ${days} days after you use it`,
    usageArtifactsScope: "In this workspace",
    usageEnforcedAs: (tier) =>
      `Your runs are being enforced as ${tier}. The limits above are what this page resolved; these are what the control plane applies.`,
    usageNextSlotOn: (date) => `1 more frees up on ${date}`,
    usageNextSlotWhen: (word) => `1 more frees up ${word}`,
    usageSharedProjects: "Shared projects",
    usageSharedProjectsScope:
      "Counted across your whole account — projects you share plus projects shared with you. Projects you keep to yourself are unlimited on every plan and are not counted here.",
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
    spendNotBilled: "Shown for visibility. Tokens are not charged for and count against no allowance.",
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
    personalWorkspaceHelp: "個人用のワークスペースです。招待しない限り、他の人には表示されません。",
    artifacts: "回路・実行記録",
    runs: "実行",
    access: "アクセス",
    privateAccess: "非公開",
    autoKeep: "結果を自動的に保存する",
    autoKeepHelp:
      "既定ではオフです。オフのときは、実行後に保存するか確認します。結果は開いて変換・編集できますが、保存を選ぶまで保存済みの一覧には追加されません。",
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
    usageWindow: (days) => `直近${days}日間のローリング — 使った実行は${days}日後に1回ずつ戻ります`,
    usageArtifactsScope: "このワークスペース内",
    usageEnforcedAs: (tier) =>
      `実行は ${tier} として制限されています。上の上限はこのページが判定した値、以下はコントロールプレーンが実際に適用している値です。`,
    usageNextSlotOn: (date) => `${date}に1回分が戻ります`,
    usageNextSlotWhen: (word) => `${word}1回分が戻ります`,
    usageSharedProjects: "共有プロジェクト",
    // 「2 / 4」だけを見ると全プロジェクトの上限に読めてしまう。共有していない
    // プロジェクトはどのプランでも無制限で、この数には入らない。
    usageSharedProjectsScope:
      "アカウント全体での数です。自分が共有しているプロジェクトと、共有されたプロジェクトの両方を数えます。共有していないプロジェクトはどのプランでも無制限で、ここには含まれません。",
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
    spendNotBilled: "参考表示です。トークンは課金対象ではなく、いずれの上限にも数えられません。",
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
    workspacesHelp:
      "Everything you run and save belongs to one workspace. Switching changes what Run and Studio show you.",
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
    transferHelp:
      "The owner is the only person who can delete this workspace or hand it on. Give it away and you stay as an admin — which the new owner can take back.",
    transferFailed: "Could not hand the workspace over.",
    transferred: (name) => `${name} owns this workspace now. You are an admin of it, and you can leave whenever you like.`,
    membersTitle: "Members",
    membersHelp: "People who can act in the workspace you have open.",
    membersShareWarning:
      "A member sees every run and every saved artifact in this workspace, including work saved before they arrived. A viewer can read all of it but cannot run or save.",
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
    workspacesHelp:
      "実行と保存はすべて、いずれかのワークスペースに属します。切り替えると、Run と Studio の表示内容が変わります。",
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
    transferHelp:
      "このワークスペースを削除・譲渡できるのはオーナーだけです。譲渡すると、あなたは管理者として残ります（新しいオーナーはそれを解除できます）。",
    transferFailed: "オーナーを変更できませんでした。",
    transferred: (name) => `${name} がこのワークスペースのオーナーになりました。あなたは管理者で、いつでも退出できます。`,
    membersTitle: "メンバー",
    membersHelp: "現在のワークスペースにアクセスできるメンバーです。",
    membersShareWarning:
      "メンバーは、参加前のものを含むすべての実行結果と保存済み回路を閲覧できます。閲覧者は内容を確認できますが、実行や保存はできません。",
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
