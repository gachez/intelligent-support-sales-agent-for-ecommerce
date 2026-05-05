import { Router, Request, Response } from "express";
import { ShopifyService } from "../services/shopify.service";
import { RAGService } from "../services/rag.service";
import { getOrCreateDefaultStore } from "../utils/init-store";
import { db } from "../config/database";
import { products, draftOrders, pricingEvents } from "../models/schema";
import { sql, desc } from "drizzle-orm";
import { AzureOpenAI } from "openai";
import { env } from "../config/env";
import { PricingService } from "../services/pricing.service";
import { pricingConfigUpdateSchema } from "../schemas/pricing.schema";

const router = Router();
const shopifyService = new ShopifyService();
const pricingService = new PricingService();
// We'll use the AI client directly here to embed product summaries
const ai = new AzureOpenAI({
  endpoint: env.AZURE_OPENAI_ENDPOINT,
  apiKey: env.AZURE_OPENAI_API_KEY,
  apiVersion: "2024-02-01",
  deployment: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT, 
});

/**
 * POST /api/admin/sync-products
 * S2-01: Pulls products from Shopify, embeds them, and stores them in pgvector
 */
router.post("/sync-products", async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = await getOrCreateDefaultStore();
    
    // 1. Fetch products from Shopify
    const shopifyProducts = await shopifyService.fetchAllProductsForSync();
    
    let syncedCount = 0;

    // 2. Process and embed each product
    for (const prod of shopifyProducts) {
      const currencyCode = prod.priceRange?.minVariantPrice?.currencyCode ?? null;
      const variantNodes = (prod.variants?.edges ?? []).map((e: any) => ({
        ...e.node,
        currencyCode,
      }));
      const lowestPrice = prod.priceRange?.minVariantPrice?.amount ?? variantNodes[0]?.price ?? "0";
      const tags = (prod.tags ?? []).join(", ");
      const imageUrl = prod.featuredImage?.url ?? null;
      const totalInventory = prod.totalInventory ?? 0;

      // Rich text for embedding — includes price, tags, and variant names for relevance
      const variantTitles = variantNodes.map((v: any) => v.title).join(", ");
      const productSummary = `Product: ${prod.title}. Description: ${prod.description}. Tags: ${tags}. Variants: ${variantTitles}. Starting Price: ${formatMoneyForEmbedding(lowestPrice, currencyCode)}.`;

      // Generate embedding
      const embedResponse = await ai.embeddings.create({
        input: productSummary,
        model: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
      });
      const embeddingVector = embedResponse.data[0].embedding;
      const vectorString = JSON.stringify(embeddingVector);

      // Extract numeric Shopify ID from GID (gid://shopify/Product/12345)
      const numericId = prod.id.split("/").pop();

      // Serialise variants as JSON for storage
      const variantsJson = JSON.stringify(variantNodes);

      await db.execute(sql`
        INSERT INTO products (
          store_id,
          shopify_product_id,
          title,
          description,
          price_min,
          tags,
          image_url,
          variants,
          total_inventory,
          embedding_text,
          embedding
        )
        VALUES (
          ${storeId},
          ${numericId},
          ${prod.title},
          ${prod.description},
          ${lowestPrice}::numeric,
          ${tags},
          ${imageUrl},
          ${variantsJson}::jsonb,
          ${totalInventory},
          ${productSummary},
          ${vectorString}::vector
        )
        ON CONFLICT (store_id, shopify_product_id) DO UPDATE SET
          title            = EXCLUDED.title,
          description      = EXCLUDED.description,
          price_min        = EXCLUDED.price_min,
          tags             = EXCLUDED.tags,
          image_url        = EXCLUDED.image_url,
          variants         = EXCLUDED.variants,
          total_inventory  = EXCLUDED.total_inventory,
          embedding_text   = EXCLUDED.embedding_text,
          embedding        = EXCLUDED.embedding,
          updated_at       = NOW();
      `);
      syncedCount++;
    }

    res.json({ success: true, message: `Successfully embedded and synced ${syncedCount} products.` });
  } catch (error: any) {
    console.error("Product sync error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/discounts/config
 * Returns the current pricing configuration for the store.
 */
router.get("/discounts/config", async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = await getOrCreateDefaultStore();
    const config = await pricingService.getConfig(storeId);

    res.json({ success: true, config });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/discounts/config
 * Updates the pricing configuration used by the negotiation engine.
 */
router.post("/discounts/config", async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = await getOrCreateDefaultStore();
    const parsed = pricingConfigUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "Invalid pricing configuration.",
        details: parsed.error.flatten(),
      });
      return;
    }

    const config = await pricingService.updateConfig(storeId, parsed.data);
    res.json({ success: true, config });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/pricing/events
 * Returns the most recent pricing events for the admin demo.
 */
router.get("/pricing/events", async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db
      .select({
        id: pricingEvents.id,
        sessionId: pricingEvents.sessionId,
        contextVector: pricingEvents.contextVector,
        armSelected: pricingEvents.armSelected,
        discountCode: pricingEvents.discountCode,
        outcome: pricingEvents.outcome,
        reward: pricingEvents.reward,
        createdAt: pricingEvents.createdAt,
        resolvedAt: pricingEvents.resolvedAt,
      })
      .from(pricingEvents)
      .orderBy(desc(pricingEvents.createdAt))
      .limit(20);

    res.json({ success: true, events: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/orders
 * Returns the 20 most recent draft orders with saga log for the admin panel.
 */
router.get("/orders", async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await db
      .select({
        id: draftOrders.id,
        shopifyDraftOrderId: draftOrders.shopifyDraftOrderId,
        checkoutUrl: draftOrders.checkoutUrl,
        lineItems: draftOrders.lineItems,
        status: draftOrders.status,
        sagaLog: draftOrders.sagaLog,
        discountPercent: draftOrders.discountPercent,
        createdAt: draftOrders.createdAt,
      })
      .from(draftOrders)
      .orderBy(desc(draftOrders.createdAt))
      .limit(20);

    res.json({ success: true, orders: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

function formatMoneyForEmbedding(amount: string, currencyCode: string | null): string {
  return currencyCode ? `${currencyCode} ${amount}` : amount;
}
