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
    rollupOptions: {
      output: {
        // Bibliotecas em pacotes separados: melhor cache entre versões da aplicação.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/recharts|d3-|victory-vendor/.test(id)) return "charts";
          if (/react-dom|react-router|scheduler|@tanstack/.test(id)) return "vendor";
          return undefined;
        },
      },
    },
  },
});
