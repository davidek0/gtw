import { createHash, timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { requireEnvironmentVariable } from "../env.js";
import {
  type LiveHeartRateSampleInput,
  insertLiveHeartRateSamples,
  listLiveHeartRateSamples,
} from "./service.js";

export async function registerGarminLiveRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/garmin-live/heart-rate", async (request, reply) => {
    if (!authenticateAdmin(request, reply)) return;
    const body = requireObject(request.body, "Request body");
    const subjectId = validateSubjectId(body.subjectId);
    const sourceDevice = validateSourceDevice(body.sourceDevice);
    const samples = validateSamples(body.samples);
    const samplesInserted = await insertLiveHeartRateSamples(subjectId, sourceDevice, samples);
    return { samplesInserted };
  });

  app.get("/api/garmin-live/:subjectId/heart-rate", async (request, reply) => {
    if (!authenticateAdmin(request, reply)) return;
    const { subjectId } = request.params as { subjectId: string };
    const query = isObject(request.query) ? request.query : {};
    const requestedLimit = typeof query.limit === "string" ? Number.parseInt(query.limit, 10) : 300;
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 5000) : 300;
    return listLiveHeartRateSamples(validateSubjectId(subjectId), limit);
  });
}

function validateSamples(value: unknown): LiveHeartRateSampleInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 300) {
    throw new Error("samples must contain between 1 and 300 entries");
  }
  return value.map((entry) => {
    const sample = requireObject(entry, "sample");
    if (!Number.isInteger(sample.bpm) || (sample.bpm as number) < 20 || (sample.bpm as number) > 250) {
      throw new Error("sample.bpm must be an integer between 20 and 250");
    }
    if (typeof sample.measuredAt !== "string") {
      throw new Error("sample.measuredAt must be an ISO timestamp");
    }
    const measuredAt = new Date(sample.measuredAt);
    if (Number.isNaN(measuredAt.getTime())) {
      throw new Error("sample.measuredAt must be a valid ISO timestamp");
    }
    return { bpm: sample.bpm as number, measuredAt };
  });
}

function validateSourceDevice(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 200) {
    throw new Error("sourceDevice must be at most 200 characters");
  }
  return value;
}

function validateSubjectId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > 200) {
    throw new Error("subjectId must be a non-empty string of at most 200 characters");
  }
  return value.trim();
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
