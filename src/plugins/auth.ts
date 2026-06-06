import type { FastifyInstance } from "fastify";
import { config } from "../config.js";

// Registers a preHandler that enforces x-admin-key on every route in this scope
export async function authPlugin(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    const key = request.headers["x-admin-key"];
    if (key !== config.adminKey) {
      return reply.status(401).send({ error: "Unauthorized: invalid x-admin-key" });
    }
  });
}
