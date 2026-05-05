export const DEFAULT_CURRENCY_CODE = "KES";

export function normalizeCurrencyCode(currencyCode?: string | null): string {
  const normalized = currencyCode?.trim().toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized)
    ? normalized
    : DEFAULT_CURRENCY_CODE;
}

export function normalizeMoneyAmount(
  amount: string | number | null | undefined,
  currencyCode?: string | null
): number {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return 0;

  const currency = normalizeCurrencyCode(currencyCode);

  if (currency === "KES" && value >= 100000 && Number.isInteger(value)) {
    return value / 100;
  }

  return value;
}

export function formatMoney(
  amount: string | number | null | undefined,
  currencyCode?: string | null
): string {
  const currency = normalizeCurrencyCode(currencyCode);
  const value = normalizeMoneyAmount(amount, currency);

  if (!Number.isFinite(value)) {
    return `${currency} ${amount ?? ""}`.trim();
  }

  const fractionDigits = Number.isInteger(value) ? 0 : 2;

  if (currency === "KES") {
    const formatted = new Intl.NumberFormat("en-KE", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);

    return `KSh ${formatted}`;
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
      .format(value)
      .replace(/\u00a0/g, " ");
  } catch {
    const formatted = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);

    return `${currency} ${formatted}`;
  }
}
