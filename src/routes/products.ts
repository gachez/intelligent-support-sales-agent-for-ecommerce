import { Router, Request, Response } from "express";
import { getOrCreateDefaultStore } from "../utils/init-store";
import { ProductService } from "@/services/project.service";

const router = Router();
const productService = new ProductService();

/**
 * GET /api/products
 * S2-02: Searches for products using natural language vector similarity.
 * Query Params: q (string), limit (number)
 */
router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const query = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 5;

    if (!query) {
      res.status(400).json({ success: false, error: "Missing search query parameter 'q'." });
      return;
    }

    const storeId = await getOrCreateDefaultStore();
    
    // Perform semantic search
    const products = await productService.searchProducts(storeId, query, limit);

    res.json({
      success: true,
      query,
      count: products.length,
      products
    });
  } catch (error: any) {
    console.error("Product search error:", error);
    res.status(500).json({ success: false, error: "Failed to search products." });
  }
});

export default router;