// Parâmetros configuráveis pelo administrador (tabela `settings`).
// Cada grupo tem valores padrão; o servidor mescla o que está salvo sobre estes padrões.

export type ThemeMode = "light" | "dark" | "system";

export interface BrandingSettings {
  platformName: string;
  organizationName: string;
  tagline: string;
  loginMessage: string;
  /** Arquivo de logotipo enviado pelo administrador (PNG/JPEG/WebP). */
  logoFileId: string | null;
  colors: {
    /** Cor de destaque (botões, links, progresso). Hex #RRGGBB. */
    primary: string;
    /** Cor do painel institucional das telas de acesso. */
    brandSurface: string;
    /** Cor secundária para detalhes e gradientes. */
    accent: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  defaultMode: ThemeMode;
}

export interface CatalogSettings {
  /** Como conteúdos sem autorização aparecem no catálogo. */
  lockedVisibility: "locked" | "hidden";
  allowAccessRequests: boolean;
}

export interface ReadingSettings {
  wordsPerMinute: number;
  /** Usado quando o PDF não tem texto extraível (ex.: digitalizado). */
  minutesPerPageFallback: number;
  /** Tempo mínimo de leitura ativa para considerar uma página lida. */
  minPageSeconds: number;
  /** Percentual de páginas lidas para concluir a apostila. */
  completionThreshold: number;
  /** Sem interação por este tempo, o leitor para de contar tempo ativo. */
  idleSeconds: number;
  allowTextModeDefault: boolean;
}

export interface AssessmentSettings {
  defaultPassingScore: number;
  defaultMaxAttempts: number | null;
}

export interface SecuritySettings {
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
  maxFailedLogins: number;
  lockoutMinutes: number;
  passwordMinLength: number;
  inviteExpiryHours: number;
  resetExpiryMinutes: number;
  pageRequestsPerMinute: number;
  maxUploadMb: number;
}

export interface NotificationSettings {
  emailEnabled: boolean;
  /** Tipos que também geram e-mail (quando o SMTP estiver configurado). */
  emailTypes: string[];
  deadlineReminderDays: number;
}

export interface PrivacySettings {
  auditRetentionDays: number;
  readingSessionRetentionDays: number;
  notificationRetentionDays: number;
  dataProtectionContact: string;
}

export interface CommunitySettings {
  commentsEnabledDefault: boolean;
}

export interface OnboardingSettings {
  welcomeMessage: string;
  supportContact: string;
}

export interface AllSettings {
  branding: BrandingSettings;
  catalog: CatalogSettings;
  reading: ReadingSettings;
  assessment: AssessmentSettings;
  security: SecuritySettings;
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  community: CommunitySettings;
  onboarding: OnboardingSettings;
}

export type SettingsKey = keyof AllSettings;

export const DEFAULT_SETTINGS: AllSettings = {
  branding: {
    platformName: "LIFE CLASS",
    organizationName: "Grupo Life Brasil",
    tagline: "Universidade corporativa do Grupo Life Brasil. Aprender, praticar e executar.",
    loginMessage: "Acesse seu ambiente de aprendizado e desenvolvimento.",
    logoFileId: null,
    colors: {
      primary: "#1FB873",
      brandSurface: "#0B1210",
      accent: "#0E6B4A",
    },
    fonts: {
      heading: "Bricolage Grotesque",
      body: "Inter",
    },
    defaultMode: "light",
  },
  catalog: {
    lockedVisibility: "locked",
    allowAccessRequests: true,
  },
  reading: {
    wordsPerMinute: 200,
    minutesPerPageFallback: 2,
    minPageSeconds: 6,
    completionThreshold: 90,
    idleSeconds: 120,
    allowTextModeDefault: true,
  },
  assessment: {
    defaultPassingScore: 80,
    defaultMaxAttempts: 3,
  },
  security: {
    sessionIdleMinutes: 60,
    sessionAbsoluteHours: 12,
    maxFailedLogins: 5,
    lockoutMinutes: 15,
    passwordMinLength: 10,
    inviteExpiryHours: 72,
    resetExpiryMinutes: 60,
    pageRequestsPerMinute: 90,
    maxUploadMb: 80,
  },
  notifications: {
    emailEnabled: false,
    emailTypes: ["track_assigned", "deadline_overdue", "assessment_graded", "leader_feedback", "content_updated"],
    deadlineReminderDays: 3,
  },
  privacy: {
    auditRetentionDays: 730,
    readingSessionRetentionDays: 365,
    notificationRetentionDays: 180,
    dataProtectionContact: "privacidade@exemplo.com.br",
  },
  community: {
    commentsEnabledDefault: true,
  },
  onboarding: {
    welcomeMessage:
      "Bem-vindo ao LIFE CLASS! Este é o seu ambiente de aprendizado e desenvolvimento dentro do Grupo Life Brasil. Aqui você encontrará o conhecimento, as metodologias e as ferramentas para evoluir profissionalmente e transformar aprendizado em resultados.",
    supportContact: "suporte.lifeclass@exemplo.com.br",
  },
};

/** Fontes disponíveis no seletor de identidade visual (carregadas do Google Fonts). */
export const FONT_CHOICES = [
  "Inter",
  "Bricolage Grotesque",
  "Geist",
  "Manrope",
  "Plus Jakarta Sans",
  "DM Sans",
  "Sora",
  "Montserrat",
  "Poppins",
  "Source Sans 3",
  "Lato",
  "Fraunces",
] as const;
