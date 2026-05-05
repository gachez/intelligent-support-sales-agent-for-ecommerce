import { AzureOpenAI } from "openai";
import { env } from "../config/env";
import { formatMoney } from "../utils/money";

const VALID_INTENTS = [
  "PRODUCT_SEARCH",
  "SUPPORT_QUESTION",
  "PURCHASE_INTENT",
  "NEGOTIATION",
  "GENERAL_CHAT",
] as const;

const SUPPORT_FALLBACK_RESPONSE =
  "Thanks for asking. I’ll need a teammate to confirm that, so I’m passing this to our support team.";

export type Intent = (typeof VALID_INTENTS)[number];

interface ProductSearchReplyInput {
  latestMessage: string;
  rewrittenQuery: string;
  products: Array<{
    title: string;
    price: string;
    currencyCode?: string;
    formattedPrice?: string;
    stockLabel: string;
  }>;
  constraints?: {
    minPrice: number | null;
    maxPrice: number | null;
    sortBy: "relevance" | "price_asc" | "price_desc";
    searchTerms: string[];
  };
  priceConstraintRelaxed?: boolean;
}

export interface ProductSearchPlan {
  searchQuery: string;
  productTerms: string[];
  attributes: string[];
  minPrice: number | null;
  maxPrice: number | null;
  sortBy: "relevance" | "price_asc" | "price_desc";
}

export interface NegotiationRequest {
  productReference: string | null;
  requestedPrice: number | null;
  requestedDiscountPercent: number | null;
  reason: string | null;
}

interface RerankChunk {
  id?: string;
  source: string;
  chunkIndex?: number;
  content: string;
  similarity?: number;
  keywordHits?: number;
  score?: number;
}

const ai = new AzureOpenAI({
  endpoint: env.AZURE_OPENAI_ENDPOINT,
  apiKey: env.AZURE_OPENAI_API_KEY,
  apiVersion: "2024-02-15-preview",
  deployment: env.AZURE_OPENAI_DEPLOYMENT,
});

export class ChatService {
  private parseJsonObject(raw: string): any | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    try {
      return JSON.parse(trimmed);
    } catch {
      const match = trimmed.match(/\{[\s\S]*\}/);
      if (!match) return null;

      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }

  private normalizeProductSearchPlan(
    parsed: any,
    fallbackQuery: string
  ): ProductSearchPlan {
    const sortByValues = new Set(["relevance", "price_asc", "price_desc"]);
    const toNullableNumber = (value: unknown): number | null => {
      if (value === null || value === undefined || value === "") return null;
      const parsedValue = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
      return Number.isFinite(parsedValue) ? parsedValue : null;
    };
    const toStringArray = (value: unknown): string[] =>
      Array.isArray(value)
        ? value
            .filter((item) => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 8)
        : [];

    const searchQuery =
      typeof parsed?.searchQuery === "string" && parsed.searchQuery.trim()
        ? parsed.searchQuery.trim()
        : fallbackQuery;
    const sortBy =
      typeof parsed?.sortBy === "string" && sortByValues.has(parsed.sortBy)
        ? parsed.sortBy
        : "relevance";

    return {
      searchQuery,
      productTerms: toStringArray(parsed?.productTerms),
      attributes: toStringArray(parsed?.attributes),
      minPrice: toNullableNumber(parsed?.minPrice),
      maxPrice: toNullableNumber(parsed?.maxPrice),
      sortBy: sortBy as ProductSearchPlan["sortBy"],
    };
  }

  private formatProductPrice(product: ProductSearchReplyInput["products"][number]): string {
    return product.formattedPrice ?? formatMoney(product.price, product.currencyCode);
  }

