import type { FastifyInstance } from "fastify";
import { computeSignature } from "../signing.js";

export interface EchoEntry {
  received_at: number;
  headers: Record<string, string>;
  body: unknown;
  signature_valid: boolean | null; // null when no signature present
}

// In-memory ring buffer — last 50 received webhooks
const echoLog: EchoEntry[] = [];
const MAX_LOG = 50;

export function getEchoLog(): EchoEntry[] {
  return [...echoLog].reverse(); // newest first
}

export async function debugRoutes(app: FastifyInstance) {
  // Receive a webhook delivery and log it
  app.post("/echo", { config: { rawBody: true } }, async (request, reply) => {
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
    const bodyStr = rawBody ? rawBody.toString() : JSON.stringify(request.body);

    const sigHeader = request.headers["x-webhook-signature"] as string | undefined;
    const tsHeader = request.headers["x-webhook-timestamp"] as string | undefined;

    let signatureValid: boolean | null = null;
    if (sigHeader && tsHeader) {
      // We don't know the secret here, so just check format and timestamp freshness
      const ts = parseInt(tsHeader, 10);
      const age = Math.abs(Math.floor(Date.now() / 1000) - ts);
      signatureValid = !isNaN(ts) && age < 300;
    }

    const entry: EchoEntry = {
      received_at: Math.floor(Date.now() / 1000),
      headers: {
        "x-webhook-id": request.headers["x-webhook-id"] as string ?? "",
        "x-webhook-timestamp": tsHeader ?? "",
        "x-webhook-signature": sigHeader ?? "",
        "content-type": request.headers["content-type"] as string ?? "",
      },
      body: request.body,
      signature_valid: signatureValid,
    };

    echoLog.push(entry);
    if (echoLog.length > MAX_LOG) echoLog.shift();

    return reply.status(200).send({ ok: true });
  });

  // Return the echo log as JSON (used by dashboard)
  app.get("/echo", async () => {
    return { data: getEchoLog(), total: echoLog.length };
  });
}
