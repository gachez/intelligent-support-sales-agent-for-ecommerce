import { AzureOpenAI } from "openai";
import { env } from "../config/env";
import { db } from "../config/database";
import { knowledgeChunks } from "../models/schema";
import { sql } from "drizzle-orm";

const pdfParse = require("pdf-parse");

const ai = new AzureOpenAI({
  endpoint: env.AZURE_OPENAI_ENDPOINT,
  apiKey: env.AZURE_OPENAI_API_KEY,
  apiVersion: "2024-02-01",
  deployment: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
});

export class RAGService {
  private normalizeDocumentText(raw: string): string {
    return raw
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /**
   * Splits text into units while preserving headings.
   * This helps questions like "what if it arrives broken?"
   * match sections like "Damaged Goods Policy".
   */
  private splitIntoUnits(text: string): string[] {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const units: string[] = [];
    let currentHeading = "";

    for (const line of lines) {
      const looksLikeHeading =
        line.length <= 90 &&
        !/[.!?]$/.test(line) &&
        /^[A-Z0-9][A-Za-z0-9\s&:/,()'-]+$/.test(line);

      if (looksLikeHeading) {
        currentHeading = line;
        continue;
      }

      const sentences = line.match(/[^.!?\n]+(?:[.!?]+|$)/g) ?? [line];

      for (const sentence of sentences) {
        const cleaned = sentence.replace(/\s+/g, " ").trim();
        if (!cleaned) continue;

        units.push(currentHeading ? `${currentHeading}: ${cleaned}` : cleaned);
      }
    }

    return units;
  }

  private trailingOverlap(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
      return text.trim();
    }

    const tail = text.slice(-maxChars);
    const firstSpace = tail.indexOf(" ");

    return (firstSpace >= 0 ? tail.slice(firstSpace + 1) : tail).trim();
  }

  private extractSearchTerms(query: string): string[] {
    const stopWords = new Set([
      "a",
      "an",
      "and",
      "are",
      "can",
      "could",
      "do",
      "does",
      "for",
      "from",
      "how",
      "i",
      "if",
      "in",
      "is",
      "it",
      "me",
      "my",
      "of",
      "on",
      "or",
      "the",
      "this",
      "that",
      "to",
      "what",
      "when",
      "where",
      "which",
      "with",
      "you",
      "your",
    ]);

    return [
      ...new Set(
        query
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .map((token) => token.trim())
          .filter((token) => token.length >= 3)
          .filter((token) => !/^\d+$/.test(token))
          .filter((token) => !stopWords.has(token))
      ),
    ];
  }

  private keywordScore(content: string, terms: string[]): number {
    if (terms.length === 0) return 0;

    const haystack = content.toLowerCase();

    return terms.reduce((score, term) => {
      return score + (haystack.includes(term) ? 1 : 0);
    }, 0);
  }

  async extractTextFromFile(buffer: Buffer, mimetype: string): Promise<string> {
    if (mimetype === "application/pdf") {
      try {
        const data = await pdfParse(buffer);
        return this.normalizeDocumentText(data.text);
      } catch {
        throw new Error("Failed to parse PDF document.");
      }
    }

    if (mimetype === "text/plain") {
      return this.normalizeDocumentText(buffer.toString("utf-8"));
    }

    throw new Error("Unsupported file format.");
  }

  /**
   * Larger policy-friendly chunks with overlap.
   * 420 tokens is better for support policies because answers often depend on
   * nearby conditions, timelines, and exceptions.
   */
  chunkText(text: string, maxTokens = 420, overlapTokens = 80): string[] {
    const maxChars = maxTokens * 4;
    const overlapChars = overlapTokens * 4;

    const chunks: string[] = [];
    const units = this.splitIntoUnits(text);

    let currentChunk = "";

    for (const unit of units) {
      const candidate = currentChunk ? `${currentChunk} ${unit}` : unit;

      if (candidate.length <= maxChars) {
        currentChunk = candidate;
        continue;
      }

      if (currentChunk) {
        chunks.push(currentChunk.trim());

        const overlap = this.trailingOverlap(currentChunk, overlapChars);
        currentChunk = overlap ? `${overlap} ${unit}` : unit;
      } else {
        chunks.push(unit.slice(0, maxChars).trim());
        currentChunk = unit.slice(Math.max(0, maxChars - overlapChars)).trim();
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Generates embeddings in batches and stores them.
   */
  async embedAndStoreChunks(
    storeId: string,
    filename: string,
    chunks: string[]
  ): Promise<void> {
    await db.execute(sql`
      DELETE FROM knowledge_chunks
      WHERE store_id = ${storeId} AND source = ${filename}
    `);

    const batchSize = 64;

    for (let start = 0; start < chunks.length; start += batchSize) {
      const batch = chunks.slice(start, start + batchSize);

      const response = await ai.embeddings.create({
        input: batch,
        model: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
      });

      for (let i = 0; i < batch.length; i++) {
        const chunkIndex = start + i;
        const textChunk = batch[i];
        const embeddingVector = response.data[i].embedding;
        const vectorString = JSON.stringify(embeddingVector);

        await db.insert(knowledgeChunks).values({
          storeId,
          source: filename,
          chunkIndex,
          content: textChunk,
          tokenCount: Math.round(textChunk.length / 4),
        });

        await db.execute(sql`
          UPDATE knowledge_chunks
          SET embedding = ${vectorString}::vector
          WHERE store_id = ${storeId}
            AND source = ${filename}
            AND chunk_index = ${chunkIndex}
        `);
      }
    }
  }

  /**
   * Semantic vector search with light keyword assist.
   * Exact keywords should help slightly, not dominate semantic similarity.
   */
  async searchKnowledge(
    storeId: string,
    query: string | string[],
    topK: number = 6
  ) {
    const queries = [
      ...new Set(
        (Array.isArray(query) ? query : [query])
          .map((q) => q.trim())
          .filter(Boolean)
      ),
    ];

    const candidateLimit = Math.max(topK * 6, 18);
    const searchTerms = this.extractSearchTerms(queries.join(" "));
    const merged = new Map<string, any>();

    for (const searchQuery of queries) {
      const response = await ai.embeddings.create({
        input: searchQuery,
        model: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
      });

      const queryEmbedding = response.data[0].embedding;
      const vectorString = JSON.stringify(queryEmbedding);

      const results = await db.execute(sql`
        SELECT
          id,
          source,
          chunk_index AS "chunkIndex",
          content,
          1 - (embedding <=> ${vectorString}::vector) AS similarity
        FROM knowledge_chunks
        WHERE store_id = ${storeId}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${vectorString}::vector
        LIMIT ${candidateLimit};
      `);

      for (const row of results.rows as any[]) {
        const existing = merged.get(row.id);

        const similarity = Number(row.similarity ?? 0);
        const keywordHits = this.keywordScore(row.content ?? "", searchTerms);

        const score =
          similarity * 0.92 +
          Math.min(keywordHits, 3) * 0.02 +
          (existing ? 0.01 : 0);

        if (!existing || score > existing.score) {
          merged.set(row.id, {
            ...row,
            similarity,
            keywordHits,
            score,
          });
        }
      }
    }

    return [...merged.values()]
      .filter((item) => item.similarity >= 0.6 || item.keywordHits > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.keywordHits - a.keywordHits ||
          b.similarity - a.similarity
      )
      .slice(0, topK);
  }

  buildContext(
    chunks: Array<{
      source: string;
      chunkIndex?: number;
      content: string;
    }>
  ): string {
    return chunks
      .map(
        (chunk) =>
          `Source: ${chunk.source}${
            chunk.chunkIndex !== undefined ? ` (section ${chunk.chunkIndex + 1})` : ""
          }\n${chunk.content}`
      )
      .join("\n\n---\n\n");
  }
}