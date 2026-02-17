import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  decimal,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ========================================
// STORES
// ========================================
export const stores = pgTable("stores", {
  id: uuid("id").defaultRandom().primaryKey(),
  shopifyDomain: varchar("shopify_domain", { length: 255 }).notNull().unique(),
  shopifyAccessToken: text("shopify_access_token").notNull(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 255 }),
  plan: varchar("plan", { length: 50 }).default("free"),
  settings: jsonb("settings").default({}),
  maxDiscountPercent: decimal("max_discount_percent", { precision: 5, scale: 2 }).default("15.00"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ========================================
// PRODUCTS (synced from Shopify)
// ========================================
export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .references(() => stores.id, { onDelete: "cascade" })
      .notNull(),
    shopifyProductId: varchar("shopify_product_id", { length: 50 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    vendor: varchar("vendor", { length: 255 }),
    productType: varchar("product_type", { length: 255 }),
    tags: text("tags"), // comma-separated
    imageUrl: text("image_url"),
    status: varchar("status", { length: 20 }).default("active"),
    variants: jsonb("variants").default([]),
    priceMin: decimal("price_min", { precision: 10, scale: 2 }),
    priceMax: decimal("price_max", { precision: 10, scale: 2 }),
    totalInventory: integer("total_inventory").default(0),
    // Embedding stored as vector(1536) via raw SQL migration
    embeddingText: text("embedding_text"), // the text that was embedded
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    storeProductIdx: uniqueIndex("store_product_idx").on(
      table.storeId,
      table.shopifyProductId
    ),
    storeIdx: index("products_store_idx").on(table.storeId),
  })
);

// ========================================
// SESSIONS (chat sessions with shoppers)
// ========================================
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .references(() => stores.id, { onDelete: "cascade" })
      .notNull(),
    guestToken: varchar("guest_token", { length: 100 }).notNull().unique(),
    metadata: jsonb("metadata").default({}), // device, referrer, etc.
    hesitationScore: decimal("hesitation_score", { precision: 5, scale: 2 }).default("0.00"),
    cartValue: decimal("cart_value", { precision: 10, scale: 2 }).default("0.00"),
    status: varchar("status", { length: 20 }).default("active"), // active, completed, abandoned
    startedAt: timestamp("started_at").defaultNow().notNull(),
    lastActiveAt: timestamp("last_active_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    guestTokenIdx: uniqueIndex("guest_token_idx").on(table.guestToken),
    storeSessionIdx: index("sessions_store_idx").on(table.storeId),
    activeIdx: index("sessions_active_idx").on(table.status, table.expiresAt),
  })
);

// ========================================
// MESSAGES (conversation history)
// ========================================
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .references(() => sessions.id, { onDelete: "cascade" })
      .notNull(),
    role: varchar("role", { length: 20 }).notNull(), // 'user', 'assistant', 'system'
    content: text("content").notNull(),
    intent: varchar("intent", { length: 50 }), // PRODUCT_SEARCH, SUPPORT, PURCHASE, NEGOTIATION
    metadata: jsonb("metadata").default({}), // tool calls, product refs, etc.
    tokenCount: integer("token_count"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    sessionMsgIdx: index("messages_session_idx").on(table.sessionId, table.createdAt),
  })
);

// ========================================
// KNOWLEDGE CHUNKS (RAG - store policies, FAQs)
// ========================================
export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .references(() => stores.id, { onDelete: "cascade" })
      .notNull(),
    source: varchar("source", { length: 500 }).notNull(), // filename or URL
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    // Embedding stored as vector(1536) via raw SQL migration
    tokenCount: integer("token_count"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    storeChunkIdx: index("chunks_store_idx").on(table.storeId),
    sourceIdx: index("chunks_source_idx").on(table.storeId, table.source),
  })
);

// ========================================
// DRAFT ORDERS (created by the agent)
// ========================================
export const draftOrders = pgTable(
  "draft_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .references(() => stores.id, { onDelete: "cascade" })
      .notNull(),
    sessionId: uuid("session_id")
      .references(() => sessions.id)
      .notNull(),
    shopifyDraftOrderId: varchar("shopify_draft_order_id", { length: 50 }),
    checkoutUrl: text("checkout_url"),
    lineItems: jsonb("line_items").notNull(),
    subtotal: decimal("subtotal", { precision: 10, scale: 2 }),
    discountCode: varchar("discount_code", { length: 50 }),
    discountPercent: decimal("discount_percent", { precision: 5, scale: 2 }),
    status: varchar("status", { length: 20 }).default("pending"), // pending, validated, committed, failed, rolled_back
    sagaLog: jsonb("saga_log").default([]), // [{step, status, timestamp, error}]
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    storeOrderIdx: index("orders_store_idx").on(table.storeId),
    sessionOrderIdx: index("orders_session_idx").on(table.sessionId),
  })
);

// ========================================
// PRICING EVENTS (RL logging)
// ========================================
export const pricingEvents = pgTable(
  "pricing_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .references(() => stores.id, { onDelete: "cascade" })
      .notNull(),
    sessionId: uuid("session_id")
      .references(() => sessions.id)
      .notNull(),
    contextVector: jsonb("context_vector").notNull(), // {hesitation_score, cart_value, device, ...}
    armSelected: decimal("arm_selected", { precision: 5, scale: 2 }).notNull(), // discount %
    discountCode: varchar("discount_code", { length: 50 }),
    outcome: varchar("outcome", { length: 20 }), // converted, abandoned, expired
    reward: decimal("reward", { precision: 3, scale: 1 }), // 1.0 or 0.0
    createdAt: timestamp("created_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (table) => ({
    storePricingIdx: index("pricing_store_idx").on(table.storeId),
  })
);
