import { eq } from "drizzle-orm";
import { db } from "../config/database";
import { draftOrders } from "../models/schema";
import { ShopifyService } from "./shopify.service";
import { ValidatorService } from "./validator.service";
import { DraftOrderPayload } from "../schemas/draftOrder.schema";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type SagaStep =
  | "validate"
  | "inventory_check"
  | "create_draft_order"
  | "get_checkout_url"
  | "rollback";

interface SagaLogEntry {
  step: SagaStep;
  status: "started" | "succeeded" | "failed";
  timestamp: string;
  error?: string;
}

export interface CheckoutResult {
  success: boolean;
  checkoutUrl?: string;
  draftOrderId?: string;
  shopifyDraftOrderId?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CheckoutService  (S3-03 + S3-04 — Commit + Compensating Transaction)
// ─────────────────────────────────────────────────────────────────────────────

export class CheckoutService {
  private shopify: ShopifyService;
  private validator: ValidatorService;

  constructor() {
    this.shopify = new ShopifyService();
    this.validator = new ValidatorService();
  }

  /**
   * Full SagaLLM checkout pipeline:
   *
   *   Prepare  → validate payload (AJV + Shopify variant + stock)
   *   Commit   → create draft order on Shopify, persist to DB
   *   Rollback → delete draft order if checkout URL is missing
   *
   * All steps are recorded in draft_orders.saga_log for audit.
   */
  async checkout(
    storeId: string,
    sessionId: string,
    rawPayload: unknown
  ): Promise<CheckoutResult> {
    const sagaLog: SagaLogEntry[] = [];
    let dbOrderId: string | undefined;
    let shopifyDraftOrderId: string | undefined;

    // ── Step 1: Validate (Phase 1 — Prepare) ─────────────────────────────────
    sagaLog.push({ step: "validate", status: "started", timestamp: now() });

    const validation = await this.validator.validate(rawPayload);

    if (!validation.valid) {
      sagaLog[sagaLog.length - 1].status = "failed";
      sagaLog[sagaLog.length - 1].error = validation.errors.join("; ");
      return {
        success: false,
        error: `Validation failed: ${validation.errors.join("; ")}`,
      };
    }

    sagaLog[sagaLog.length - 1].status = "succeeded";
    const payload = validation.data as DraftOrderPayload;

    // ── Step 2: Real-time inventory re-check (S3-06) ──────────────────────────
    sagaLog.push({
      step: "inventory_check",
      status: "started",
      timestamp: now(),
    });

    const stockErrors = await this.revalidateInventory(payload);
    if (stockErrors.length > 0) {
      sagaLog[sagaLog.length - 1].status = "failed";
      sagaLog[sagaLog.length - 1].error = stockErrors.join("; ");
      return {
        success: false,
        error: `Stock changed before checkout: ${stockErrors.join("; ")}`,
      };
    }

    sagaLog[sagaLog.length - 1].status = "succeeded";

    // ── Step 3: Create draft order in Shopify (Phase 2 — Commit) ─────────────
    sagaLog.push({
      step: "create_draft_order",
      status: "started",
      timestamp: now(),
    });

    // Persist a DB record first (status = pending) so we can update it after
    const [dbOrder] = await db
      .insert(draftOrders)
      .values({
        storeId,
        sessionId,
        lineItems: payload.line_items,
        discountPercent: payload.discount?.valueType === "PERCENTAGE"
          ? String(payload.discount.value)
          : null,
        status: "pending",
        sagaLog: sagaLog as any,
      })
      .returning({ id: draftOrders.id });

    dbOrderId = dbOrder.id;

    let shopifyOrderId: string;
    let invoiceUrl: string;

    try {
      const result = await this.shopify.createDraftOrder({
        lineItems: payload.line_items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        })),
        note: payload.note,
        appliedDiscount: payload.discount
          ? {
              title: payload.discount.title,
              valueType: payload.discount.valueType,
              value: payload.discount.value,
            }
          : undefined,
      });

