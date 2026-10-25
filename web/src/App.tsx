import { lazy, Suspense, type ComponentType } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import type { Role } from "../../shared/domain";
import { AppShell } from "./components/AppShell";
import { PageLoader } from "./components/ui";
import { useAuth } from "./lib/auth";
import { AccessDeniedPage, NotFoundPage } from "./pages/Errors";
import { LoginPage } from "./pages/auth/Login";
import { MfaSetupPage, MfaVerifyPage } from "./pages/auth/Mfa";
import { AcceptInvitePage, FirstAccessManualPage, ForgotPasswordPage, ResetPasswordPage } from "./pages/auth/Recovery";
import { OnboardingPage } from "./pages/learner/Onboarding";
import { DashboardPage } from "./pages/learner/Dashboard";
import { AreasPage, CatalogPage } from "./pages/learner/Catalog";
import { ModulePage, TrackPage } from "./pages/learner/Track";
import { ReaderPage } from "./pages/learner/Reader";
import { AssessmentPage, AttemptPage } from "./pages/learner/Assessment";
import { ActivityPage } from "./pages/learner/Activity";
import { NotesPage } from "./pages/learner/Notes";
import { CertificatePage, ProgressPage } from "./pages/learner/Progress";
import { LibraryPage } from "./pages/learner/Library";
import { HelpPage, NotificationsPage, ProfilePage } from "./pages/learner/Misc";

// Áreas de liderança e administração são carregadas sob demanda (menos código para o colaborador).
const lazyPage = <M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) =>
  lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
const LeaderDashboardPage = lazyPage(() => import("./pages/leader/LeaderDashboard"), "LeaderDashboardPage");
const MemberPage = lazyPage(() => import("./pages/leader/LeaderDashboard"), "MemberPage");
const ValidationsPage = lazyPage(() => import("./pages/leader/Validations"), "ValidationsPage");
const GradeAttemptPage = lazyPage(() => import("./pages/leader/Validations"), "GradeAttemptPage");
const RequestsPage = lazyPage(() => import("./pages/leader/Requests"), "RequestsPage");
const LeaderQuestionsPage = lazyPage(() => import("./pages/leader/Requests"), "LeaderQuestionsPage");
const AdminHomePage = lazyPage(() => import("./pages/admin/AdminHome"), "AdminHomePage");
const UsersPage = lazyPage(() => import("./pages/admin/Users"), "UsersPage");
const UserDetailPage = lazyPage(() => import("./pages/admin/Users"), "UserDetailPage");
const OrganizationPage = lazyPage(() => import("./pages/admin/Organization"), "OrganizationPage");
const ContentTreePage = lazyPage(() => import("./pages/admin/ContentTree"), "ContentTreePage");
const TrackEditorPage = lazyPage(() => import("./pages/admin/TrackEditor"), "TrackEditorPage");
const ContentEditorPage = lazyPage(() => import("./pages/admin/ContentEditor"), "ContentEditorPage");
const AssessmentEditorPage = lazyPage(() => import("./pages/admin/AssessmentEditor"), "AssessmentEditorPage");
const AssessmentResultsPage = lazyPage(() => import("./pages/admin/AssessmentEditor"), "AssessmentResultsPage");
const QuestionBankPage = lazyPage(() => import("./pages/admin/AssessmentEditor"), "QuestionBankPage");
const PermissionsPage = lazyPage(() => import("./pages/admin/Permissions"), "PermissionsPage");
const ReportsPage = lazyPage(() => import("./pages/admin/Reports"), "ReportsPage");
const AuditPage = lazyPage(() => import("./pages/admin/Reports"), "AuditPage");
const SecurityPage = lazyPage(() => import("./pages/admin/Security"), "SecurityPage");
const SettingsPage = lazyPage(() => import("./pages/admin/Settings"), "SettingsPage");
const LibraryAdminPage = lazyPage(() => import("./pages/admin/LibraryAdmin"), "LibraryAdminPage");

function RequireAuth() {
  const { me, loading, expired } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  const next = encodeURIComponent(location.pathname + location.search);
  if (!me) return <Navigate to={`/entrar?next=${next}${expired ? "&expirou=1" : ""}`} replace />;
  if (!me.mfa.satisfied) return <Navigate to={me.mfa.enabled ? `/entrar/verificacao?next=${next}` : `/entrar/configurar-mfa?next=${next}`} replace />;
  if ((!me.onboardingCompleted || !me.termsAccepted) && location.pathname !== "/primeiro-acesso") return <Navigate to="/primeiro-acesso" replace />;
  return <Outlet />;
}

