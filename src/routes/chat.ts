import { Router, Request, Response } from "express";
import { ChatService } from "../services/chat.service";
import { RAGService } from "../services/rag.service";
import { SessionService } from "../services/session.service";
import { ProductService } from "../services/project.service";
import { getOrCreateDefaultStore } from "../utils/init-store";

const router = Router();
const chatService = new ChatService();
const ragService = new RAGService();
const sessionService = new SessionService();
const productService = new ProductService();

/**
 * POST /api/chat
 *
 * Sprint 2 unified chat endpoint.
 *
 * Request body:
 *   message      string   — the user's message (required)
 *   guest_token  string?  — session token from a previous turn (optional)
 *
 * Response body:
 *   success      boolean
 *   guest_token  string   — always returned so the client can persist it
 *   intent       string   — classified intent for this turn
 *   answer       string?  — text response (all intents except PRODUCT_SEARCH)
 *   products     array?   — product cards (PRODUCT_SEARCH only)
 *   _debug       object   — rewritten query and flags (development aid)
 */
router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, guest_token } = req.body;

    if (!message || typeof message !== "string" || message.trim() === "") {
      res.status(400).json({ success: false, error: "message is required." });
      return;
    }

    const storeId = await getOrCreateDefaultStore();

    // ── S2-03: Session management ─────────────────────────────────────────────
    const { sessionId, guestToken, isNew } =
      await sessionService.createOrResumeSession(storeId, guest_token);

    // ── S2-06: Load conversation history from DB ──────────────────────────────
    // Fetch up to 10 prior turns so the query rewriter and LLM have full context.
    const history = await sessionService.getHistory(sessionId, 10);

    // ── S2-04: Intent classification ─────────────────────────────────────────
    const intent = await chatService.classifyIntent(message, history);

    // Persist the user's message with its classified intent
    await sessionService.saveMessage(sessionId, "user", message, intent);

    // ── Intent routing ────────────────────────────────────────────────────────
    let answer: string | undefined;
    let products: any[] | undefined;
    let sources: string[] | undefined;
    let rewrittenQuery: string | undefined;

    if (intent === "PRODUCT_SEARCH") {
      // S2-06: Rewrite the query to resolve pronouns and references from history,
      // then run semantic vector search and return formatted product cards (S2-05).
      rewrittenQuery = await chatService.rewriteQuery(history, message);
      products = await productService.searchProducts(storeId, rewrittenQuery, 5);

      answer =
        products.length > 0
          ? `I found ${products.length} product${products.length > 1 ? "s" : ""} that match your search:`
          : "I couldn't find any products matching that description. Could you try different keywords?";

      await sessionService.saveMessage(sessionId, "assistant", answer, intent, {
        products: products.map((p) => p.id),
      });
    } else if (intent === "SUPPORT_QUESTION") {
      // S1-06 / S2-06: Rewrite query, retrieve RAG context, generate grounded answer.
      rewrittenQuery = await chatService.rewriteQuery(history, message);
      const chunks = await ragService.searchKnowledge(storeId, rewrittenQuery, 2);
      const context = chunks.map((c: any) => c.content).join("\n\n");
      // Collect distinct source filenames so the UI can show attribution
      sources = [...new Set(chunks.map((c: any) => c.source as string))];
      answer = await chatService.generateResponse(history, message, context);

      await sessionService.saveMessage(sessionId, "assistant", answer, intent, { sources });
    } else if (intent === "PURCHASE_INTENT") {
      // Sprint 3 (SagaLLM checkout) — placeholder response for now.
      answer =
        "I'd love to help you complete your purchase! Autonomous checkout is coming very soon. " +
        "In the meantime, please let me know the exact product and variant you'd like and I'll do my best to assist.";
      await sessionService.saveMessage(sessionId, "assistant", answer, intent);
    } else if (intent === "NEGOTIATION") {
      // Sprint 4 (Dynamic Pricing Engine) — placeholder response for now.
      answer =
        "I understand you're looking for a better deal! Our dynamic pricing feature is being rolled out soon. " +
        "Stay tuned — I'll be able to offer you a personalised discount in the next update.";
      await sessionService.saveMessage(sessionId, "assistant", answer, intent);
    } else {
      // GENERAL_CHAT: friendly direct LLM response, no RAG needed.
      answer = await chatService.generateDirectResponse(history, message);
      await sessionService.saveMessage(sessionId, "assistant", answer, intent);
    }

    // S2-03: Extend session expiry on every active turn
    await sessionService.updateLastActive(sessionId);

    res.json({
      success: true,
      guest_token: guestToken,
      is_new_session: isNew,
      intent,
      ...(answer !== undefined && { answer }),
      ...(products !== undefined && { products }),
      ...(sources !== undefined && { sources }),
      _debug: {
        rewrittenQuery: rewrittenQuery ?? null,
        sessionId,
      },
    });
  } catch (error: any) {
    console.error("Chat error:", error.message);
    res.status(500).json({ success: false, error: "Failed to process chat message." });
  }
});

export default router;
