import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import { IngestEventSchema, ingestEvent, getEventById, listEvents } from "../../services/eventService.js";
import { getDeliveryAttemptsByEventId } from "../../services/deliveryService.js";

export async function eventRoutes(app: FastifyInstance) {
  const db = getDb();

  app.post("/", async (request, reply) => {
    const parsed = IngestEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation error", details: parsed.error.flatten() });
    }
    const result = ingestEvent(db, parsed.data);
    return reply.status(202).send({
      event_id: result.eventId,
      matched_subscriptions: result.matchedSubscriptions,
    });
  });

  app.get("/", async (request) => {
    const q = request.query as { limit?: string; offset?: string; event_type?: string };
    return listEvents(db, {
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
      event_type: q.event_type,
    });
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = getEventById(db, id);
    if (!event) return reply.status(404).send({ error: "Not found" });
    const delivery_attempts = getDeliveryAttemptsByEventId(db, id);
    return { event, delivery_attempts };
  });
}
