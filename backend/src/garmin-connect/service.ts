import { and, desc, eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { garminConnectHealthRecords } from "../db/schema.js";

export interface GarminConnectRecordInput {
  type: string;
  data: unknown;
}

export async function upsertGarminConnectRecords(
  subjectId: string,
  recordDate: string,
  records: GarminConnectRecordInput[],
): Promise<number> {
  const fetchedAt = new Date();

  for (const record of records) {
    await db
      .insert(garminConnectHealthRecords)
      .values({
        subjectId,
        recordDate,
        metricType: record.type,
        data: record.data,
        fetchedAt,
      })
      .onConflictDoUpdate({
        target: [
          garminConnectHealthRecords.subjectId,
          garminConnectHealthRecords.recordDate,
          garminConnectHealthRecords.metricType,
        ],
        set: { data: record.data, fetchedAt },
      });
  }

  return records.length;
}

export function listGarminConnectRecords(
  subjectId: string,
  limit: number,
  metricType?: string,
) {
  const conditions = [eq(garminConnectHealthRecords.subjectId, subjectId)];
  if (metricType) conditions.push(eq(garminConnectHealthRecords.metricType, metricType));

  return db
    .select()
    .from(garminConnectHealthRecords)
    .where(and(...conditions))
    .orderBy(
      desc(garminConnectHealthRecords.recordDate),
      desc(garminConnectHealthRecords.fetchedAt),
    )
    .limit(limit);
}
