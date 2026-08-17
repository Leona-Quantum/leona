import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCloudflareEdgeAddress } from "./cloudflare-proxy.ts";

describe("recognising Cloudflare's own edge addresses", () => {
  it("matches an address inside a published IPv4 range", () => {
    // 104.16.0.0/13 — well inside the block, not on either boundary.
    assert.equal(isCloudflareEdgeAddress("104.20.1.1"), true);
  });

  it("matches the exact network and broadcast boundaries of an IPv4 range", () => {
    // 173.245.48.0/20 → 173.245.48.0 .. 173.245.63.255
    assert.equal(isCloudflareEdgeAddress("173.245.48.0"), true);
    assert.equal(isCloudflareEdgeAddress("173.245.63.255"), true);
    assert.equal(isCloudflareEdgeAddress("173.245.64.0"), false, "one past the range");
    assert.equal(isCloudflareEdgeAddress("173.245.47.255"), false, "one before the range");
  });

  it("rejects an ordinary visitor IPv4 address", () => {
    assert.equal(isCloudflareEdgeAddress("203.0.113.7"), false);
  });

  it("matches an address inside a published IPv6 range", () => {
    // 2606:4700::/32
    assert.equal(isCloudflareEdgeAddress("2606:4700:1234::5"), true);
  });

  it("rejects an ordinary visitor IPv6 address", () => {
    assert.equal(isCloudflareEdgeAddress("2001:db8::1"), false);
  });

  it("rejects garbage without throwing", () => {
    assert.equal(isCloudflareEdgeAddress(""), false);
    assert.equal(isCloudflareEdgeAddress("not-an-ip"), false);
    assert.equal(isCloudflareEdgeAddress("999.999.999.999"), false);
    assert.equal(isCloudflareEdgeAddress("104.16.0.0.0"), false, "too many octets");
    assert.equal(isCloudflareEdgeAddress("2606:4700:1234:5678:9:a:b:c:d"), false, "too many groups");
  });

  it("tolerates surrounding whitespace", () => {
    assert.equal(isCloudflareEdgeAddress("  104.20.1.1  "), true);
  });
});
