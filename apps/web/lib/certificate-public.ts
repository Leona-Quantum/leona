import { cache } from "react";
import { controlPlaneUrl, fetchControlPlane } from "./control-plane.ts";

export type PublicCertificate = {
  id: string;
  recipientName: string;
  courseTitle: string;
  issuedOn: string;
  issuer: string;
  revoked: boolean;
};

/**
 * One control-plane read per request for the public certificate page
 * (ai-ops 349 proposal 8). `cache()` dedupes within one render the same way
 * `qapp-public.ts`'s `loadPublicQapp` does.
 *
 * Reads the SAME JSON the public assertion route serves
 * (`certificates_badge.build_assertion`, services/api) rather than a second,
 * page-specific shape, so the page and the downloadable Open Badges file can
 * never disagree about the recipient's name, the course title or the
 * revocation state — there is exactly one source for both.
 */
export const loadPublicCertificate = cache(
  async (id: string): Promise<PublicCertificate | null> => {
    const response = await fetchControlPlane(controlPlaneUrl(`/v1/certificates/${encodeURIComponent(id)}`));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Certificate is temporarily unavailable");
    const assertion = (await response.json()) as Record<string, unknown>;
    const badge = (assertion.badge as Record<string, unknown> | undefined) ?? {};
    const issuer = (badge.issuer as Record<string, unknown> | undefined) ?? {};
    return {
      id,
      recipientName: String(assertion["extensions:recipientName"] ?? ""),
      courseTitle: String(badge.name ?? ""),
      issuedOn: String(assertion.issuedOn ?? ""),
      issuer: String(issuer.name ?? "Leona Quantum"),
      revoked: Boolean(assertion.revoked),
    };
  },
);
