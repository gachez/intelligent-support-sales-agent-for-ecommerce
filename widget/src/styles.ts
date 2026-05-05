import type { WidgetConfig } from "./types";

export function buildStyles(config: Required<WidgetConfig>): string {
  const side = config.position === "bottom-left" ? "left" : "right";
  const opposite = config.position === "bottom-left" ? "right" : "left";

  return `
    :host {
      --agent-primary: ${config.primaryColor};
      --agent-radius: ${config.borderRadius};
      --agent-font: ${config.fontFamily};
      color: #111827;
      font-family: var(--agent-font);
      line-height: 1.4;
    }

    * { box-sizing: border-box; }
    button, input { font: inherit; }

    .agent-root {
      position: fixed;
      ${side}: 20px;
      bottom: 20px;
      z-index: 2147483000;
    }

    .launcher {
      width: 58px;
      height: 58px;
      border: 0;
      border-radius: 999px;
      background: var(--agent-primary);
      color: white;
      box-shadow: 0 12px 32px rgba(17, 24, 39, 0.24);
      cursor: pointer;
      display: grid;
      place-items: center;
      transition: transform 160ms ease, box-shadow 160ms ease;
    }

    .launcher:hover {
      transform: translateY(-1px);
      box-shadow: 0 16px 40px rgba(17, 24, 39, 0.28);
    }

    .launcher svg { width: 28px; height: 28px; }

    .panel {
      width: min(380px, calc(100vw - 32px));
      height: min(640px, calc(100vh - 96px));
      margin-bottom: 14px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: var(--agent-radius);
      box-shadow: 0 24px 80px rgba(17, 24, 39, 0.26);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transform-origin: bottom ${side};
      animation: agent-panel-in 160ms ease-out;
    }

    @keyframes agent-panel-in {
      from { opacity: 0; transform: translateY(8px) scale(.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 14px 12px;
      background: var(--agent-primary);
      color: white;
    }

    .header-title {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0;
      margin: 0;
    }

    .header-subtitle {
      font-size: 12px;
      opacity: .86;
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 260px;
    }

    .icon-button {
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: 999px;
      color: white;
      background: rgba(255,255,255,.16);
      display: grid;
      place-items: center;
      cursor: pointer;
      flex: 0 0 auto;
    }

    .icon-button svg { width: 18px; height: 18px; }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      background: #f8fafc;
    }

    .message-row {
      display: flex;
      margin: 0 0 12px;
    }

    .message-row.user {
      justify-content: flex-end;
    }

    .bubble {
      max-width: 82%;
      padding: 10px 12px;
      border-radius: 14px;
      font-size: 14px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, .08);
      overflow-wrap: anywhere;
    }

    .assistant .bubble {
      background: white;
      color: #111827;
      border-bottom-left-radius: 5px;
    }

    .user .bubble {
      background: var(--agent-primary);
      color: white;
      border-bottom-right-radius: 5px;
    }

    .meta {
      color: #64748b;
      font-size: 11px;
      margin-top: 4px;
      padding: 0 4px;
    }

    .user .meta { text-align: right; color: #818cf8; }

    .typing {
      display: inline-flex;
      gap: 4px;
      align-items: center;
      padding: 10px 12px;
      background: white;
      border-radius: 14px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, .08);
    }

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #94a3b8;
      animation: bounce 1s infinite ease-in-out;
    }

    .dot:nth-child(2) { animation-delay: .12s; }
    .dot:nth-child(3) { animation-delay: .24s; }

    @keyframes bounce {
      0%, 80%, 100% { transform: translateY(0); opacity: .55; }
      40% { transform: translateY(-4px); opacity: 1; }
    }

    .cards {
      display: grid;
      gap: 10px;
      margin: 8px 0 12px;
    }

    .product-card {
      display: grid;
      grid-template-columns: 82px minmax(0, 1fr);
      gap: 10px;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 9px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, .06);
    }

    .product-image {
      width: 82px;
      aspect-ratio: 1;
      border-radius: 9px;
      background: #eef2f7;
      display: grid;
      place-items: center;
      overflow: hidden;
      color: #64748b;
      font-size: 20px;
    }

    .product-image img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .product-title {
      font-size: 13px;
      font-weight: 700;
      margin: 0 0 2px;
      color: #111827;
    }

    .product-price {
      font-size: 13px;
      color: var(--agent-primary);
      font-weight: 800;
      margin-bottom: 5px;
    }

    .stock {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      padding: 2px 7px;
      border-radius: 999px;
      background: #dcfce7;
      color: #166534;
      font-size: 11px;
      font-weight: 700;
      margin-bottom: 7px;
    }

    .select {
      width: 100%;
      height: 30px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      background: white;
      color: #111827;
      font-size: 12px;
      padding: 0 8px;
      margin: 0 0 7px;
    }

    .card-actions {
      display: flex;
      gap: 6px;
    }

    .action {
      min-height: 32px;
      border: 0;
      border-radius: 8px;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
      flex: 1;
    }

    .primary { background: var(--agent-primary); color: white; }
    .secondary { background: #eef2ff; color: #3730a3; }

    .quick-replies {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding: 0 14px 10px;
      background: #f8fafc;
    }

    .quick-reply {
      white-space: nowrap;
      border: 1px solid #c7d2fe;
      background: #eef2ff;
      color: #3730a3;
      border-radius: 999px;
      padding: 7px 11px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }

    .input-area {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid #e5e7eb;
      background: white;
    }

    .input {
      min-width: 0;
      flex: 1;
      min-height: 42px;
      border: 1px solid #d1d5db;
      border-radius: 999px;
      padding: 0 14px;
      outline: none;
      font-size: 14px;
    }

    .input:focus {
      border-color: var(--agent-primary);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--agent-primary) 18%, transparent);
    }

    .send {
      width: 42px;
      height: 42px;
      border: 0;
      border-radius: 999px;
      background: var(--agent-primary);
      color: white;
      display: grid;
      place-items: center;
      cursor: pointer;
      flex: 0 0 auto;
    }

    .send:disabled {
      opacity: .55;
      cursor: not-allowed;
    }

    .verified {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-top: 8px;
      padding: 6px 8px;
      border-radius: 999px;
      background: #ecfdf5;
      color: #047857;
      font-size: 11px;
      font-weight: 800;
    }

    @media (max-width: 520px) {
      .agent-root {
        ${side}: 12px;
        ${opposite}: 12px;
        bottom: 12px;
      }

      .panel {
        width: auto;
        height: min(660px, calc(100vh - 88px));
      }
    }
  `;
}
