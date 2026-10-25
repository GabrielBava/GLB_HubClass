import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// O front-end vive em web/. Em desenvolvimento, /api é encaminhado para o
// servidor Fastify (porta 3001); em produção o próprio servidor entrega o build.
export default defineConfig({
  root: "web",
  publicDir: "public",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: false },
    },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    sourcemap: false,
  },
});
