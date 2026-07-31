import { redirect } from "next/navigation";

// The Vault's artifact detail retires with its list. Studio already addresses
// the same artifact by id, so the old deep link keeps resolving to the artifact
// it named rather than dropping the person on a list to search it out again.
export default async function ArtifactPage({ params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  redirect(`/studio?artifact=${encodeURIComponent(artifactId)}`);
}
