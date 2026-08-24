import { QappWorkspace } from "./qapp-workspace";

export const metadata = { title: "Qapp — Leona Quantum" };

export default async function QappPage({ params }: { params: Promise<{ qappId: string }> }) {
  const { qappId } = await params;
  return <QappWorkspace qappId={qappId} />;
}
