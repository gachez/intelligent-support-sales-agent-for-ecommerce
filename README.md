# 🤖 Intelligent Conversational Support & Sales Agent

An AI-powered e-commerce agent that integrates with Shopify to autonomously manage customer support, product discovery, dynamic pricing, and checkout — all within a chat interface.

**University of Nairobi — BSc Computer Science Capstone Project**
Brian Gacheru Mungai | P15/33466/2015 | Supervisor: Ms. Selina Ochukut

---

## Architecture

- **Backend**: Node.js + TypeScript + Express
- **Database**: PostgreSQL with pgvector (for RAG embeddings)
- **AI**: Azure OpenAI (GPT-4o) + DeepSeek-R1
- **Platform**: Shopify Admin API (GraphQL)
- **Frontend**: React embeddable chat widget (Sprint 5)

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- A Shopify Partner account with a development store
- An Azure OpenAI API key

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/your-username/ai-sales-agent.git
cd ai-sales-agent

# 2. Copy environment variables
cp .env.example .env
# Edit .env with your Shopify and Azure OpenAI credentials

# 3. Start with Docker Compose
docker-compose up

# The server runs at http://localhost:3000
```

### Without Docker

```bash
# Install dependencies
npm install

# Make sure PostgreSQL is running with pgvector
# Run the migration
psql -U agent -d ai_sales_agent -f src/models/migrations/001_initial_schema.sql

# Start development server
npm run dev
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | System health check (DB + Shopify) |
| GET | `/api/products` | Search products (`?q=hiking+boots&limit=10`) |
| GET | `/api/products/:id` | Get product by ID |
| GET | `/api/products/inventory/:variantId` | Check variant stock |

## Project Structure

```
src/
├── config/          # Environment validation, database connection
├── middleware/       # Request logging, error handling
├── models/          # Database schema (Drizzle ORM) + migrations
├── routes/          # Express route handlers
├── services/        # Business logic (Shopify, AI, RAG, Pricing)
└── utils/           # Shared utilities
```

## Sprint Progress

- [x] Sprint 0: Foundation & Infrastructure
- [ ] Sprint 1: RAG Pipeline & Knowledge Base
- [ ] Sprint 2: Semantic Product Search & Conversation
- [ ] Sprint 3: Agentic Checkout (SagaLLM)
- [ ] Sprint 4: Dynamic Pricing Engine
- [ ] Sprint 5: Frontend Widget & Integration
- [ ] Sprint 6: Documentation & Polish
