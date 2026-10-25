// Vocabulário do domínio compartilhado entre servidor e front-end.
// Valores (chaves) ficam em inglês/minúsculas para o banco; rótulos em português para a interface.

export const ROLES = ["admin", "leader", "collaborator"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador geral",
  leader: "Líder de área",
  collaborator: "Colaborador",
};

export const USER_STATUS = ["invited", "active", "inactive"] as const;
export type UserStatus = (typeof USER_STATUS)[number];
export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  invited: "Convidado",
  active: "Ativo",
  inactive: "Desativado",
};

export const PUBLICATION_STATUS = ["draft", "review", "published", "archived"] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUS)[number];
export const PUBLICATION_STATUS_LABEL: Record<PublicationStatus, string> = {
  draft: "Rascunho",
  review: "Em revisão",
  published: "Publicado",
  archived: "Arquivado",
};

export const TRACK_MODES = ["obrigatoria", "opcional", "livre", "dependente"] as const;
export type TrackMode = (typeof TRACK_MODES)[number];
export const TRACK_MODE_LABEL: Record<TrackMode, string> = {
  obrigatoria: "Obrigatória",
  opcional: "Opcional",
  livre: "Livre",
  dependente: "Dependente de etapa anterior",
};

export const LEVELS = ["basico", "intermediario", "avancado"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABEL: Record<Level, string> = {
  basico: "Básico",
  intermediario: "Intermediário",
  avancado: "Avançado",
};

export const CONTENT_TYPES = ["document", "video", "audio", "link", "text"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  document: "Apostila (PDF)",
  video: "Vídeo",
  audio: "Áudio",
  link: "Link externo",
  text: "Texto",
};

export const LEARNER_TRACK_STATUS = [
  "not_started",
  "in_progress",
  "pending_assessment",
  "pending_validation",
  "completed",
  "needs_revision",
] as const;
export type LearnerTrackStatus = (typeof LEARNER_TRACK_STATUS)[number];
export const LEARNER_TRACK_STATUS_LABEL: Record<LearnerTrackStatus, string> = {
  not_started: "Não iniciada",
  in_progress: "Em andamento",
  pending_assessment: "Pendente de avaliação",
  pending_validation: "Aguardando validação prática",
  completed: "Concluída",
  needs_revision: "Reprovada ou necessita revisão",
};

export const CONTENT_PROGRESS_STATUS = ["not_started", "in_progress", "completed"] as const;
export type ContentProgressStatus = (typeof CONTENT_PROGRESS_STATUS)[number];

export const QUESTION_TYPES = [
  "single_choice",
  "multiple_choice",
  "true_false",
  "matching",
  "ordering",
  "numeric",
  "essay",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  single_choice: "Múltipla escolha (uma resposta)",
  multiple_choice: "Múltipla escolha (várias respostas)",
  true_false: "Verdadeiro ou falso",
  matching: "Associação de conceitos",
  ordering: "Ordenação de etapas",
  numeric: "Exercício de cálculo",
  essay: "Resposta discursiva / estudo de caso",
};

export const ASSESSMENT_KINDS = ["fixation", "final", "case_study", "simulation"] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];
export const ASSESSMENT_KIND_LABEL: Record<AssessmentKind, string> = {
  fixation: "Exercícios de fixação",
  final: "Avaliação final",
  case_study: "Estudo de caso",
  simulation: "Simulação",
};

export const FEEDBACK_MODES = ["after_submit", "score_only"] as const;
export type FeedbackMode = (typeof FEEDBACK_MODES)[number];
export const FEEDBACK_MODE_LABEL: Record<FeedbackMode, string> = {
  after_submit: "Mostrar correção e explicações após o envio",
  score_only: "Mostrar apenas a nota",
};

export const ATTEMPT_STATUS = ["in_progress", "pending_review", "graded"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUS)[number];

export const PRACTICE_STAGES = ["demonstrate", "execute"] as const;
export type PracticeStage = (typeof PRACTICE_STAGES)[number];
export const PRACTICE_STAGE_LABEL: Record<PracticeStage, string> = {
  demonstrate: "Demonstre (simulação ou estudo de caso)",
  execute: "Execute (atividade profissional acompanhada)",
};

