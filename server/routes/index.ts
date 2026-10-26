import type { FastifyInstance } from "fastify";
import { accountRoutes } from "./account.js";
import { activityRoutes } from "./activities.js";
import { assessmentRoutes } from "./assessments.js";
import { authRoutes } from "./auth.js";
import { catalogRoutes } from "./catalog.js";
import { communityRoutes } from "./community.js";
import { dashboardRoutes } from "./dashboard.js";
import { leaderRoutes } from "./leader.js";
import { notesRoutes } from "./notes.js";
import { platformRoutes } from "./platform.js";
import { publicRoutes } from "./public.js";
import { readerRoutes } from "./reader.js";
import { adminAccessRoutes } from "./admin/access.js";
import { adminAssessmentRoutes } from "./admin/assessments.js";
import { adminContentRoutes } from "./admin/content.js";
import { adminOverviewRoutes } from "./admin/overview.js";
import { adminReportRoutes } from "./admin/reports.js";
import { adminSettingsRoutes } from "./admin/settings.js";
import { adminUserRoutes } from "./admin/users.js";

export async function registerRoutes(app: FastifyInstance) {
  for (const plugin of [
    publicRoutes,
    platformRoutes,
    authRoutes,
    accountRoutes,
    dashboardRoutes,
    catalogRoutes,
    readerRoutes,
    notesRoutes,
    assessmentRoutes,
    activityRoutes,
    communityRoutes,
    leaderRoutes,
    adminOverviewRoutes,
    adminUserRoutes,
    adminContentRoutes,
    adminAssessmentRoutes,
    adminAccessRoutes,
    adminReportRoutes,
    adminSettingsRoutes,
  ]) {
    await plugin(app);
  }
}