function RequireRole({ roles, contentManager }: { roles: Role[]; contentManager?: boolean }) {
  const { me } = useAuth();
  const allowed = !!me && (roles.includes(me.user.role) || (contentManager && me.canManageContent));
  return allowed ? (
    <Suspense fallback={<PageLoader />}>
      <Outlet />
    </Suspense>
  ) : (
    <AccessDeniedPage />
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route path="/entrar/verificacao" element={<MfaVerifyPage />} />
      <Route path="/entrar/configurar-mfa" element={<MfaSetupPage />} />
      <Route path="/recuperar-acesso" element={<ForgotPasswordPage />} />
      <Route path="/redefinir-senha/:token" element={<ResetPasswordPage />} />
      <Route path="/convite/:token" element={<AcceptInvitePage />} />
      <Route path="/primeiro-acesso/manual" element={<FirstAccessManualPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/primeiro-acesso" element={<OnboardingPage />} />
        <Route path="/conteudos/:id" element={<ReaderPage />} />
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="/areas" element={<AreasPage />} />
          <Route path="/trilhas" element={<CatalogPage />} />
          <Route path="/trilhas/:id" element={<TrackPage />} />
          <Route path="/modulos/:id" element={<ModulePage />} />
          <Route path="/avaliacoes/:id" element={<AssessmentPage />} />
          <Route path="/avaliacoes/:id/tentativas/:attemptId" element={<AttemptPage />} />
          <Route path="/atividades/:id" element={<ActivityPage />} />
          <Route path="/anotacoes" element={<NotesPage />} />
          <Route path="/minha-evolucao" element={<ProgressPage />} />
          <Route path="/certificados/:code" element={<CertificatePage />} />
          <Route path="/biblioteca" element={<LibraryPage />} />
          <Route path="/notificacoes" element={<NotificationsPage />} />
          <Route path="/ajuda" element={<HelpPage />} />
          <Route path="/perfil" element={<ProfilePage />} />
          <Route path="/acesso-negado" element={<AccessDeniedPage />} />

          <Route element={<RequireRole roles={["leader", "admin"]} />}>
            <Route path="/lider" element={<LeaderDashboardPage />} />
            <Route path="/lider/equipe/:id" element={<MemberPage />} />
            <Route path="/lider/validacoes" element={<ValidationsPage />} />
            <Route path="/lider/validacoes/tentativas/:id" element={<GradeAttemptPage />} />
            <Route path="/lider/solicitacoes" element={<RequestsPage />} />
            <Route path="/lider/duvidas" element={<LeaderQuestionsPage />} />
          </Route>

          <Route element={<RequireRole roles={["admin"]} contentManager />}>
            <Route path="/admin/conteudos" element={<ContentTreePage />} />
            <Route path="/admin/trilhas/:id" element={<TrackEditorPage />} />
            <Route path="/admin/conteudos/:id" element={<ContentEditorPage />} />
            <Route path="/admin/avaliacoes/:id" element={<AssessmentEditorPage />} />
            <Route path="/admin/avaliacoes/:id/resultados" element={<AssessmentResultsPage />} />
            <Route path="/admin/questoes" element={<QuestionBankPage />} />
          </Route>

          <Route element={<RequireRole roles={["admin"]} />}>
            <Route path="/admin" element={<AdminHomePage />} />
            <Route path="/admin/usuarios" element={<UsersPage />} />
            <Route path="/admin/usuarios/:id" element={<UserDetailPage />} />
            <Route path="/admin/organizacao" element={<OrganizationPage />} />
            <Route path="/admin/permissoes" element={<PermissionsPage />} />
            <Route path="/admin/relatorios" element={<ReportsPage />} />
            <Route path="/admin/auditoria" element={<AuditPage />} />
            <Route path="/admin/seguranca" element={<SecurityPage />} />
            <Route path="/admin/configuracoes" element={<SettingsPage />} />
            <Route path="/admin/biblioteca" element={<LibraryAdminPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
