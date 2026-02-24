import { db } from "../config/database";
import { stores } from "../models/schema";

export async function getOrCreateDefaultStore() {
  const existingStores = await db.select().from(stores).limit(1);
  
  if (existingStores.length > 0) {
    return existingStores[0].id;
  }

  const newStore = await db.insert(stores).values({
    shopifyDomain: "poch-9133.myshopify.com",
    shopifyAccessToken: "dummy-token",
    name: "Dev Store"
  }).returning({ id: stores.id });

  return newStore[0].id;
}