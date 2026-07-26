import type { RunEvent } from "@majorana/ui";
import type { MeasuredResult } from "./measured-result.ts";
import type { VerificationCheck, VerificationSummary } from "./verification-record.ts";
import { verificationFromResource, verificationSummaryFromValue } from "./verification-record.ts";

/** `structural` is a pass whose evidence was contract checks only — the result dict
 * had the promised keys, the qubit count was within the plan's ceiling — with nothing
 * compared against what the physics should do. It is a real pass, and it is not the
 * claim "verified" makes, so it gets its own word. See
 * `plans/evidence-strength-labelling.md`. */
export type LibraryStatus = "verified" | "structural" | "verified_caveats" | "inconclusive" | "failed" | "legacy_unknown" | "stale";

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
  archivedAt?: string;
  source: "demo" | "run" | "public";
  // The checks the pipeline actually ran, read off the saved version's metadata.
  // Until 2026-07-20 the Verification tab described these in a fixed paragraph
  // that named checks generically and could not distinguish a run that proved a
  // circuit's unitary from one that only confirmed its return keys.
  checks?: VerificationCheck[];
  criticSummary?: string;
  verificationSummary?: VerificationSummary | null;
  // What the program measured, stored on the version so a reopened artifact shows
  // numbers and not only a verdict. Absent on artifacts saved before 2026-07-26.
  measuredResult?: MeasuredResult | null;
}

const STORAGE_KEY = "majorana.library.v1";
const DELETED_STORAGE_KEY = "majorana.deleted-artifacts.v1";
const STARRED_STORAGE_KEY = "majorana.library-stars.v1";
export const ARTIFACT_ARCHIVE_RETENTION_DAYS = 14;
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

function persistSilently(artifacts: LibraryArtifact[]): void {
  if (canUseStorage()) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(artifacts));
}

function loadDeletedIds(): Set<string> {
  if (!canUseStorage()) return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DELETED_STORAGE_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function persistDeletedIds(ids: Set<string>): void {
  if (canUseStorage()) window.localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify([...ids]));
}

