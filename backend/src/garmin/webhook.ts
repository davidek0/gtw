import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import {
  garminConnections,
  garminHealthRecords,
  garminWebhookEvents,
} from "../db/schema.js";

interface HealthSummary {
  summaryType: string;
  garminUserId: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  data: Record<string, unknown>;
}

export async function ingestGarminWebhook(payload: unknown): Promise<{
  duplicate: boolean;
  recordsStored: number;
}> {
  const payloadHash = hashJson(payload);
  const [event] = await db
    .insert(garminWebhookEvents)
    .values({ payloadHash, payload })
    .onConflictDoNothing({ target: garminWebhookEvents.payloadHash })
    .returning({ id: garminWebhookEvents.id });
  if (!event) return { duplicate: true, recordsStored: 0 };

  const summaries = extractSummaries(payload);
  const connections = new Map<string, string | null>();
  let recordsStored = 0;

  for (const summary of summaries) {
    let connectionId: string | null = null;
    if (summary.garminUserId) {
      if (!connections.has(summary.garminUserId)) {
        const [connection] = await db
          .select({ id: garminConnections.id })
          .from(garminConnections)
          .where(eq(garminConnections.garminUserId, summary.garminUserId))
          .limit(1);
        connections.set(summary.garminUserId, connection?.id ?? null);
      }
      connectionId = connections.get(summary.garminUserId) ?? null;
    }

    const [inserted] = await db
      .insert(garminHealthRecords)
      .values({
        webhookEventId: event.id,
        connectionId,
        garminUserId: summary.garminUserId,
        summaryType: summary.summaryType,
        recordHash: hashJson({
          type: summary.summaryType,
          garminUserId: summary.garminUserId,
          data: summary.data,
        }),
        startedAt: summary.startedAt,
        endedAt: summary.endedAt,
        data: summary.data,
      })
      .onConflictDoNothing({ target: garminHealthRecords.recordHash })
      .returning({ id: garminHealthRecords.id });
    if (inserted) recordsStored += 1;
  }

  return { duplicate: false, recordsStored };
}

function extractSummaries(payload: unknown): HealthSummary[] {
  if (Array.isArray(payload)) {
    return payload.filter(isObject).map((data) => toSummary("unknown", data));
  }
  if (!isObject(payload)) return [];

  const summaries: HealthSummary[] = [];
  for (const [summaryType, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      summaries.push(...value.filter(isObject).map((data) => toSummary(summaryType, data)));
    } else if (isObject(value)) {
      summaries.push(toSummary(summaryType, value));
    }
  }
  return summaries;
}

function toSummary(summaryType: string, data: Record<string, unknown>): HealthSummary {
  const startedAt = unixSecondsToDate(data.startTimeInSeconds ?? data.startTimeOffsetInSeconds);
  const explicitEnd = unixSecondsToDate(data.endTimeInSeconds);
  const duration = numberValue(data.durationInSeconds);
  return {
    summaryType,
    garminUserId: typeof data.userId === "string" ? data.userId : null,
    startedAt,
    endedAt:
      explicitEnd ?? (startedAt && duration !== null ? new Date(startedAt.getTime() + duration * 1000) : null),
    data,
  };
}

function unixSecondsToDate(value: unknown): Date | null {
  const seconds = numberValue(value);
  if (seconds === null || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
