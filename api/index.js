// Função da Vercel: atende todas as rotas /api/* com o mesmo servidor Fastify da aplicação.
// O servidor é compilado em dist/server durante o build (npm run vercel-build) e reaproveitado
// entre requisições enquanto a instância estiver ativa.
import { buildApp } from "../dist/server/server/app.js";
import { loadConfig } from "../dist/server/server/config.js";

let ready = null;

function getApp() {
  if (!ready) {
    ready = buildApp(loadConfig()).then(async (app) => {
      await app.ready();
      return app;
    });
    // Falha na inicialização (ex.: variável de ambiente ausente): tenta de novo na próxima requisição.
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

export default async function handler(req, res) {
  const app = await getApp();
  app.server.emit("request", req, res);
}
