import type { AccountTier } from "./account-tier";
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
    /** Plan name shown beside the person's first name in the sidebar footer. */
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
    gpuSimulation: string;
    qpuExecution: string;
    gpuUnavailable: string;
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
    sourceFallbackNote: (target: string, source: string) => string;
    circuitTooLargeToDraw: string;
    circuitViewerReadonly: string;
    readonlyDiagram: (qubits: number) => string;
    readonlyDiagramHint: string;
    canvasOutOfDate: string;
    canvasBeyondBuilder: string;
    rebuildFromCode: string;
    rebuiltFromCode: string;
    applyOverwritesEditedCode: string;
    applyOverwritesUnrepresentableCode: string;
    confirmApply: string;
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
      tierLabel: { demo: "Preview", free: "Free", developer: "Developer" },
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
      downloadExport: "Download export",
      simulate: "Simulate",
      simulation: "Simulation",
      cpuLane: "CPU lane",
      cpuEligible: "CPU eligible",
      cpuUnavailable: (reason) => ({
        artifact_required: "Save this draft to Vault before creating an artifact-owned simulation record.",
        framework_unavailable: "CPU execution is available only for Qiskit, PennyLane, and Cirq source.",
        source_unavailable: "The in-browser lane can only rebuild circuits written in Studio's own gate shape, and this one is beyond it — so nothing is simulated here rather than a result being invented.",
        source_limit: "This source is too large for the bounded CPU simulation lane.",
        qubit_limit: "This circuit is wider than the browser simulation lane can run on your plan.",
        operation_limit: "This source exceeds the bounded CPU operation limit.",
      }[reason] ?? "CPU simulation is unavailable for this source."),
      sandboxFallbackExplainer: "Run it for real instead: the sandbox executes this exact source and reports whatever it produces, including the error if it does not work.",
      runInSandbox: "Run this code for real",
      openSimulation: "Open simulation",
      simulationArtifactRequired: "Save this draft to Vault before creating an artifact-owned simulation record.",
      cpuInvalidShots: (maximum) => `Shots must be a whole number from 1 to ${maximum.toLocaleString("en-US")}.`,
      cpuInvalidSeed: (maximum) => `Seed must be a whole number from 0 to ${maximum.toLocaleString("en-US")}.`,
      simulationPersistenceUnavailable: "The CPU result was not recorded because this browser cannot store local simulation records.",
      cpuSimulationRecorded: "CPU simulation recorded in this browser. It did not start a Nala Run or verify this artifact.",
      simulationFailed: "CPU simulation failed before a record could be created.",
      simulationBoundary: "This bounded statevector runs in this browser from the parsed gate model. It records the exact draft fingerprint; unsaved edits do not update a Vault version. Its local record is not verification, a Nala Run, or hardware execution.",
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
      gpuSimulation: "GPU simulation",
      qpuExecution: "QPU execution",
      gpuUnavailable: "GPU simulation is planned. It remains unavailable until provider, cost, and security work are complete.",
      qpuUnavailable: "QPU execution is planned. It remains unavailable until a provider, estimate, confirmation, and spend policy are in place.",
      simulationResults: "Simulation records",
      simulationNoRecords: "No CPU simulation record exists for this artifact in this browser.",
      simulationRecord: "CPU simulation record",
      artifactVersion: "Base Vault version",
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
      hardwareVerifiedRequired: "Hardware submission will require a verified Vault version of this circuit.",
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
      sourceFallbackNote: (target, source) => `No safe ${target} conversion exists for this circuit, so this tab shows the stored ${source} source — it is a source reference, not ${target} code. Exports and runs from this tab use ${source}.`,
      circuitTooLargeToDraw: "This circuit is too large to draw as a diagram — its qubit or gate count would render an unreadable canvas. The Code tab holds the full source to read and run.",
      circuitViewerReadonly: "This circuit is wider than the editable builder, so it opens as a read-only diagram. Edit the circuit in the Code tab.",
      readonlyDiagram: (qubits: number) => `Read-only diagram · ${qubits} qubits. Wider than the drag-and-drop builder (max 6) — reconstructed from the saved circuit so you can see it. The Code tab holds the source to edit and run.`,
      readonlyDiagramHint: "Read-only view — reconstructed from the saved circuit. Edit the source in the Code tab.",
      canvasOutOfDate: "The Code tab has changed since this diagram was drawn, so the diagram no longer shows what will run.",
      canvasBeyondBuilder: "The code in the Code tab is outside what this editor can draw, so the diagram below is not a picture of it. The code is what runs.",
      rebuildFromCode: "Rebuild from code",
      rebuiltFromCode: "Diagram rebuilt from the code in the Code tab.",
      applyOverwritesEditedCode: "The Code tab has changed since this diagram was drawn. Applying replaces that code with the diagram. Continue?",
      applyOverwritesUnrepresentableCode: "The Code tab holds source this editor cannot draw. Applying replaces it with the diagram, and the diagram cannot reproduce it. Continue?",
      confirmApply: "Replace the code",
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
      tierLabel: { demo: "プレビュー", free: "フリー", developer: "開発者" },
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
      inconclusive: "検証不能",
      legacyUnknown: "旧データ・根拠不明",
      stale: "検証期限切れ",
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
      downloadExport: "エクスポートをダウンロード",
      simulate: "シミュレーション",
      simulation: "シミュレーション",
      cpuLane: "CPUレーン",
      cpuEligible: "CPUで実行可能",
      cpuUnavailable: (reason) => ({
        artifact_required: "アーティファクトに紐づくシミュレーション記録を作成する前に、この下書きをボールトへ保存してください。",
        framework_unavailable: "CPU実行はQiskit、PennyLane、Cirqのソースでのみ利用できます。",
        source_unavailable: "ブラウザ内のレーンはStudio独自のゲート表記で書かれた回路しか再構成できず、このソースはその範囲を超えています。結果を捏造せず、ここでは実行しません。",
        source_limit: "このソースは限定CPUシミュレーションレーンには大きすぎます。",
        qubit_limit: "この回路は、お使いのプランでブラウザシミュレーションを実行できる幅を超えています。",
        operation_limit: "このソースは限定CPU操作数の上限を超えています。",
      }[reason] ?? "このソースではCPUシミュレーションを利用できません。"),
      sandboxFallbackExplainer: "代わりに実際に実行できます。サンドボックスはこのソースをそのまま実行し、動作しない場合はエラーも含めて結果を報告します。",
      runInSandbox: "このコードを実際に実行",
      openSimulation: "シミュレーションを開く",
      simulationArtifactRequired: "アーティファクトに紐づくシミュレーション記録を作成する前に、この下書きをボールトへ保存してください。",
      cpuInvalidShots: (maximum) => `ショット数は1から${maximum.toLocaleString("en-US")}までの整数にしてください。`,
      cpuInvalidSeed: (maximum) => `シードは0から${maximum.toLocaleString("en-US")}までの整数にしてください。`,
      simulationPersistenceUnavailable: "このブラウザにローカルのシミュレーション記録を保存できないため、CPU結果を記録しませんでした。",
      cpuSimulationRecorded: "CPUシミュレーションをこのブラウザに記録しました。Nala実行の開始やアーティファクトの検証は行っていません。",
      simulationFailed: "記録を作成する前にCPUシミュレーションが失敗しました。",
      simulationBoundary: "解析済みの限定ゲートモデルから、このブラウザで状態ベクトルを実行します。正確な下書きフィンガープリントを記録しますが、未保存の編集はボールトバージョンを更新しません。ローカル記録は検証、Nala実行、ハードウェア実行ではありません。",
      simulationArtifact: "アーティファクト",
      sourceFingerprint: "ソースフィンガープリント",
      interchangeFingerprint: "中間表現フィンガープリント",
      simulationModel: "実行モデル",
      directSourceModel: "直接解析したソース",
      standardDecompositionModel: "OpenQASM標準ゲート分解 · グローバル位相の留意事項あり",
      simulator: "シミュレータ",
      browserCpu: "ブラウザCPU",
      runCpuSimulation: "CPUシミュレーションを実行",
      rerunCpuSimulation: "CPUシミュレーションをもう一度実行",
      rerunPrompt: "この同一ソースにはすでにローカルのシミュレーション記録があります。確認すると、以前の結果を上書きせずに新しい記録を作成します。",
      confirmRerun: "再実行を確認",
      cancel: "キャンセル",
      hardwareLanes: "ハードウェアレーン",
      gpuSimulation: "GPUシミュレーション",
      qpuExecution: "QPU実行",
      gpuUnavailable: "GPUシミュレーションは計画中です。プロバイダー、コスト、セキュリティの作業が完了するまで利用できません。",
      qpuUnavailable: "QPU実行は計画中です。プロバイダー、見積り、確認、利用ポリシーが整うまで利用できません。",
      simulationResults: "シミュレーション記録",
      simulationNoRecords: "このブラウザには、このアーティファクトのCPUシミュレーション記録がありません。",
      simulationRecord: "CPUシミュレーション記録",
      artifactVersion: "基準ボールトバージョン",
      operations: "操作数",
      resultCounts: "全サンプル測定値",
      simulationDistribution: "サンプル分布",
      simulationPeak: "ピーク状態",
      simulationOtherBar: (states) => `他 ${states} 状態`,
      simulationRecordSummary: (shots, qubits) => `${shots} ショット · ${qubits} 量子ビット`,
      simulationDetails: "記録の詳細",
      simulationContextDetails: "来歴と実行条件の詳細",
      readingConcentrated: (state, share) => `ショットの${share}が |${state}⟩ に集中しました — このサンプルでは単一の支配的な結果です。`,
      readingPaired: (first, second, share) => `ショットは |${first}⟩ と |${second}⟩ に集中（合計${share}）— 相関ペアの特徴です。`,
      readingSpread: (states, state, share) => `このサンプルでは${states}種類の結果が観測され、最頻は |${state}⟩（${share}）でした。`,
      hardwareCatalogLoading: "デバイスカタログを読み込み中…",
      hardwareCatalogUnavailable: "コントロールプレーンに接続できないため、QPUデバイスカタログを利用できません。",
      hardwareDevice: "デバイス",
      hardwareAccessFree: "無料キュー",
      hardwareAccessOnDemand: "オンデマンド課金",
      hardwareTaskFee: "タスク料金",
      hardwareShotFees: (shots) => `ショット料金（${shots} ショット）`,
      hardwareEstimatedTotal: "見積もり合計",
      hardwareRateConfirmed: (date) => `ベンダー料金表 · ${date} 確認`,
      hardwareRateSource: "料金の出典",
      hardwareEstimating: "見積もり中…",
      hardwareEstimateFailed: "コントロールプレーンに接続できないため、見積もりを利用できません。",
      hardwareRequestSubmission: "ハードウェア実行をリクエスト",
      hardwareVerifiedRequired: "ハードウェア実行には、この回路の検証済みボールトバージョンが必要になります。",
      hardwareInterchangeRequired: "このバージョンにはハードウェア実行に使うOpenQASMエクスポートが保存されていません。「検証して保存」を再実行してください。",
      hardwareJobStatus: "ジョブの状態",
      hardwareJobId: "プロバイダーのジョブ",
      hardwareJobError: "プロバイダーのエラー",
      hardwareRawCounts: "デバイスの生カウント",
      hardwareBlockedReason: (reason) => ({
        submission_disabled: "このデプロイメントでは、オーナーによりハードウェア実行が無効化されています。上記のデバイス・料金・見積もりは、実際の実行時にそのまま使用されるものです。",
        credentials_unconfigured: "このデプロイメントにはプロバイダーの認証情報が設定されていないため、実行できません。",
        provider_dependency_missing: "このデプロイメントにはプロバイダーSDKがインストールされていないため、実行できません。",
      }[reason] ?? "このデプロイメントではハードウェア実行を利用できません。"),
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
      runContract: "検証コントラクト",
      evidencePhysical: "物理的根拠 — 物理が示すべき結果と照合済み",
      evidenceStructural: "構造的根拠 — 回答の形式のみを確認、物理は未検証",
      evidenceCaveats: "公開リファレンス — 留意事項つきで検証済み",
      evidenceFailed: "検証に失敗しました",
      evidenceNotLoaded: "このバージョンのチェック内容は完全な記録を開くと読み込まれます。",
      openFullRecord: "検証記録の全体を開く",
      shots: "ショット数",
      seed: "シード",
      seedAuto: "自動",
      samplingNote: "CPUシミュレーションはこれらの入力を使い、検証して保存は実行プランナーにそのまま渡します。シードを空欄にすると、ブラウザで選ばれたシードを記録します。",
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
      sourceReferenceHeading: (source, target) => `${source}ソース · ${target}への変換なし`,
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
      sourceFallbackNote: (target, source) => `この回路には安全な${target}変換がないため、このタブには保存済みの${source}ソースを表示しています。${target}のコードではなくソース参照です。このタブからのエクスポートと実行は${source}を使用します。`,
      circuitTooLargeToDraw: "この回路は図として描画するには大きすぎます — 量子ビット数またはゲート数が多く、キャンバスが判読不能になります。全ソースはコードタブで確認・実行できます。",
      circuitViewerReadonly: "この回路は編集可能なビルダーより幅が広いため、読み取り専用の図として開きます。回路の編集はコードタブで行ってください。",
      readonlyDiagram: (qubits: number) => `読み取り専用の回路図 · ${qubits} 量子ビット。ドラッグ&ドロップのビルダー（最大6）より広いため、保存された回路から再構成して表示しています。編集・実行するソースはコードタブにあります。`,
      readonlyDiagramHint: "読み取り専用の表示 — 保存された回路から再構成しています。ソースの編集はコードタブで行ってください。",
      canvasOutOfDate: "この図を描いたあとにコードタブが変更されました。図は実行される内容と一致していません。",
      canvasBeyondBuilder: "コードタブのコードはこのエディタで描ける範囲を超えているため、下の図はその内容を表していません。実行されるのはコードです。",
      rebuildFromCode: "コードから再構築",
      rebuiltFromCode: "コードタブのコードから図を再構築しました。",
      applyOverwritesEditedCode: "この図を描いたあとにコードタブが変更されています。適用するとそのコードは図の内容で置き換えられます。続行しますか？",
      applyOverwritesUnrepresentableCode: "コードタブには、このエディタで描けないソースがあります。適用するとそのコードは図で置き換えられ、図から元に戻すことはできません。続行しますか？",
      confirmApply: "コードを置き換える",
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
  usageSimulation: string;
  usageUnlimited: string;
  usageRunsPerWeek: (count: number) => string;
  usageArtifacts: (count: number) => string;
  usageQubits: (count: number) => string;
  tierNames: Record<"demo" | "free" | "developer", string>;
  usageUnenforced: string;
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
    usageHelp: "No payment is collected during early access. Weekly run and Vault allowances are enforced; contact us if you need more room.",
    usagePlan: "Plan",
    usagePlanValue: "Early access",
    usageRuns: "Runs",
    usageRunsValue: "Fair use — no hard cap during early access",
    usageStorage: "Vault storage",
    usageStorageValue: "Fair use — artifacts and versions retained",
    usageSimulation: "Browser simulation",
    usageUnlimited: "Unlimited",
    usageRunsPerWeek: (count) => `${count} per week`,
    usageArtifacts: (count) => `${count} artifacts`,
    usageQubits: (count) => `Up to ${count} qubits`,
    tierNames: { demo: "Preview", free: "Free", developer: "Developer" },
    usageUnenforced: "These allowances are enforced when you submit a run. Browser simulation always stays available on your own hardware.",
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
    usageHelp: "アーリーアクセス期間中に料金は発生しません。週あたりの実行回数とボールトの上限は適用されます。追加が必要な場合はご連絡ください。",
    usagePlan: "プラン",
    usagePlanValue: "アーリーアクセス",
    usageRuns: "実行",
    usageRunsValue: "フェアユース — アーリーアクセス中は固定上限なし",
    usageStorage: "ボールト保存",
    usageStorageValue: "フェアユース — アーティファクトとバージョンを保持",
    usageSimulation: "ブラウザ実行",
    usageUnlimited: "無制限",
    usageRunsPerWeek: (count) => `週${count}回`,
    usageArtifacts: (count) => `${count}件`,
    usageQubits: (count) => `${count}量子ビットまで`,
    tierNames: { demo: "プレビュー", free: "Free", developer: "Developer" },
    usageUnenforced: "これらの上限は実行の送信時に適用されます。ブラウザーでのシミュレーションはお使いの端末上で常に利用できます。",
    billingTitle: "請求とクレジット",
    billingHelp: "Leona Quantum がエージェント実行とハードウェアに課金する仕組みです。透明性のために表示しており、支払いは有効化されていません。",
    billingPayments: "支払い",
    billingPaymentsDisabled: "無効です。支払い方法を追加せずに全フローを確認できます。このデプロイメントにはカード入力・チェックアウト・請求は存在しません。",
    billingBackend: "請求バックエンド",
    billingBackendConfigured: "Stripe は将来の請求のために接続済みです。支払い方法は保持せず、誰にも請求できません。",
    billingBackendUnconfigured: "このデプロイメントでは Stripe は設定されていません。",
    billingUnavailable: "コントロールプレーンに接続できないため、請求ステータスを利用できません。",
    billingPolicyTitle: "暫定クレジットポリシー",
    billingPolicyHelp: "オーナー承認の方針を透明性のために表示しています。まだ適用されておらず、提供開始前に変更される可能性があります。",
    billingPolicyFree: "無料プラン",
    billingPolicyFreeValue: "週あたり約5回のエージェント実行",
    billingPolicyDemo: "デモクレジット",
    billingPolicyDemoValue: "約15回のエージェント実行（初回使用から約2週間で失効）",
    billingPolicyCpu: "ブラウザCPUシミュレーション",
    billingPolicyCpuValue: "無料 — 10分あたり約10回を目安",
    billingPolicyHardware: "GPU / QPU ハードウェア",
    billingPolicyHardwareValue: "オーナー承認制。実行前に Studio のハードウェアレーンに出典付き見積もりが表示されます。",
    billingEstimatesLink: "Studio でハードウェア見積もりを見る",
  },
};
