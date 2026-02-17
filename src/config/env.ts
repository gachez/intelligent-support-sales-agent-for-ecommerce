import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

/**
 * Environment variable schema.
 * Server refuses to start if any required variable is missing.
 */
const envSchema = z.object({
  // Server
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.string().default("3000"),

  // Database
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid PostgreSQL connection string"),

  // Shopify
  SHOPIFY_STORE_URL: z.string().min(1, "SHOPIFY_STORE_URL is required (e.g., your-store.myshopify.com)"),
  SHOPIFY_ACCESS_TOKEN: z.string().min(1, "SHOPIFY_ACCESS_TOKEN is required"),
  SHOPIFY_API_VERSION: z.string().default("2024-10"),

  // Azure OpenAI
  AZURE_OPENAI_API_KEY: z.string().min(1, "AZURE_OPENAI_API_KEY is required"),
  AZURE_OPENAI_ENDPOINT: z.string().url("AZURE_OPENAI_ENDPOINT must be a valid URL"),
  AZURE_OPENAI_DEPLOYMENT: z.string().default("gpt-4o"),
  AZURE_OPENAI_EMBEDDING_DEPLOYMENT: z.string().default("text-embedding-ada-002"),

  // Session
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  SESSION_TTL_HOURS: z.string().default("24"),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Environment validation failed:\n");
    result.error.issues.forEach((issue) => {
      console.error(`  • ${issue.path.join(".")}: ${issue.message}`);
    });
    console.error("\n📝 Check your .env file against .env.example\n");
    process.exit(1);
  }

  console.log("✅ Environment variables validated");
  return result.data;
}

export const env = validateEnv();
