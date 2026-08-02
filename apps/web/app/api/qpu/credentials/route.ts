import { getMajoranaAuth } from "../../../../lib/auth";
import {
  controlPlaneUnavailable,
  controlPlaneUrl,
  fetchControlPlane,
  forwardFromControlPlane,
} from "../../../../lib/control-plane";

/**
 * The account's own provider credential, proxied and nothing else.
 *
 * A pass-through in the style of `app/api/usage/route.ts`, and more strictly so
 * than most: the PUT body carries an API key. Nothing here reads it, validates
 * its length, trims it, or writes it anywhere — the body is forwarded as an
 * opaque string, and the only thing this file adds to the request is the
 * session's bearer token.
 *
 * In particular nothing here logs. A `console.log(await request.json())` added
 * while debugging would put a live credential into the platform's log drain,
 * where it outlives the request, the deployment and any revocation the user
 * later performs at the provider. The upstream service is the only place that
 * is allowed to see the value, and it is the only place that decides whether
 * the key is any good — verification lives there, so a key this route accepted
 * and upstream rejected can only ever be reported by upstream.
 */
export const dynamic = "force-dynamic";

const UPSTREAM = "/v1/qpu/credentials";

/** Whether a credential is connected, and when it was last verified and used. */
export async function GET() {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(controlPlaneUrl(UPSTREAM), {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}

/**
 * Store a key, or replace the stored one.
 *
 * The 400/502/503 the control plane answers with each mean something different
 * to the person who pasted the key, so they are forwarded with their bodies
 * intact rather than flattened into one "could not save" here.
 */
export async function PUT(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(controlPlaneUrl(UPSTREAM), {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": request.headers.get("Content-Type") ?? "application/json",
        },
        body: await request.text(),
      }),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}

/**
 * Forget the stored key.
 *
 * The provider is named in the query string, and the whole search string is
 * copied across rather than a `provider` parameter being read and rebuilt. The
 * BFF has no opinion about which providers exist; upstream refuses the ones it
 * does not know.
 */
export async function DELETE(request: Request) {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  const upstream = controlPlaneUrl(UPSTREAM);
  upstream.search = new URL(request.url).search;
  try {
    return forwardFromControlPlane(
      await fetchControlPlane(upstream, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
  } catch (error) {
    return controlPlaneUnavailable(error);
  }
}
