import { createHash, timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { requireEnvironmentVariable } from "../env.js";
import {
  type GarminConnectRecordInput,
  listGarminConnectRecords,
  upsertGarminConnectRecords,
} from "./service.js";

export async function registerGarminConnectRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/garmin-connect/ingest", async (request, reply) => {
    if (!authenticateAdmin(request, reply)) return;

    const body = requireObject(request.body, "Request body");
    const subjectId = validateSubjectId(body.subjectId);
    const recordDate = validateDate(body.date);
    const records = validateRecords(body.records);
    const recordsUpserted = await upsertGarminConnectRecords(subjectId, recordDate, records);

    return { recordsUpserted };
  });

  app.get("/api/garmin-connect/:subjectId/health", async (request, reply) => {
    if (!authenticateAdmin(request, reply)) return;

    const { subjectId } = request.params as { subjectId: string };
    const query = isObject(request.query) ? request.query : {};
    const requestedLimit = typeof query.limit === "string" ? Number.parseInt(query.limit, 10) : 100;
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 100;
    const metricType =
      typeof query.type === "string" && query.type.length <= 100 ? query.type : undefined;

    return listGarminConnectRecords(validateSubjectId(subjectId), limit, metricType);
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

function validateDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("date must use YYYY-MM-DD format");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("date is invalid");
  }
  return value;
}

function validateRecords(value: unknown): GarminConnectRecordInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    throw new Error("records must contain between 1 and 50 entries");
  }

  return value.map((entry) => {
    const record = requireObject(entry, "record");
    if (
      typeof record.type !== "string" ||
      record.type.length < 1 ||
      record.type.length > 100
    ) {
      throw new Error("record.type must be between 1 and 100 characters");
    }
    if (!("data" in record)) throw new Error("record.data is required");
    return { type: record.type, data: record.data };
  });
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${name} must be a JSON object`);
  return value;
}

function secureEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
