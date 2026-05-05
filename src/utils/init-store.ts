import { eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../config/database";
import { stores } from "../models/schema";

export async function getOrCreateDefaultStore() {
  const shopifyDomain = env.SHOPIFY_STORE_URL
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  const existingStore = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.shopifyDomain, shopifyDomain))
    .limit(1);

  if (existingStore.length > 0) {
    return existingStore[0].id;
  }

  const newStore = await db
    .insert(stores)
    .values({
      shopifyDomain,
      shopifyAccessToken: env.SHOPIFY_ACCESS_TOKEN,
      name: shopifyDomain,
    })
    .returning({ id: stores.id });

  return newStore[0].id;
}
