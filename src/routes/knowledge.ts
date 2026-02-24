import { Router, Request, Response } from "express";
import multer from "multer";
import { RAGService } from "../services/rag.service";

const router = Router();
const ragService = new RAGService();

// Set up multer to store files in memory (RAM) temporarily
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

    // 1. Extract the text
    const extractedText = await ragService.extractTextFromFile(buffer, mimetype);

    // TODO: S1-02 Chunking and S1-03 Embedding will go here!

    res.json({
      success: true,
      message: "File successfully parsed.",
      filename: originalname,
      textLength: extractedText.length,
      preview: extractedText.substring(0, 200) + "...", // Show the first 200 chars
    });
  } catch (error: any) {
    console.error("Knowledge upload error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to process document.",
    });
  }
});

export default router;