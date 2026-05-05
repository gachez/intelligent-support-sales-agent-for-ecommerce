# Project Update for Supervisor

**Project:** Intelligent Conversational Support & Sales Agent for E-Commerce  
**Student:** Brian Gacheru Mungai  
**Supervisor:** Ms. Selina Ochukut

## Current Status

The project is functional through the core chatbot, product search, knowledge base retrieval, and checkout flow. I have now started Sprint 4 and added the first version of the dynamic pricing engine.

## Completed Work

- Sprint 0: Foundation and infrastructure
- Sprint 1: Knowledge base ingestion and RAG responses
- Sprint 2: Semantic product search and session-based conversation
- Sprint 3: Agentic checkout with Shopify draft orders

## Recent Updates

### Sprint 4: Dynamic Pricing Engine

- Added a pricing service to score hesitation from session behavior.
- Added Thompson Sampling style discount selection with 5 arms:
  - 0%
  - 5%
  - 7%
  - 10%
  - 15%
- Added server-side pricing configuration stored in the database.
- Added negotiation handling in the chat route so discount requests can now produce real offers.
- Added pricing event logging for offers, outcomes, and rewards.
- Added Shopify discount code creation support in the backend.

### Admin and Demo UI

- Added a pricing configuration panel to the admin demo page.
- Added a recent pricing events section to the admin demo page.
- Added negotiation presets to the chat demo page.
- Added a visible offer card in the chat demo when a discount is issued.

## What I Can Demonstrate

- Product search from natural language
- Support question answering from uploaded documents
- Checkout through Shopify draft orders
- Discount negotiation flow in Sprint 4
- Admin control of pricing settings

## Remaining Work

- Refine the hesitation scoring model
- Improve discount policy tuning
- Add stronger reporting for pricing outcomes
- Continue Sprint 5 frontend integration work
- Complete Sprint 6 documentation and polish

## Technical Notes

- The app runs in Docker using PostgreSQL with pgvector and a Node.js backend.
- The demo UI is served from the existing `/demo` pages.
- TypeScript checks pass after the recent changes.