function loadStarredIds(): Set<string> {
  if (!canUseStorage()) return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STARRED_STORAGE_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

export function loadStarredLibraryArtifactIds(): Set<string> {
  return loadStarredIds();
}

export function isLibraryArtifactStarred(id: string): boolean {
  return loadStarredIds().has(id);
}

export function toggleLibraryArtifactStar(id: string): boolean {
  const starred = loadStarredIds();
  if (starred.has(id)) starred.delete(id);
  else starred.add(id);
  if (canUseStorage()) window.localStorage.setItem(STARRED_STORAGE_KEY, JSON.stringify([...starred]));
  emitChange();
  return starred.has(id);
}

export function loadLibraryArtifacts({ includeDemo = false, includeArchived = false }: { includeDemo?: boolean; includeArchived?: boolean } = {}): LibraryArtifact[] {
  if (!canUseStorage()) return includeDemo ? DEMO_ARTIFACTS : [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return includeDemo ? DEMO_ARTIFACTS : [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return includeDemo ? DEMO_ARTIFACTS : [];
    const deletedIds = loadDeletedIds();
    const valid = parsed
      .filter(isLibraryArtifact)
      // localStorage may restore presentation data while the API settles, but it
      // is never a trust source. Only the typed API resource can promote this row.
      .map((artifact) => isDemoArtifact(artifact) ? artifact : { ...artifact, status: "legacy_unknown" as const, verificationSummary: null })
      .filter((artifact) => !deletedIds.has(artifact.id))
      .filter((artifact) => includeDemo || !isDemoArtifact(artifact))
      .sort(sortNewestFirst);
    const retained = valid.filter((artifact) => !artifact.archivedAt || !isArtifactArchiveExpired(artifact.archivedAt));
    if (retained.length !== valid.length) persistSilently(retained);
    const visible = includeArchived ? retained : retained.filter((artifact) => !artifact.archivedAt);
    if (!includeDemo) return visible;
    const local = retained.filter((artifact) => !isDemoArtifact(artifact));
    return [...DEMO_ARTIFACTS, ...local.filter((artifact) => includeArchived || !artifact.archivedAt)].sort(sortNewestFirst);
  } catch {
    return includeDemo ? DEMO_ARTIFACTS : [];
  }
}

export function getLibraryArtifact(id: string): LibraryArtifact | null {
  return loadLibraryArtifacts().find((artifact) => artifact.id === id) ?? null;
}

export function rememberArtifact(artifact: LibraryArtifact): LibraryArtifact[] {
  const deletedIds = loadDeletedIds();
  deletedIds.delete(artifact.id);
  persistDeletedIds(deletedIds);
  const current = loadLibraryArtifacts({ includeArchived: true }).filter((item) => item.id !== artifact.id);
  const activeArtifact = { ...artifact };
  delete activeArtifact.archivedAt;
  return persist([activeArtifact, ...current].sort(sortNewestFirst));
}

export function archiveArtifact(id: string, fallback?: LibraryArtifact): LibraryArtifact[] {
  const current = loadLibraryArtifacts({ includeArchived: true });
  const archivedAt = new Date().toISOString();
  const existing = current.find((artifact) => artifact.id === id);
  if (existing) return persist(current.map((artifact) => (artifact.id === id ? { ...artifact, archivedAt } : artifact)));
  if (!fallback) return current;
  return persist([{ ...fallback, archivedAt }, ...current].sort(sortNewestFirst));
}

export function restoreArtifact(id: string): LibraryArtifact[] {
  return persist(
    loadLibraryArtifacts({ includeArchived: true }).map((artifact) => {
      if (artifact.id !== id) return artifact;
      const restored = { ...artifact };
      delete restored.archivedAt;
      return restored;
    }),
  );
}

/** Soft-delete server-side. Resolves when the row is really gone (or was never there). */
async function deleteArtifactRemote(id: string): Promise<void> {
  const response = await fetch(`/api/artifacts/${encodeURIComponent(id)}`, { method: "DELETE" });
  // 404 is success for the user's intent: demo fixtures and artifacts that were
  // never persisted have no server row to delete. Anything else is a real
  // failure and must not be reported to the user as a deletion.
  if (!response.ok && response.status !== 404) {
    throw new Error(`artifact delete failed (${response.status})`);
  }
}

/**
 * Delete an artifact from the Library, server first.
 *
 * Previously this only added the id to a localStorage tombstone list, so the
 * row stayed in Postgres and came back on any other device or after clearing
 * site data. The server call now happens FIRST and is awaited: if it fails the
 * local state is left untouched and the error propagates, so the UI can never
 * show a deletion that did not actually happen.
 */
export async function deleteArtifact(id: string): Promise<LibraryArtifact[]> {
  await deleteArtifactRemote(id);
  const deletedIds = loadDeletedIds();
  deletedIds.add(id);
  persistDeletedIds(deletedIds);
  return persist(loadLibraryArtifacts({ includeArchived: true }).filter((artifact) => artifact.id !== id));
}

export function isArtifactDeleted(id: string): boolean {
  return loadDeletedIds().has(id);
}

export function daysUntilArtifactDeletion(archivedAt: string, now = new Date()): number {
  const expiresAt = new Date(archivedAt).valueOf() + ARTIFACT_ARCHIVE_RETENTION_DAYS * 86_400_000;
  return Math.max(0, Math.ceil((expiresAt - now.valueOf()) / 86_400_000));
}

function isArtifactArchiveExpired(archivedAt: string): boolean {
  return daysUntilArtifactDeletion(archivedAt) <= 0;
}

/** A just-finished run still uses the typed summary carried by its terminal event.
 * RunStatus and the legacy top-level decision are workflow fields, not trust evidence. */
function statusFromFinished(finished: RunEvent | undefined): LibraryStatus {
  if (finished?.type !== "run.finished") return "legacy_unknown";
  return statusFromVerificationSummary(verificationSummaryFromValue(finished.verification_summary));
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
    status: statusFromFinished(finished),
    updatedAt,
    description: statusFromFinished(finished) === "inconclusive"
      ? `Saved from an executed, unverified Leona Run for: ${prompt}`
      : `Saved from the Leona Run for: ${prompt}`,
    tags: [String(family).toLowerCase(), String(framework).toLowerCase(), "run"],
    verification,
    code,
    frameworkVariants,
    qasm: "OpenQASM 3 availability follows the saved run export classification.",
    currentVersionId: saved.version_id,
    resourceRows,
    runId: saved.run_id,
    verificationSummary: finished?.type === "run.finished"
      ? verificationSummaryFromValue(finished.verification_summary)
      : null,
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

/** Map only the API's typed summary to a Vault status. Absence remains unknown. */
export function statusFromVerificationSummary(summary: VerificationSummary | null): LibraryStatus {
  if (!summary) return "legacy_unknown";
  if (summary.decision === "fail") return "failed";
  if (summary.decision === "inconclusive") return "inconclusive";
  return summary.evidence_strength === "physical" ? "verified" : "structural";
}

export function statusFromResource(artifact: Record<string, unknown>): LibraryStatus {
  return statusFromVerificationSummary(verificationFromResource(artifact));
}

/** The one mapper from `GET /v1/artifacts` to a LibraryArtifact.
 *
 * There were two, near-identical, in library-studio.tsx and studio-workspace.tsx.
 * The Vault's copy was fixed to read the server's grade; Studio's was not, and
 * kept `status: existing?.status ?? "verified"` — so any artifact not already in
 * this browser's localStorage was shown as "Verified" in Studio's picker
 * regardless of what the pipeline actually proved, including artifacts that only
 * ever earned a structural pass. One function cannot drift from itself.
 */
export function artifactFromResource(value: unknown): LibraryArtifact[] {
  if (!value || typeof value !== "object") return [];
  const artifact = value as Record<string, unknown>;
  if (typeof artifact.id !== "string" || typeof artifact.title !== "string") return [];
  const existing = getLibraryArtifact(artifact.id);
  const slug = typeof artifact.slug === "string" ? artifact.slug : artifact.id;
  const isPublicReference = slug.startsWith("public-");
  const family = typeof artifact.family === "string" ? artifact.family : "Simulation";
  const verificationSummary = verificationFromResource(artifact);
  return [{
    id: artifact.id,
    slug,
    title: artifact.title,
    family,
    framework: typeof artifact.framework === "string" ? artifact.framework : "Qiskit",
    status: statusFromVerificationSummary(verificationSummary),
    updatedAt: typeof artifact.updated_at === "string" ? artifact.updated_at : new Date().toISOString(),
    description: existing?.description ?? "Saved artifact in the workspace vault.",
    tags: existing?.tags ?? [family.toLowerCase()],
    verification: existing?.verification ?? "Verification record available in artifact detail.",
    code: existing?.code ?? "",
    qasm: existing?.qasm ?? null,
    currentVersionId: typeof artifact.current_version_id === "string" ? artifact.current_version_id : existing?.currentVersionId,
    resourceRows: existing?.resourceRows ?? [],
    runId: existing?.runId,
    // Carried through so Studio's Versions tab can show the checks the pipeline
    // actually ran rather than a version id and nothing else.
    checks: existing?.checks,
    criticSummary: existing?.criticSummary,
    verificationSummary,
    source: existing?.source ?? (isPublicReference ? "public" : "run"),
  }];
}