export const DELIVERABLE_TYPES = ["text", "link"] as const;
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];

export const SUBMISSION_STATUS = ["submitted", "approved", "rejected", "returned"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUS)[number];
export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  submitted: "Aguardando avaliação",
  approved: "Aprovada",
  rejected: "Reprovada",
  returned: "Devolvida para ajustes",
};

export const ACCESS_SUBJECTS = ["user", "team", "department", "job_title", "role", "everyone"] as const;
export type AccessSubject = (typeof ACCESS_SUBJECTS)[number];
export const ACCESS_SUBJECT_LABEL: Record<AccessSubject, string> = {
  user: "Usuário",
  team: "Equipe",
  department: "Departamento",
  job_title: "Cargo",
  role: "Perfil",
  everyone: "Todos os usuários ativos",
};

export const ACCESS_RESOURCES = ["area", "track", "module", "content"] as const;
export type AccessResource = (typeof ACCESS_RESOURCES)[number];
export const ACCESS_RESOURCE_LABEL: Record<AccessResource, string> = {
  area: "Área",
  track: "Trilha",
  module: "Módulo",
  content: "Conteúdo",
};

export const REQUEST_TYPES = ["access", "content_suggestion", "content_creation"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  access: "Solicitação de acesso",
  content_suggestion: "Sugestão de conteúdo",
  content_creation: "Pedido de elaboração de conteúdo",
};
export const REQUEST_STATUS = ["open", "approved", "rejected", "closed"] as const;
export type RequestStatus = (typeof REQUEST_STATUS)[number];
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  open: "Aberta",
  approved: "Aprovada",
  rejected: "Recusada",
  closed: "Encerrada",
};

export const LIBRARY_TYPES = ["book", "article", "ebook", "publication", "video", "podcast", "link"] as const;
export type LibraryType = (typeof LIBRARY_TYPES)[number];
export const LIBRARY_TYPE_LABEL: Record<LibraryType, string> = {
  book: "Livro",
  article: "Artigo",
  ebook: "E-book",
  publication: "Publicação técnica",
  video: "Vídeo",
  podcast: "Podcast",
  link: "Link externo",
};
export const LIBRARY_LICENSES = ["own", "licensed", "open", "external_only"] as const;
export type LibraryLicense = (typeof LIBRARY_LICENSES)[number];
export const LIBRARY_LICENSE_LABEL: Record<LibraryLicense, string> = {
  own: "Conteúdo próprio",
  licensed: "Licenciado para distribuição interna",
  open: "Licença aberta compatível",
  external_only: "Somente indicação (sem cópia hospedada)",
};

export const FEEDBACK_KINDS = ["feedback", "recommendation", "development_plan"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  feedback: "Feedback",
  recommendation: "Recomendação de conteúdo",
  development_plan: "Plano de desenvolvimento",
};

export const NOTIFICATION_TYPES = [
  "track_assigned",
  "content_published",
  "deadline_near",
  "deadline_overdue",
  "assessment_available",
  "assessment_graded",
  "leader_feedback",
  "certificate_available",
  "content_updated",
  "submission_reviewed",
  "request_resolved",
  "comment_reply",
  "validation_pending",
  "request_received",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  track_assigned: "Nova trilha atribuída",
  content_published: "Novo conteúdo disponível",
  deadline_near: "Prazo próximo",
  deadline_overdue: "Treinamento atrasado",
  assessment_available: "Avaliação liberada",
  assessment_graded: "Avaliação concluída",
  leader_feedback: "Feedback do líder",
  certificate_available: "Certificado disponível",
  content_updated: "Atualização de apostila obrigatória",
  submission_reviewed: "Atividade prática avaliada",
  request_resolved: "Solicitação respondida",
  comment_reply: "Resposta à sua dúvida",
  validation_pending: "Atividade aguardando validação",
  request_received: "Nova solicitação recebida",
};

export function userCode(seq: number): string {
  return `LC-${String(seq).padStart(6, "0")}`;
}