      shopifyOrderId = result.id;
      invoiceUrl = result.invoiceUrl;
      shopifyDraftOrderId = shopifyOrderId;
    } catch (err: any) {
      sagaLog[sagaLog.length - 1].status = "failed";
      sagaLog[sagaLog.length - 1].error = err.message;

      await this.updateDbOrder(dbOrderId, { status: "failed", sagaLog });

      return { success: false, error: `Shopify order creation failed: ${err.message}` };
    }

    sagaLog[sagaLog.length - 1].status = "succeeded";

    // ── Step 4: Confirm checkout URL exists ───────────────────────────────────
    sagaLog.push({
      step: "get_checkout_url",
      status: "started",
      timestamp: now(),
    });

    if (!invoiceUrl) {
      // Rollback — compensating transaction (S3-04)
      sagaLog[sagaLog.length - 1].status = "failed";
      sagaLog[sagaLog.length - 1].error = "invoiceUrl missing from Shopify response";

      await this.rollback(shopifyOrderId, dbOrderId, sagaLog);

      return { success: false, error: "Checkout URL was not returned by Shopify. Order rolled back." };
    }

    sagaLog[sagaLog.length - 1].status = "succeeded";

    // ── Persist final committed state ─────────────────────────────────────────
    await this.updateDbOrder(dbOrderId, {
      shopifyDraftOrderId: shopifyOrderId,
      checkoutUrl: invoiceUrl,
      status: "committed",
      sagaLog,
    });

    return {
      success: true,
      checkoutUrl: invoiceUrl,
      draftOrderId: dbOrderId,
      shopifyDraftOrderId: shopifyOrderId,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * S3-06: Real-time stock re-check immediately before creating the draft order.
   * Returns an array of error strings (empty = all good).
   */
  private async revalidateInventory(payload: DraftOrderPayload): Promise<string[]> {
    const errors: string[] = [];

    await Promise.all(
      payload.line_items.map(async (item) => {
        try {
          const stock = await this.shopify.checkInventory(item.variantId);
          if (stock.quantity < item.quantity) {
            errors.push(
              `${item.variantId} now has only ${stock.quantity} unit(s) in stock.`
            );
          }
        } catch {
          errors.push(`Could not re-check inventory for ${item.variantId}.`);
        }
      })
    );

    return errors;
  }

  /**
   * S3-04: Compensating transaction — deletes the Shopify draft order and
   * marks the DB record as rolled_back.
   */
  private async rollback(
    shopifyDraftOrderId: string,
    dbOrderId: string,
    sagaLog: SagaLogEntry[]
  ): Promise<void> {
    sagaLog.push({ step: "rollback", status: "started", timestamp: now() });

    const deleted = await this.shopify.deleteDraftOrder(shopifyDraftOrderId);

    sagaLog[sagaLog.length - 1].status = deleted ? "succeeded" : "failed";
    if (!deleted) {
      sagaLog[sagaLog.length - 1].error =
        "deleteDraftOrder returned false — manual cleanup may be needed.";
    }

    await this.updateDbOrder(dbOrderId, { status: "rolled_back", sagaLog });
  }

  private async updateDbOrder(
    id: string,
    fields: Partial<{
      shopifyDraftOrderId: string;
      checkoutUrl: string;
      status: string;
      sagaLog: SagaLogEntry[];
    }>
  ): Promise<void> {
    await db
      .update(draftOrders)
      .set({
        ...(fields.shopifyDraftOrderId !== undefined && {
          shopifyDraftOrderId: fields.shopifyDraftOrderId,
        }),
        ...(fields.checkoutUrl !== undefined && {
          checkoutUrl: fields.checkoutUrl,
        }),
        ...(fields.status !== undefined && { status: fields.status }),
        ...(fields.sagaLog !== undefined && {
          sagaLog: fields.sagaLog as any,
        }),
        updatedAt: new Date(),
      })
      .where(eq(draftOrders.id, id));
  }
}

function now(): string {
  return new Date().toISOString();
}
