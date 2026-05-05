import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "../config/database";
import { sessions, stores, messages, pricingEvents } from "../models/schema";
import { ShopifyService } from "./shopify.service";
import { formatMoney, normalizeMoneyAmount } from "../utils/money";
import {
  DISCOUNT_ARMS,
  pricingConfigSchema,
  pricingConfigUpdateSchema,
  type PricingConfig,
  type PricingConfigUpdate,
} from "../schemas/pricing.schema";
import type { DraftOrderPayload } from "../schemas/draftOrder.schema";

type PricingOutcome = "converted" | "abandoned" | "expired";

type PricingOffer = {
  code: string;
  discountPercent: number;
  armSelected: number;
  eventId: string;
  expiresAt: string;
  source: "thompson_sampling" | "explicit_negotiation";
  shopifyDiscountId?: string | null;
  productId?: string | null;
  productTitle?: string | null;
  productPrice?: number | null;
  formattedProductPrice?: string | null;
  finalPrice?: number | null;
  formattedFinalPrice?: string | null;
  variantIds?: string[];
};

type PricingContext = {
  sessionDurationMinutes: number;
  minutesSinceLastActive: number;
  productSearchCount: number;
  negotiationCount: number;
  messageCount: number;
  cartValue: number;
  hesitationScore: number;
  recentProductIds: string[];
};

type NegotiationRequestInput = {
  productReference?: string | null;
  requestedPrice?: number | null;
  requestedDiscountPercent?: number | null;
  reason?: string | null;
};

type ProductCandidate = {
  id: string;
  title: string;
  price: number;
  formattedPrice?: string;
  currencyCode?: string;
  variants: Array<{ id: string; title?: string; price?: string }>;
};

export class PricingService {
  private readonly shopify = new ShopifyService();

  async getConfig(storeId: string): Promise<PricingConfig> {
    const [row] = await db
      .select({
        settings: stores.settings,
        maxDiscountPercent: stores.maxDiscountPercent,
      })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);

    const settings = (row?.settings ?? {}) as Record<string, any>;
    const pricingSettings = (settings.pricing ?? {}) as Record<string, any>;

