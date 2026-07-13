// Local development auth is deliberately impossible in a production Next process.
// Keep this module free of WorkOS imports because middleware runs in the edge runtime.

export const LOCAL_DEV_ACCESS_TOKEN = "majorana-local-dev";

export function isLocalDevAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.MAJORANA_LOCAL_DEV_AUTH === "true" &&
    !process.env.VERCEL &&
    !process.env.CI
  );
}
