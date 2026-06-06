import type { FastifyInstance } from "fastify";
import { getDb } from "../../db/client.js";
import {
  CreateSubscriptionSchema,
  PatchSubscriptionSchema,
  createSubscription,
  getSubscriptionById,
  listSubscriptions,
  patchSubscription,
  softDeleteSubscription,
  toPublic,
} from "../../services/subscriptionService.js";

export async function subscriptionRoutes(app: FastifyInstance) {
  const db = getDb();

  app.post("/", async (request, reply) => {
    const parsed = CreateSubscriptionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation error", details: parsed.error.flatten() });
    }
    const sub = createSubscription(db, parsed.data);
    return reply.status(201).send(toPublic(sub));
  });

  app.get("/", async (request) => {
    const query = request.query as { active?: string };
    let active: boolean | undefined;
    if (query.active === "true") active = true;
    else if (query.active === "false") active = false;
    const data = listSubscriptions(db, active).map(toPublic);
    return { data, total: data.length };
  });

  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const sub = getSubscriptionById(db, id);
    if (!sub) return reply.status(404).send({ error: "Not found" });
    return toPublic(sub);
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = PatchSubscriptionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation error", details: parsed.error.flatten() });
    }
    const sub = patchSubscription(db, id, parsed.data);
    if (!sub) return reply.status(404).send({ error: "Not found" });
    return toPublic(sub);
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = softDeleteSubscription(db, id);
    if (!deleted) return reply.status(404).send({ error: "Not found" });
    return reply.status(204).send();
  });
}
