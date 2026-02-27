import { AzureOpenAI } from "openai";
import { env } from "../config/env";

const VALID_INTENTS = [
  "PRODUCT_SEARCH",
  "SUPPORT_QUESTION",
  "PURCHASE_INTENT",
  "NEGOTIATION",
  "GENERAL_CHAT",
] as const;

export type Intent = (typeof VALID_INTENTS)[number];

const ai = new AzureOpenAI({
  endpoint: env.AZURE_OPENAI_ENDPOINT,
  apiKey: env.AZURE_OPENAI_API_KEY,
  apiVersion: "2024-02-15-preview",
  deployment: env.AZURE_OPENAI_DEPLOYMENT,
});

export class ChatService {
  /**
   * S1-05: Standalone Query Rewriting
   * Takes the conversation history and the latest message and rewrites it
   * so it makes sense out of context for the Vector Database.
   */
  async rewriteQuery(chatHistory: any[], latestMessage: string): Promise<string> {
    if (!chatHistory || chatHistory.length === 0) {
      return latestMessage; // No history? No need to rewrite.
    }

    // Convert history into a readable string format
    const historyText = chatHistory
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    const response = await ai.chat.completions.create({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      messages: [
        {
          role: "system",
          content: `You are an expert search query rewriter for an e-commerce store. 
Given the following conversation history and a new user message, rewrite the new user message into a standalone search query that contains all the necessary context. 
Do NOT answer the question. ONLY return the rewritten query. If the message is already standalone, just return it exactly as is.`,
        },
        {
          role: "user",
          content: `Conversation History:\n${historyText}\n\nNew Message: ${latestMessage}`,
        },
      ],
      temperature: 0.5,
    });

    return response.choices[0].message.content || latestMessage;
  }

  /**
   * S1-06: Final RAG Generation
   * Takes the retrieved context from pgvector and the conversation history,
   * and generates a grounded, conversational response.
   */
  async generateResponse(chatHistory: any[], latestMessage: string, context: string): Promise<string> {
    // Format the history for the OpenAI API
    const messages = chatHistory.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Add the System Prompt with the RAG Context
    messages.unshift({
      role: "system",
      content: `You are a helpful e-commerce support agent. 
        Answer the user's question USING ONLY the provided Knowledge Base Context below. 
        If the answer is not contained in the context, politely say "I don't have that information right now, let me connect you to a human." DO NOT hallucinate or invent store policies.

        Knowledge Base Context:
        ---
        ${context}
        ---`
    });

    // Add the user's latest message
    messages.push({
      role: "user",
      content: latestMessage
    });

    const response = await ai.chat.completions.create({
      model: env.AZURE_OPENAI_DEPLOYMENT,
      messages: messages as any,
      temperature: 0.5,
    });

    return response.choices[0].message.content || "I am having trouble connecting to my knowledge base right now.";
  }

  /**
   * S2-04: Intent Classifier
   * Classifies the user's message into one of five intents so the chat
   * endpoint can route it to the correct handler.
   * Uses temperature: 0 and a 20-token cap to keep latency under 200ms.
   */
  async classifyIntent(
    message: string,
    history: Array<{ role: string; content: string }>
  ): Promise<Intent> {
    // Feed only the last 4 turns so the prompt stays compact
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
- SUPPORT_QUESTION: User is asking about store policies, shipping, returns, or other support topics.
- PURCHASE_INTENT: User explicitly wants to buy, add to cart, or checkout.
- NEGOTIATION: User is asking for a discount or trying to negotiate a price.
- GENERAL_CHAT: Greetings, thanks, complaints, or anything that doesn't fit the above.

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

  /**
   * S2-06: Direct LLM response for GENERAL_CHAT intent.
   * Does not use RAG — just a friendly conversational reply grounded in history.
   */
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
    });

    return (
      response.choices[0].message.content ??
      "I'm here to help! What can I assist you with today?"
    );
  }
}