import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ChatApiResponse, ChatMessage, ProductCard, ProductVariant, WidgetConfig } from "./types";

const TOKEN_KEY = "agent_chat_guest_token";

interface AppProps {
  config: Required<WidgetConfig>;
}

export function App({ config }: AppProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [guestToken, setGuestToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: cryptoId(),
      role: "assistant",
      text: config.greeting,
      timestamp: new Date(),
      intent: "GENERAL_CHAT",
    },
  ]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isTyping, open]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;

    setMessages((current) => [
      ...current,
      {
        id: cryptoId(),
        role: "user",
        text: trimmed,
        timestamp: new Date(),
      },
    ]);
    setInput("");
    setOpen(true);
    setIsTyping(true);

    try {
      const response = await fetch(`${config.apiBase.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          ...(guestToken ? { guest_token: guestToken } : {}),
        }),
      });
      const data = (await response.json()) as ChatApiResponse;

      if (!data.success) {
        throw new Error(data.error || "The assistant could not process that message.");
      }

      if (data.guest_token && data.guest_token !== guestToken) {
        setGuestToken(data.guest_token);
        localStorage.setItem(TOKEN_KEY, data.guest_token);
      }

      setMessages((current) => [
        ...current,
        {
          id: cryptoId(),
          role: "assistant",
          text: data.answer || "",
          timestamp: new Date(),
          intent: data.intent,
          products: data.products || [],
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: cryptoId(),
          role: "assistant",
          text:
            error instanceof Error
              ? error.message
              : "The assistant is temporarily unavailable.",
          timestamp: new Date(),
          intent: "GENERAL_CHAT",
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  const quickReplies = useMemo(() => {
    const last = [...messages].reverse().find((message) => message.role === "assistant");
    if (!last) return [];
    if (last.intent === "PRODUCT_SEARCH" && last.products?.length) {
      return ["Show cheaper options", "Can I get a discount?", "Help me choose"];
    }
    if (last.intent === "NEGOTIATION") {
      return ["Create checkout link", "Show another option"];
    }
    return ["Show products", "Ask about delivery"];
  }, [messages]);

  return (
    <div className="agent-root">
      {open && (
        <section className="panel" aria-label={config.title}>
          <header className="header">
            <div>
              <h2 className="header-title">{config.title}</h2>
              <div className="header-subtitle">{config.subtitle}</div>
            </div>
            <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close chat">
              <CloseIcon />
            </button>
          </header>

          <div className="messages" ref={scrollerRef}>
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onSend={sendMessage}
              />
            ))}
            {isTyping && <TypingBubble />}
          </div>

          <div className="quick-replies" aria-label="Quick replies">
            {quickReplies.map((reply) => (
              <button
                className="quick-reply"
                type="button"
                key={reply}
                onClick={() => void sendMessage(reply)}
              >
                {reply}
              </button>
            ))}
          </div>

          <form className="input-area" onSubmit={handleSubmit}>
            <input
              className="input"
              value={input}
              placeholder="Type your message..."
              onChange={(event) => setInput(event.target.value)}
              autoComplete="off"
            />
            <button className="send" type="submit" disabled={!input.trim() || isTyping} aria-label="Send message">
              <SendIcon />
            </button>
          </form>
        </section>
      )}

      <button
        className="launcher"
        type="button"
        aria-label={open ? "Close chat" : "Open chat"}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
      </button>
    </div>
  );
}

function MessageBubble({
  message,
  onSend,
}: {
  message: ChatMessage;
  onSend: (text: string) => Promise<void>;
}) {
  const checkoutUrl = extractUrl(message.text);
  const cleanText = checkoutUrl ? message.text.replace(checkoutUrl, "").trim() : message.text;

  return (
    <div className={`message-row ${message.role}`}>
      <div>
        {cleanText && <div className="bubble">{cleanText}</div>}
        {checkoutUrl && (
          <div className="bubble">
            <a href={checkoutUrl} target="_blank" rel="noreferrer">
              Complete secure checkout
            </a>
            <div className="verified">Verified Shopify checkout</div>
          </div>
        )}
        {message.products?.length ? (
          <ProductCards products={message.products} onSend={onSend} />
        ) : null}
        <div className="meta">{formatTime(message.timestamp)}</div>
      </div>
    </div>
  );
}

function ProductCards({
  products,
  onSend,
}: {
  products: ProductCard[];
  onSend: (text: string) => Promise<void>;
}) {
  return (
    <div className="cards">
      {products.map((product) => (
        <ProductCardView key={product.id} product={product} onSend={onSend} />
      ))}
    </div>
  );
}

function ProductCardView({
  product,
  onSend,
}: {
  product: ProductCard;
  onSend: (text: string) => Promise<void>;
}) {
  const variants = product.variants || [];
  const [variantId, setVariantId] = useState(() => variants[0]?.id || "");
  const selectedVariant = variants.find((variant) => variant.id === variantId) || variants[0];

  async function addToCart() {
    if (!selectedVariant?.id) {
      await onSend(`I want to buy the ${product.title}`);
      return;
    }

    const numericVariantId = selectedVariant.id.split("/").pop();
    if (!numericVariantId || location.hostname === "localhost") {
      await onSend(`I want to buy the ${product.title}`);
      return;
    }

    try {
      await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: numericVariantId, quantity: 1 }),
      });
      await onSend(`I added ${product.title} to my cart. Can you help me checkout?`);
    } catch {
      await onSend(`I want to buy the ${product.title}`);
    }
  }

  return (
    <article className="product-card">
      <div className="product-image">
        {product.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" /> : "Bag"}
      </div>
      <div>
        <h3 className="product-title">{product.title}</h3>
        <div className="product-price">{formatProductPrice(product)}</div>
        <div className="stock">{product.stockLabel || "Available"}</div>

        {variants.length > 1 && (
          <select
            className="select"
            value={variantId}
            onChange={(event) => setVariantId(event.target.value)}
            aria-label={`Select variant for ${product.title}`}
          >
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.title}
              </option>
            ))}
          </select>
        )}

        <div className="card-actions">
          <button className="action primary" type="button" onClick={() => void addToCart()}>
            Add to cart
          </button>
          <button
            className="action secondary"
            type="button"
            onClick={() => void onSend(`Can you offer a discount on ${product.title}?`)}
          >
            Discount
          </button>
        </div>
      </div>
    </article>
  );
}

function TypingBubble() {
  return (
    <div className="message-row assistant">
      <div className="typing" aria-label="Assistant is typing">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatProductPrice(product: ProductCard): string {
  if (product.formattedPrice) return product.formattedPrice;
  return `${product.currencyCode || ""} ${product.price}`.trim();
}

function extractUrl(text: string): string | null {
  return text.match(/https?:\/\/\S+/)?.[0] || null;
}

function cryptoId(): string {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 6.5A4.5 4.5 0 0 1 9.5 2h5A4.5 4.5 0 0 1 19 6.5v4A4.5 4.5 0 0 1 14.5 15H12l-4.2 3.15A.5.5 0 0 1 7 17.75V15A4.5 4.5 0 0 1 5 10.5v-4Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 7.5h7M8.5 10.5h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12 20 4l-4 16-3.2-6.8L4 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
