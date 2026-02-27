import { Router, Request, Response } from "express";
import { ShopifyService } from "../services/shopify.service";
import { RAGService } from "../services/rag.service";
import { getOrCreateDefaultStore } from "../utils/init-store";
import { db } from "../config/database";
import { products } from "../models/schema";
import { sql } from "drizzle-orm";
import { AzureOpenAI } from "openai";
import { env } from "../config/env";

const router = Router();
const shopifyService = new ShopifyService();
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
      const variantNodes = (prod.variants?.edges ?? []).map((e: any) => e.node);
      const lowestPrice = variantNodes[0]?.price || "0";
      const tags = (prod.tags ?? []).join(", ");
      const imageUrl = prod.featuredImage?.url ?? null;
      const totalInventory = prod.totalInventory ?? 0;

      // Rich text for embedding — includes price, tags, and variant names for relevance
      const variantTitles = variantNodes.map((v: any) => v.title).join(", ");
      const productSummary = `Product: ${prod.title}. Description: ${prod.description}. Tags: ${tags}. Variants: ${variantTitles}. Starting Price: $${lowestPrice}.`;

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

export default router;