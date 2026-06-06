import { describe, it, expect } from "vitest";
import { computeSignature, signatureHeader } from "../src/signing.js";

describe("computeSignature", () => {
  const secret = "test-secret";
  const body = '{"hello":"world"}';
  const ts = 1700000000;

  it("produces a deterministic hex string", () => {
    const sig1 = computeSignature(body, secret, ts);
    const sig2 = computeSignature(body, secret, ts);
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different body → different signature", () => {
    const sig1 = computeSignature(body, secret, ts);
    const sig2 = computeSignature('{"hello":"other"}', secret, ts);
    expect(sig1).not.toBe(sig2);
  });

  it("different timestamp → different signature (replay prevention)", () => {
    const sig1 = computeSignature(body, secret, ts);
    const sig2 = computeSignature(body, secret, ts + 1);
    expect(sig1).not.toBe(sig2);
  });

  it("different secret → different signature", () => {
    const sig1 = computeSignature(body, "secret-a", ts);
    const sig2 = computeSignature(body, "secret-b", ts);
    expect(sig1).not.toBe(sig2);
  });
});

describe("signatureHeader", () => {
  it("prefixes with sha256=", () => {
    expect(signatureHeader("abc123")).toBe("sha256=abc123");
  });
});
