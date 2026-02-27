import { env } from "../config/env";

/**
 * ShopifyService
 *
 * Handles all communication with the Shopify Admin API (GraphQL).
 * Uses the Custom App access token for authentication.
 */

interface ShopifyVariant {
  id: string;
  title: string;
  price: string;
  inventoryQuantity: number;
  sku: string;
  availableForSale: boolean;
}

interface ShopifyProduct {
  id: string;
  title: string;
  description: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  featuredImage: { url: string } | null;
  status: string;
  variants: ShopifyVariant[];
  totalInventory: number;
  priceRange: {
    minVariantPrice: string;
    maxVariantPrice: string;
  };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; locations?: any[] }>;
}

export class ShopifyService {
  private readonly storeUrl: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly graphqlEndpoint: string;

  constructor(
    storeUrl?: string,
    accessToken?: string,
    apiVersion?: string
  ) {
    this.storeUrl = storeUrl || env.SHOPIFY_STORE_URL;
    this.accessToken = accessToken || env.SHOPIFY_ACCESS_TOKEN;
    this.apiVersion = apiVersion || env.SHOPIFY_API_VERSION;

    // Normalize store URL
    const domain = this.storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    this.graphqlEndpoint = `https://${domain}/admin/api/${this.apiVersion}/graphql.json`;
  }

  /**
   * Execute a GraphQL query against the Shopify Admin API.
   */
  private async query<T>(
    graphqlQuery: string,
    variables: Record<string, any> = {}
  ): Promise<T> {
    const response = await fetch(this.graphqlEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": this.accessToken,
      },
      body: JSON.stringify({ query: graphqlQuery, variables }),
    });

    if (!response.ok) {
      throw new Error(
        `Shopify API error: ${response.status} ${response.statusText}`
      );
    }

    const result = (await response.json()) as GraphQLResponse<T>;

    if (result.errors && result.errors.length > 0) {
      const messages = result.errors.map((e) => e.message).join("; ");
      throw new Error(`Shopify GraphQL error: ${messages}`);
    }

    if (!result.data) {
      throw new Error("Shopify returned empty response");
    }

    return result.data;
  }

