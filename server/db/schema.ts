import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  ACCESS_RESOURCES,
  ACCESS_SUBJECTS,
  ASSESSMENT_KINDS,
  ATTEMPT_STATUS,
  CONTENT_PROGRESS_STATUS,
  CONTENT_TYPES,
  DELIVERABLE_TYPES,
  FEEDBACK_KINDS,
  FEEDBACK_MODES,
  LEARNER_TRACK_STATUS,
  LEVELS,
  LIBRARY_LICENSES,
  LIBRARY_TYPES,
  PRACTICE_STAGES,
  PUBLICATION_STATUS,
  QUESTION_TYPES,
  REQUEST_STATUS,
  REQUEST_TYPES,
  ROLES,
  SUBMISSION_STATUS,
  TRACK_MODES,
  USER_STATUS,
} from "../../shared/domain.js";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const roleEnum = pgEnum("role", ROLES);
export const userStatusEnum = pgEnum("user_status", USER_STATUS);
export const publicationStatusEnum = pgEnum("publication_status", PUBLICATION_STATUS);
export const trackModeEnum = pgEnum("track_mode", TRACK_MODES);
export const levelEnum = pgEnum("level", LEVELS);
export const contentTypeEnum = pgEnum("content_type", CONTENT_TYPES);
export const learnerTrackStatusEnum = pgEnum("learner_track_status", LEARNER_TRACK_STATUS);
export const contentProgressStatusEnum = pgEnum("content_progress_status", CONTENT_PROGRESS_STATUS);
export const questionTypeEnum = pgEnum("question_type", QUESTION_TYPES);
export const assessmentKindEnum = pgEnum("assessment_kind", ASSESSMENT_KINDS);
export const feedbackModeEnum = pgEnum("feedback_mode", FEEDBACK_MODES);
export const attemptStatusEnum = pgEnum("attempt_status", ATTEMPT_STATUS);
export const practiceStageEnum = pgEnum("practice_stage", PRACTICE_STAGES);
export const deliverableTypeEnum = pgEnum("deliverable_type", DELIVERABLE_TYPES);
export const submissionStatusEnum = pgEnum("submission_status", SUBMISSION_STATUS);
export const accessSubjectEnum = pgEnum("access_subject", ACCESS_SUBJECTS);
export const accessResourceEnum = pgEnum("access_resource", ACCESS_RESOURCES);
export const accessEffectEnum = pgEnum("access_effect", ["allow", "deny"]);
export const enrollmentSourceEnum = pgEnum("enrollment_source", ["admin", "leader", "self", "rule"]);
export const requestTypeEnum = pgEnum("request_type", REQUEST_TYPES);
export const requestStatusEnum = pgEnum("request_status", REQUEST_STATUS);
export const libraryTypeEnum = pgEnum("library_type", LIBRARY_TYPES);
export const libraryLicenseEnum = pgEnum("library_license", LIBRARY_LICENSES);
export const feedbackKindEnum = pgEnum("feedback_kind", FEEDBACK_KINDS);
export const authTokenTypeEnum = pgEnum("auth_token_type", ["invite", "password_reset"]);
export const processingStatusEnum = pgEnum("processing_status", ["pending", "processing", "ready", "failed"]);
export const scanStatusEnum = pgEnum("scan_status", ["pending", "clean", "skipped", "infected", "error"]);
export const noteKindEnum = pgEnum("note_kind", ["note", "doubt"]);
export const validationDecisionEnum = pgEnum("validation_decision", ["approved", "rejected"]);

// ---------------------------------------------------------------------------
// Organização
// ---------------------------------------------------------------------------
export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: createdAt(),
});

