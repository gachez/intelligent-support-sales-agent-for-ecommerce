import { Router, Request, Response } from "express";
import multer from "multer";
import { RAGService } from "../services/rag.service";
import { getOrCreateDefaultStore } from "@/utils/init-store";
import { db } from "../config/database";
import { sql } from "drizzle-orm";

const router = Router();
const ragService = new RAGService();

// Set up multer to store files in memory temporarily
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

/**
 * POST /api/admin/knowledge/upload
 * Uploads a document (PDF/TXT) and extracts its text.
 */
router.post("/upload", upload.single("file"), async (req: Request, res: Response): Promise<void> => {
    try {
        if (!req.file) {
            res.status(400).json({ success: false, error: "No file uploaded." });
            return;
        }

        const { originalname, buffer, mimetype } = req.file;

        // 1. Get Store and extract and chunk text
        const storeId = await getOrCreateDefaultStore();
        const extractedText = await ragService.extractTextFromFile(buffer, mimetype);

        // 2. Split the text into overlapping chunks
        // We are passing smaller numbers here (50 max, 10 overlap) just to test it with our small text file!
        const chunks = ragService.chunkText(extractedText, 50, 10);
// 3. Generate Embeddings and Save to Database
    await ragService.embedAndStoreChunks(storeId, originalname, chunks);

    res.json({
      success: true,
      message: `Successfully processed and embedded ${chunks.length} chunk(s) into pgvector!`,
      filename: originalname,
      totalChunks: chunks.length
    });
  } catch (error: any) {
    console.error("Knowledge upload error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to process document.",
    });
  }
});

/**
 * GET /api/admin/knowledge/search
 * Tests the vector similarity search.
 * Query params: q (string), limit (number)
 */
router.get("/search", async (req: Request, res: Response): Promise<void> => {
  try {
    const query = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 3;

    if (!query) {
      res.status(400).json({ success: false, error: "Missing query parameter 'q'." });
      return;
    }

    const storeId = await getOrCreateDefaultStore();
    
    // Perform the vector search!
    const results = await ragService.searchKnowledge(storeId, query, limit);

    res.json({
      success: true,
      query,
      count: results.length,
      results
    });
  } catch (error: any) {
    console.error("Knowledge search error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to search knowledge base.",
    });
  }
});

/**
 * GET /api/admin/knowledge/documents
 * Lists all distinct documents in the knowledge base with their chunk count.
 * Powers the document list on the admin demo page.
 */
router.get("/documents", async (req: Request, res: Response): Promise<void> => {
  try {
    const storeId = await getOrCreateDefaultStore();

    const results = await db.execute(sql`
      SELECT
        source                        AS "filename",
        COUNT(*)::int                 AS "chunkCount",
        MIN(created_at)               AS "uploadedAt"
      FROM knowledge_chunks
      WHERE store_id = ${storeId}
      GROUP BY source
      ORDER BY MIN(created_at) DESC;
    `);

    res.json({ success: true, documents: results.rows });
  } catch (error: any) {
    console.error("Knowledge documents list error:", error.message);
    res.status(500).json({ success: false, error: "Failed to list documents." });
  }
});

export default router;