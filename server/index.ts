import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { startMaintenance } from "./services/maintenance.js";

const config = loadConfig();
const app = await buildApp(config);
startMaintenance(app);

const shutdown = async (signal: string) => {
  app.log.info(`${signal} recebido, encerrando...`);
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.host, port: config.port });
