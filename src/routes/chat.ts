import { Router, Request, Response } from "express";
import { ChatService } from "../services/chat.service";
import { RAGService } from "../services/rag.service";
import { SessionService } from "../services/session.service";
import { ProductService } from "../services/project.service";
import { CheckoutService } from "../services/checkout.service";
import { PricingService } from "../services/pricing.service";
import { getOrCreateDefaultStore } from "../utils/init-store";

const router = Router();

const chatService = new ChatService();
const ragService = new RAGService();
const sessionService = new SessionService();
const productService = new ProductService();
const checkoutService = new CheckoutService();
const pricingService = new PricingService();

/**
 * POST /api/chat
 *
 * Request body:
 *   message      string   — the user's message (required)
 *   guest_token  string?  — session token from a previous turn (optional)
 *
 * Response body:
 *   success      boolean
 *   guest_token  string
 *   intent       string
 *   answer       string?
 *   products     array?
 *   sources      array?
 *   _debug       object
 */
router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, guest_token } = req.body;

    if (!message || typeof message !== "string" || message.trim() === "") {
      res.status(400).json({
        success: false,
        error: "message is required.",
      });
      return;
    }

    const latestMessage = message.trim();
    const storeId = await getOrCreateDefaultStore();

    // ── Session management ───────────────────────────────────────────────────
    const { sessionId, guestToken, isNew } =
      await sessionService.createOrResumeSession(storeId, guest_token);

    // Fetch prior turns before saving current user message.
    const history = await sessionService.getHistory(sessionId, 10);

    // ── Intent classification ────────────────────────────────────────────────
    const intent = await chatService.classifyIntent(latestMessage, history);

    // Persist the user's message with its classified intent.
    await sessionService.saveMessage(sessionId, "user", latestMessage, intent);

    // ── Intent routing ───────────────────────────────────────────────────────
    let answer: string | undefined;
    let products: any[] | undefined;
    let sources: string[] | undefined;

    let rewrittenQuery: string | undefined;
    let searchQueries: string[] | undefined;
    let retrievedChunksCount: number | undefined;
    let rerankedChunksCount: number | undefined;
    let priceConstraintRelaxed = false;
    let productSearchPlan: any | undefined;
    let effectiveSearchQuery: string | undefined;
    let negotiationRequest: any | undefined;

    if (intent === "PRODUCT_SEARCH") {
      rewrittenQuery = await chatService.rewriteQuery(history, latestMessage);
      productSearchPlan = await chatService.extractProductSearchPlan(
        history,
        latestMessage,
        rewrittenQuery
      );
      const productQuery = productSearchPlan.searchQuery || rewrittenQuery;
      effectiveSearchQuery = productQuery;

      const constraints = productService.buildChatSearchConstraintsFromPlan(
        latestMessage,
        rewrittenQuery,
        productSearchPlan
      );

      products = await productService.searchProducts(storeId, productQuery, 5, {
        constraints,
      });

      if (products.length === 0 && productService.hasPriceConstraint(constraints)) {
        products = await productService.searchProducts(storeId, productQuery, 5, {
          constraints: productService.withoutPriceConstraints(constraints),
        });
        priceConstraintRelaxed = products.length > 0;
      }

      answer = await chatService.generateProductSearchResponse({
        latestMessage,
        rewrittenQuery: productQuery,
        products,
        constraints,
        priceConstraintRelaxed,
      });

      await sessionService.saveMessage(sessionId, "assistant", answer, intent, {
        products: products.map((p) => ({
          id: p.id,
          title: p.title,
          price: p.price,
          currencyCode: p.currencyCode,
          formattedPrice: p.formattedPrice,
          variants: p.variants,
        })),
      });
    } else if (intent === "SUPPORT_QUESTION") {
      // ── Improved Semantic RAG Flow ─────────────────────────────────────────
      // 1. Rewrite the message into a standalone query.
      rewrittenQuery = await chatService.rewriteQuery(history, latestMessage);

      // 2. Generate semantic/paraphrased search queries.
      searchQueries = await chatService.generateSearchQueries(
        rewrittenQuery,
        history
      );

      // Ensure the original user wording is included too.
      searchQueries = [
        latestMessage,
        rewrittenQuery,
        ...searchQueries,
      ]
        .map((query) => query.trim())
        .filter(Boolean)
        .filter((query, index, arr) => arr.indexOf(query) === index)
        .slice(0, 8);

      // 3. Retrieve more candidates than we need.
      const retrievedChunks = await ragService.searchKnowledge(
        storeId,
        searchQueries,
        12
      );

      retrievedChunksCount = retrievedChunks.length;

      // 4. Rerank retrieved candidates using LLM relevance judgment.
      const rerankedChunks = await chatService.rerankChunks(
        latestMessage,
        retrievedChunks as any
      );

      rerankedChunksCount = rerankedChunks.length;

      // 5. Build grounded context from the reranked chunks only.
      const context = ragService.buildContext(rerankedChunks as any);

      sources = [
        ...new Set(
          rerankedChunks
            .map((chunk: any) => chunk.source as string)
            .filter(Boolean)
        ),
      ];

      // 6. Generate final grounded response.
      answer = await chatService.generateResponse(
        history,
        latestMessage,
        context
      );

      await sessionService.saveMessage(sessionId, "assistant", answer, intent, {
        sources,
        searchQueries,
        retrievedChunksCount,
        rerankedChunksCount,
      });
    } else if (intent === "PURCHASE_INTENT") {
      const rawPayload = await chatService.extractOrderPayload(history, latestMessage);

      if (!rawPayload) {
        answer =
          "I'd love to help you complete that purchase! Could you tell me which product " +
          "and variant (size, colour, etc.) you'd like to order?";
      } else {
        const payloadWithOffer = await pricingService.applyOfferToPayload(
          storeId,
          sessionId,
          rawPayload as any
        );

        const checkout = await checkoutService.checkout(
          storeId,
          sessionId,
          payloadWithOffer.payload
        );

        if (payloadWithOffer.offer && checkout.success) {
          await pricingService.finalizeOfferOutcome(
            storeId,
            sessionId,
            "converted"
          );
        } else if (payloadWithOffer.offer && !checkout.success) {
          await pricingService.finalizeOfferOutcome(
            storeId,
            sessionId,
            "abandoned"
          );
        }

        if (checkout.success && checkout.checkoutUrl) {
          answer =
            `Great choice! I've created your order. ` +
            `Complete your purchase here: ${checkout.checkoutUrl}`;
        } else {
          answer =
            `Sorry, I wasn't able to complete that order. ` +
            `${checkout.error ?? "Please try again or contact support."}`;
        }
      }

      await sessionService.saveMessage(sessionId, "assistant", answer, intent);
    } else if (intent === "NEGOTIATION") {
      negotiationRequest = await chatService.extractNegotiationRequest(
        history,
        latestMessage
      );
      const decision = await pricingService.createNegotiationOffer(
        storeId,
        sessionId,
        negotiationRequest
      );

      if (decision.offer) {
        const expiresAt = new Date(decision.offer.expiresAt).toLocaleTimeString();
        const productText = decision.offer.productTitle
          ? ` for ${decision.offer.productTitle}`
          : "";
        const finalPriceText = decision.offer.formattedFinalPrice
          ? ` That brings it to ${decision.offer.formattedFinalPrice}.`
          : "";
        const counterText = decision.reason.includes("exceeded the configured cap")
          ? "I can’t go that low, but "
          : "";

        answer =
          `${counterText}I can offer you ${decision.offer.discountPercent}% off${productText} until ${expiresAt}.` +
          finalPriceText +
          " " +
          `Use code ${decision.offer.code} at checkout before ${expiresAt}.`;
      } else {
        answer = decision.reason.includes("No recent product")
          ? "I can discuss a discount once we pick a product. Which item would you like the offer on?"
          : "I’m not able to issue a discount right now, but I can still help you find the right product or answer questions about the store.";
      }

      await sessionService.saveMessage(sessionId, "assistant", answer, intent, {
        negotiationRequest,
        pricingOffer: decision.offer ?? null,
        pricingReason: decision.reason,
      });
    } else {
      answer = await chatService.generateDirectResponse(history, latestMessage);

      await sessionService.saveMessage(sessionId, "assistant", answer, intent);
    }

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
        searchQueries: searchQueries ?? null,
        retrievedChunksCount: retrievedChunksCount ?? null,
        rerankedChunksCount: rerankedChunksCount ?? null,
        productSearchPlan: productSearchPlan ?? null,
        effectiveSearchQuery: effectiveSearchQuery ?? null,
        negotiationRequest: negotiationRequest ?? null,
        priceConstraintRelaxed,
        sessionId,
      },
    });
  } catch (error: any) {
    console.error("Chat error:", error);

    res.status(500).json({
      success: false,
      error: "Failed to process chat message.",
    });
  }
});

export default router;
