import React from "react";
import { createRoot, Root } from "react-dom/client";
import { App } from "./App";
import { buildStyles } from "./styles";
import type { WidgetConfig } from "./types";

declare global {
  interface Window {
    AgentChatWidget?: {
      init: (config?: WidgetConfig) => void;
      destroy: () => void;
    };
    AgentChatWidgetConfig?: WidgetConfig;
  }
}

const DEFAULT_CONFIG: Required<WidgetConfig> = {
  apiBase: "",
  position: "bottom-right",
  primaryColor: "#4f46e5",
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  borderRadius: "16px",
  title: "Shopping assistant",
  subtitle: "Products, support, discounts, checkout",
  greeting:
    "Hi, I can help you find products, answer support questions, and create checkout links. What are you looking for?",
};

let root: Root | null = null;
let host: HTMLElement | null = null;
const scriptConfig = readScriptConfig();

function readScriptConfig(): WidgetConfig {
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script) return {};

  return {
    apiBase: script.dataset.apiBase,
    position: script.dataset.position as WidgetConfig["position"],
    primaryColor: script.dataset.primaryColor,
    fontFamily: script.dataset.fontFamily,
    borderRadius: script.dataset.borderRadius,
    title: script.dataset.title,
    subtitle: script.dataset.subtitle,
    greeting: script.dataset.greeting,
  };
}

function resolveConfig(config: WidgetConfig = {}): Required<WidgetConfig> {
  const themePrimary = readCssVariable("--color-primary") || readCssVariable("--shopify-primary-color");
  const themeFont = readCssVariable("--font-body-family") || readCssVariable("--font-stack-body");
  const themeRadius = readCssVariable("--buttons-radius") || readCssVariable("--border-radius");

  return {
    ...DEFAULT_CONFIG,
    ...(themePrimary ? { primaryColor: themePrimary } : {}),
    ...(themeFont ? { fontFamily: themeFont } : {}),
    ...(themeRadius ? { borderRadius: themeRadius } : {}),
    ...removeEmpty(config),
  };
}

function init(config: WidgetConfig = {}) {
  destroy();

  const resolvedConfig = resolveConfig({
    ...scriptConfig,
    ...(window.AgentChatWidgetConfig || {}),
    ...config,
  });

  host = document.createElement("div");
  host.id = "agent-chat-widget";
  host.style.setProperty("display", "block", "important");
  host.style.setProperty("visibility", "visible", "important");
  host.style.setProperty("opacity", "1", "important");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = buildStyles(resolvedConfig);
  const mount = document.createElement("div");

  shadow.append(style, mount);
  document.body.appendChild(host);

  root = createRoot(mount);
  root.render(<App config={resolvedConfig} />);
}

function destroy() {
  if (root) {
    root.unmount();
    root = null;
  }
  host?.remove();
  host = null;
}

function readCssVariable(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function removeEmpty(config: WidgetConfig): WidgetConfig {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined && value !== "")
  ) as WidgetConfig;
}

window.AgentChatWidget = { init, destroy };

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => init(), { once: true });
} else {
  init();
}
