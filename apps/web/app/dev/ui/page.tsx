import { notFound } from "next/navigation";
import { Shell } from "../../../components/shell";
import { UiFixtures } from "./fixtures";

export const dynamic = "force-static";

export const metadata = { title: "UI fixtures — Majorana" };

// Dev/CI only (still auth-gated by middleware); 404s in production builds.
export default function UiFixturesPage() {
  if (process.env.NODE_ENV === "production" && process.env.MAJORANA_UI_FIXTURES !== "1") {
    notFound();
  }
  return (
    <Shell>
      <h1 style={{ fontSize: "var(--fs-20)", fontWeight: 600 }}>UI fixtures</h1>
      <UiFixtures />
    </Shell>
  );
}
