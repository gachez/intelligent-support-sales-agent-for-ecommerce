import { AzureOpenAI } from "openai";
import { env } from "../config/env";
import { db } from "../config/database";
import { sql } from "drizzle-orm";

const ai = new AzureOpenAI({
  endpoint: env.AZURE_OPENAI_ENDPOINT,
  apiKey: env.AZURE_OPENAI_API_KEY,
  apiVersion: "2024-02-01",
  deployment: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
});

export interface ProductCard {
  id: string;
  title: string;
  description: string;
  price: string;
  imageUrl: string | null;
  tags: string;
  variants: Array<{
    id: string;
    title: string;
    price: string;
    inventoryQuantity: number;
    availableForSale: boolean;
    sku: string;
  }>;
  totalInventory: number;
  /** Human-readable stock label for the UI ("In Stock" / "X left" / "Out of Stock") */
  stockLabel: string;
  similarity: number;
}

export class ProductService {
  /**
   * S2-02 / S2-05: Semantic Product Search → Product Cards
   * Embeds the query, runs cosine similarity against pgvector, and returns
   * structured product cards ready for the frontend to render.
   * Out-of-stock products are excluded by default.
   */
  async searchProducts(
    storeId: string,
    query: string,
    topK: number = 5
  ): Promise<ProductCard[]> {
    const response = await ai.embeddings.create({
      input: query,
      model: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
    });

    const queryEmbedding = response.data[0].embedding;
    const vectorString = JSON.stringify(queryEmbedding);

    // Exclude out-of-stock products (total_inventory > 0).
    // Returns the topK most semantically similar results.
    const results = await db.execute(sql`
      SELECT
        shopify_product_id                              AS "id",
        title,
        description,
        price_min                                       AS "price",
        image_url                                       AS "imageUrl",
        tags,
        variants,
        total_inventory                                 AS "totalInventory",
        1 - (embedding <=> ${vectorString}::vector)     AS "similarity"
      FROM products
      WHERE store_id = ${storeId}
        AND total_inventory > 0
      ORDER BY embedding <=> ${vectorString}::vector
      LIMIT ${topK};
    `);

    return results.rows.map((row: any) => {
      const inv: number = Number(row.totalInventory ?? 0);
      const stockLabel =
        inv === 0 ? "Out of Stock" : inv <= 5 ? `${inv} left` : "In Stock";

      return {
        id: row.id,
        title: row.title,
        description: row.description,
        price: row.price,
        imageUrl: row.imageUrl,
        tags: row.tags,
        variants: row.variants ?? [],
        totalInventory: inv,
        stockLabel,
        similarity: parseFloat(row.similarity),
      };
    });
  }
}