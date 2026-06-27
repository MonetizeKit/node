import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyWebhookInput {
  /** The exact raw request body string received at your endpoint. */
  rawBody: string;
  /** Value of the `X-MonetizeKit-Timestamp` header. */
  timestamp: string;
  /** Value of the `X-MonetizeKit-Signature` header (e.g. `sha256=...`). */
  signature: string;
  /** Your endpoint signing secret (shown once at creation). */
  secret: string;
}

/**
 * Verify a MonetizeKit webhook signature.
 *
 * Signature scheme: `sha256=` + HMAC-SHA256 over `"{timestamp}.{rawBody}"`,
 * using your endpoint secret. Compare in constant time.
 */
export function verifyWebhookSignature(input: VerifyWebhookInput): boolean {
  const expected = `sha256=${createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest("hex")}`;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(input.signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
