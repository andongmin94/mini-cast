import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
  },
  plugins: [
    {
      name: "mini-cast-csp",
      transformIndexHtml(html) {
        const scriptPolicy =
          command === "serve"
            ? "script-src 'self' 'unsafe-inline';"
            : "script-src 'self';";
        const connectPolicy =
          command === "serve"
            ? "connect-src 'self' http://127.0.0.1:3000 ws://127.0.0.1:3000;"
            : "connect-src 'none';";
        return html
          .replace("script-src 'self';", scriptPolicy)
          .replace("connect-src 'none';", connectPolicy);
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
