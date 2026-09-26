import { createHash, timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { requireEnvironmentVariable } from "../env.js";
import { getGarminConfig } from "./config.js";
import {
  completeGarminAuthorization,
  createGarminAuthorization,
  disconnectGarmin,
  getGarminConnectionStatus,
  listGarminHealthRecords,
} from "./service.js";
import { ingestGarminWebhook } from "./webhook.js";

export async function registerGarminRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/garmin/authorization", async (request, reply) => {
    if (!authenticateAdmin(request, reply)) return;
    const body = isObject(request.body) ? request.body : {};
    const subjectId = validateSubjectId(body.subjectId);
    const authorizationUrl = await createGarminAuthorization(subjectId);
    return { authorizationUrl };
  });

  app.get("/api/garmin/callback", async (request, reply) => {
    const query = isObject(request.query) ? request.query : {};
    if (typeof query.error === "string") {
      return reply.code(400).send({ error: "Garmin authorization was declined", detail: query.error });
    }
    if (typeof query.code !== "string" || typeof query.state !== "string") {
      return reply.code(400).send({ error: "Missing Garmin authorization code or state" });
    }

    const subjectId = await completeGarminAuthorization(query.code, query.state);
    return reply.type("text/html; charset=utf-8").send(
      "<!doctype html><html><body><h1>Garmin connected</h1><p>You may close this window.</p></body></html>",
    );
  });

  app.post("/api/garmin/webhook/:token", async (request, reply) => {
    const params = request.params as { token?: string };
    if (!secureEqual(params.token ?? "", getGarminConfig().webhookToken)) {
      return reply.code(404).send({ error: "Not found" });
    }
    const result = await ingestGarminWebhook(request.body);
    return reply.code(200).send(result);
  });

  app.get("/api/garmin/:subjectId", async (request, reply) => {
    if (!authenticateAdmin(request, reply)) return;
    const { subjectId } = request.params as { subjectId: string };
    const status = await getGarminConnectionStatus(validateSubjectId(subjectId));
    if (!status) return reply.code(404).send({ error: "Garmin connection not found" });
    return status;
  });

  app.get("/api/garmin/:subjectId/health", async (request, reply) => {
    if (!authenticateAdmin(request, reply)) return;
    const { subjectId } = request.params as { subjectId: string };
    const query = isObject(request.query) ? request.query : {};
    const requestedLimit = typeof query.limit === "string" ? Number.parseInt(query.limit, 10) : 100;
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 100;
    const summaryType = typeof query.type === "string" ? query.type.slice(0, 100) : undefined;
    return listGarminHealthRecords(validateSubjectId(subjectId), limit, summaryType);
  });

  app.delete("/api/garmin/:subjectId", async (request, reply) => {
    if (!authenticateAdmin(request, reply)) return;
    const { subjectId } = request.params as { subjectId: string };
    const disconnected = await disconnectGarmin(validateSubjectId(subjectId));
    return disconnected ? reply.code(204).send() : reply.code(404).send({ error: "Garmin connection not found" });
  });
}

function authenticateAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const expected = requireEnvironmentVariable("ADMIN_API_TOKEN");
  const authorization = request.headers.authorization ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secureEqual(provided, expected)) {
    void reply.code(401).send({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function validateSubjectId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > 200) {
    throw new Error("subjectId must be a non-empty string of at most 200 characters");
  }
  return value.trim();
}

function secureEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
