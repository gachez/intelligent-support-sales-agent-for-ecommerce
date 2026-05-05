export type ChatIntent =
  | "PRODUCT_SEARCH"
  | "SUPPORT_QUESTION"
  | "PURCHASE_INTENT"
  | "NEGOTIATION"
  | "GENERAL_CHAT";

export interface WidgetConfig {
  apiBase?: string;
  position?: "bottom-right" | "bottom-left";
  primaryColor?: string;
  fontFamily?: string;
  borderRadius?: string;
  title?: string;
  subtitle?: string;
  greeting?: string;
}

export interface ProductVariant {
  id: string;
  title: string;
  price?: string;
  currencyCode?: string;
  inventoryQuantity?: number;
  availableForSale?: boolean;
}

export interface ProductCard {
  id: string;
  title: string;
  description?: string;
  price: string;
  currencyCode?: string;
  formattedPrice?: string;
  imageUrl?: string | null;
  variants?: ProductVariant[];
  stockLabel?: string;
}

export interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  timestamp: Date;
  intent?: ChatIntent;
  products?: ProductCard[];
}

export interface ChatApiResponse {
  success: boolean;
  guest_token?: string;
  intent?: ChatIntent;
  answer?: string;
  products?: ProductCard[];
  error?: string;
}
