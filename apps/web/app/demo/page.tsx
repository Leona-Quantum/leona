import { notFound } from "next/navigation";
import { isPublicDemoEnabled } from "../../lib/public-demo";
import { DemoWorkspace } from "./demo-workspace";

export const metadata = { title: "LeonaQ public preview" };

export default function DemoPage() {
  if (!isPublicDemoEnabled()) notFound();
  return <DemoWorkspace />;
}
