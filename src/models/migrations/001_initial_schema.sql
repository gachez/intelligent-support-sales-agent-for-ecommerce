-- Migration: Initial Schema Setup
-- Requires: PostgreSQL 15+ with pgvector extension

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- STORES
-- ========================================
CREATE TABLE IF NOT EXISTS stores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shopify_domain VARCHAR(255) NOT NULL UNIQUE,
    shopify_access_token TEXT NOT NULL,
    name VARCHAR(255),
    email VARCHAR(255),
    plan VARCHAR(50) DEFAULT 'free',
    settings JSONB DEFAULT '{}',
    max_discount_percent DECIMAL(5,2) DEFAULT 15.00,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- ========================================
-- PRODUCTS
-- ========================================
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    shopify_product_id VARCHAR(50) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    vendor VARCHAR(255),
    product_type VARCHAR(255),
    tags TEXT,
    image_url TEXT,
    status VARCHAR(20) DEFAULT 'active',
    variants JSONB DEFAULT '[]',
    price_min DECIMAL(10,2),
    price_max DECIMAL(10,2),
    total_inventory INTEGER DEFAULT 0,
    embedding_text TEXT,
    embedding vector(1536),
    synced_at TIMESTAMP DEFAULT NOW() NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
    UNIQUE(store_id, shopify_product_id)
);

CREATE INDEX IF NOT EXISTS products_store_idx ON products(store_id);
CREATE INDEX IF NOT EXISTS products_embedding_idx ON products USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ========================================
-- SESSIONS
-- ========================================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    guest_token VARCHAR(100) NOT NULL UNIQUE,
    metadata JSONB DEFAULT '{}',
    hesitation_score DECIMAL(5,2) DEFAULT 0.00,
    cart_value DECIMAL(10,2) DEFAULT 0.00,
    status VARCHAR(20) DEFAULT 'active',
    started_at TIMESTAMP DEFAULT NOW() NOT NULL,
    last_active_at TIMESTAMP DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_store_idx ON sessions(store_id);
CREATE INDEX IF NOT EXISTS sessions_active_idx ON sessions(status, expires_at);

-- ========================================
-- MESSAGES
-- ========================================
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    intent VARCHAR(50),
    metadata JSONB DEFAULT '{}',
    token_count INTEGER,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_session_idx ON messages(session_id, created_at);

-- ========================================
-- KNOWLEDGE CHUNKS (RAG)
-- ========================================
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    source VARCHAR(500) NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),
    token_count INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS chunks_store_idx ON knowledge_chunks(store_id);
CREATE INDEX IF NOT EXISTS chunks_source_idx ON knowledge_chunks(store_id, source);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ========================================
-- DRAFT ORDERS
-- ========================================
CREATE TABLE IF NOT EXISTS draft_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions(id),
    shopify_draft_order_id VARCHAR(50),
    checkout_url TEXT,
    line_items JSONB NOT NULL,
    subtotal DECIMAL(10,2),
    discount_code VARCHAR(50),
    discount_percent DECIMAL(5,2),
    status VARCHAR(20) DEFAULT 'pending',
    saga_log JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS orders_store_idx ON draft_orders(store_id);
CREATE INDEX IF NOT EXISTS orders_session_idx ON draft_orders(session_id);

-- ========================================
-- PRICING EVENTS (RL Logging)
-- ========================================
CREATE TABLE IF NOT EXISTS pricing_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions(id),
    context_vector JSONB NOT NULL,
    arm_selected DECIMAL(5,2) NOT NULL,
    discount_code VARCHAR(50),
    outcome VARCHAR(20),
    reward DECIMAL(3,1),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS pricing_store_idx ON pricing_events(store_id);
