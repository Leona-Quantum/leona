/**
 * Whether an address is one of Cloudflare's own edge addresses (ai-ops 141).
 *
 * ## What this exists to close
 *
 * Once `leonaqt.com` is proxied through Cloudflare, Vercel's edge stops seeing
 * visitors directly — it sees Cloudflare, which terminates every client
 * connection and opens its own to Vercel. Cloudflare adds `cf-connecting-ip`,
 * set to the real visitor's address and stripped-and-replaced on the way in, so
 * a client cannot write its own value that survives to Vercel *when the request
 * actually passes through Cloudflare's edge*.
 *
 * That qualifier is load-bearing. A Vercel deployment keeps its `*.vercel.app`
 * alias reachable for the life of the project, entirely outside whatever DNS a
 * custom domain resolves to — Vercel's own domain docs describe the anycast
 * front door as answering for any hostname it has been told to accept, and
 * nothing about proxying `leonaqt.com` through Cloudflare teaches Vercel to
 * refuse a request that arrives by another path. So a request can reach this
 * same deployment without ever touching Cloudflare, and on that path
 * `cf-connecting-ip` is just an ordinary, caller-supplied header — indistinguishable
 * at the point of arrival from `x-forwarded-for`, and just as forgeable. Trusting
 * it unconditionally would hand back exactly the bypass `contact-rate-limit.ts`
 * closed for `x-forwarded-for`, under a different header name.
 *
 * ## The witness that tells the two apart
 *
 * `x-vercel-forwarded-for` is set by Vercel's own edge from the actual TCP peer
 * that connected to it, regardless of which path the request took — that part
 * of its trustworthiness does not change. What changes under proxying is only
 * *whose* address that is: every request that genuinely came through Cloudflare
 * now shows one of Cloudflare's own published edge addresses there, because
 * Cloudflare is the peer Vercel actually accepted a connection from. A request
 * that bypassed Cloudflare shows the caller's real address instead, because
 * there was no proxy in between to substitute one.
 *
 * So `x-vercel-forwarded-for` — trustworthy for a different reason than before,
 * but still trustworthy — is what `cf-connecting-ip` is checked against: only
 * when the immediate hop into Vercel is Cloudflare's is the header believed.
 * On any other hop it is ignored, and the caller falls back to being metered by
 * `x-vercel-forwarded-for` itself, which on that path is the real address, not
 * Cloudflare's.
 *
 * ## Where the ranges came from
 *
 * Cloudflare publishes the exact set at https://www.cloudflare.com/ips-v4 and
 * https://www.cloudflare.com/ips-v6, meant to be consumed programmatically by
 * exactly this kind of check. Copied here — rather than fetched at request time
 * — because a runtime fetch on every submission would trade a rate limiter for
 * a dependency on Cloudflare's API answering fast enough to meter a request,
 * and because these ranges change rarely enough that a stale copy is a much
 * smaller risk than a synchronous network call in a hot path. Fetched and
 * transcribed 2026-08-17; re-fetch and diff before the next time this file is
 * touched, since Cloudflare does not version them.
 */

/** Cloudflare's published IPv4 edge ranges, as CIDR blocks. */
const CLOUDFLARE_IPV4_CIDRS: readonly string[] = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

/** Cloudflare's published IPv6 edge ranges, as CIDR blocks. */
const CLOUDFLARE_IPV6_CIDRS: readonly string[] = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value < 0 || value > 255) return null;
    n = (n << 8) | value;
  }
  return n >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf("/");
  const base = ipv4ToInt(cidr.slice(0, slash));
  const bits = Number(cidr.slice(slash + 1));
  const addr = ipv4ToInt(ip);
  if (base === null || addr === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  // A shift of 32 wraps in JS (shift amounts are taken mod 32), so the /0 case
  // — matching every address — has to be handled outright rather than through
  // the mask arithmetic below.
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (addr & mask) === (base & mask);
}

/**
 * Parses dotted or `::`-abbreviated IPv6 into a 128-bit integer. `bigint`
 * rather than `number`, which cannot represent 128 bits exactly.
 */
function ipv6ToBigInt(ip: string): bigint | null {
  const doubleColonCount = (ip.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return null;

  let groups: string[];
  if (doubleColonCount === 1) {
    const [headPart, tailPart] = ip.split("::");
    const head = headPart ? headPart.split(":") : [];
    const tail = tailPart ? tailPart.split(":") : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  } else {
    groups = ip.split(":");
  }
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

function ipv6InCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf("/");
  const base = ipv6ToBigInt(cidr.slice(0, slash));
  const bits = Number(cidr.slice(slash + 1));
  const addr = ipv6ToBigInt(ip);
  if (base === null || addr === null || !Number.isInteger(bits) || bits < 0 || bits > 128) return false;
  const hostBits = 128 - bits;
  const hostMask = (1n << BigInt(hostBits)) - 1n;
  const mask = ((1n << 128n) - 1n) - hostMask;
  return (addr & mask) === (base & mask);
}

/**
 * True when `address` falls inside one of Cloudflare's published edge ranges —
 * i.e. it is the kind of value Vercel would see in `x-vercel-forwarded-for` for
 * a request that genuinely passed through Cloudflare's proxy for this zone.
 *
 * Not a general-purpose IP validator: an address that fails to parse as either
 * IPv4 or IPv6 simply is not in range, same as any other non-match.
 */
export function isCloudflareEdgeAddress(address: string): boolean {
  const ip = address.trim();
  if (ip.includes(":")) return CLOUDFLARE_IPV6_CIDRS.some((cidr) => ipv6InCidr(ip, cidr));
  if (ip.includes(".")) return CLOUDFLARE_IPV4_CIDRS.some((cidr) => ipv4InCidr(ip, cidr));
  return false;
}
