export type PublicRepositoryStatus = "verified" | "verified_caveats";

export interface PublicRepositoryEntry {
  slug: string;
  title: string;
  algorithmFamily: string;
  framework: string;
  status: PublicRepositoryStatus;
  verification: string;
  exportStatus: string;
  provenance: string;
  updatedAt: string;
  description: string;
  tags: string[];
  resources: Array<{ label: string; value: string }>;
}

// Public reference records are deliberately separate from the private Library store.
// They are the first thin catalog layer: classification, evidence, export status, and
// provenance are visible without exposing workspace data or pretending the API is done.
export const PUBLIC_REPOSITORY_ENTRIES: PublicRepositoryEntry[] = [
  {
    slug: "qaoa-maxcut-ring",
    title: "QAOA MaxCut on a 5-node ring",
    algorithmFamily: "QAOA",
    framework: "Qiskit",
    status: "verified",
    verification: "Statistical TVD 0.0088 ≤ δ 0.05 · seed 42 · 4096 shots",
    exportStatus: "OpenQASM 3 available",
    provenance: "Curated reference",
    updatedAt: "2026-07-12",
    description: "A p=1 QAOA circuit with a classical MaxCut comparison and reproducible simulation evidence.",
    tags: ["optimization", "maxcut", "simulation"],
    resources: [
      { label: "Qubits", value: "5" },
      { label: "Depth", value: "14 gates" },
      { label: "Runtime", value: "40 ms est." },
    ],
  },
  {
    slug: "bell-state-qiskit",
    title: "Bell state measurement",
    algorithmFamily: "Bell",
    framework: "Qiskit",
    status: "verified",
    verification: "Exact state check · return contract passed",
    exportStatus: "OpenQASM 3 available",
    provenance: "Verified starter",
    updatedAt: "2026-07-10",
    description: "A two-qubit entanglement example with a return-contract and distribution check.",
    tags: ["entanglement", "intro", "verification"],
    resources: [
      { label: "Qubits", value: "2" },
      { label: "Depth", value: "2 gates" },
      { label: "Runtime", value: "12 ms est." },
    ],
  },
  {
    slug: "ghz-state-pennylane",
    title: "GHZ state preparation",
    algorithmFamily: "GHZ",
    framework: "PennyLane",
    status: "verified_caveats",
    verification: "Structural checks passed · simulator-only caveat",
    exportStatus: "Code-only · framework-specific",
    provenance: "Framework example",
    updatedAt: "2026-07-09",
    description: "A reusable GHZ state preparation circuit with simulator-only evidence.",
    tags: ["state preparation", "pennylane", "simulator"],
    resources: [
      { label: "Qubits", value: "4" },
      { label: "Depth", value: "2 layers" },
      { label: "Runtime", value: "18 ms est." },
    ],
  },
  {
    slug: "qft-resource-screen",
    title: "QFT resource screen",
    algorithmFamily: "QFT",
    framework: "Cirq",
    status: "verified",
    verification: "QASM parse · compilation compatibility passed",
    exportStatus: "Lossless export classified",
    provenance: "Curated reference",
    updatedAt: "2026-07-07",
    description: "A resource-focused QFT construction with a readable compile comparison.",
    tags: ["resource estimate", "cirq", "qft"],
    resources: [
      { label: "Qubits", value: "4" },
      { label: "Depth", value: "18 gates" },
      { label: "Runtime", value: "31 ms est." },
    ],
  },
];
