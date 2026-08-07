import manifestJson from "./private-mvp-capability.generated.json" with { type: "json" };
import type {
  PrivateMvpCapabilityManifest,
  PrivateMvpGoldenJourney,
} from "./types";

const JOURNEY_STATUS = new Set(["NOT_RUN", "qualified_private"]);
const GO_DECISION = new Set(["unavailable", "private_only"]);

function fail(message: string): never {
  throw new Error(`[atlas-vqe/private-mvp-source] ${message}`);
}

function validateJourney(value: unknown, name: string): PrivateMvpGoldenJourney {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  const journey = value as Partial<PrivateMvpGoldenJourney>;
  if (!JOURNEY_STATUS.has(String(journey.status))) fail(`${name} has an unknown status`);
  if (!GO_DECISION.has(String(journey.go_decision))) fail(`${name} has an unknown GO decision`);
  if (journey.status === "NOT_RUN" && journey.go_decision !== "unavailable") {
    fail(`${name} cannot make a GO decision without execution evidence`);
  }
  return journey as PrivateMvpGoldenJourney;
}

function validateManifest(raw: unknown): PrivateMvpCapabilityManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("manifest must be an object");
  const manifest = raw as Partial<PrivateMvpCapabilityManifest>;
  if (manifest.schema_version !== "1.0.0") fail("unsupported schema version");
  if (manifest.release_scope !== "private_technical_mvp") fail("unexpected release scope");
  if (manifest.product_model !== "component_first_vqe") fail("unexpected product model");
  const boundary = manifest.claim_boundary;
  if (
    !boundary
    || boundary.publication !== "blocked"
    || boundary.public_execution !== "blocked"
    || boundary.scientific_superiority_claim !== "blocked"
    || boundary.external_repository_execution !== "blocked"
    || boundary.scientific_review !== "unreviewed"
    || boundary.execution_policy !== "owner_waived_private"
    || typeof boundary.statement !== "string"
  ) {
    fail("claim boundary is missing or unsafe");
  }
  const journeys = manifest.golden_journeys;
  if (!journeys) fail("golden journeys are missing");
  validateJourney(journeys.primary_fixed_excitation_slsqp, "primary_fixed_excitation_slsqp");
  const comparison = validateJourney(
    journeys.controlled_slsqp_to_cobyla,
    "controlled_slsqp_to_cobyla",
  );
  if (
    comparison.changed_roles?.length !== 1
    || comparison.changed_roles[0] !== "parameter_optimizer"
  ) {
    fail("controlled comparison must change only parameter_optimizer");
  }
  validateJourney(journeys.secondary_uccsd_smoke, "secondary_uccsd_smoke");
  validateJourney(journeys.tertiary_hardware_efficient_smoke, "tertiary_hardware_efficient_smoke");
  validateJourney(journeys.live_workos_same_account_reopen, "live_workos_same_account_reopen");
  return manifest as PrivateMvpCapabilityManifest;
}

const MANIFEST = validateManifest(manifestJson);

export function getPrivateMvpCapabilityManifest(): PrivateMvpCapabilityManifest {
  return MANIFEST;
}
