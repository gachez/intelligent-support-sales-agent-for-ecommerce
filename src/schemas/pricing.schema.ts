import { z } from "zod";

export const DISCOUNT_ARMS = [0, 5, 7, 10, 15] as const;

export const pricingConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    maxDiscountPercent: z.number().min(0).max(15).default(15),
    excludedProductIds: z.array(z.string().min(1)).default([]),
    budgetUsd: z.number().nonnegative().nullable().default(null),
    hesitationThreshold: z.number().min(0).max(100).default(55),
    offerTtlMinutes: z.number().int().min(5).max(120).default(30),
  })
  .strict();

export const pricingConfigUpdateSchema = pricingConfigSchema
  .partial()
  .strict();

export type PricingConfig = z.infer<typeof pricingConfigSchema>;
export type PricingConfigUpdate = z.infer<typeof pricingConfigUpdateSchema>;

