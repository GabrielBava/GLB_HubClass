import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// O front-end vive em web/. Em desenvolvimento, /api é encaminhado para o
// servidor Fastify (porta 3001); em produção o próprio servidor entrega o build.
// `vite build --mode demo` gera a demonstração estática: um único pacote JavaScript, embutido depois no HTML.
export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
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
      outDir: demo ? "../dist/demo" : "../dist/web",
      // Na demonstração (arquivo único), imagens como o logotipo vão embutidas no pacote.
      assetsInlineLimit: demo ? 10_000_000 : 4096,
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        output: demo
          ? { inlineDynamicImports: true }
          : {
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
  };
});
