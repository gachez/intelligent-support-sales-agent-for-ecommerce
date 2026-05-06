# Intelligent Conversational Support & Sales Agent

An AI-powered e-commerce assistant for Shopify stores. It combines product discovery, support knowledge retrieval, discount negotiation, and draft-order checkout inside a chat experience that can run as a demo UI or as an embeddable storefront widget.

This repository was built as a University of Nairobi BSc Computer Science capstone project by Brian Gacheru Mungai.

## What It Can Do

- Chat with shoppers and classify messages into product search, support questions, purchase intent, negotiation, or general chat.
- Sync active Shopify products into PostgreSQL and generate embeddings for semantic product search.
- Return product cards with prices, images, variants, stock labels, and budget-aware ranking.
- Upload TXT or PDF store documents, chunk them, embed them, and answer support questions with RAG.
- Maintain guest chat sessions and conversation history.
- Create Shopify draft orders from chat purchase intent.
- Re-check inventory before checkout and roll back draft orders when checkout creation fails.
- Handle discount negotiation with capped offers, expiring codes, Shopify discount-code creation, and pricing-event logs.
- Serve a demo chat UI, a merchant admin demo, and a compiled embeddable widget.

## Tech Stack

- Node.js 20, TypeScript, Express 5
- PostgreSQL with pgvector
- Drizzle ORM
- Azure OpenAI for chat completions and embeddings
- Shopify Admin GraphQL API
- React 19 and Vite for the embeddable widget
- Docker and Docker Compose for local development

## Prerequisites

- Node.js 20+
- npm
- Docker and Docker Compose
- A Shopify development store
- A Shopify custom app Admin API access token
- An Azure OpenAI resource with:
  - a chat deployment, for example `gpt-4o`
  - an embedding deployment compatible with `vector(1536)`, for example `text-embedding-ada-002`

## Shopify Setup

Create a Shopify custom app from your store admin:

1. Go to `Settings -> Apps and sales channels -> Develop apps`.
2. Create and install a custom app.
3. Grant these Admin API scopes:
   - `read_products`
   - `write_products`
   - `read_orders`
   - `write_draft_orders`
   - `read_inventory`
   - `write_discounts`
4. Copy the Admin API access token.
5. Use your store domain in the form `your-store.myshopify.com`.

## Environment Variables

Copy the example file and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development`, `production`, or `test` |
| `PORT` | API port inside the app container, defaults to `3000` |
| `DATABASE_URL` | PostgreSQL connection string |
| `SHOPIFY_STORE_URL` | Shopify store domain, for example `your-store.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | Shopify Admin API token |
| `SHOPIFY_API_VERSION` | Shopify API version, defaults to `2024-10` |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_DEPLOYMENT` | Chat model deployment name |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Embedding deployment name |
| `SESSION_SECRET` | Random secret with at least 16 characters |
| `SESSION_TTL_HOURS` | Guest chat session lifetime |

Do not commit `.env`. It is already ignored by `.gitignore`. If a real token has ever been committed, rotate it before making the repository public.

## Quick Start With Docker

This is the easiest way to run the full stack locally.

```bash
git clone <repo-url>
cd intelligent-support-sales-agent-for-ecommerce
npm install
cp .env.example .env
# edit .env with Shopify and Azure OpenAI credentials
docker compose up --build
```

Docker Compose starts:

- PostgreSQL with pgvector on host port `5433`
- the API server on `http://localhost:3080`

Open:

- Health check: `http://localhost:3080/health`
- Chat demo: `http://localhost:3080/demo/`
- Merchant admin demo: `http://localhost:3080/demo/admin.html`
- Widget demo page: `http://localhost:3080/demo/widget/`

The initial database migration is mounted into the PostgreSQL container and runs automatically the first time the database volume is created.

## Local Development Without the App Container

You can run PostgreSQL in Docker and the TypeScript server directly on your machine.

```bash
npm install
docker compose up -d db
cp .env.example .env
```

If you use the Compose database from your host machine, set this in `.env`:

```bash
DATABASE_URL=postgresql://agent:agent_dev_password@localhost:5433/ai_sales_agent
```

Then run the API:

```bash
npm run dev
```

The local server runs at `http://localhost:3000`.

If you use your own PostgreSQL instance, make sure pgvector is installed and run:

```bash
npm run db:migrate
```

## First Run Workflow

After the server starts:

1. Visit `GET /health` and confirm database and Shopify are connected.
2. Open `http://localhost:3080/demo/admin.html` when using Docker, or `http://localhost:3000/demo/admin.html` when running locally.
3. Click product sync to pull active Shopify products and embed them.
4. Upload one or more TXT/PDF knowledge documents, such as return policies, delivery policies, or FAQs.
5. Open the chat demo and try product search, support questions, discount requests, and checkout requests.

