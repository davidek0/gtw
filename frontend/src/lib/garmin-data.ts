import { createServerFn } from "@tanstack/react-start";

export type GarminRecord = {
  recordDate: string;
  metricType: string;
  data: unknown;
};

export type GarminMetrics = Record<"sleep" | "steps" | "heart_rate" | "hrv", GarminRecord[]>;

export type HeartRateSample = {
  id: string;
  bpm: number;
  measuredAt: string;
  sourceDevice: string | null;
};

export const loadGarminHealth = createServerFn({ method: "GET" }).handler(
  async (): Promise<GarminMetrics> => {
    const metricTypes = ["sleep", "steps", "heart_rate", "hrv"] as const;
    const entries = await Promise.all(
      metricTypes.map(async (metricType) => [
        metricType,
        await garminRequest<GarminRecord[]>(
          `/api/garmin-connect/${encodeURIComponent(subjectId())}/health?type=${metricType}&limit=30`,
        ),
      ] as const),
    );
    return Object.fromEntries(entries) as GarminMetrics;
  },
);

export const loadGarminLiveHeartRate = createServerFn({ method: "GET" }).handler(
  async (): Promise<HeartRateSample[]> =>
    garminRequest<HeartRateSample[]>(
      `/api/garmin-live/${encodeURIComponent(subjectId())}/heart-rate?limit=90`,
    ),
);

function subjectId(): string {
  return process.env.GARMIN_SUBJECT_ID?.trim() || "person-1";
}

async function garminRequest<T>(path: string): Promise<T> {
  const token = process.env.ADMIN_API_TOKEN?.trim();
  if (!token) throw new Error("Frontendservern saknar ADMIN_API_TOKEN");
  const baseUrl = (process.env.BACKEND_URL?.trim() || "http://127.0.0.1:3000").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Garmin-backend svarade ${response.status}`);
  return response.json() as Promise<T>;
}
