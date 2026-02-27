import { db } from "../config/database";
import { sessions, messages } from "../models/schema";
import { eq, and, gt, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { env } from "../config/env";

export class SessionService {
  private getTTLMs(): number {
    return parseInt(env.SESSION_TTL_HOURS) * 60 * 60 * 1000;
  }

  /**
   * S2-03: Creates a new session or resumes an existing valid one.
   * A session is valid if it exists, is 'active', and has not expired.
   */
  async createOrResumeSession(
    storeId: string,
    guestToken?: string
  ): Promise<{ sessionId: string; guestToken: string; isNew: boolean }> {
    if (guestToken) {
      const existing = await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.guestToken, guestToken),
            eq(sessions.status, "active"),
            gt(sessions.expiresAt, new Date())
          )
        )
        .limit(1);

      if (existing.length > 0) {
        return { sessionId: existing[0].id, guestToken, isNew: false };
      }
    }

    // Create a fresh session
    const newToken = randomUUID();
    const expiresAt = new Date(Date.now() + this.getTTLMs());

    const [newSession] = await db
      .insert(sessions)
      .values({ storeId, guestToken: newToken, expiresAt })
      .returning({ id: sessions.id });

    return { sessionId: newSession.id, guestToken: newToken, isNew: true };
  }

  /**
   * S2-03: Persists a single message to the messages table.
   */
  async saveMessage(
    sessionId: string,
    role: "user" | "assistant",
    content: string,
    intent?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await db.insert(messages).values({
      sessionId,
      role,
      content,
      intent: intent ?? null,
      metadata: metadata ?? {},
      tokenCount: Math.round(content.length / 4),
    });
  }

  /**
   * S2-06: Loads the N most recent messages for a session in chronological order.
   * Used to reconstruct conversation history for the LLM and query rewriter.
   */
  async getHistory(
    sessionId: string,
    limit: number = 10
  ): Promise<Array<{ role: string; content: string }>> {
    const rows = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    // Reverse so messages are in chronological order for the LLM
    return rows.reverse();
  }

  /**
   * S2-03: Resets the session's last-active timestamp and extends its expiry window.
   * Called at the end of every successful chat request.
   */
  async updateLastActive(sessionId: string): Promise<void> {
    const expiresAt = new Date(Date.now() + this.getTTLMs());
    await db
      .update(sessions)
      .set({ lastActiveAt: new Date(), expiresAt })
      .where(eq(sessions.id, sessionId));
  }
}