Useful sample prompts:

```text
Show me affordable office chairs under 10000
What is your return policy if an item arrives damaged?
Can I get a discount on the second product?
I want to buy the black medium variant
```

## API Reference

### System

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Checks server uptime, PostgreSQL, and Shopify connectivity |

### Chat

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/chat` | Main conversational endpoint |

Example:

```bash
curl -X POST http://localhost:3080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Show me office chairs under 10000"}'
```

The response includes `guest_token`. Send it back as `guest_token` on later requests to continue the same session.

### Products

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/products?q=chair&limit=5` | Semantic product search over synced Shopify products |

### Knowledge Base

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/admin/knowledge/upload` | Upload a TXT or PDF file as `file` multipart form data |
| `GET` | `/api/admin/knowledge/search?q=returns&limit=3` | Test knowledge retrieval |
| `GET` | `/api/admin/knowledge/documents` | List uploaded knowledge documents |

Upload example:

```bash
curl -X POST http://localhost:3080/api/admin/knowledge/upload \
  -F "file=@demo/sample-data/return-policy.txt"
```

### Admin

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/admin/sync-products` | Sync active Shopify products, variants, inventory, images, prices, and embeddings |
| `GET` | `/api/admin/orders` | List recent draft orders and saga logs |
| `GET` | `/api/admin/discounts/config` | Read negotiation/discount configuration |
| `POST` | `/api/admin/discounts/config` | Update negotiation/discount configuration |
| `GET` | `/api/admin/pricing/events` | List recent pricing events and outcomes |

## Embeddable Widget

Build the widget:

```bash
npm run build:widget
```

The compiled widget is served from:

```text
/widget/agent-chat-widget.js
```

Example Shopify theme snippet:

```html
<script
  src="https://your-api-host.example.com/widget/agent-chat-widget.js"
  data-api-base="https://your-api-host.example.com"
  data-title="Shopping assistant"
  data-subtitle="Products, support, discounts, checkout"
  defer
></script>
```

The widget uses a shadow DOM, stores the guest session token in `localStorage`, renders product cards, supports variant selection, and can add products to the Shopify cart when running on a Shopify storefront.

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the TypeScript API in watch mode |
| `npm run build` | Compile the backend to `dist/` |
| `npm run build:widget` | Build the embeddable React widget |
| `npm run build:all` | Build backend and widget |
| `npm start` | Run the compiled backend from `dist/index.js` |
| `npm run db:migrate` | Apply the initial SQL migration to `DATABASE_URL` |
| `npm run lint` | Type-check the project with `tsc --noEmit` |

## Project Structure

```text
src/
  config/        Environment validation and database connection
  middleware/    Request logging and error handling
  models/        Drizzle schema and SQL migrations
  routes/        Express route handlers
  schemas/       Request payload validation schemas
  services/      Shopify, RAG, chat, session, pricing, checkout logic
  utils/         Shared helpers

widget/          React source for the embeddable widget
public/widget/   Built widget bundle served by Express
demo/            Static demo/admin pages
demo/sample-data Sample knowledge-base document
```

## Current Limitations

- The app currently bootstraps a single default store from `.env`; it is not a full multi-tenant Shopify app yet.
- Admin endpoints are not authenticated. Do not expose them publicly without adding authentication and authorization.
- Product sync currently fetches the first 50 active products and up to 10 variants per product.
- Embeddings are configured for 1536 dimensions. If you use a different embedding model, update the pgvector column dimensions and migration.
- The RAG pipeline supports TXT and PDF uploads only.
- The demo pages are development tools, not production merchant dashboards.
- There is no automated test suite yet.
- Production deployment needs rate limiting, request validation hardening, logging/monitoring, and secret management.

## Remaining Work

- Add OAuth installation flow and proper multi-store tenancy.
- Add authenticated merchant admin routes and role-based access control.
- Add webhook-based product, inventory, and order synchronization instead of manual product sync only.
- Expand product sync pagination beyond the current first-page implementation.
- Add automated tests for chat routing, RAG retrieval, checkout saga behavior, pricing rules, and Shopify failure cases.
- Add production observability: structured logs, metrics, tracing, and alerting.
- Add a production deployment guide for hosted PostgreSQL, the API server, and the widget asset.
- Improve checkout handoff and Shopify cart integration for real storefront use.
- Add a `LICENSE` file and contribution guidelines before publishing publicly.

## License

The package metadata declares this project as MIT licensed. Add a top-level `LICENSE` file before publishing the repository as open source.
