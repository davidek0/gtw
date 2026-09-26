import { createServerFn } from "@tanstack/react-start";

export type GarminRecord = {
  recordDate: string;
  metricType: string;
  data: unknown;
};

export type GarminMetrics = Record<
  "sleep" | "steps" | "heart_rate" | "hrv",
  GarminRecord[]
>;

export type HeartRateSample = {
  id: string;
  bpm: number;
  measuredAt: string;
  sourceDevice: string | null;
};

export type GarminResult<T> =
  { ok: true; data: T } | { ok: false; error: string };

export const loadGarminHealth = createServerFn({ method: "GET" }).handler(
  async (): Promise<GarminResult<GarminMetrics>> => {
    try {
      const metricTypes = ["sleep", "steps", "heart_rate", "hrv"] as const;
      const entries = await Promise.all(
        metricTypes.map(
          async (metricType) =>
            [
              metricType,
              await garminRequest<GarminRecord[]>(
                `/api/garmin-connect/${encodeURIComponent(subjectId())}/health?type=${metricType}&limit=30`,
              ),
            ] as const,
        ),
      );
      return { ok: true, data: Object.fromEntries(entries) as GarminMetrics };
    } catch (error) {
      return { ok: false, error: safeErrorMessage(error) };
    }
  },
);

export const loadGarminLiveHeartRate = createServerFn({
  method: "GET",
}).handler(async (): Promise<GarminResult<HeartRateSample[]>> => {
  try {
    return {
      ok: true,
      data: await garminRequest<HeartRateSample[]>(
        `/api/garmin-live/${encodeURIComponent(subjectId())}/heart-rate?limit=90`,
      ),
    };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

function subjectId(): string {
  return process.env.GARMIN_SUBJECT_ID?.trim() || "person-1";
}

async function garminRequest<T>(path: string): Promise<T> {
  const token = process.env.ADMIN_API_TOKEN?.trim();
  if (!token) throw new Error("The frontend server is missing ADMIN_API_TOKEN");
  const baseUrl = (
    process.env.BACKEND_URL?.trim() || "http://127.0.0.1:3000"
  ).replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`The Garmin backend returned ${response.status}`);
  return response.json() as Promise<T>;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown error while retrieving Garmin data";
}
