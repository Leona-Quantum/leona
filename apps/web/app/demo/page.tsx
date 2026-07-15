import { notFound } from "next/navigation";
import { isPublicDemoEnabled } from "../../lib/public-demo";
import { getPublicLocale } from "../../lib/public-locale-server";
import { DemoWorkspace } from "./demo-workspace";

export const metadata = { title: "LeonaQ public preview" };

export default async function DemoPage() {
  if (!isPublicDemoEnabled()) notFound();
  return <DemoWorkspace locale={await getPublicLocale()} />;
}