  async generateProductSearchResponse(input: ProductSearchReplyInput): Promise<string> {
    if (input.products.length === 0) {
      const maxPrice = input.constraints?.maxPrice;

      if (maxPrice !== null && maxPrice !== undefined) {
        return `I couldn’t find any matching products within your budget of ${formatMoney(
          maxPrice
        )}. I can widen the range or show you the closest alternatives.`;
      }

      return "I couldn’t find a strong match for that yet. Tell me the product type, style, or budget and I’ll narrow it down.";
    }

    const relaxedMaxPrice = input.constraints?.maxPrice;
    if (input.priceConstraintRelaxed && relaxedMaxPrice !== null && relaxedMaxPrice !== undefined) {
      const productSummary = input.products
        .slice(0, 3)
        .map(
          (product, index) =>
            `${index + 1}. ${product.title} — ${this.formatProductPrice(product)} (${product.stockLabel})`
        )
        .join("; ");

      return `I couldn’t find an exact match within ${formatMoney(
        relaxedMaxPrice
      )}, but these are the closest available options: ${productSummary}.`;
    }

    const productSummary = input.products
      .slice(0, 3)
      .map(
        (product, index) =>
          `${index + 1}. ${product.title} — ${this.formatProductPrice(product)} (${product.stockLabel})`
      )
      .join("\n");

    const response = await ai.chat.completions.create({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      messages: [
        {
          role: "system",
          content: `You are a concise, conversational shopping assistant.

Write a natural reply for a product search result.

Rules:
- Sound like a helpful store assistant, not a database dump.
- Mention 2-3 standout products by name and price when relevant.
- Use the formatted prices exactly as provided; do not convert currencies or replace the currency symbol.
- If the user asked for the cheapest or gave a budget, acknowledge that explicitly.
- If strict price constraints were relaxed, say these are closest alternatives, not exact budget matches.
- Do not mention internal IDs, variant IDs, embeddings, similarity, or backend logic.
- Do not use bullet lists unless absolutely necessary.
- Keep it under 90 words.`,
        },
        {
          role: "user",
          content:
            `User message: ${input.latestMessage}\n` +
            `Rewritten search query: ${input.rewrittenQuery}\n` +
            `Applied constraints: ${JSON.stringify(input.constraints ?? null)}\n` +
            `Strict price constraints relaxed: ${input.priceConstraintRelaxed ? "yes" : "no"}\n` +
            `Top products:\n${productSummary}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 140,
    });

    return (
      response.choices[0].message.content?.trim() ??
      `I found ${input.products.length} options that look relevant. The best-priced one is ${
        input.products[0].title
      } at ${this.formatProductPrice(input.products[0])}.`
    );
  }

  /**
   * Rewrites the user's latest message into a standalone query.
   */
  async rewriteQuery(
    chatHistory: Array<{ role: string; content: string }>,
    latestMessage: string
  ): Promise<string> {
    if (!chatHistory || chatHistory.length === 0) {
      return latestMessage;
    }

    const historyText = chatHistory
      .slice(-8)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    const response = await ai.chat.completions.create({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      messages: [
        {
          role: "system",
          content: `You are an expert search query rewriter for an e-commerce store.

Given the conversation history and the new user message, rewrite the new message into a standalone search query that contains all necessary context.

Rules:
- Do NOT answer the question.
- ONLY return the rewritten query.
- If the message is already standalone, return it as-is.
- Keep it short and search-friendly.`,
        },
        {
          role: "user",
          content: `Conversation History:\n${historyText}\n\nNew Message: ${latestMessage}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 120,
    });

    return response.choices[0].message.content?.trim() || latestMessage;
  }

  async extractProductSearchPlan(
    chatHistory: Array<{ role: string; content: string }>,
    latestMessage: string,
    fallbackQuery: string
  ): Promise<ProductSearchPlan> {
    const historyText = chatHistory
      .slice(-6)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    const response = await ai.chat.completions.create({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      messages: [
        {
          role: "system",
          content: `You extract a structured product search plan for an e-commerce chatbot.

Return ONLY valid JSON with this exact shape:
{
  "searchQuery": "short product search query",
  "productTerms": ["main product nouns"],
  "attributes": ["meaningful modifiers like color, material, use case, room, size"],
  "minPrice": null,
  "maxPrice": null,
  "sortBy": "relevance"
}

Rules:
- Understand the user's shopping need by meaning, not by raw words.
- Remove greetings and filler such as hello, hi, I am looking for, show me, find me.
- Keep product words and meaningful attributes.
- Convert "below", "under", "less than", "within budget" into maxPrice.
- Convert "above", "over", "at least" into minPrice.
- Use sortBy "price_asc" for cheapest/lowest/budget-friendly.
- Use sortBy "price_desc" for premium/most expensive/highest.
- If the user refers to prior context, include the needed product context from history.
- Do not invent product attributes or prices that the user did not imply.
- searchQuery should be short and search-friendly, for example "chair", "office chair", or "black mesh office chair".
- Do not include markdown.`,
        },
        {
          role: "user",
          content:
            `Conversation History:\n${historyText || "None"}\n\n` +
            `Latest user message: ${latestMessage}\n` +
            `Fallback standalone query: ${fallbackQuery}`,
        },
      ],
      temperature: 0,
      max_tokens: 220,
    });

    const raw = response.choices[0].message.content?.trim() ?? "";
    const parsed = this.parseJsonObject(raw);

    return this.normalizeProductSearchPlan(parsed, fallbackQuery);
  }

  async extractNegotiationRequest(
    chatHistory: Array<{ role: string; content: string }>,
    latestMessage: string
  ): Promise<NegotiationRequest> {
    const historyText = chatHistory
      .slice(-8)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    const response = await ai.chat.completions.create({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      messages: [
        {
          role: "system",
          content: `You extract structured discount negotiation details for an e-commerce chatbot.

Return ONLY valid JSON with this exact shape:
{
  "productReference": null,
  "requestedPrice": null,
  "requestedDiscountPercent": null,
  "reason": null
}

Rules:
- productReference is the user's wording for the product, such as "the one for 15000", "Office Desk - OD475", or "the second one".
- requestedPrice is the final price the user wants to pay, e.g. "can you do 12000" -> 12000.
- requestedDiscountPercent is the percent discount requested, e.g. "10% off" -> 10.
- If the user only asks for any discount, leave requestedPrice and requestedDiscountPercent null.
- Do not invent prices, discounts, or product names.
- Do not include markdown.`,
        },
        {
          role: "user",
          content:
            `Conversation History:\n${historyText || "None"}\n\n` +
            `Latest user message: ${latestMessage}`,
        },
      ],
      temperature: 0,
      max_tokens: 160,
    });

    const raw = response.choices[0].message.content?.trim() ?? "";
    const parsed = this.parseJsonObject(raw) ?? {};
    const toNullableNumber = (value: unknown): number | null => {
      if (value === null || value === undefined || value === "") return null;
      const parsedValue = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
      return Number.isFinite(parsedValue) ? parsedValue : null;
    };

    return {
      productReference:
        typeof parsed.productReference === "string" && parsed.productReference.trim()
          ? parsed.productReference.trim()
          : null,
      requestedPrice: toNullableNumber(parsed.requestedPrice),
      requestedDiscountPercent: toNullableNumber(parsed.requestedDiscountPercent),
      reason:
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : null,
    };
  }

  /**
   * Generates multiple semantic search queries so RAG can match meaning,
   * not only exact keywords.
   */
  async generateSearchQueries(
    latestMessage: string,
    chatHistory: Array<{ role: string; content: string }> = []
  ): Promise<string[]> {
    const historyText = chatHistory
      .slice(-6)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const response = await ai.chat.completions.create({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      messages: [
        {
          role: "system",
          content: `You generate semantic search queries for an e-commerce RAG system.

Return ONLY a JSON array of 3 to 5 short search queries.

Rules:
- Include the user's original meaning.
- Add natural paraphrases.
- Add policy/document terms likely used in store documents.
- Match meaning, not exact wording.
- Do not answer the question.
- Do not include markdown.`,
        },
        {
          role: "user",
          content: `Conversation history:\n${historyText || "None"}\n\nUser message: ${latestMessage}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 180,
    });

    const raw = response.choices[0].message.content?.trim() ?? "";

    try {
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        return [
          latestMessage,
          ...parsed.filter((q) => typeof q === "string" && q.trim().length > 0),
        ]
          .map((q) => q.trim())
          .filter((q, index, arr) => arr.indexOf(q) === index)
          .slice(0, 6);
      }
    } catch {
      // Fall back to original message below.
    }

    return [latestMessage];
  }

  /**
   * Reranks retrieved chunks using the LLM.
   * Vector search finds candidates; this chooses the chunks that actually answer the question.
   */
  async rerankChunks(question: string, chunks: RerankChunk[]): Promise<RerankChunk[]> {
    if (!chunks.length) return [];
    if (chunks.length <= 3) return chunks;

    const chunkList = chunks
      .map(
        (chunk, index) =>
          `Chunk ${index}:\nSource: ${chunk.source}${
            chunk.chunkIndex !== undefined ? ` section ${chunk.chunkIndex + 1}` : ""
          }\nContent: ${chunk.content}`
      )
      .join("\n\n---\n\n");

    const response = await ai.chat.completions.create({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      messages: [
        {
          role: "system",
          content: `You rerank retrieved knowledge base chunks for an e-commerce support chatbot.

Return ONLY a JSON array of chunk indexes, ordered from most relevant to least relevant.

Rules:
- Select only chunks that help answer the user's question.
- Prefer chunks that answer the semantic meaning, even if wording differs.
- Exclude unrelated chunks.
- Return at most 5 indexes.
- Return [] if none are relevant.
- No markdown.`,
        },
        {
          role: "user",
          content: `User question: ${question}\n\nRetrieved chunks:\n${chunkList}`,
        },
      ],
      temperature: 0,
      max_tokens: 80,
    });

    const raw = response.choices[0].message.content?.trim() ?? "";

    try {
      const indexes = JSON.parse(raw);

      if (Array.isArray(indexes)) {
        const selected = indexes
          .filter((i) => Number.isInteger(i) && chunks[i])
          .map((i) => chunks[i])
          .slice(0, 5);

        return selected.length > 0 ? selected : chunks.slice(0, 5);
      }
    } catch {
      // Fall back below.
    }

    return chunks.slice(0, 5);
  }

  /**
   * Final grounded RAG response.
   */
  async generateResponse(
    chatHistory: Array<{ role: string; content: string }>,
    latestMessage: string,
    context: string
  ): Promise<string> {
    if (!context.trim()) {
      return SUPPORT_FALLBACK_RESPONSE;
    }

    const messages = chatHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    messages.unshift({
      role: "system",
      content: `You are a helpful e-commerce support agent.

Answer the user's question using ONLY the Knowledge Base Context below.

Important:
- The user may use different words from the document. Match by meaning, not exact wording.
- "broken", "faulty", "damaged", "defective", and "arrived in bad condition" may refer to damaged goods if the context supports it.
- "send back", "bring back", "exchange", "refund", and "return" may refer to returns if the context supports it.
- "delivery", "shipping", "dispatch", "rider", and "courier" may refer to delivery if the context supports it.
- You may combine snippets if they clearly belong to the same policy.
- You may apply direct policy boundaries from the context. For example, if the context says refunds are available "within 30 days", then a request after 30 days is outside that refund window.
- If the user's situation clearly fails a stated condition, say it does not qualify under the stated policy. Do not escalate just because the document does not separately spell out the inverse case.
- If the context partially answers the question, say what is confirmed and what needs support confirmation.
- If the context does not contain the answer, reply exactly with: "${SUPPORT_FALLBACK_RESPONSE}"
- Do not invent timelines, fees, conditions, warranties, exceptions, payment terms, or store policies.
- Do not mention snippets, context, embeddings, retrieval, or knowledge base.
- Keep the answer natural, concise, and helpful.

Knowledge Base Context:
---
${context}
---`,
    });

    messages.push({
      role: "user",
      content: latestMessage,
    });

    const response = await ai.chat.completions.create({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      messages: messages as any,
      temperature: 0.3,
      max_tokens: 300,
    });

    return (
      response.choices[0].message.content?.trim() ||
      "I am having trouble connecting to my knowledge base right now."
    );
  }

  async classifyIntent(
    message: string,
    history: Array<{ role: string; content: string }>
  ): Promise<Intent> {
    const historyText = history
      .slice(-4)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const response = await ai.chat.completions.create({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      messages: [
        {
          role: "system",
          content: `You are an intent classifier for an e-commerce chatbot.

Classify the user's message into exactly ONE of these labels:
- PRODUCT_SEARCH: User is looking for, browsing, or asking about specific products.
- SUPPORT_QUESTION: User is asking about store policies, shipping, returns, delivery, warranty, damaged goods, refunds, exchanges, payment, or other support topics.
- PURCHASE_INTENT: User explicitly wants to buy, add to cart, place an order, or checkout a selected product.
- NEGOTIATION: User is asking for a discount or trying to negotiate a price.
- GENERAL_CHAT: Greetings, thanks, complaints, or anything that doesn't fit the above.

Important:
- "I want/need/am looking for a <product type>" is PRODUCT_SEARCH unless the user asks to checkout, order, add to cart, or buy a specific selected item.
- If a message contains a discount request or price negotiation, classify it as NEGOTIATION even if it also says "I want".

Reply with ONLY the label. No punctuation, no explanation.`,
        },
        {
          role: "user",
          content: `Recent conversation:\n${historyText}\n\nClassify this message: "${message}"`,
        },
      ],
      temperature: 0,
      max_tokens: 20,
    });

    const raw = response.choices[0].message.content?.trim().toUpperCase() ?? "";

    return (VALID_INTENTS as readonly string[]).includes(raw)
      ? (raw as Intent)
      : "GENERAL_CHAT";
  }

  async extractOrderPayload(
    history: Array<{ role: string; content: string; metadata?: any }>,
    message: string
  ): Promise<unknown | null> {
    const historyText = history
      .slice(-10)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const candidateProducts = history
      .flatMap((entry) => entry.metadata?.products ?? [])
      .slice(-10)
      .map((product: any) => ({
        id: product.id,
        title: product.title,
        price: product.price,
        variants: (product.variants ?? []).map((variant: any) => ({
          id: variant.id,
          title: variant.title,
          price: variant.price,
        })),
      }));

    const response = await ai.chat.completions.create({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      messages: [
        {
          role: "system",
          content: `You are an order extraction assistant for an e-commerce chatbot.

Your job is to read a conversation and produce a JSON draft order payload.

The payload MUST follow this exact structure:
{
  "line_items": [
    {
      "variantId": "gid://shopify/ProductVariant/<numeric_id>",
      "quantity": <positive integer>
    }
  ],
  "note": "<optional string>",
  "discount": {
    "title": "<discount title>",
    "valueType": "PERCENTAGE" | "FIXED_AMOUNT",
    "value": <number>
  }
}

Rules:
- "line_items" is REQUIRED and must contain at least one item.
- "variantId" MUST be in GID format: "gid://shopify/ProductVariant/<id>".
- Only include "discount" if the user explicitly mentioned one.
- Only include "note" if the user said something worth noting.
- If you cannot determine the variantId from the conversation, reply with exactly: null
- Return ONLY valid JSON or null. No explanation, no markdown fences.`,
        },
        {
          role: "user",
          content:
            `Conversation:\n${historyText}\n\n` +
            `Recent product candidates:\n${JSON.stringify(candidateProducts, null, 2)}\n\n` +
            `Latest message: ${message}`,
        },
      ],
      temperature: 0,
    });

    const raw = response.choices[0].message.content?.trim() ?? "";
    if (raw === "null" || raw === "") return null;

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async generateDirectResponse(
    history: Array<{ role: string; content: string }>,
    message: string
  ): Promise<string> {
    const formattedHistory = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const response = await ai.chat.completions.create({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      messages: [
        {
          role: "system",
          content: `You are a friendly, concise e-commerce assistant. Help the user naturally.
If they seem to be looking for products, encourage them to describe what they need.
If they have support questions about orders or policies, let them know you can help with that too.`,
        },
        ...formattedHistory,
        { role: "user", content: message },
      ],
      temperature: 0.7,
      max_tokens: 220,
    });

    return (
      response.choices[0].message.content?.trim() ??
      "I'm here to help! What can I assist you with today?"
    );
  }
}
