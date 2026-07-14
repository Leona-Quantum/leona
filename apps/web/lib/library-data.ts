import type { RunEvent } from "@majorana/ui";

export type LibraryStatus = "verified" | "verified_caveats" | "failed";

export interface LibraryArtifact {
  id: string;
  slug: string;
  title: string;
  family: string;
  framework: string;
  status: LibraryStatus;
  updatedAt: string;
  description: string;
  tags: string[];
  verification: string;
  code: string;
  frameworkVariants?: Record<string, string>;
  qasm: string | null;
  currentVersionId?: string;
  resourceRows: Array<{ label: string; value: string }>;
  runId?: string;
  source: "demo" | "run" | "public";
}

const STORAGE_KEY = "majorana.library.v1";
const LIBRARY_EVENT = "majorana:library";
const DEMO_ARTIFACT_IDS = new Set([
  "a7c1b0d2-0000-4000-8000-0000000000aa",
  "a7c1b0d2-0000-4000-8000-0000000000bb",
  "a7c1b0d2-0000-4000-8000-0000000000cc",
  "a7c1b0d2-0000-4000-8000-0000000000dd",
]);

const DEMO_CODE = `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qc = QuantumCircuit(5)
qc.h(range(5))
for a, b in [(0, 1), (1, 2), (2, 3), (3, 4), (4, 0)]:
    qc.cx(a, b)
    qc.rz(0.8, b)
    qc.cx(a, b)
qc.measure_all()`;

const DEMO_ARTIFACTS: LibraryArtifact[] = [
  {
    id: "a7c1b0d2-0000-4000-8000-0000000000aa",
    slug: "qaoa-maxcut-ring",
    title: "QAOA MaxCut on a 5-node ring",
    family: "QAOA",
    framework: "Qiskit",
    status: "verified",
    updatedAt: "2026-07-12T12:04:00.000Z",
    description: "A p=1 QAOA circuit with a classical MaxCut comparison and reproducible simulation evidence.",
    tags: ["optimization", "maxcut", "simulation"],
    verification: "Statistical TVD 0.0088 ≤ δ 0.05 · seed 42 · 4096 shots",
    code: DEMO_CODE,
    qasm: "OpenQASM 3 export available from the verified run.",
    resourceRows: [
      { label: "Qubits", value: "5 qubits" },
      { label: "Depth", value: "14 gates deep" },
      { label: "Runtime", value: "40 ms estimated" },
    ],
    source: "demo",
  },
  {
    id: "a7c1b0d2-0000-4000-8000-0000000000bb",
    slug: "bell-state-qiskit",
    title: "Bell state measurement",
    family: "Bell",
    framework: "Qiskit",
    status: "verified",
    updatedAt: "2026-07-10T15:10:00.000Z",
    description: "A two-qubit entanglement example with a return-contract and distribution check.",
    tags: ["entanglement", "intro", "verification"],
    verification: "Exact state check · return contract passed",
    code: "from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(2)\nqc.h(0)\nqc.cx(0, 1)\nqc.measure_all()",
    qasm: "OpenQASM 3 export available.",
    resourceRows: [
      { label: "Qubits", value: "2 qubits" },
      { label: "Depth", value: "2 gates deep" },
      { label: "Runtime", value: "12 ms estimated" },
    ],
    source: "demo",
  },
  {
    id: "a7c1b0d2-0000-4000-8000-0000000000cc",
    slug: "ghz-state-pennylane",
    title: "GHZ state preparation",
    family: "GHZ",
    framework: "PennyLane",
    status: "verified_caveats",
    updatedAt: "2026-07-09T10:12:00.000Z",
    description: "A reusable GHZ state preparation circuit with simulator-only evidence.",
    tags: ["state preparation", "pennylane", "simulator"],
    verification: "Structural checks passed · simulator-only caveat",
    code: "import pennylane as qml\n\n@qml.qnode(qml.device(\"default.qubit\", wires=4))\ndef ghz():\n    qml.Hadamard(0)\n    for wire in range(1, 4):\n        qml.CNOT(wires=[0, wire])\n    return qml.probs(wires=range(4))",
    qasm: null,
    resourceRows: [
      { label: "Qubits", value: "4 qubits" },
      { label: "Depth", value: "2 layers" },
      { label: "Runtime", value: "18 ms estimated" },
    ],
    source: "demo",
  },
  {
    id: "a7c1b0d2-0000-4000-8000-0000000000dd",
    slug: "qft-resource-screen",
    title: "QFT resource screen",
    family: "QFT",
    framework: "Cirq",
    status: "verified",
    updatedAt: "2026-07-07T08:45:00.000Z",
    description: "A resource-focused QFT construction with a readable compile comparison.",
    tags: ["resource estimate", "cirq", "qft"],
    verification: "QASM parse · compilation compatibility passed",
    code: "import cirq\n\nqubits = cirq.LineQubit.range(4)\ncircuit = cirq.Circuit()\n# QFT construction is stored with the verified artifact.",
    qasm: "Export classified as lossless for the stored Cirq circuit.",
    resourceRows: [
      { label: "Qubits", value: "4 qubits" },
      { label: "Depth", value: "18 gates deep" },
      { label: "Runtime", value: "31 ms estimated" },
    ],
    source: "demo",
  },
];

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function emitChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LIBRARY_EVENT));
}

function persist(artifacts: LibraryArtifact[]): LibraryArtifact[] {
  if (canUseStorage()) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(artifacts));
  emitChange();
  return artifacts;
}

