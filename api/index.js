// Função da Vercel: atende todas as rotas /api/* com o mesmo servidor Fastify da aplicação.
// O servidor é compilado em dist/server durante o build (npm run vercel-build) e reaproveitado
// entre requisições enquanto a instância estiver ativa.

// Uma promessa rejeitada sem tratamento não pode derrubar a instância (na Vercel, isso vira
// "A server error has occurred"): registra o erro, que aparece no filtro "Error" da aba Logs.
process.on("unhandledRejection", (reason) => {
  console.error("Erro não tratado na API:", reason);
});

let ready = null;

function getApp() {
  if (!ready) {
    ready = (async () => {
      // Importação dinâmica: uma falha ao carregar o servidor vira resposta legível, não queda da função.
      const [{ buildApp }, { loadConfig }] = await Promise.all([import("../dist/server/server/app.js"), import("../dist/server/server/config.js")]);
      let config;
      try {
        config = loadConfig();
      } catch (err) {
        // Configuração incompleta (ex.: banco não conectado, APP_SECRET ausente): a mensagem não contém segredos.
        throw Object.assign(new Error(err.message), { configError: true });
      }
      const app = await buildApp(config);
      await app.ready();
      return app;
    })();
    // Falha na inicialização: tenta de novo na próxima requisição.
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

export default async function handler(req, res) {
  let app;
  try {
    app = await getApp();
  } catch (err) {
    console.error("Falha ao iniciar a API:", err);
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const message = err.configError
      ? `A plataforma ainda não está configurada: ${err.message} Depois de ajustar, publique de novo (Deployments › Redeploy).`
      : `A plataforma não conseguiu iniciar: ${String(err?.message ?? err).split("\n")[0]} Veja os detalhes na aba Logs da Vercel (filtro Error).`;
    res.end(JSON.stringify({ error: { code: "not_configured", message } }));
    return;
  }
  app.server.emit("request", req, res);
}
