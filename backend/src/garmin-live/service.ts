import { desc, eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { garminLiveHeartRateSamples } from "../db/schema.js";

export interface LiveHeartRateSampleInput {
  bpm: number;
  measuredAt: Date;
}

export async function insertLiveHeartRateSamples(
  subjectId: string,
  sourceDevice: string | null,
  samples: LiveHeartRateSampleInput[],
): Promise<number> {
  const inserted = await db
    .insert(garminLiveHeartRateSamples)
    .values(
      samples.map((sample) => ({
        subjectId,
        sourceDevice,
        bpm: sample.bpm,
        measuredAt: sample.measuredAt,
      })),
    )
    .onConflictDoNothing({
      target: [garminLiveHeartRateSamples.subjectId, garminLiveHeartRateSamples.measuredAt],
    })
    .returning({ id: garminLiveHeartRateSamples.id });
  return inserted.length;
}

export function listLiveHeartRateSamples(subjectId: string, limit: number) {
  return db
    .select()
    .from(garminLiveHeartRateSamples)
    .where(eq(garminLiveHeartRateSamples.subjectId, subjectId))
    .orderBy(desc(garminLiveHeartRateSamples.measuredAt))
    .limit(limit);
}
