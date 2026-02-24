import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { testConnection } from "./config/database";
import { requestLogger, errorHandler } from "./middleware/logger";
import healthRoutes from "./routes/health";
import productRoutes from "./routes/products";
import knowledgeRoutes from "./routes/knowledge";
import chatRoutes from "./routes/chat";


const app = express();

// ========================================
// MIDDLEWARE
// ========================================
app.use(
  cors({
    origin: [
      // Allow Shopify storefront and admin
      `https://${env.SHOPIFY_STORE_URL}`,
      // Allow localhost for development
      "http://localhost:3000",
      "http://localhost:5173",
    ],
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(requestLogger);

// ========================================
// ROUTES
// ========================================
app.use("/health", healthRoutes);
app.use("/api/products", productRoutes);
app.use("/api/admin/knowledge", knowledgeRoutes);
app.use("/api/chat", chatRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.path });
});

// Global error handler
app.use(errorHandler);

// ========================================
// START SERVER
// ========================================
async function start() {
  const port = parseInt(env.PORT);

  console.log("\n🤖 Intelligent Sales Agent - Starting...\n");

  // Test database connection
  try {
    await testConnection();
  } catch (error) {
    console.error("Failed to connect to database. Server starting without DB.");
  }

  app.listen(port, () => {
    console.log(`\n🚀 Server running on http://localhost:${port}`);
    console.log(`📊 Health check: http://localhost:${port}/health`);
    console.log(`🛍️  Products API: http://localhost:${port}/api/products`);
    console.log(`\n🔧 Environment: ${env.NODE_ENV}`);
    console.log(`🏪 Shopify Store: ${env.SHOPIFY_STORE_URL}\n`);
  });
}

start().catch((error) => {
  console.error("Fatal error starting server:", error);
  process.exit(1);
});

export default app;
