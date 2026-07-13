import { StudioWorkspace } from "./studio-workspace";

export const metadata = { title: "Studio — Majorana" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ artifact?: string }> }) {
  const params = await searchParams;
  return <StudioWorkspace artifactId={params.artifact} />;
}
