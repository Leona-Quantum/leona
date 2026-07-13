import { ArtifactDetail } from "./artifact-detail";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  return { title: `Artifact ${artifactId} — Library` };
}

export default async function ArtifactPage({ params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  return <ArtifactDetail artifactId={artifactId} />;
}
