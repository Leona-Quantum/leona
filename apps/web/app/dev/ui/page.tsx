import { notFound } from "next/navigation";
import { Shell } from "../../../components/shell";
import { UiFixtures } from "./fixtures";

export const metadata = { title: "UI fixtures — Leona Quantum" };

// Dev/CI only (still auth-gated by middleware); 404s in production builds.
export default function UiFixturesPage() {
  if (process.env.NODE_ENV === "production" && process.env.MAJORANA_UI_FIXTURES !== "1") {
    notFound();
  }
  return (
    // A name and a tier, so the sidebar footer's identity block and account
    // drawer are actually inspectable here. Without them the Shell falls back to
    // the sessionless labels and the surface under test never renders.
    <Shell accountName="Eshaan Mistry" accountTier="developer">
      <h1 style={{ fontSize: "var(--fs-20)", fontWeight: 600 }}>UI fixtures</h1>
      <UiFixtures />
    </Shell>
  );
}
