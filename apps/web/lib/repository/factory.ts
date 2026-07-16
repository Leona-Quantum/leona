import type {
  PublicRepositoryCategory,
  PublicRepositoryCitation,
  PublicRepositoryClassicalComparison,
  PublicRepositoryCodeVariant,
  PublicRepositoryEntry,
  PublicRepositoryFramework,
  PublicRepositoryStatus,
} from "./types";
import type { VerificationMethodId } from "./verification";

export type ReferenceEntryOptions = {
  slug: string;
  title: string;
  titleJa: string;
  category: PublicRepositoryCategory;
  categoryLabel: string;
  categoryLabelJa: string;
  algorithmFamily: string;
  framework: PublicRepositoryFramework;
  status?: PublicRepositoryStatus;
  verification: string;
  verificationMethods?: VerificationMethodId[];
  method: string;
  result: string;
  caveat?: string;
  exportStatus: string;
  provenance: string;
  updatedAt: string;
  description: string;
  descriptionJa: string;
  introduction: string;
  introductionJa: string;
  explanation: string;
  explanationJa: string;
  explanationMd?: string;
  explanationMdJa?: string;
  tags: string[];
  resources: Array<{ label: string; value: string }>;
  metadata: Array<{ label: string; value: string }>;
  sourceTitle: string;
  sourceUrl: string;
  sourceLicense?: string;
  wires: string[];
  operations: Array<{ label: string; qubits: number[]; tone: "accent" | "ok" | "warn" | "neutral" }>;
  outcomes: Array<{ label: string; probability: number }>;
  code: string;
  filename: string;
  language: PublicRepositoryCodeVariant["language"];
  /** Additional framework variants beyond the primary `code` snippet. */
  extraVariants?: PublicRepositoryCodeVariant[];
  relatedSlugs: string[];
  literature?: PublicRepositoryCitation[];
  classicalComparison?: PublicRepositoryClassicalComparison;
  industryUseCases?: string[];
  industryUseCasesJa?: string[];
};

export function makeReferenceEntry(options: ReferenceEntryOptions): PublicRepositoryEntry {
  return {
    slug: options.slug,
    title: options.title,
    titleJa: options.titleJa,
    category: options.category,
    categoryLabel: options.categoryLabel,
    categoryLabelJa: options.categoryLabelJa,
    algorithmFamily: options.algorithmFamily,
    framework: options.framework,
    status: options.status ?? "verified",
    ...(options.verificationMethods ? { verificationMethods: options.verificationMethods } : {}),
    verification: options.verification,
    verificationDetails: {
      method: options.method,
      result: options.result,
      ...(options.caveat ? { caveat: options.caveat } : {}),
    },
    exportStatus: options.exportStatus,
    provenance: options.provenance,
    updatedAt: options.updatedAt,
    description: options.description,
    descriptionJa: options.descriptionJa,
    introduction: options.introduction,
    introductionJa: options.introductionJa,
    explanation: options.explanation,
    explanationJa: options.explanationJa,
    ...(options.explanationMd ? { explanationMd: options.explanationMd } : {}),
    ...(options.explanationMdJa ? { explanationMdJa: options.explanationMdJa } : {}),
    tags: options.tags,
    resources: options.resources,
    metadata: options.metadata,
    source: {
      kind: options.status === "community_review" ? "community_submission" : "curated_reference",
      title: options.sourceTitle,
      url: options.sourceUrl,
      reviewedBy: "Leona Quantum curation pass",
      license: options.sourceLicense ?? "CC BY 4.0-compatible reference metadata",
    },
    visualization: {
      wires: options.wires,
      operations: options.operations,
      outcomes: options.outcomes,
    },
    codeVariants: [
      {
        framework: options.framework,
        status: "native",
        language: options.language,
        filename: options.filename,
        code: options.code,
      },
      ...(options.extraVariants ?? []),
    ],
    relatedSlugs: options.relatedSlugs,
    ...(options.literature ? { literature: options.literature } : {}),
    ...(options.classicalComparison ? { classicalComparison: options.classicalComparison } : {}),
    ...(options.industryUseCases ? { industryUseCases: options.industryUseCases } : {}),
    ...(options.industryUseCasesJa ? { industryUseCasesJa: options.industryUseCasesJa } : {}),
  };
}
