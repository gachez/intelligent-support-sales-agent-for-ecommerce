import { AzureOpenAI } from "openai";
import { env } from "../config/env";
import { db } from "../config/database";
import { knowledgeChunks } from "../models/schema";
import { sql } from "drizzle-orm";

const pdfParse = require("pdf-parse");

// Initialize Azure OpenAI Client
const ai = new AzureOpenAI({
  endpoint: env.AZURE_OPENAI_ENDPOINT,
  apiKey: env.AZURE_OPENAI_API_KEY,
  apiVersion: "2024-02-01", // Standard Azure API version for embeddings
  deployment: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT, 
});

export class RAGService {
  
  async extractTextFromFile(buffer: Buffer, mimetype: string): Promise<string> {
    if (mimetype === "application/pdf") {
      try {
        const data = await pdfParse(buffer);
        return data.text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
      } catch (error) {
        throw new Error("Failed to parse PDF document.");
      }
    } 
    
    if (mimetype === "text/plain") {
      return buffer.toString("utf-8").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    }

    throw new Error("Unsupported file format.");
  }

  // Changed to 512 max, 50 overlap to match your sprint requirements!
  chunkText(text: string, maxTokens = 512, overlapTokens = 50): string[] {
    const maxChars = maxTokens * 4;
    const overlapChars = overlapTokens * 4;
    const step = maxChars - overlapChars;
    const chunks: string[] = [];

    for (let i = 0; i < text.length; i += step) {
      let chunk = text.substring(i, i + maxChars).trim();
      if (chunk) chunks.push(chunk);
    }
    
    return chunks;
  }

  /**
   * Generates an embedding for a chunk of text and saves it to the database.
   */
  async embedAndStoreChunks(storeId: string, filename: string, chunks: string[]): Promise<void> {
    for (let i = 0; i < chunks.length; i++) {
      const textChunk = chunks[i];

      // 1. Get embedding from Azure OpenAI
      const response = await ai.embeddings.create({
        input: textChunk,
        model: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
      });

      const embeddingVector = response.data[0].embedding;

      // 2. Insert into PostgreSQL using Drizzle ORM
      await db.insert(knowledgeChunks).values({
        storeId: storeId,
        source: filename,
        chunkIndex: i,
        content: textChunk,
        tokenCount: Math.round(textChunk.length / 4)
      });

      // 3. Update the row with the actual vector data (pgvector)
const vectorString = JSON.stringify(embeddingVector);
      
      await db.execute(sql`
        UPDATE knowledge_chunks 
        SET embedding = ${vectorString}::vector 
        WHERE store_id = ${storeId} AND source = ${filename} AND chunk_index = ${i}
      `);
    }
  }

  /**
   * Performs a vector similarity search against the knowledge base.
   */
  async searchKnowledge(storeId: string, query: string, topK: number = 3) {
    // 1. Embed the user's search query
    const response = await ai.embeddings.create({
      input: query,
      model: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
    });

    const queryEmbedding = response.data[0].embedding;
    const vectorString = JSON.stringify(queryEmbedding);

    // 2. Perform Cosine Similarity Search using pgvector
    // The `<=>` operator calculates cosine distance. 
    // We calculate similarity as (1 - distance).
    const results = await db.execute(sql`
      SELECT 
        id,
        source,
        content,
        1 - (embedding <=> ${vectorString}::vector) as similarity
      FROM knowledge_chunks
      WHERE store_id = ${storeId}
      ORDER BY embedding <=> ${vectorString}::vector
      LIMIT ${topK};
    `);

    return results.rows;
  }
}