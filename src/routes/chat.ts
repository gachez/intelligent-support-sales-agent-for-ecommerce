import { Router, Request, Response } from "express";
import { ChatService } from "../services/chat.service";
import { RAGService } from "../services/rag.service";
import { getOrCreateDefaultStore } from "../utils/init-store";

const router = Router();
const chatService = new ChatService();
const ragService = new RAGService();

/**
 * POST /api/chat
 * S1-06: Main endpoint for chatting with the RAG agent.
 */
router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, history = [] } = req.body;

    if (!message) {
      res.status(400).json({ success: false, error: "Message is required." });
      return;
    }

    const storeId = await getOrCreateDefaultStore();

    // 1. Rewrite the query (S1-05)
    console.log("Original message:", message);
    const rewrittenQuery = await chatService.rewriteQuery(history, message);
    console.log("Rewritten query:", rewrittenQuery);

    // 2. Search the vector database (S1-04)
    const contextChunks = await ragService.searchKnowledge(storeId, rewrittenQuery, 2);
    
    // Combine chunks into a single text block
    const contextText = contextChunks.map((c: any) => c.content).join("\n\n");

    // 3. Generate final answer using GPT (S1-06)
    const finalAnswer = await chatService.generateResponse(history, message, contextText);

    res.json({
      success: true,
      answer: finalAnswer,
      // We can optionally return these for debugging
      _debug: {
        rewrittenQuery,
        contextUsed: contextText !== ""
      }
    });
  } catch (error: any) {
    console.error("Chat error:", error.message);
    res.status(500).json({ success: false, error: "Failed to process chat message." });
  }
});

export default router;