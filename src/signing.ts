import { createHmac } from "node:crypto";

// Signs `"${timestampSecs}.${body}"` with HMAC-SHA256.
// Including the timestamp prevents replay attacks — subscribers should reject
// signatures where abs(now - timestamp) > 300 seconds.
export function computeSignature(body: string, secret: string, timestampSecs: number): string {
  const payload = `${timestampSecs}.${body}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function signatureHeader(sig: string): string {
  return `sha256=${sig}`;
}