export const jobTitles = pgTable("job_titles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Identificador interno curto, usado na marca d'água (LC-000123). */
    seq: serial("seq").notNull().unique(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: roleEnum("role").notNull().default("collaborator"),
    status: userStatusEnum("status").notNull().default("invited"),
    passwordHash: text("password_hash"),
    passwordChangedAt: ts("password_changed_at"),
    jobTitleId: uuid("job_title_id").references(() => jobTitles.id, { onDelete: "set null" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    mfaSecretEnc: text("mfa_secret_enc"),
    mfaPendingSecretEnc: text("mfa_pending_secret_enc"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaEnabledAt: ts("mfa_enabled_at"),
    /** Último passo TOTP aceito: impede reutilizar o mesmo código. */
    mfaLastStep: integer("mfa_last_step"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastLoginAt: ts("last_login_at"),
    lastActivityAt: ts("last_activity_at"),
    onboardingCompletedAt: ts("onboarding_completed_at"),
    preferences: jsonb("preferences").$type<{ emailNotifications?: boolean; theme?: string }>().notNull().default({}),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deactivatedAt: ts("deactivated_at"),
    anonymizedAt: ts("anonymized_at"),
    /** Após ativar o convite, aguarda a liberação do administrador. */
    approvalRequired: boolean("approval_required").notNull().default(false),
    approvedAt: ts("approved_at"),
    approvedBy: uuid("approved_by"),
    /** Desligamento: data e hora em que o acesso é trancado (agendado ou já executado). */
    offboardAt: ts("offboard_at"),
    offboardReason: text("offboard_reason"),
    offboardedBy: uuid("offboarded_by"),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`), index("users_team_idx").on(t.teamId)],
);

export const teamLeaders = pgTable(
  "team_leaders",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

// ---------------------------------------------------------------------------
// Arquitetura educacional: Área → Trilha → Módulo → Conteúdo
// ---------------------------------------------------------------------------
export const knowledgeAreas = pgTable("knowledge_areas", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  code: text("code"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  icon: text("icon").notNull().default("BookOpen"),
  color: text("color").notNull().default("#F36B22"),
  sortOrder: integer("sort_order").notNull().default(0),
  isVisible: boolean("is_visible").notNull().default(true),
  /** Configurações por área: palavras por minuto, nota mínima padrão etc. */
  settings: jsonb("settings").$type<{ wordsPerMinute?: number; passingScore?: number; commentsEnabled?: boolean }>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Escopo do líder: áreas pelas quais responde (e se pode editar/publicar nelas). */
export const leaderAreas = pgTable(
  "leader_areas",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    areaId: uuid("area_id")
      .notNull()
      .references(() => knowledgeAreas.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.areaId] })],
);

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  storageKey: text("storage_key").notNull().unique(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  purpose: text("purpose").notNull(),
  scanStatus: scanStatusEnum("scan_status").notNull().default("pending"),
  scanDetail: text("scan_detail"),
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    areaId: uuid("area_id")
      .notNull()
      .references(() => knowledgeAreas.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    description: text("description").notNull().default(""),
    objectives: text("objectives").notNull().default(""),
    prerequisitesText: text("prerequisites_text").notNull().default(""),
    specialty: text("specialty").notNull().default(""),
    level: levelEnum("level").notNull().default("basico"),
    mode: trackModeEnum("mode").notNull().default("opcional"),
    dependsOnTrackId: uuid("depends_on_track_id").references((): AnyPgColumn => tracks.id, { onDelete: "set null" }),
    estimatedMinutesOverride: integer("estimated_minutes_override"),
    coverFileId: uuid("cover_file_id").references(() => files.id, { onDelete: "set null" }),
    coverColor: text("cover_color"),
    status: publicationStatusEnum("status").notNull().default("draft"),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Sobrescreve a configuração global de catálogo: 'locked' | 'hidden'. */
    lockedVisibility: text("locked_visibility"),
    requiresLeaderValidation: boolean("requires_leader_validation").notNull().default(false),
    certificateEnabled: boolean("certificate_enabled").notNull().default(false),
    commentsEnabled: boolean("comments_enabled").notNull().default(true),
    isRampUp: boolean("is_ramp_up").notNull().default(false),
    rampDays: integer("ramp_days"),
    ownerName: text("owner_name").notNull().default(""),
    version: integer("version").notNull().default(1),
    publishedAt: ts("published_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tracks_area_idx").on(t.areaId)],
);

/** Cargos aos quais a trilha é recomendada (filtro do catálogo e "Minha jornada"). */
export const trackJobTitles = pgTable(
  "track_job_titles",
  {
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    jobTitleId: uuid("job_title_id")
      .notNull()
      .references(() => jobTitles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.trackId, t.jobTitleId] })],
);

export const modules = pgTable(
  "modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    code: text("code"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    objectives: text("objectives").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    status: publicationStatusEnum("status").notNull().default("draft"),
    /** Só libera depois que o módulo anterior estiver concluído. */
    requiresPrevious: boolean("requires_previous").notNull().default(false),
    estimatedMinutesOverride: integer("estimated_minutes_override"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("modules_track_idx").on(t.trackId)],
);

export const contents = pgTable(
  "contents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    type: contentTypeEnum("type").notNull().default("document"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    learningObjective: text("learning_objective").notNull().default(""),
    level: levelEnum("level"),
    ownerName: text("owner_name").notNull().default(""),
    isRequired: boolean("is_required").notNull().default(true),
    allowDownload: boolean("allow_download").notNull().default(false),
    allowTextMode: boolean("allow_text_mode"),
    commentsEnabled: boolean("comments_enabled"),
    status: publicationStatusEnum("status").notNull().default("draft"),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => contentVersions.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    estimatedMinutesOverride: integer("estimated_minutes_override"),
    /** Fator para materiais técnicos, com tabelas ou exercícios (1 = padrão). */
    readingFactor: real("reading_factor").notNull().default(1),
    dependsOnContentId: uuid("depends_on_content_id").references((): AnyPgColumn => contents.id, { onDelete: "set null" }),
    externalUrl: text("external_url"),
    bodyText: text("body_text"),
    publishedAt: ts("published_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contents_module_idx").on(t.moduleId)],
);

export const contentVersions = pgTable(
  "content_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentId: uuid("content_id")
      .notNull()
      .references((): AnyPgColumn => contents.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    sourceFileId: uuid("source_file_id").references(() => files.id, { onDelete: "set null" }),
    pageCount: integer("page_count").notNull().default(0),
    wordCount: integer("word_count").notNull().default(0),
    outline: jsonb("outline").$type<{ title: string; page: number; level: number }[]>().notNull().default([]),
    processingStatus: processingStatusEnum("processing_status").notNull().default("pending"),
    processingError: text("processing_error"),
    changeNotes: text("change_notes").notNull().default(""),
    isMajor: boolean("is_major").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    publishedAt: ts("published_at"),
  },
  (t) => [uniqueIndex("content_versions_number_unique").on(t.contentId, t.versionNumber)],
);

export const documentPages = pgTable(
  "document_pages",
  {
    versionId: uuid("version_id")
      .notNull()
      .references(() => contentVersions.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    imageKey: text("image_key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    text: text("text").notNull().default(""),
    wordCount: integer("word_count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.pageNumber] })],
);

// ---------------------------------------------------------------------------
// Acesso e matrículas
// ---------------------------------------------------------------------------
export const accessRules = pgTable(
  "access_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectType: accessSubjectEnum("subject_type").notNull(),
    /** uuid do usuário/equipe/departamento/cargo, ou nome do perfil; nulo para "everyone". */
    subjectId: text("subject_id"),
    resourceType: accessResourceEnum("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    effect: accessEffectEnum("effect").notNull().default("allow"),
    note: text("note").notNull().default(""),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("access_rules_resource_idx").on(t.resourceType, t.resourceId),
    index("access_rules_subject_idx").on(t.subjectType, t.subjectId),
  ],
);

export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    source: enrollmentSourceEnum("source").notNull().default("self"),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    isMandatory: boolean("is_mandatory").notNull().default(false),
    dueDate: ts("due_date"),
    status: learnerTrackStatusEnum("status").notNull().default("not_started"),
    progressPercent: integer("progress_percent").notNull().default(0),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    lastActivityAt: ts("last_activity_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("enrollments_user_track_unique").on(t.userId, t.trackId), index("enrollments_track_idx").on(t.trackId)],
);

// ---------------------------------------------------------------------------
// Leitura, progresso e anotações
// ---------------------------------------------------------------------------
export const contentProgress = pgTable(
  "content_progress",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => contentVersions.id, { onDelete: "set null" }),
    status: contentProgressStatusEnum("status").notNull().default("not_started"),
    lastPage: integer("last_page").notNull().default(1),
    pagesRead: jsonb("pages_read").$type<number[]>().notNull().default([]),
    percent: integer("percent").notNull().default(0),
    activeSeconds: integer("active_seconds").notNull().default(0),
    viewSeconds: integer("view_seconds").notNull().default(0),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.contentId] })],
);

export const readingSessions = pgTable(
  "reading_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => contentVersions.id, { onDelete: "set null" }),
    startedAt: ts("started_at").notNull().defaultNow(),
    lastHeartbeatAt: ts("last_heartbeat_at").notNull().defaultNow(),
    endedAt: ts("ended_at"),
    activeSeconds: integer("active_seconds").notNull().default(0),
    viewSeconds: integer("view_seconds").notNull().default(0),
    pagesViewed: integer("pages_viewed").notNull().default(0),
  },
  (t) => [index("reading_sessions_user_idx").on(t.userId, t.contentId)],
);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number"),
    quote: text("quote"),
    body: text("body").notNull(),
    kind: noteKindEnum("kind").notNull().default("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("notes_user_idx").on(t.userId, t.contentId)],
);

export const bookmarks = pgTable(
  "bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    label: text("label").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("bookmarks_unique").on(t.userId, t.contentId, t.pageNumber)],
);

export const highlights = pgTable(
  "highlights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => contentVersions.id, { onDelete: "set null" }),
    pageNumber: integer("page_number").notNull(),
    quote: text("quote").notNull(),
    color: text("color").notNull().default("yellow"),
    createdAt: createdAt(),
  },
  (t) => [index("highlights_user_idx").on(t.userId, t.contentId)],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number"),
    body: text("body").notNull(),
    isHidden: boolean("is_hidden").notNull().default(false),
    hiddenBy: uuid("hidden_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("comments_content_idx").on(t.contentId)],
);

// ---------------------------------------------------------------------------
// Avaliações
// ---------------------------------------------------------------------------
export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    /** Nulo = avaliação final da trilha. */
    moduleId: uuid("module_id").references(() => modules.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    kind: assessmentKindEnum("kind").notNull().default("fixation"),
    passingScore: integer("passing_score").notNull().default(80),
    maxAttempts: integer("max_attempts"),
    timeLimitMinutes: integer("time_limit_minutes"),
    questionCount: integer("question_count"),
    shuffleQuestions: boolean("shuffle_questions").notNull().default(true),
    feedbackMode: feedbackModeEnum("feedback_mode").notNull().default("after_submit"),
    isRequired: boolean("is_required").notNull().default(true),
    requiresPassToAdvance: boolean("requires_pass_to_advance").notNull().default(true),
    requiresLeaderValidation: boolean("requires_leader_validation").notNull().default(false),
    status: publicationStatusEnum("status").notNull().default("draft"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("assessments_track_idx").on(t.trackId)],
);

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    type: questionTypeEnum("type").notNull(),
    prompt: text("prompt").notNull(),
    context: text("context").notNull().default(""),
    /** Estrutura apresentada ao colaborador (alternativas, itens, pares). */
    options: jsonb("options").$type<Record<string, unknown>>().notNull().default({}),
    /** Gabarito: nunca é enviado ao navegador antes do envio da tentativa. */
    answerKey: jsonb("answer_key").$type<Record<string, unknown>>().notNull().default({}),
    explanation: text("explanation").notNull().default(""),
    points: integer("points").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("questions_assessment_idx").on(t.assessmentId)],
);

export const attempts = pgTable(
  "attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: attemptStatusEnum("status").notNull().default("in_progress"),
    questionIds: jsonb("question_ids").$type<string[]>().notNull().default([]),
    startedAt: ts("started_at").notNull().defaultNow(),
    expiresAt: ts("expires_at"),
    submittedAt: ts("submitted_at"),
    score: real("score"),
    passed: boolean("passed"),
    gradedBy: uuid("graded_by").references(() => users.id, { onDelete: "set null" }),
    gradedAt: ts("graded_at"),
    feedback: text("feedback"),
  },
  (t) => [index("attempts_user_idx").on(t.userId, t.assessmentId)],
);

export const answers = pgTable(
  "answers",
  {
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    response: jsonb("response").$type<unknown>(),
    isCorrect: boolean("is_correct"),
    pointsAwarded: real("points_awarded"),
    maxPoints: real("max_points").notNull().default(1),
    reviewerComment: text("reviewer_comment"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: ts("reviewed_at"),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.questionId] })],
);

// ---------------------------------------------------------------------------
// Da teoria à prática
// ---------------------------------------------------------------------------
export const practicalActivities = pgTable(
  "practical_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    instructions: text("instructions").notNull().default(""),
    stage: practiceStageEnum("stage").notNull().default("demonstrate"),
    deliverable: deliverableTypeEnum("deliverable").notNull().default("text"),
    competency: text("competency").notNull().default(""),
    requiresValidation: boolean("requires_validation").notNull().default(true),
    isRequired: boolean("is_required").notNull().default(true),
    status: publicationStatusEnum("status").notNull().default("draft"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("practical_module_idx").on(t.moduleId)],
);

export const practicalSubmissions = pgTable(
  "practical_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => practicalActivities.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull().default(1),
    body: text("body").notNull().default(""),
    link: text("link"),
    status: submissionStatusEnum("status").notNull().default("submitted"),
    submittedAt: ts("submitted_at").notNull().defaultNow(),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: ts("reviewed_at"),
    reviewerComment: text("reviewer_comment"),
  },
  (t) => [index("practical_submissions_user_idx").on(t.activityId, t.userId)],
);

/** Validação de competência / conclusão da trilha pelo líder. */
export const trackValidations = pgTable(
  "track_validations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    decision: validationDecisionEnum("decision").notNull(),
    comment: text("comment").notNull().default(""),
    validatedBy: uuid("validated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("track_validations_user_idx").on(t.userId, t.trackId)],
);

export const feedbacks = pgTable(
  "feedbacks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    trackId: uuid("track_id").references(() => tracks.id, { onDelete: "set null" }),
    kind: feedbackKindEnum("kind").notNull().default("feedback"),
    body: text("body").notNull(),
    /** Recomendação: { type: 'track' | 'content' | 'library', id } */
    reference: jsonb("reference").$type<{ type: string; id: string; title?: string } | null>(),
    createdAt: createdAt(),
  },
  (t) => [index("feedbacks_user_idx").on(t.userId)],
);

export const requests = pgTable("requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: requestTypeEnum("type").notNull(),
  requesterId: uuid("requester_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  resourceType: accessResourceEnum("resource_type"),
  resourceId: uuid("resource_id"),
  areaId: uuid("area_id").references(() => knowledgeAreas.id, { onDelete: "set null" }),
  title: text("title").notNull().default(""),
  message: text("message").notNull().default(""),
  status: requestStatusEnum("status").notNull().default("open"),
  resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
  resolvedAt: ts("resolved_at"),
  resolutionNote: text("resolution_note"),
  createdAt: createdAt(),
});

export const certificates = pgTable(
  "certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    code: text("code").notNull().unique(),
    issuedAt: ts("issued_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("certificates_user_track_unique").on(t.userId, t.trackId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link"),
    dedupeKey: text("dedupe_key"),
    readAt: ts("read_at"),
    emailedAt: ts("emailed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("notifications_dedupe_unique").on(t.userId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
  ],
);

export const libraryItems = pgTable("library_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  author: text("author").notNull().default(""),
  category: text("category").notNull().default(""),
  theme: text("theme").notNull().default(""),
  description: text("description").notNull().default(""),
  level: levelEnum("level").notNull().default("basico"),
  estimatedMinutes: integer("estimated_minutes"),
  type: libraryTypeEnum("type").notNull().default("book"),
  license: libraryLicenseEnum("license").notNull().default("external_only"),
  coverFileId: uuid("cover_file_id").references(() => files.id, { onDelete: "set null" }),
  coverColor: text("cover_color"),
  externalUrl: text("external_url"),
  fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
  allowDownload: boolean("allow_download").notNull().default(false),
  areaId: uuid("area_id").references(() => knowledgeAreas.id, { onDelete: "set null" }),
  status: publicationStatusEnum("status").notNull().default("published"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Termos, autenticação e sessões
// ---------------------------------------------------------------------------
export const termsVersions = pgTable("terms_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: text("version").notNull().unique(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
  publishedAt: ts("published_at").notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
});

export const termsAcceptances = pgTable(
  "terms_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    termsVersionId: uuid("terms_version_id")
      .notNull()
      .references(() => termsVersions.id, { onDelete: "restrict" }),
    acceptedAt: ts("accepted_at").notNull().defaultNow(),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
  },
  (t) => [uniqueIndex("terms_acceptances_unique").on(t.userId, t.termsVersionId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    csrfToken: text("csrf_token").notNull(),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    idleExpiresAt: ts("idle_expires_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    mfaVerifiedAt: ts("mfa_verified_at"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    revokedAt: ts("revoked_at"),
    revokedReason: text("revoked_reason"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: authTokenTypeEnum("type").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const mfaRecoveryCodes = pgTable("mfa_recovery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

export const passwordHistory = pgTable("password_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hash: text("hash").notNull(),
  createdAt: createdAt(),
});

/** Trilha de auditoria (somente inserção; ver migração com gatilhos de proteção). */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    actorId: uuid("actor_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    outcome: text("outcome").notNull().default("success"),
    targetType: text("target_type"),
    targetId: text("target_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("audit_logs_at_idx").on(t.at), index("audit_logs_actor_idx").on(t.actorId), index("audit_logs_action_idx").on(t.action)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: updatedAt(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

/** Histórico de alterações de áreas, trilhas, módulos, conteúdos e avaliações. */
export const entityRevisions = pgTable(
  "entity_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    changedAt: ts("changed_at").notNull().defaultNow(),
  },
  (t) => [index("entity_revisions_entity_idx").on(t.entityType, t.entityId)],
);
