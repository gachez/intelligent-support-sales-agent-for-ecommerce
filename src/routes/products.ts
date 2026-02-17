import { Router, Request, Response } from "express";
import { ShopifyService } from "../services/shopify.service";

const router = Router();
const shopify = new ShopifyService();

/**
 * GET /api/products
 * Search products from the Shopify store.
 *
 * Query params:
 *   q     - search query (optional)
 *   limit - max results (default: 10)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 25);

    const products = await shopify.fetchProducts(query, limit);

    res.json({
      success: true,
      count: products.length,
      query: query || null,
      products: products.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        vendor: p.vendor,
        productType: p.productType,
        tags: p.tags,
        image: p.featuredImage?.url || null,
        status: p.status,
        totalInventory: p.totalInventory,
        priceRange: p.priceRange,
        variants: p.variants.map((v) => ({
          id: v.id,
          title: v.title,
          price: v.price,
          inventory: v.inventoryQuantity,
          available: v.availableForSale,
          sku: v.sku,
        })),
      })),
    });
  } catch (error: any) {
    console.error("Product fetch error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch products",
      message: error.message,
    });
  }
});

/**
 * GET /api/products/:id
 * Get a single product by Shopify GID.
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const productId = req.params.id as string;

    // Accept either raw GID or just the numeric ID
    const gid = productId.startsWith("gid://")
      ? productId
      : `gid://shopify/Product/${productId}`;

    const product = await shopify.getProductById(gid);

    if (!product) {
      res.status(404).json({
        success: false,
        error: "Product not found",
      });
      return;
    }

    res.json({ success: true, product });
  } catch (error: any) {
    console.error("Product fetch error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch product",
      message: error.message,
    });
  }
});

/**
 * GET /api/products/inventory/:variantId
 * Check inventory for a specific variant.
 */
router.get("/inventory/:variantId", async (req: Request, res: Response) => {
  try {
    const variantId = req.params.variantId as string;

    const gid = variantId.startsWith("gid://")
      ? variantId
      : `gid://shopify/ProductVariant/${variantId}`;

    const inventory = await shopify.checkInventory(gid);

    res.json({ success: true, variantId: gid, ...inventory });
  } catch (error: any) {
    console.error("Inventory check error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to check inventory",
      message: error.message,
    });
  }
});

export default router;
