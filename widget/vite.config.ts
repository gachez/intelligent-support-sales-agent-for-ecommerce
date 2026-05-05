import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react",
      development: false,
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../public/widget"),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "src/main.tsx"),
      name: "AgentChatWidget",
      formats: ["iife"],
      fileName: () => "agent-chat-widget.js",
    },
  },
});
