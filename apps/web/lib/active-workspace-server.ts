import "server-only";

import { getMajoranaAuth } from "./auth";
import { controlPlaneUrl, fetchControlPlane } from "./control-plane";

export type ActiveWorkspace = {
  id: string;
  name: string;
  role: string;
  /** The workspace this account owns. Everything else is somebody's shared one. */
  isPersonal: boolean;
};

/**
 * Which workspace the signed-in account is currently acting in.
 *
 * Resolved server-side, in the authenticated layout, because two things depend
 * on it before any child renders:
 *
 * 1. **The browser's local mirror.** The sidebar's chats and Vault entries are a
 *    union of localStorage and the API. Those keys are scoped per account today;
 *    left that way, switching workspaces would show the personal workspace's
 *    chat titles and artifacts inside a shared one, permanently, because the
 *    union never removes what the API did not return. The scope is set during
 *    render, so it cannot wait for a client fetch.
 * 2. **The sidebar identity block**, which has to say where you are. Someone who
 *    switched and forgot would otherwise save work into a colleague's tenant
 *    with nothing on screen to say so.
 *
 * Returns null when the control plane cannot be reached. Callers treat that as
 * the personal workspace — the pre-collaboration behaviour, and the same keys
 * the account has always used, rather than an empty sidebar during an outage.
 */
export async function getActiveWorkspace(): Promise<ActiveWorkspace | null> {
  const { accessToken } = await getMajoranaAuth({ ensureSignedIn: true });
  try {
    const upstream = await fetchControlPlane(controlPlaneUrl("/v1/me"), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!upstream.ok) return null;
    const payload = (await upstream.json()) as {
      workspace_id?: unknown;
      workspace_name?: unknown;
      role?: unknown;
      is_personal_workspace?: unknown;
    };
    if (typeof payload.workspace_id !== "string") return null;
    return {
      id: payload.workspace_id,
      name: typeof payload.workspace_name === "string" ? payload.workspace_name : "",
      role: typeof payload.role === "string" ? payload.role : "member",
      // Absent means an older control plane that has no shared workspaces at
      // all, so personal is the only truthful answer.
      isPersonal: payload.is_personal_workspace !== false,
    };
  } catch {
    return null;
  }
}