    return pricingConfigSchema.parse({
      enabled: pricingSettings.enabled ?? true,
      maxDiscountPercent: clampNumber(
        toNumber(pricingSettings.maxDiscountPercent ?? row?.maxDiscountPercent ?? 15),
        0,
        15
      ),
      excludedProductIds: Array.isArray(pricingSettings.excludedProductIds)
        ? pricingSettings.excludedProductIds.filter((id: unknown) => typeof id === "string")
        : [],
      budgetUsd: pricingSettings.budgetUsd ?? null,
      hesitationThreshold: clampNumber(
        toNumber(pricingSettings.hesitationThreshold ?? 55),
        0,
        100
      ),
      offerTtlMinutes: clampNumber(
        toNumber(pricingSettings.offerTtlMinutes ?? 30),
        5,
        120
      ),
    });
  }

  async updateConfig(
    storeId: string,
    updates: PricingConfigUpdate
  ): Promise<PricingConfig> {
    const current = await this.getConfig(storeId);
    const parsed = pricingConfigUpdateSchema.parse(updates);

    const nextConfig = pricingConfigSchema.parse({
      ...current,
      ...parsed,
      excludedProductIds: parsed.excludedProductIds ?? current.excludedProductIds,
      budgetUsd:
        parsed.budgetUsd === undefined ? current.budgetUsd : parsed.budgetUsd,
    });

    const [store] = await db
      .select({
        id: stores.id,
        settings: stores.settings,
      })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);

    if (!store) {
      throw new Error("Store not found");
    }

    const settings = (store.settings ?? {}) as Record<string, any>;
    await db
      .update(stores)
      .set({
        settings: {
          ...settings,
          pricing: nextConfig,
        },
        maxDiscountPercent: nextConfig.maxDiscountPercent.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(stores.id, storeId));

    return nextConfig;
  }

  async scoreHesitation(
    storeId: string,
    sessionId: string
  ): Promise<PricingContext> {
    const [session] = await db
      .select({
        id: sessions.id,
        startedAt: sessions.startedAt,
        lastActiveAt: sessions.lastActiveAt,
        cartValue: sessions.cartValue,
        hesitationScore: sessions.hesitationScore,
        metadata: sessions.metadata,
      })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.storeId, storeId)))
      .limit(1);

    if (!session) {
      throw new Error("Session not found");
    }

    const recentMessages = await db
      .select({
        role: messages.role,
        intent: messages.intent,
        metadata: messages.metadata,
      })
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(desc(messages.createdAt))
      .limit(25);

    const now = new Date();
    const sessionDurationMinutes = Math.max(
      0,
      (now.getTime() - session.startedAt.getTime()) / 60000
    );
    const minutesSinceLastActive = Math.max(
      0,
      (now.getTime() - session.lastActiveAt.getTime()) / 60000
    );

    const productSearchMessages = recentMessages.filter(
      (msg) =>
        msg.role === "assistant" &&
        msg.intent === "PRODUCT_SEARCH" &&
        Array.isArray((msg.metadata as any)?.products) &&
        (msg.metadata as any).products.length > 0
    );
    const negotiationCount = recentMessages.filter(
      (msg) => msg.intent === "NEGOTIATION"
    ).length;
    const userTurnCount = recentMessages.filter((msg) => msg.role === "user").length;

    const recentProductIds = [...new Set(
      productSearchMessages.flatMap((msg) =>
        ((msg.metadata as any)?.products ?? []).map((p: any) => String(p.id))
      )
    )];

    const cartValue = toNumber(session.cartValue ?? 0);
    const hesitationScore = clampNumber(
      Math.round(
        sessionDurationMinutes * 2 +
          minutesSinceLastActive * 2.5 +
          productSearchMessages.length * 15 +
          negotiationCount * 12 +
          Math.min(cartValue / 8, 20) +
          Math.min(userTurnCount * 2, 15)
      ),
      0,
      100
    );

    await db
      .update(sessions)
      .set({
        hesitationScore: hesitationScore.toFixed(2),
        metadata: {
          ...(session.metadata ?? {}),
          pricing: {
            hesitationScore,
            lastScoredAt: now.toISOString(),
            productSearchCount: productSearchMessages.length,
            negotiationCount,
          },
        },
      })
      .where(eq(sessions.id, sessionId));

    return {
      sessionDurationMinutes,
      minutesSinceLastActive,
      productSearchCount: productSearchMessages.length,
      negotiationCount,
      messageCount: recentMessages.length,
      cartValue,
      hesitationScore,
      recentProductIds,
    };
  }

  async createNegotiationOffer(
    storeId: string,
    sessionId: string,
    request: NegotiationRequestInput = {}
  ): Promise<{ offer: PricingOffer | null; reason: string; context: PricingContext }> {
    const config = await this.getConfig(storeId);
    const context = await this.scoreHesitation(storeId, sessionId);
    const candidates = await this.getRecentProductCandidates(sessionId);
    const targetProduct = this.resolveProductCandidate(candidates, request);

    if (!config.enabled) {
      return { offer: null, reason: "Pricing is disabled for this store.", context };
    }

    if (!targetProduct) {
      return {
        offer: null,
        reason: "No recent product could be resolved for this negotiation.",
        context,
      };
    }

    const activeOffer = await this.getActiveOffer(storeId, sessionId);
    if (activeOffer) {
      return {
        offer: activeOffer,
        reason: "A live offer already exists for this session.",
        context,
      };
    }

    if (
      config.excludedProductIds.length > 0 &&
      config.excludedProductIds.includes(targetProduct.id)
    ) {
      return {
        offer: null,
        reason: "The selected product is excluded from promotions.",
        context,
      };
    }

    const eligibleArms = DISCOUNT_ARMS.filter(
      (arm) => arm > 0 && arm <= config.maxDiscountPercent
    );

    if (eligibleArms.length === 0) {
      return {
        offer: null,
        reason: "No promotional arm is available under the configured discount cap.",
        context,
      };
    }

    const requestedDiscount = this.deriveRequestedDiscountPercent(
      targetProduct.price,
      request
    );
    const cappedRequestedDiscount =
      requestedDiscount === null
        ? null
        : clampNumber(requestedDiscount, 0, config.maxDiscountPercent);
    const armSelected =
      cappedRequestedDiscount !== null && cappedRequestedDiscount > 0
        ? this.roundDiscount(cappedRequestedDiscount)
        : await this.selectArm(storeId, eligibleArms);

    const estimatedOfferValue = (targetProduct.price * armSelected) / 100;
    const budgetExceeded = await this.isBudgetExceeded(storeId, config, estimatedOfferValue);
    if (budgetExceeded) {
      return {
        offer: null,
        reason: "Offer skipped because the pricing budget would be exceeded.",
        context,
      };
    }

    const code = this.generateOfferCode(sessionId, armSelected);
    const expiresAt = new Date(Date.now() + config.offerTtlMinutes * 60 * 1000);
    const finalPrice = Math.max(0, targetProduct.price * (1 - armSelected / 100));
    const currencyCode = targetProduct.currencyCode;

    let shopifyDiscountId: string | null = null;
    try {
      shopifyDiscountId = await this.createShopifyDiscountCode({
        code,
        discountPercent: armSelected,
        expiresAt,
      });
    } catch (error) {
      console.error("Shopify discount creation failed, falling back to local offer code:", error);
    }

    const [event] = await db
      .insert(pricingEvents)
      .values({
        storeId,
        sessionId,
        contextVector: {
          ...context,
          productId: targetProduct.id,
          productTitle: targetProduct.title,
          productPrice: targetProduct.price,
          requestedPrice: request.requestedPrice ?? null,
          requestedDiscountPercent: request.requestedDiscountPercent ?? null,
          derivedRequestedDiscountPercent: requestedDiscount,
          maxDiscountPercent: config.maxDiscountPercent,
          threshold: config.hesitationThreshold,
          offerTtlMinutes: config.offerTtlMinutes,
        },
        armSelected: String(armSelected),
        discountCode: code,
        outcome: "offered",
        reward: "0.0",
      })
      .returning({ id: pricingEvents.id });

    await this.saveSessionOffer(storeId, sessionId, {
      code,
      discountPercent: armSelected,
      armSelected,
      eventId: event.id,
      expiresAt: expiresAt.toISOString(),
      source: "explicit_negotiation",
      shopifyDiscountId,
      productId: targetProduct.id,
      productTitle: targetProduct.title,
      productPrice: targetProduct.price,
      formattedProductPrice: targetProduct.formattedPrice ?? formatMoney(targetProduct.price, currencyCode),
      finalPrice,
      formattedFinalPrice: formatMoney(finalPrice, currencyCode),
      variantIds: targetProduct.variants.map((variant) => variant.id).filter(Boolean),
    });

    return {
      offer: {
        code,
        discountPercent: armSelected,
        armSelected,
        eventId: event.id,
        expiresAt: expiresAt.toISOString(),
        source: "explicit_negotiation",
        shopifyDiscountId,
        productId: targetProduct.id,
        productTitle: targetProduct.title,
        productPrice: targetProduct.price,
        formattedProductPrice: targetProduct.formattedPrice ?? formatMoney(targetProduct.price, currencyCode),
        finalPrice,
        formattedFinalPrice: formatMoney(finalPrice, currencyCode),
        variantIds: targetProduct.variants.map((variant) => variant.id).filter(Boolean),
      },
      reason:
        requestedDiscount !== null && requestedDiscount > config.maxDiscountPercent
          ? `Requested discount ${requestedDiscount.toFixed(2)}% exceeded the configured cap of ${config.maxDiscountPercent}%; countered at the cap.`
          : "Offer created.",
      context,
    };
  }

  private async getRecentProductCandidates(sessionId: string): Promise<ProductCandidate[]> {
    const recentMessages = await db
      .select({
        metadata: messages.metadata,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(eq(messages.sessionId, sessionId), eq(messages.role, "assistant"), eq(messages.intent, "PRODUCT_SEARCH")))
      .orderBy(desc(messages.createdAt))
      .limit(5);

    const candidates = new Map<string, ProductCandidate>();

    for (const msg of recentMessages) {
      const products = (msg.metadata as any)?.products;
      if (!Array.isArray(products)) continue;

      for (const product of products) {
        if (!product?.id || !product?.title || candidates.has(String(product.id))) {
          continue;
        }

        const variants = Array.isArray(product.variants) ? product.variants : [];
        const currencyCode =
          typeof product.currencyCode === "string"
            ? product.currencyCode
            : variants.find((variant: any) => typeof variant?.currencyCode === "string")?.currencyCode;
        const price = normalizeMoneyAmount(product.price, currencyCode);

        candidates.set(String(product.id), {
          id: String(product.id),
          title: String(product.title),
          price,
          formattedPrice:
            typeof product.formattedPrice === "string" ? product.formattedPrice : undefined,
          currencyCode,
          variants: variants
            .filter((variant: any) => typeof variant?.id === "string")
            .map((variant: any) => ({
              id: variant.id,
              title: typeof variant.title === "string" ? variant.title : undefined,
              price: variant.price,
            })),
        });
      }
    }

    return [...candidates.values()];
  }

  private resolveProductCandidate(
    candidates: ProductCandidate[],
    request: NegotiationRequestInput
  ): ProductCandidate | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const reference = normalizeText(request.productReference ?? "");
    const referenceAmount = extractFirstAmount(reference);
    let best: { candidate: ProductCandidate; score: number } | null = null;

    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const title = normalizeText(candidate.title);
      let score = 0;

      if (reference) {
        const refTokens = reference
          .split(/\s+/)
          .filter((token) => token.length >= 3 && !["one", "for", "the", "that", "this"].includes(token));
        score += refTokens.filter((token) => title.includes(token)).length * 8;

        if (reference.includes(String(index + 1)) || reference.includes(ordinalWord(index + 1))) {
          score += 12;
        }
      }

      if (referenceAmount !== null) {
        const priceDistance = Math.abs(candidate.price - referenceAmount);
        if (priceDistance < 1) score += 40;
        else if (priceDistance <= Math.max(100, candidate.price * 0.03)) score += 20;
      }

      if (!best || score > best.score) {
        best = { candidate, score };
      }
    }

    return best && best.score > 0 ? best.candidate : candidates[0];
  }

  private deriveRequestedDiscountPercent(
    productPrice: number,
    request: NegotiationRequestInput
  ): number | null {
    if (
      typeof request.requestedDiscountPercent === "number" &&
      Number.isFinite(request.requestedDiscountPercent) &&
      request.requestedDiscountPercent > 0
    ) {
      return request.requestedDiscountPercent;
    }

    if (
      typeof request.requestedPrice === "number" &&
      Number.isFinite(request.requestedPrice) &&
      request.requestedPrice > 0 &&
      productPrice > 0 &&
      request.requestedPrice < productPrice
    ) {
      return ((productPrice - request.requestedPrice) / productPrice) * 100;
    }

    return null;
  }

  private roundDiscount(value: number): number {
    return Math.round(value * 100) / 100;
  }

  async getActiveOffer(
    storeId: string,
    sessionId: string
  ): Promise<PricingOffer | null> {
    const [session] = await db
      .select({
        metadata: sessions.metadata,
        storeId: sessions.storeId,
      })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.storeId, storeId)))
      .limit(1);

    if (!session) return null;

    const offer = (session.metadata as any)?.pricingOffer as PricingOffer | undefined;
    if (!offer) return null;

    if (new Date(offer.expiresAt).getTime() <= Date.now()) {
      await this.expireOffer(storeId, sessionId, offer.eventId);
      return null;
    }

    return offer;
  }

  async applyOfferToPayload(
    storeId: string,
    sessionId: string,
    payload: DraftOrderPayload
  ): Promise<{ payload: DraftOrderPayload; offer?: PricingOffer | null }> {
    const offer = await this.getActiveOffer(storeId, sessionId);

    if (!offer || payload.discount) {
      return { payload, offer: offer ?? null };
    }

    if (
      offer.variantIds &&
      offer.variantIds.length > 0 &&
      !payload.line_items.some((item) => offer.variantIds!.includes(item.variantId))
    ) {
      return { payload, offer };
    }

    return {
      payload: {
        ...payload,
        discount: {
          title: offer.code,
          valueType: "PERCENTAGE",
          value: offer.discountPercent,
        },
      },
      offer,
    };
  }

  async finalizeOfferOutcome(
    storeId: string,
    sessionId: string,
    outcome: PricingOutcome
  ): Promise<void> {
    const offer = await this.getActiveOffer(storeId, sessionId);
    if (!offer) return;

    await db
      .update(pricingEvents)
      .set({
        outcome,
        reward: outcome === "converted" ? "1.0" : "0.0",
        resolvedAt: new Date(),
      })
      .where(eq(pricingEvents.id, offer.eventId));

    await this.clearSessionOffer(storeId, sessionId);
  }

  private async selectArm(storeId: string, eligibleArms: number[]): Promise<number> {
    const resolvedEvents = await db.execute(sql`
      SELECT arm_selected, outcome
      FROM pricing_events
      WHERE store_id = ${storeId}
        AND outcome IN ('converted', 'abandoned', 'expired')
        AND created_at > NOW() - INTERVAL '90 days'
    `);

    const stats = new Map<number, { success: number; failure: number }>();
    eligibleArms.forEach((arm) => stats.set(arm, { success: 0, failure: 0 }));

    for (const row of resolvedEvents.rows as Array<{ arm_selected: string | number; outcome: string }>) {
      const arm = Number(row.arm_selected);
      const bucket = stats.get(arm);
      if (!bucket) continue;

      if (row.outcome === "converted") {
        bucket.success += 1;
      } else {
        bucket.failure += 1;
      }
    }

    let bestArm = eligibleArms[0];
    let bestScore = -Infinity;

    for (const arm of eligibleArms) {
      const bucket = stats.get(arm) ?? { success: 0, failure: 0 };
      const alpha = 1 + bucket.success;
      const beta = 1 + bucket.failure;
      const sampledConversionRate = sampleBeta(alpha, beta);
      const utilityScore = sampledConversionRate * (1 - arm / 100);

      if (
        utilityScore > bestScore ||
        (utilityScore === bestScore && arm < bestArm)
      ) {
        bestScore = utilityScore;
        bestArm = arm;
      }
    }

    return bestArm;
  }

  private async isBudgetExceeded(
    storeId: string,
    config: PricingConfig,
    estimatedOfferValue: number
  ): Promise<boolean> {
    if (config.budgetUsd == null) return false;

    const result = await db.execute(sql`
      SELECT COALESCE(SUM(
        COALESCE((context_vector->>'cartValue')::numeric, 0) * arm_selected / 100
      ), 0) AS reserved
      FROM pricing_events
      WHERE store_id = ${storeId}
        AND outcome = 'offered'
        AND created_at > NOW() - INTERVAL '30 minutes'
    `);

    const reserved = Number((result.rows[0] as any)?.reserved ?? 0);
    return reserved + estimatedOfferValue > config.budgetUsd;
  }

  private generateOfferCode(sessionId: string, armSelected: number): string {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    const sessionBits = sessionId.replace(/-/g, "").slice(0, 4).toUpperCase();
    return `NG-${armSelected}-${sessionBits}-${suffix}`;
  }

  private async createShopifyDiscountCode(input: {
    code: string;
    discountPercent: number;
    expiresAt: Date;
  }): Promise<string | null> {
    const result = await this.shopify.createDiscountCode({
      code: input.code,
      title: `Negotiation ${input.discountPercent}%`,
      discountPercent: input.discountPercent,
      startsAt: new Date(),
      endsAt: input.expiresAt,
      usageLimit: 1,
    });

    return result.id ?? null;
  }

  private async saveSessionOffer(
    storeId: string,
    sessionId: string,
    offer: PricingOffer
  ): Promise<void> {
    const [session] = await db
      .select({
        metadata: sessions.metadata,
      })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.storeId, storeId)))
      .limit(1);

    if (!session) {
      throw new Error("Session not found");
    }

    await db
      .update(sessions)
      .set({
        metadata: {
          ...(session.metadata ?? {}),
          pricingOffer: offer,
        },
      })
      .where(eq(sessions.id, sessionId));
  }

  private async clearSessionOffer(storeId: string, sessionId: string): Promise<void> {
    const [session] = await db
      .select({
        metadata: sessions.metadata,
      })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.storeId, storeId)))
      .limit(1);

    if (!session) return;

    const metadata = { ...(session.metadata ?? {}) } as Record<string, any>;
    delete metadata.pricingOffer;

    await db
      .update(sessions)
      .set({ metadata })
      .where(eq(sessions.id, sessionId));
  }

  private async expireOffer(
    storeId: string,
    sessionId: string,
    eventId: string
  ): Promise<void> {
    await db
      .update(pricingEvents)
      .set({
        outcome: "expired",
        reward: "0.0",
        resolvedAt: new Date(),
      })
      .where(eq(pricingEvents.id, eventId));

    await this.clearSessionOffer(storeId, sessionId);
  }
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirstAmount(value: string): number | null {
  const match = value.match(/\b\d[\d,]*(?:\.\d+)?\b/);
  if (!match) return null;

  const parsed = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function ordinalWord(value: number): string {
  const words: Record<number, string> = {
    1: "first",
    2: "second",
    3: "third",
    4: "fourth",
    5: "fifth",
  };

  return words[value] ?? String(value);
}

function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

function sampleGamma(shape: number): number {
  if (shape < 1) {
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    const x = sampleNormal();
    let v = 1 + c * x;
    if (v <= 0) continue;
    v = v * v * v;

    const u = Math.random();
    if (u < 1 - 0.331 * Math.pow(x, 4)) {
      return d * v;
    }

    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

function sampleNormal(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
