import { ArtifactDetail } from "./artifact-detail";
import { getPublicLocale } from "../../../../lib/public-locale-server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  return { title: `Artifact ${artifactId} — Leona Quantum Library` };
}

export default async function ArtifactPage({ params }: { params: Promise<{ artifactId: string }> }) {
  const [{ artifactId }, locale] = await Promise.all([params, getPublicLocale()]);
  return <ArtifactDetail artifactId={artifactId} locale={locale} />;
}
