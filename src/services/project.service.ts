import { AzureOpenAI } from "openai";
import { env } from "../config/env";
import { db } from "../config/database";
import { sql } from "drizzle-orm";
import {
  DEFAULT_CURRENCY_CODE,
  formatMoney,
  normalizeCurrencyCode,
  normalizeMoneyAmount,
} from "../utils/money";

const ai = new AzureOpenAI({
  endpoint: env.AZURE_OPENAI_ENDPOINT,
  apiKey: env.AZURE_OPENAI_API_KEY,
  apiVersion: "2024-02-01",
  deployment: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
});

export interface ProductCard {
  id: string;
  title: string;
  description: string;
  price: string;
  currencyCode: string;
  formattedPrice: string;
  imageUrl: string | null;
  tags: string;
  variants: Array<{
    id: string;
    title: string;
    price: string;
    currencyCode?: string;
    inventoryQuantity: number;
    availableForSale: boolean;
    sku: string;
  }>;
  totalInventory: number;
  /** Human-readable stock label for the UI ("In Stock" / "X left" / "Out of Stock") */
  stockLabel: string;
  similarity: number;
}

export interface ProductSearchConstraints {
  minPrice: number | null;
  maxPrice: number | null;
  sortBy: "relevance" | "price_asc" | "price_desc";
  searchTerms: string[];
}

interface ProductSearchOptions {
  constraints?: ProductSearchConstraints;
}

interface ProductSearchPlanInput {
  searchQuery?: string;
  productTerms?: string[];
  attributes?: string[];
  minPrice?: number | null;
  maxPrice?: number | null;
  sortBy?: "relevance" | "price_asc" | "price_desc";
}

interface RankedProduct {
  product: ProductCard;
  keywordScore: number;
  numericPrice: number;
}

export class ProductService {
  private readonly tokenCorrections = new Map<string, string>([
    ["chiar", "chair"],
    ["chirs", "chair"],
    ["ofice", "office"],
  ]);

  private readonly stopWords = new Set([
    "a",
    "affordable",
    "an",
    "and",
    "any",
    "are",
    "around",
    "am",
    "best",
    "budget",
    "budgetfriendly",
    "buy",
    "can",
    "cheap",
    "cheapest",
    "cost",
    "do",
    "for",
    "get",
    "have",
    "hello",
    "hey",
    "hi",
    "i",
    "im",
    "in",
    "inexpensive",
    "interested",
    "is",
    "items",
    "less",
    "find",
    "looking",
    "look",
    "lowest",
    "me",
    "my",
    "need",
    "of",
    "on",
    "or",
    "please",
    "price",
    "products",
    "recommend",
    "search",
    "searching",
    "show",
    "some",
    "than",
    "that",
    "the",
    "to",
    "under",
    "up",
    "what",
    "with",
    "within",
    "want",
    "wants",
    "would",
  ]);

  private normalizeToken(token: string): string {
    const cleaned = token.toLowerCase().replace(/[^a-z0-9]/g, "");
    const corrected = this.tokenCorrections.get(cleaned) ?? cleaned;
    if (corrected.endsWith("ies") && corrected.length > 4) {
      return `${corrected.slice(0, -3)}y`;
    }
    if (corrected.endsWith("s") && corrected.length > 4) {
      return corrected.slice(0, -1);
    }
    return corrected;
  }

