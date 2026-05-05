import Ajv, { JSONSchemaType, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DraftOrderLineItem {
  /** Shopify variant GID, e.g. "gid://shopify/ProductVariant/12345678" */
  variantId: string;
  quantity: number;
}

export interface DraftOrderDiscount {
  title: string;
  valueType: "PERCENTAGE" | "FIXED_AMOUNT";
  /** Numeric value: 10 means 10% or $10 depending on valueType */
  value: number;
}

export interface DraftOrderPayload {
  line_items: DraftOrderLineItem[];
  note?: string;
  discount?: DraftOrderDiscount;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON Schema (matches Shopify draftOrderCreate mutation input)
// ─────────────────────────────────────────────────────────────────────────────

const draftOrderSchema: JSONSchemaType<DraftOrderPayload> = {
  type: "object",
  required: ["line_items"],
  additionalProperties: false,
  properties: {
    line_items: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["variantId", "quantity"],
        additionalProperties: false,
        properties: {
          variantId: {
            type: "string",
            pattern: "^gid://shopify/ProductVariant/[0-9]+$",
          },
          quantity: {
            type: "integer",
            minimum: 1,
            maximum: 100,
          },
        },
      },
    },
    note: {
      type: "string",
      nullable: true,
      maxLength: 500,
    },
    discount: {
      type: "object",
      nullable: true,
      required: ["title", "valueType", "value"],
      additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 1, maxLength: 100 },
        valueType: { type: "string", enum: ["PERCENTAGE", "FIXED_AMOUNT"] },
        value: { type: "number", minimum: 0.01, maximum: 100 },
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Compiled validator (singleton — compile once, reuse)
// ─────────────────────────────────────────────────────────────────────────────

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

export const validateDraftOrderPayload: ValidateFunction<DraftOrderPayload> =
  ajv.compile(draftOrderSchema);

/**
 * Validate a raw payload against the draft order schema.
 * Returns { valid: true, data } or { valid: false, errors }.
 */
export function parseDraftOrderPayload(raw: unknown):
  | { valid: true; data: DraftOrderPayload }
  | { valid: false; errors: string[] } {
  const ok = validateDraftOrderPayload(raw);
  if (ok) {
    return { valid: true, data: raw as DraftOrderPayload };
  }
  const errors = (validateDraftOrderPayload.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message}`
  );
  return { valid: false, errors };
}
