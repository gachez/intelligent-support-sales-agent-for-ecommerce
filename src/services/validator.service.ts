import { ShopifyService } from "./shopify.service";
import {
  parseDraftOrderPayload,
  DraftOrderPayload,
} from "../schemas/draftOrder.schema";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** Payload echoed back (only present when valid === true) */
  data?: DraftOrderPayload;
}

// ─────────────────────────────────────────────────────────────────────────────
// ValidatorService  (S3-02 — Phase 1: Prepare)
// ─────────────────────────────────────────────────────────────────────────────

export class ValidatorService {
  private shopify: ShopifyService;

  constructor() {
    this.shopify = new ShopifyService();
  }

  /**
   * Full three-phase validation:
   *   1. JSON schema (AJV)
   *   2. Variant IDs exist in Shopify
   *   3. Requested quantities are in stock
   *
   * Returns { valid: true, data } or { valid: false, errors }.
   */
  async validate(raw: unknown): Promise<ValidationResult> {
    // ── Phase 1: Schema validation ────────────────────────────────────────────
    const parsed = parseDraftOrderPayload(raw);
    if (!parsed.valid) {
      return { valid: false, errors: parsed.errors };
    }

    const payload = parsed.data;
    const errors: string[] = [];

    // ── Phase 2 + 3: Per-variant Shopify checks ───────────────────────────────
    await Promise.all(
      payload.line_items.map(async (item) => {
        let stock: { available: boolean; quantity: number };

        try {
          stock = await this.shopify.checkInventory(item.variantId);
        } catch (err: any) {
          // checkInventory throws if variant doesn't exist in Shopify
          errors.push(
            `Variant ${item.variantId} does not exist in Shopify: ${err.message}`
          );
          return;
        }

        // Phase 3: quantity vs. available stock
        if (stock.quantity < item.quantity) {
          errors.push(
            `Variant ${item.variantId} only has ${stock.quantity} unit(s) in stock ` +
              `but ${item.quantity} were requested.`
          );
        }
      })
    );

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, errors: [], data: payload };
  }
}