  private extractSearchTerms(query: string): string[] {
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9$]+/)
      .map((token) => this.normalizeToken(token))
      .filter((token) => token.length >= 3)
      .filter((token) => !/^\d+(\.\d+)?$/.test(token))
      .filter((token) => !["usd", "kes", "ksh"].includes(token))
      .filter((token) => !this.stopWords.has(token));

    return [...new Set(terms)];
  }

  private extractPriceConstraints(query: string): Pick<ProductSearchConstraints, "minPrice" | "maxPrice" | "sortBy"> {
    const normalized = query.toLowerCase();
    let minPrice: number | null = null;
    let maxPrice: number | null = null;
    let sortBy: ProductSearchConstraints["sortBy"] = "relevance";
    const amount = String.raw`(?:kes|ksh|\$)?\s*(\d[\d,]*(?:\.\d+)?)`;
    const parseAmount = (value: string): number => Number(value.replace(/,/g, ""));

    const betweenMatch = normalized.match(
      new RegExp(String.raw`(?:between|from)\s*${amount}\s*(?:and|to)\s*${amount}`, "i")
    );
    if (betweenMatch) {
      minPrice = parseAmount(betweenMatch[1]);
      maxPrice = parseAmount(betweenMatch[2]);
    }

    const budgetMatch = normalized.match(
      new RegExp(String.raw`budget(?:\s+is|\s+of|:)?\s*${amount}`, "i")
    );
    if (budgetMatch) {
      maxPrice = parseAmount(budgetMatch[1]);
    }

    const maxMatch = normalized.match(
      new RegExp(
        String.raw`(?:under|below|less than|up to|within|max(?:imum)?(?: price)?(?: of)?)\s*${amount}`,
        "i"
      )
    );
    if (maxMatch) {
      maxPrice = parseAmount(maxMatch[1]);
    }

    const minMatch = normalized.match(
      new RegExp(
        String.raw`(?:over|above|more than|at least|min(?:imum)?(?: price)?(?: of)?)\s*${amount}`,
        "i"
      )
    );
    if (minMatch) {
      minPrice = parseAmount(minMatch[1]);
    }

    if (/\b(cheapest|lowest|most affordable|budget-friendly)\b/i.test(normalized)) {
      sortBy = "price_asc";
    } else if (/\b(most expensive|premium|highest)\b/i.test(normalized)) {
      sortBy = "price_desc";
    }

    return { minPrice, maxPrice, sortBy };
  }

  private computeKeywordScore(product: ProductCard, searchTerms: string[]): number {
    if (searchTerms.length === 0) return 0;

    const haystack = [
      product.title,
      product.description ?? "",
      product.tags ?? "",
      ...(product.variants ?? []).map((variant) => variant.title),
    ]
      .join(" ")
      .toLowerCase();

    return searchTerms.reduce((score, term) => {
      const singular = this.normalizeToken(term);
      const plural =
        singular.endsWith("y") && singular.length > 3
          ? `${singular.slice(0, -1)}ies`
          : `${singular}s`;
      const matched =
        haystack.includes(singular) ||
        (plural.length > singular.length && haystack.includes(plural));

      return score + (matched ? 1 : 0);
    }, 0);
  }

  private getCurrencyCode(variants: ProductCard["variants"]): string {
    const variantCurrency = variants.find((variant) => variant.currencyCode)?.currencyCode;
    return normalizeCurrencyCode(variantCurrency ?? DEFAULT_CURRENCY_CODE);
  }

  getSearchConstraints(query: string): ProductSearchConstraints {
    return {
      ...this.extractPriceConstraints(query),
      searchTerms: this.extractSearchTerms(query),
    };
  }

  hasPriceConstraint(constraints: ProductSearchConstraints): boolean {
    return constraints.minPrice !== null || constraints.maxPrice !== null;
  }

  withoutPriceConstraints(constraints: ProductSearchConstraints): ProductSearchConstraints {
    return {
      ...constraints,
      minPrice: null,
      maxPrice: null,
    };
  }

  mergeSearchConstraints(...queries: string[]): ProductSearchConstraints {
    const constraints = queries
      .filter((query) => query.trim().length > 0)
      .map((query) => this.getSearchConstraints(query));

    return constraints.reduce<ProductSearchConstraints>(
      (merged, current) => ({
        minPrice:
          current.minPrice === null
            ? merged.minPrice
            : merged.minPrice === null
              ? current.minPrice
              : Math.max(merged.minPrice, current.minPrice),
        maxPrice:
          current.maxPrice === null
            ? merged.maxPrice
            : merged.maxPrice === null
              ? current.maxPrice
              : Math.min(merged.maxPrice, current.maxPrice),
        sortBy: current.sortBy === "relevance" ? merged.sortBy : current.sortBy,
        searchTerms: [...new Set([...merged.searchTerms, ...current.searchTerms])],
      }),
      { minPrice: null, maxPrice: null, sortBy: "relevance", searchTerms: [] }
    );
  }

  buildChatSearchConstraints(
    latestMessage: string,
    rewrittenQuery: string
  ): ProductSearchConstraints {
    const latestConstraints = this.getSearchConstraints(latestMessage);
    const merged = this.mergeSearchConstraints(latestMessage, rewrittenQuery);

    // Rewritten queries can accidentally carry an old budget into a fresh,
    // standalone product request. Keep price limits only when the latest user
    // message explicitly contains one, or when the message is just a contextual
    // follow-up with no concrete product terms.
    if (
      !this.hasPriceConstraint(latestConstraints) &&
      latestConstraints.searchTerms.length > 0
    ) {
      return {
        ...merged,
        minPrice: null,
        maxPrice: null,
      };
    }

    return merged;
  }

  buildChatSearchConstraintsFromPlan(
    latestMessage: string,
    rewrittenQuery: string,
    plan: ProductSearchPlanInput
  ): ProductSearchConstraints {
    const deterministic = this.buildChatSearchConstraints(latestMessage, rewrittenQuery);
    const planText = [
      plan.searchQuery,
      ...(plan.productTerms ?? []),
      ...(plan.attributes ?? []),
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ");
    const planTerms = this.extractSearchTerms(planText);
    const fallbackTerms = this.extractSearchTerms(rewrittenQuery);

    return {
      minPrice:
        typeof plan.minPrice === "number" && Number.isFinite(plan.minPrice)
          ? plan.minPrice
          : deterministic.minPrice,
      maxPrice:
        typeof plan.maxPrice === "number" && Number.isFinite(plan.maxPrice)
          ? plan.maxPrice
          : deterministic.maxPrice,
      sortBy: plan.sortBy ?? deterministic.sortBy,
      searchTerms: planTerms.length > 0 ? planTerms : fallbackTerms,
    };
  }

  private mapProductRow(row: any): ProductCard {
    const inv: number = Number(row.totalInventory ?? 0);
    const variants = Array.isArray(row.variants) ? row.variants : [];
    const currencyCode = this.getCurrencyCode(variants);
    const stockLabel =
      inv === 0 ? "Out of Stock" : inv <= 5 ? `${inv} left` : "In Stock";

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      price: String(normalizeMoneyAmount(row.price, currencyCode)),
      currencyCode,
      formattedPrice: formatMoney(row.price, currencyCode),
      imageUrl: row.imageUrl,
      tags: row.tags,
      variants,
      totalInventory: inv,
      stockLabel,
      similarity: parseFloat(row.similarity ?? "0"),
    };
  }

  private rankProducts(
    products: ProductCard[],
    constraints: ProductSearchConstraints
  ): RankedProduct[] {
    return products.map((product) => ({
      product,
      keywordScore: this.computeKeywordScore(product, constraints.searchTerms),
      numericPrice: Number(product.price ?? 0),
    }));
  }

  private applySearchConstraints(
    ranked: RankedProduct[],
    constraints: ProductSearchConstraints
  ): RankedProduct[] {
    let filtered = ranked;

    if (constraints.searchTerms.length > 0) {
      const requiredKeywordScore =
        constraints.searchTerms.length <= 2
          ? constraints.searchTerms.length
          : Math.ceil(constraints.searchTerms.length * 0.6);
      const keywordMatches = filtered.filter(
        (entry) => entry.keywordScore >= requiredKeywordScore
      );
      if (keywordMatches.length > 0) {
        filtered = keywordMatches;
      } else {
        return [];
      }
    }

    if (constraints.minPrice !== null) {
      filtered = filtered.filter((entry) => entry.numericPrice >= constraints.minPrice!);
    }

    if (constraints.maxPrice !== null) {
      filtered = filtered.filter((entry) => entry.numericPrice <= constraints.maxPrice!);
    }

    return filtered;
  }

  private sortRankedProducts(
    ranked: RankedProduct[],
    constraints: ProductSearchConstraints
  ): RankedProduct[] {
    return ranked.sort((a, b) => {
      if (constraints.sortBy === "price_asc") {
        return (
          a.numericPrice - b.numericPrice ||
          b.keywordScore - a.keywordScore ||
          b.product.similarity - a.product.similarity
        );
      }

      if (constraints.sortBy === "price_desc") {
        return (
          b.numericPrice - a.numericPrice ||
          b.keywordScore - a.keywordScore ||
          b.product.similarity - a.product.similarity
        );
      }

      return (
        b.keywordScore - a.keywordScore ||
        b.product.similarity - a.product.similarity ||
        a.numericPrice - b.numericPrice
      );
    });
  }

  private async searchProductsByKeyword(
    storeId: string,
    constraints: ProductSearchConstraints,
    topK: number
  ): Promise<ProductCard[]> {
    if (constraints.searchTerms.length === 0) return [];

    const keywordClauses = constraints.searchTerms.map((term) => {
      const normalized = `%${term}%`;
      const plural =
        term.endsWith("y") && term.length > 3
          ? `%${term.slice(0, -1)}ies%`
          : `%${term}s%`;

      return sql`(
        title ILIKE ${normalized}
        OR title ILIKE ${plural}
        OR COALESCE(description, '') ILIKE ${normalized}
        OR COALESCE(description, '') ILIKE ${plural}
        OR COALESCE(tags, '') ILIKE ${normalized}
        OR COALESCE(tags, '') ILIKE ${plural}
        OR variants::text ILIKE ${normalized}
        OR variants::text ILIKE ${plural}
      )`;
    });

    const results = await db.execute(sql`
      SELECT
        shopify_product_id AS "id",
        title,
        description,
        price_min          AS "price",
        image_url          AS "imageUrl",
        tags,
        variants,
        total_inventory    AS "totalInventory",
        0                  AS "similarity"
      FROM products
      WHERE store_id = ${storeId}
        AND total_inventory > 0
        AND (${sql.join(keywordClauses, sql` OR `)})
      LIMIT ${Math.max(topK * 5, 20)};
    `);

    const ranked = this.applySearchConstraints(
      this.rankProducts(results.rows.map((row: any) => this.mapProductRow(row)), constraints),
      constraints
    );

    return this.sortRankedProducts(ranked, constraints)
      .slice(0, topK)
      .map((entry) => entry.product);
  }

  /**
   * S2-02 / S2-05: Semantic Product Search → Product Cards
   * Embeds the query, runs cosine similarity against pgvector, and returns
   * structured product cards ready for the frontend to render.
   * Out-of-stock products are excluded by default.
   */
  async searchProducts(
    storeId: string,
    query: string,
    topK: number = 5,
    options: ProductSearchOptions = {}
  ): Promise<ProductCard[]> {
    const constraints = options.constraints ?? this.getSearchConstraints(query);
    const response = await ai.embeddings.create({
      input: query,
      model: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
    });

    const queryEmbedding = response.data[0].embedding;
    const vectorString = JSON.stringify(queryEmbedding);

    // Exclude out-of-stock products before vector ranking. Price filtering is
    // applied after row mapping because synced Shopify prices can be decimal
    // amounts or cent-like integers, and ProductCard normalizes them for display.
    const candidateLimit = this.hasPriceConstraint(constraints)
      ? Math.max(topK * 25, 100)
      : Math.max(topK * 10, 50);
    const results = await db.execute(sql`
      SELECT
        shopify_product_id                              AS "id",
        title,
        description,
        price_min                                       AS "price",
        image_url                                       AS "imageUrl",
        tags,
        variants,
        total_inventory                                 AS "totalInventory",
        1 - (embedding <=> ${vectorString}::vector)     AS "similarity"
      FROM products
      WHERE store_id = ${storeId}
        AND total_inventory > 0
      ORDER BY embedding <=> ${vectorString}::vector
      LIMIT ${candidateLimit};
    `);

    let ranked = this.applySearchConstraints(
      this.rankProducts(results.rows.map((row: any) => this.mapProductRow(row)), constraints),
      constraints
    );

    if (ranked.length === 0 && constraints.searchTerms.length > 0) {
      return this.searchProductsByKeyword(storeId, constraints, topK);
    }

    ranked = this.sortRankedProducts(ranked, constraints);

    return ranked.slice(0, topK).map((entry) => entry.product);
  }
}
