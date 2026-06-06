import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import {
  listDeliveryAttempts,
  getDeliveryAttemptById,
  resetForRetry,
  isRetryConflict,
} from "../../services/deliveryService.js";

export async function deliveryRoutes(app: FastifyInstance) {
  const db = getDb();

  app.get("/", async (request) => {
    const q = request.query as {
      event_id?: string;
      subscription_id?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };
    return listDeliveryAttempts(db, {
      event_id: q.event_id,
      subscription_id: q.subscription_id,
      status: q.status,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const attempt = getDeliveryAttemptById(db, id);
    if (!attempt) return reply.status(404).send({ error: "Not found" });
    return attempt;
  });

  app.post("/:id/retry", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getDeliveryAttemptById(db, id);
    if (!existing) return reply.status(404).send({ error: "Not found" });
    if (isRetryConflict(existing)) {
      return reply.status(409).send({ error: "Delivery is already pending or in flight" });
    }
    const updated = resetForRetry(db, id);
    return updated;
  });
}