export function loadLibraryArtifacts({ includeDemo = false }: { includeDemo?: boolean } = {}): LibraryArtifact[] {
  if (!canUseStorage()) return includeDemo ? DEMO_ARTIFACTS : [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return includeDemo ? DEMO_ARTIFACTS : [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return includeDemo ? DEMO_ARTIFACTS : [];
    const valid = parsed
      .filter(isLibraryArtifact)
      .filter((artifact) => includeDemo || !isDemoArtifact(artifact))
      .sort(sortNewestFirst);
    if (!includeDemo) return valid;
    const local = valid.filter((artifact) => !isDemoArtifact(artifact));
    return [...DEMO_ARTIFACTS, ...local].sort(sortNewestFirst);
  } catch {
    return includeDemo ? DEMO_ARTIFACTS : [];
  }
}

export function getLibraryArtifact(id: string): LibraryArtifact | null {
  return loadLibraryArtifacts().find((artifact) => artifact.id === id) ?? null;
}

export function rememberArtifact(artifact: LibraryArtifact): LibraryArtifact[] {
  const current = loadLibraryArtifacts().filter((item) => item.id !== artifact.id);
  return persist([artifact, ...current].sort(sortNewestFirst));
}

export function rememberArtifactFromRun(events: readonly RunEvent[], prompt: string): LibraryArtifact | null {
  const saved = events.find((event) => event.type === "artifact.saved");
  if (!saved || saved.type !== "artifact.saved") return null;
  const queued = events.find((event) => event.type === "run.queued");
  const plan = events.find((event) => event.type === "plan.produced");
  const finalCode = [...events].reverse().find((event) => event.type === "code.finalized");
  const generatedCode = [...events].reverse().find((event) => event.type === "code.generated");
  const finished = [...events].reverse().find((event) => event.type === "run.finished");
  const verify = [...events].reverse().find((event) => event.type === "verification.result");
  const resource = [...events].reverse().find((event) => event.type === "resource.estimate");
  const code = finalCode?.type === "code.finalized" ? finalCode.code : generatedCode?.type === "code.generated" ? generatedCode.code : "";
  const frameworkVariants = finalCode?.type === "code.finalized"
    ? Object.fromEntries(Object.entries(finalCode.framework_variants ?? {}).map(([name, variant]) => [name, variant.code]))
    : undefined;
  const title = plan?.type === "plan.produced" ? plan.plan.problem_summary : prompt;
  const family = plan?.type === "plan.produced" ? plan.plan.algorithm : "Simulation";
  const framework = plan?.type === "plan.produced" ? plan.plan.framework : queued?.type === "run.queued" ? queued.framework : "Qiskit";
  const updatedAt = finished?.ts ?? saved.ts;
  const verification = verify?.type === "verification.result" ? formatVerification(verify) : "Verification evidence saved with the run.";
  const resourceRows = resource?.type === "resource.estimate" ? resourceRowsFromEvent(resource.metrics) : [];
  const artifact: LibraryArtifact = {
    id: saved.artifact_id,
    slug: slugify(title),
    title,
    family,
    framework,
    status: finished?.type === "run.finished" && finished.verifier_decision === "pass" ? "verified" : "verified_caveats",
    updatedAt,
    description: `Saved from the verified Nameko run for: ${prompt}`,
    tags: [String(family).toLowerCase(), String(framework).toLowerCase(), "run"],
    verification,
    code,
    frameworkVariants,
    qasm: "OpenQASM 3 availability follows the saved run export classification.",
    currentVersionId: saved.version_id,
    resourceRows,
    runId: saved.run_id,
    source: "run",
  };
  rememberArtifact(artifact);
  return artifact;
}

function formatVerification(event: Extract<RunEvent, { type: "verification.result" }>): string {
  const details = (event.details ?? {}) as Record<string, unknown>;
  const metric = typeof details.metric === "string" ? details.metric : event.method;
  const value = typeof details.metric_value === "number" ? details.metric_value : null;
  const threshold = typeof details.threshold === "number" ? details.threshold : null;
  if (value !== null && threshold !== null) return `${metric} ${value} ≤ δ ${threshold}`;
  return `${event.method} ${event.result}`;
}

function resourceRowsFromEvent(metrics: Record<string, unknown>): Array<{ label: string; value: string }> {
  return Object.entries(metrics).flatMap(([label, value]) => {
    if (typeof value !== "string" && typeof value !== "number") return [];
    const unit = label.includes("runtime") ? " ms" : label.includes("count") || label === "depth" || label === "qubits" ? "" : "";
    return [{ label: label.replaceAll("_", " "), value: `${value}${unit}` }];
  });
}

export function frameworkVariantsFromRemote(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const variants = Object.entries(value as Record<string, unknown>).flatMap(([name, code]) =>
    typeof code === "string" ? [[name, code] as const] : [],
  );
  return variants.length ? Object.fromEntries(variants) : undefined;
}

function slugify(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "saved-artifact";
}

function sortNewestFirst(a: LibraryArtifact, b: LibraryArtifact): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function isLibraryArtifact(value: unknown): value is LibraryArtifact {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LibraryArtifact>;
  return typeof candidate.id === "string" && typeof candidate.title === "string" && typeof candidate.updatedAt === "string";
}

function isDemoArtifact(artifact: LibraryArtifact): boolean {
  return artifact.source === "demo" || DEMO_ARTIFACT_IDS.has(artifact.id);
}
