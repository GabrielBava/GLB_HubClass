import { loadConfig } from "../config.js";
import { openDatabase } from "../db/client.js";
import { SettingsService } from "../services/settings.js";
import { applyRetention } from "../services/maintenance.js";

const config = loadConfig();
const database = await openDatabase({ databaseUrl: config.databaseUrl, embeddedDir: config.embeddedDbDir });
await database.migrate();
const privacy = await new SettingsService(database.db).get("privacy");
const result = await applyRetention(database.db, privacy);
console.log("Retenção aplicada:", result);
await database.close();
