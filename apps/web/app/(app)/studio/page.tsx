import { StudioWorkspace } from "./studio-workspace";
import { VqeProofPanel } from "./vqe-proof-panel";
import { VqeExperimentLauncher } from "./vqe-experiment-launcher";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { getAccountTier } from "../../../lib/account-tier-server";

export const metadata = { title: "Studio — Leona Quantum" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ artifact?: string; new?: string; vqe?: string; vqeExperiment?: string; vqeWorkflow?: string }> }) {
  const [params, locale, { limits }] = await Promise.all([
    searchParams,
    getPublicLocale(),
    getAccountTier(),
  ]);
  if (params.vqeExperiment) {
    return <VqeProofPanel experimentId={params.vqeExperiment} locale={locale} />;
  }
  if (params.vqe === "1" || params.vqeWorkflow) {
    return <VqeExperimentLauncher initialWorkflowId={params.vqeWorkflow} locale={locale} />;
  }
  // Only the numbers cross into the client component. The allowlist that
  // produced them stays on the server.
  return <StudioWorkspace artifactId={params.artifact} newDraft={params.new === "1"} locale={locale} limits={limits} />;
}
