# Project Progress Summary
**Intelligent Conversational Support & Sales Agent for E-Commerce**
Brian Gacheru Mungai | P15/33466/2015 | Supervisor: Ms. Selina Ochukut

---

## Overall Status

| Sprint | Title | Status | % Done |
|--------|-------|--------|--------|
| Sprint 0 | Foundation & Infrastructure | ✅ Complete | 100% |
| Sprint 1 | RAG Pipeline & Knowledge Base | ✅ Complete | 100% |
| Sprint 2 | Semantic Product Search & Conversation | ✅ Complete | 100% |
| Sprint 3 | Agentic Checkout (SagaLLM) | ✅ Complete | 100% |
| Sprint 4 | Dynamic Pricing Engine | 🟡 Schema Only | ~15% |
| Sprint 5 | Frontend Widget & Integration | 🟡 Demo HTML Only | ~10% |
| Sprint 6 | Documentation & Polish | ❌ Not Started | 0% |

---

## Sprint 0 — Foundation & Infrastructure ✅

**Goal:** Running server that authenticates with Shopify and returns product data.

| Ticket | Description | Status |
|--------|-------------|--------|
| S0-01 | Node.js + TypeScript project, ESLint, folder structure | ✅ Done |
| S0-02 | `.env` validation with Zod, all required secrets validated on startup | ✅ Done |
| S0-03 | PostgreSQL + pgvector via Docker, all 6 tables created via migration | ✅ Done |
| S0-04 | `ShopifyService` — `fetchProducts`, `getProductById`, `checkInventory` | ✅ Done |
| S0-05 | `docker-compose.yml` with Node + PostgreSQL, health checks, volume persistence | ✅ Done |
| S0-06 | Express server, CORS, JSON parsing, `GET /health` endpoint, request logging | ✅ Done |

**Key files:** `src/index.ts`, `src/config/env.ts`, `src/config/database.ts`, `src/services/shopify.service.ts`, `src/models/migrations/001_initial_schema.sql`

---

## Sprint 1 — RAG Pipeline & Knowledge Base ✅

**Goal:** System answers store policy questions accurately using uploaded documents.

| Ticket | Description | Status |
|--------|-------------|--------|
| S1-01 | `POST /api/admin/knowledge/upload` — accepts `.txt` and `.pdf`, extracts text | ✅ Done |
| S1-02 | Text chunking service — 512-token chunks with 50-token overlap, chunk metadata stored | ✅ Done |
| S1-03 | Azure OpenAI `text-embedding-ada-002` generates 1536-dim embeddings per chunk, stored in pgvector | ✅ Done |
| S1-04 | `searchKnowledge(query, topK)` — cosine similarity search via pgvector in < 500ms | ✅ Done |
| S1-05 | Standalone query rewriter — resolves pronouns and implicit references from conversation history | ✅ Done |
| S1-06 | `POST /api/chat` — query rewrite → RAG retrieval → grounded LLM response with source attribution | ✅ Done |

**Key files:** `src/services/rag.service.ts`, `src/services/chat.service.ts`, `src/routes/knowledge.ts`, `src/routes/chat.ts`

---

## Sprint 2 — Semantic Product Search & Conversation ✅

**Goal:** Natural language product discovery with multi-turn conversational context.

| Ticket | Description | Status |
|--------|-------------|--------|
| S2-01 | `POST /api/admin/sync-products` — pulls Shopify products, generates embeddings, upserts to pgvector | ✅ Done |
| S2-02 | `GET /api/products?q=...` — cosine similarity search on product embeddings, excludes out-of-stock | ✅ Done |
| S2-03 | `SessionService` — UUID guest tokens, 24-hour TTL, conversation history persistence, session resumption | ✅ Done |
| S2-04 | `classifyIntent()` — GPT-4o classifies messages into 5 intents with < 200ms latency | ✅ Done |
| S2-05 | Product cards — title, image, price, variants, stock label (`In Stock` / `X left` / `Out of Stock`) | ✅ Done |
| S2-06 | Multi-turn context — history loaded per session, query rewriter resolves cross-turn references | ✅ Done |

**Key files:** `src/services/project.service.ts`, `src/services/session.service.ts`, `src/routes/admin.ts`, `src/routes/products.ts`

**Intents routed:**
- `PRODUCT_SEARCH` → semantic vector search → product cards
- `SUPPORT_QUESTION` → RAG retrieval → grounded answer with source tags
- `GENERAL_CHAT` → direct LLM response
- `PURCHASE_INTENT` / `NEGOTIATION` → placeholder (now replaced in Sprint 3)

---

## Sprint 3 — Agentic Checkout (SagaLLM) ✅

**Goal:** Agent creates real draft orders on Shopify and returns working checkout links.

| Ticket | Description | Status |
|--------|-------------|--------|
| S3-01 | AJV JSON schema for draft order payloads — validates GID format, quantity bounds, unknown fields rejected | ✅ Done |
| S3-02 | `ValidatorService` — 3-phase check: (1) AJV schema, (2) variant exists in Shopify, (3) quantity in stock | ✅ Done |
| S3-03 | `CheckoutService.checkout()` — creates real Shopify draft order via `draftOrderCreate` GraphQL mutation, persists to `draft_orders` DB with full saga log | ✅ Done |
| S3-04 | Compensating transaction — auto-deletes Shopify draft order if checkout URL is missing, marks DB record as `rolled_back`, all steps logged in `saga_log` JSONB | ✅ Done |
| S3-05 | `ChatService.extractOrderPayload()` — LLM extracts variant GID and quantity from conversation history; PURCHASE_INTENT handler in `chat.ts` runs full saga and returns checkout link | ✅ Done |
| S3-06 | Real-time inventory re-validation in `revalidateInventory()` runs immediately before `createDraftOrder`, independent of the initial validation check | ✅ Done |

