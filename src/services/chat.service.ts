import { AzureOpenAI } from "openai";
import { env } from "../config/env";

const ai = new AzureOpenAI({
  endpoint: env.AZURE_OPENAI_ENDPOINT,
  apiKey: env.AZURE_OPENAI_API_KEY,
  apiVersion: "2024-02-15-preview", // Standard API version for chat completions
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
}