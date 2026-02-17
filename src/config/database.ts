import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "./env";

/**
 * PostgreSQL connection pool.
 * Uses the DATABASE_URL from environment variables.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle(pool);

/**
 * Test database connectivity and pgvector extension.
 */
export async function testConnection(): Promise<void> {
  try {
    const client = await pool.connect();

    // Test basic connectivity
    const result = await client.query("SELECT NOW() as current_time");
    console.log(`✅ Database connected at ${result.rows[0].current_time}`);

    // Verify pgvector extension
    const vectorCheck = await client.query(
      "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') as has_vector"
    );

    if (vectorCheck.rows[0].has_vector) {
      console.log("✅ pgvector extension is enabled");
    } else {
      console.warn("⚠️  pgvector extension not found. Run: CREATE EXTENSION vector;");
    }

    client.release();
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    throw error;
  }
}
