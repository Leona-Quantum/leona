import { StudioWorkspace } from "./studio-workspace";
import { VqeProofPanel } from "./vqe-proof-panel";
import { VqeExperimentLauncher } from "./vqe-experiment-launcher";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { getAccountTier } from "../../../lib/account-tier-server";
import { parseVqeFramework } from "../../../lib/vqe-workflow-launch";

export const metadata = { title: "Studio — Leona Quantum" };

type StudioSearchParams = {
  artifact?: string;
  new?: string;
  vqe?: string;
  vqeExperiment?: string;
  vqeFramework?: string;
  vqeProvider?: string;
  vqeMigration?: string;
  vqeSwap?: string;
  vqeWorkflow?: string;
  vqeWorkflowKey?: string;
};

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<StudioSearchParams>;
}) {
  const [params, locale, { limits }] = await Promise.all([
    searchParams,
    getPublicLocale(),
    getAccountTier(),
  ]);
  if (params.vqeExperiment) {
    return (
      <VqeProofPanel
        experimentId={params.vqeExperiment}
        initialFramework={parseVqeFramework(params.vqeFramework)}
        locale={locale}
      />
    );
  }
  if (params.vqe === "1" || params.vqeWorkflow || params.vqeWorkflowKey) {
    return (
      <VqeExperimentLauncher
        initialFramework={parseVqeFramework(params.vqeProvider)}
        initialWorkflowId={params.vqeWorkflow}
        initialWorkflowKey={params.vqeWorkflowKey}
        initialMigration={params.vqeMigration}
        initialSwapComponentKey={params.vqeSwap}
        locale={locale}
      />
    );
  }
  // Only the numbers cross into the client component. The allowlist that
  // produced them stays on the server.
  return <StudioWorkspace artifactId={params.artifact} newDraft={params.new === "1"} locale={locale} limits={limits} />;
}
