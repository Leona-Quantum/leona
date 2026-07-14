import type { Metadata } from "next";
import { PublicSite } from "../../components/public-site";
import { isPublicDemoEnabled } from "../../lib/public-demo";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Early-access Majorana plans for individual researchers and teams.",
};

const plans = [
  {
    name: "Free",
    price: "$0",
    cadence: "while Majorana is in preview",
    description: "A low-friction way to try the verified workbench and browse public evidence.",
    features: ["Public repository access", "Small verified-run allowance", "Private Library for saved work", "Limited Studio access"],
    action: "Try the preview",
    tone: "quiet",
  },
  {
    name: "Pro",
    price: "Early access",
    cadence: "for individual researchers and builders",
    description: "More room for private research, stronger model tiers, and export-aware workflows.",
    features: ["Higher run limits", "Private artifacts and versions", "Baselines and export matrix", "Priority access to new capabilities"],
    action: "Join Pro early access",
    tone: "featured",
  },
  {
    name: "Team / Enterprise",
    price: "Let’s talk",
    cadence: "for shared R&D and governance",
    description: "Shared workspaces, private corpora, auditability, and a path to bespoke evaluation support.",
    features: ["Team workspaces and roles", "Private corpus boundary", "Audit and governance workflows", "Design-partner conversations"],
    action: "Contact us",
    tone: "quiet",
  },
];

export default function PricingPage() {
  const demoEnabled = isPublicDemoEnabled();
  return (
    <PublicSite activePath="/pricing" className="mj-pricing-site">
      <section className="mj-public-page-hero">
        <h1>A clear path from first run to team work.</h1>
        <p>
          Start free, keep private work in your Library, and move up when you need more
          verification capacity, export tooling, or shared R&amp;D controls.
        </p>
      </section>

      <section className="mj-pricing-grid" aria-label="Majorana plans">
        {plans.map((plan) => (
          <article className={`mj-pricing-card mj-pricing-card--${plan.tone}`} key={plan.name}>
            <div className="mj-pricing-card-head">
              <h2>{plan.name}</h2>
              {plan.tone === "featured" ? <span className="mj-pricing-mark">Recommended starting point</span> : null}
            </div>
            <p className="mj-pricing-price">{plan.price}</p>
            <p className="mj-pricing-cadence">{plan.cadence}</p>
            <p className="mj-pricing-description">{plan.description}</p>
            <ul>
              {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
            <a className={plan.tone === "featured" ? "mj-primary-button" : "mj-secondary-button"} href={plan.name === "Free" && demoEnabled ? "/demo" : "/contact"}>
              {plan.name === "Free" && !demoEnabled ? "Talk to us" : plan.action}
            </a>
          </article>
        ))}
      </section>

      <section className="mj-pricing-note" aria-labelledby="pricing-note-heading">
        <div>
          <p className="mj-section-label">A transparent starting point</p>
          <h2 id="pricing-note-heading">The product is live; paid billing is not.</h2>
        </div>
        <p>
          These plans describe the intended early-access packaging. Exact limits, credit
          amounts, and paid billing will be confirmed before checkout is enabled. No card is
          required to explore the public repository or contact us about a research workflow.
        </p>
      </section>
    </PublicSite>
  );
}
