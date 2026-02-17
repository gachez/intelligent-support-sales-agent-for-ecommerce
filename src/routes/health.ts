import { Router, Request, Response } from "express";
import { pool } from "../config/database";
import { ShopifyService } from "../services/shopify.service";

const router = Router();

/**
 * GET /health
 * System health check: server, database, and Shopify connection.
 */
router.get("/", async (req: Request, res: Response) => {
  const health: {
    status: string;
    timestamp: string;
    uptime: number;
    services: Record<string, { status: string; detail?: string }>;
  } = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {},
  };

  // Check database
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    health.services.database = { status: "connected" };
  } catch (error: any) {
    health.services.database = {
      status: "disconnected",
      detail: error.message,
    };
    health.status = "degraded";
  }

  // Check Shopify
  try {
    const shopify = new ShopifyService();
    const shopInfo = await shopify.testConnection();
    health.services.shopify = {
      status: "connected",
      detail: shopInfo.shopName,
    };
  } catch (error: any) {
    health.services.shopify = {
      status: "disconnected",
      detail: error.message,
    };
    health.status = "degraded";
  }

  const statusCode = health.status === "ok" ? 200 : 503;
  res.status(statusCode).json(health);
});

export default router;
