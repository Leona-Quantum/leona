export function contentSecurityPolicy({
  controlPlane,
  development,
}: {
  controlPlane: string;
  development: boolean;
}): string {
  const controlPlaneIsHttp = controlPlane.startsWith("http://");
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(development ? ["'unsafe-eval'"] : []),
  ];
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${controlPlane}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(controlPlaneIsHttp ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