**Key files:** `src/schemas/draftOrder.schema.ts`, `src/services/validator.service.ts`, `src/services/checkout.service.ts`

**Full checkout flow:**
```
User: "I'll take the black hiking boots size 10"
  → classifyIntent()       → PURCHASE_INTENT
  → extractOrderPayload()  → { line_items: [{ variantId: "gid://...", quantity: 1 }] }
  → ValidatorService       → AJV schema ✓ → variant exists ✓ → stock check ✓
  → revalidateInventory()  → live re-check ✓
  → createDraftOrder()     → Shopify draft order created
  → saga_log               → [validate ✓, inventory_check ✓, create_draft_order ✓, get_checkout_url ✓]
  → response               → "Complete your purchase here: https://..."
```

**Saga states tracked:** `pending` → `validated` → `committed` | `failed` | `rolled_back`

---

## Sprint 4 — Dynamic Pricing Engine 🟡 (Not started)

**Goal:** Personalised, context-aware discounts using Reinforcement Learning.

| Ticket | Description | Status |
|--------|-------------|--------|
| S4-01 | HesitationScorer — session duration, product views, cart signals | ❌ Not started |
| S4-02 | Thompson Sampling contextual bandit — 5 discount arms (0%, 5%, 7%, 10%, 15%) | ❌ Not started |
| S4-03 | `POST /api/admin/discounts/config` — merchant sets max discount, excluded products, budget | ❌ Not started |
| S4-04 | Shopify Price Rules API — unique single-use discount codes, 30-minute expiry | ❌ Not started |
| S4-05 | Pricing wired into chat — NEGOTIATION intent + hesitation threshold trigger offer | ❌ Not started |
| S4-06 | `pricingEvents` logging — full context vector, arm selected, outcome, reward | ❌ Not started |

**Already in place (schema):** `pricingEvents` table, `hesitationScore` and `cartValue` columns on `sessions`, `maxDiscountPercent` on `stores`.

---

## Sprint 5 — Frontend Widget & Integration 🟡 (Partially started)

**Goal:** Embeddable React chat widget on the Shopify storefront.

| Ticket | Description | Status |
|--------|-------------|--------|
| S5-01 | React chat widget bundled as single JS file | ❌ Not started |
| S5-02 | WebSocket (Socket.io) real-time messaging | ❌ Not started |
| S5-03 | Product card UI, quick-reply buttons, checkout button with Verified badge | 🟡 In demo HTML only |
| S5-04 | Theme-aware styling (inherits merchant store CSS variables) | ❌ Not started |
| S5-05 | Merchant admin dashboard — conversation analytics, sales stats, KB management | 🟡 Partial (KB + sync + orders in admin.html) |
| S5-06 | End-to-end integration testing + hallucination audit | ❌ Not started |

**Already in place:** `demo/index.html` (chat UI) and `demo/admin.html` (admin panel) — vanilla JS, served statically by Express.

---

## Sprint 6 — Documentation & Polish ❌ (Not started)

| Ticket | Description | Status |
|--------|-------------|--------|
| S6-01 | Performance benchmarking — TTFT, FCSR, latency, bandit convergence | ❌ Not started |
| S6-02 | Final project report — all chapters, diagrams, screenshots | ❌ Not started |
| S6-03 | User manual — installation, KB setup, discount config, troubleshooting | ❌ Not started |
| S6-04 | Demo video — 5-10 minutes covering all 6 use cases | ❌ Not started |
| S6-05 | Code cleanup — JSDoc, README.md, remove console.logs | ❌ Not started |
| S6-06 | Final submission — report, GitHub link, video, supervisor sign-off | ❌ Not started |

---

## API Endpoints Summary

| Method | Path | Description | Sprint |
|--------|------|-------------|--------|
| GET | `/health` | Server + DB health check | S0 |
| GET | `/api/products?q=` | Semantic product search | S2 |
| POST | `/api/chat` | Main chat endpoint (intent routing, RAG, checkout) | S1–S3 |
| POST | `/api/admin/knowledge/upload` | Upload + embed policy document | S1 |
| GET | `/api/admin/knowledge/documents` | List uploaded documents | S2 |
| GET | `/api/admin/knowledge/search?q=` | Direct vector search on KB | S1 |
| POST | `/api/admin/sync-products` | Sync Shopify products → pgvector | S2 |
| GET | `/api/admin/orders` | List recent draft orders with saga log | S3 |

---

## Demo UI

| URL | Description |
|-----|-------------|
| `http://localhost:3000/demo/index.html` | Chat widget — full conversation flow with checkout |
| `http://localhost:3000/demo/admin.html` | Admin panel — draft orders, knowledge base, product sync |

---

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + TypeScript |
| Framework | Express.js |
| Database | PostgreSQL + pgvector (Drizzle ORM) |
| AI (Chat) | Azure OpenAI GPT-4o |
| AI (Embeddings) | Azure OpenAI text-embedding-ada-002 (1536 dimensions) |
| Schema Validation | AJV (draft orders), Zod (environment) |
| E-Commerce | Shopify Admin API (GraphQL) |
| Infrastructure | Docker Compose |