/**
   * Fetches all active products for the embedding sync
   */
  async fetchAllProductsForSync(): Promise<any[]> {
    const graphql = `
      query FetchProductsForSync {
        products(first: 50, query: "status:ACTIVE") {
          edges {
            node {
              id
              title
              description
              tags
              totalInventory
              featuredImage {
                url
              }
              variants(first: 10) {
                edges {
                  node {
                    id
                    title
                    price
                    inventoryQuantity
                    availableForSale
                    sku
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const data = await this.query<{
        products: {
          edges: Array<{ node: any }>;
        };
      }>(graphql);

      return data.products.edges.map((edge) => edge.node);
    } catch (error) {
      console.error("Shopify sync fetch error:", error);
      throw new Error("Failed to fetch products for sync");
    }
  }
  
  /**
   * Fetch products with optional search query.
   * Maps to ticket S0-04.
   */
  async fetchProducts(
    searchQuery?: string,
    limit: number = 10
  ): Promise<ShopifyProduct[]> {
    const queryFilter = searchQuery
      ? `query: "title:*${searchQuery}* OR product_type:${searchQuery} OR tag:${searchQuery}"`
      : "";

    const graphql = `
      query FetchProducts($first: Int!) {
        products(first: $first, ${queryFilter}, sortKey: RELEVANCE) {
          edges {
            node {
              id
              title
              description
              descriptionHtml
              vendor
              productType
              tags
              status
              totalInventory
              featuredImage {
                url
              }
              priceRange {
                minVariantPrice {
                  amount
                  currencyCode
                }
                maxVariantPrice {
                  amount
                  currencyCode
                }
              }
              variants(first: 20) {
                edges {
                  node {
                    id
                    title
                    price
                    inventoryQuantity
                    sku
                    availableForSale
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await this.query<{
      products: {
        edges: Array<{ node: any }>;
      };
    }>(graphql, { first: limit });

    return data.products.edges.map((edge) => {
      const node = edge.node;
      return {
        id: node.id,
        title: node.title,
        description: node.description,
        descriptionHtml: node.descriptionHtml,
        vendor: node.vendor,
        productType: node.productType,
        tags: node.tags,
        featuredImage: node.featuredImage,
        status: node.status,
        totalInventory: node.totalInventory,
        variants: node.variants.edges.map((v: any) => v.node),
        priceRange: {
          minVariantPrice: node.priceRange.minVariantPrice.amount,
          maxVariantPrice: node.priceRange.maxVariantPrice.amount,
        },
      };
    });
  }

  /**
   * Get a single product by Shopify GID.
   */
  async getProductById(productId: string): Promise<ShopifyProduct | null> {
    const graphql = `
      query GetProduct($id: ID!) {
        product(id: $id) {
          id
          title
          description
          descriptionHtml
          vendor
          productType
          tags
          status
          totalInventory
          featuredImage {
            url
          }
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
            maxVariantPrice {
              amount
              currencyCode
            }
          }
          variants(first: 20) {
            edges {
              node {
                id
                title
                price
                inventoryQuantity
                sku
                availableForSale
              }
            }
          }
        }
      }
    `;

    try {
      const data = await this.query<{ product: any }>(graphql, {
        id: productId,
      });

      if (!data.product) return null;

      const node = data.product;
      return {
        id: node.id,
        title: node.title,
        description: node.description,
        descriptionHtml: node.descriptionHtml,
        vendor: node.vendor,
        productType: node.productType,
        tags: node.tags,
        featuredImage: node.featuredImage,
        status: node.status,
        totalInventory: node.totalInventory,
        variants: node.variants.edges.map((v: any) => v.node),
        priceRange: {
          minVariantPrice: node.priceRange.minVariantPrice.amount,
          maxVariantPrice: node.priceRange.maxVariantPrice.amount,
        },
      };
    } catch (error) {
      console.error(`Failed to fetch product ${productId}:`, error);
      return null;
    }
  }

  /**
   * Check inventory levels for a specific variant.
   */
  async checkInventory(
    variantId: string
  ): Promise<{ available: boolean; quantity: number }> {
    const graphql = `
      query CheckInventory($id: ID!) {
        productVariant(id: $id) {
          id
          inventoryQuantity
          availableForSale
        }
      }
    `;

    const data = await this.query<{ productVariant: any }>(graphql, {
      id: variantId,
    });

    if (!data.productVariant) {
      return { available: false, quantity: 0 };
    }

    return {
      available: data.productVariant.availableForSale,
      quantity: data.productVariant.inventoryQuantity,
    };
  }

  /**
   * Create a draft order on Shopify.
   * Used in Sprint 3 (Agentic Checkout).
   */
  async createDraftOrder(input: {
    lineItems: Array<{ variantId: string; quantity: number }>;
    note?: string;
    appliedDiscount?: {
      title: string;
      valueType: "PERCENTAGE" | "FIXED_AMOUNT";
      value: number;
    };
  }): Promise<{ id: string; invoiceUrl: string }> {
    const graphql = `
      mutation DraftOrderCreate($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id
            invoiceUrl
            totalPrice
            lineItems(first: 10) {
              edges {
                node {
                  title
                  quantity
                  originalUnitPrice
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const draftOrderInput: any = {
      lineItems: input.lineItems.map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
      })),
    };

    if (input.note) {
      draftOrderInput.note = input.note;
    }

    if (input.appliedDiscount) {
      draftOrderInput.appliedDiscount = {
        title: input.appliedDiscount.title,
        valueType: input.appliedDiscount.valueType,
        value: input.appliedDiscount.value,
      };
    }

    const data = await this.query<{ draftOrderCreate: any }>(graphql, {
      input: draftOrderInput,
    });

    const result = data.draftOrderCreate;

    if (result.userErrors && result.userErrors.length > 0) {
      const errors = result.userErrors.map((e: any) => e.message).join("; ");
      throw new Error(`Draft order creation failed: ${errors}`);
    }

    return {
      id: result.draftOrder.id,
      invoiceUrl: result.draftOrder.invoiceUrl,
    };
  }

  /**
   * Delete a draft order (compensating transaction for SagaLLM rollback).
   */
  async deleteDraftOrder(draftOrderId: string): Promise<boolean> {
    const graphql = `
      mutation DraftOrderDelete($input: DraftOrderDeleteInput!) {
        draftOrderDelete(input: $input) {
          deletedId
          userErrors {
            field
            message
          }
        }
      }
    `;

    try {
      const data = await this.query<{ draftOrderDelete: any }>(graphql, {
        input: { id: draftOrderId },
      });

      return !data.draftOrderDelete.userErrors?.length;
    } catch (error) {
      console.error(`Failed to delete draft order ${draftOrderId}:`, error);
      return false;
    }
  }

  /**
   * Test the connection to Shopify.
   */
  async testConnection(): Promise<{ shopName: string; plan: string }> {
    const graphql = `
      query ShopInfo {
        shop {
          name
          plan {
            displayName
          }
        }
      }
    `;

    const data = await this.query<{ shop: any }>(graphql);

    return {
      shopName: data.shop.name,
      plan: data.shop.plan.displayName,
    };
  }


}
