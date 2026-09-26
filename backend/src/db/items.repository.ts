import { desc, eq } from "drizzle-orm";

import { db } from "./client.js";
import { items, type Item, type NewItem } from "./schema.js";

export type CreateItemInput = Omit<NewItem, "id" | "createdAt" | "updatedAt">;
export type UpdateItemInput = Partial<CreateItemInput>;

export async function createItem(input: CreateItemInput): Promise<Item> {
  const [created] = await db.insert(items).values(input).returning();
  return created;
}

export async function listItems(): Promise<Item[]> {
  return db.select().from(items).orderBy(desc(items.createdAt));
}

export async function getItem(id: string): Promise<Item | null> {
  const [item] = await db.select().from(items).where(eq(items.id, id)).limit(1);
  return item ?? null;
}

export async function updateItem(id: string, input: UpdateItemInput): Promise<Item | null> {
  const [updated] = await db
    .update(items)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(items.id, id))
    .returning();

  return updated ?? null;
}

export async function deleteItem(id: string): Promise<Item | null> {
  const [deleted] = await db.delete(items).where(eq(items.id, id)).returning();
  return deleted ?? null;
}
