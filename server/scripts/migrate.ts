import { openDatabase } from "../db/client.js";
import { loadConfig } from "../config.js";

const config = loadConfig();
const database = await openDatabase({ databaseUrl: config.databaseUrl, embeddedDir: config.embeddedDbDir });
await database.migrate();
console.log(`Migrações aplicadas (${database.kind === "postgres" ? "PostgreSQL" : "banco embutido"}).`);
await database.close();
