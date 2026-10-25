import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, ArrowRight, CheckCircle2, FileCheck2, Rocket } from "lucide-react";
import { Brand } from "../../components/Brand";
import { HowToUse } from "../../components/HowToUse";
import { Badge, Button, Card, Checkbox, ErrorState, PageLoader, cx } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate, formatMinutes } from "../../lib/format";
import { useAction, useApi } from "../../lib/hooks";

interface JourneyTrack {
  id: string;
  title: string;
  summary: string;
  areaName: string;
  areaColor: string;
  estimatedMinutes: number;
  dueDate: string | null;
}
interface OnboardingData {
  platformName: string;
  organizationName: string;
  welcomeMessage: string;
  supportContact: string;
  dataProtectionContact: string;
  terms: { id: string; version: string; title: string; body: string; publishedAt: string } | null;
  termsAccepted: boolean;
  completed: boolean;
  journey: { mandatory: JourneyTrack[]; recommended: JourneyTrack[] };
}

const STEPS = ["Boas-vindas", "Como utilizar", "Segurança e confidencialidade", "Minha jornada", "Começar"];

function JourneyList({ items, empty }: { items: JourneyTrack[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((t) => (
        <li key={t.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
          <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: t.areaColor }} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t.title}</p>
            <p className="text-xs text-muted">
              {t.areaName}
              {t.estimatedMinutes > 0 && ` · ${formatMinutes(t.estimatedMinutes)}`}
              {t.dueDate && ` · prazo ${formatDate(t.dueDate)}`}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function OnboardingPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const { data, error, refetch, isLoading } = useApi<OnboardingData>("/api/onboarding");
  const [step, setStep] = useState(0);
  const [agree, setAgree] = useState(false);
  const accept = useAction((termsVersionId: string) => api.post("/api/onboarding/terms", { termsVersionId, accepted: true }), {
    invalidate: ["/api/onboarding"],
    success: "Ciência registrada.",
    onSuccess: () => void refresh(),
  });
  const complete = useAction(() => api.post("/api/onboarding/complete"), {
    onSuccess: async () => {
      await refresh();
      navigate("/", { replace: true });
    },
  });

  if (isLoading) return <PageLoader />;
  if (error || !data) return <div className="p-6"><ErrorState error={error} retry={refetch} /></div>;
  const termsOk = data.termsAccepted;
  const canAdvance = step !== 2 || termsOk;

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Brand size="sm" />
          <span className="text-sm text-muted">Primeiro acesso</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <ol className="mb-8 grid grid-cols-5 gap-2" aria-label="Etapas do primeiro acesso">
          {STEPS.map((s, i) => (
            <li key={s} className="min-w-0">
              <div className={cx("h-1.5 rounded-full", i <= step ? "bg-primary" : "bg-border")} />
              <p className={cx("mt-2 hidden truncate text-xs sm:block", i === step ? "font-semibold text-fg" : "text-muted")} aria-current={i === step ? "step" : undefined}>
                {i + 1}. {s}
              </p>
            </li>
          ))}
        </ol>
        <p className="mb-2 text-sm text-muted sm:hidden">Etapa {step + 1} de {STEPS.length}: {STEPS[step]}</p>

        <Card className="p-6 sm:p-10">
          {step === 0 && (
            <div className="mx-auto max-w-2xl text-center">
              <Brand size="lg" className="justify-center" />
              <h1 className="mt-8 font-heading text-3xl font-bold">Bem-vindo ao {data.platformName}!</h1>
              <p className="mt-4 text-lg leading-relaxed text-muted">{data.welcomeMessage}</p>
              <div className="mt-8 grid gap-3 text-left sm:grid-cols-3">
                {[
                  ["Aprenda", "Apostilas e conteúdos organizados em trilhas."],
                  ["Pratique", "Exercícios, estudos de caso e simulações."],
                  ["Execute", "Atividades acompanhadas e validadas pelo líder."],
                ].map(([t, d]) => (
                  <div key={t} className="rounded-xl bg-subtle p-4">
                    <p className="font-heading font-semibold text-primary">{t}</p>
                    <p className="mt-1 text-sm text-muted">{d}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {step === 1 && (
            <div>
              <h1 className="font-heading text-2xl font-bold">Como utilizar o {data.platformName}</h1>
              <p className="mt-1 text-muted">Você pode rever estas instruções a qualquer momento no menu Ajuda.</p>
              <div className="mt-6">
                <HowToUse supportContact={data.supportContact} />
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <h1 className="font-heading text-2xl font-bold">Segurança e confidencialidade</h1>
              <p className="mt-1 text-muted">Leia os termos de uso, as regras de confidencialidade e o aviso de privacidade. Sua ciência fica registrada com data e versão.</p>
              {data.terms ? (
                <>
                  <div className="mt-5 max-h-[380px] overflow-y-auto rounded-xl border border-border bg-subtle/50 p-5 text-sm leading-relaxed" tabIndex={0} aria-label="Texto dos termos">
                    <p className="mb-3 font-semibold">
                      {data.terms.title} — versão {data.terms.version}
                    </p>
                    {data.terms.body.split(/\n{2,}/).map((p, i) => (
                      <p key={i} className="mb-3 whitespace-pre-line">
                        {p}
                      </p>
                    ))}
                    <p className="text-xs text-muted">Contato do encarregado de dados: {data.dataProtectionContact}</p>
                  </div>
                  {termsOk ? (
                    <p className="mt-4 flex items-center gap-2 text-sm text-success" role="status">
                      <FileCheck2 className="h-4 w-4" aria-hidden /> Ciência registrada para a versão {data.terms.version}.
                    </p>
                  ) : (
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <Checkbox checked={agree} onChange={setAgree} label="Li e estou ciente dos termos de uso, confidencialidade e privacidade." />
                      <Button disabled={!agree} loading={accept.isPending} onClick={() => accept.mutate(data.terms!.id)}>
                        Registrar ciência
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <p className="mt-4 text-sm text-muted">Nenhum termo publicado no momento.</p>
              )}
            </div>
          )}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h1 className="font-heading text-2xl font-bold">Minha jornada</h1>
                <p className="mt-1 text-muted">Trilhas definidas para o seu cargo, área e permissões.</p>
              </div>
              <div>
                <h2 className="mb-2 flex items-center gap-2 font-semibold">
                  Obrigatórias <Badge tone="warning">{data.journey.mandatory.length}</Badge>
                </h2>
                <JourneyList items={data.journey.mandatory} empty="Nenhuma trilha obrigatória atribuída no momento." />
              </div>
              <div>
                <h2 className="mb-2 flex items-center gap-2 font-semibold">
                  Recomendadas <Badge tone="primary">{data.journey.recommended.length}</Badge>
                </h2>
                <JourneyList items={data.journey.recommended} empty="As recomendações aparecerão aqui conforme seu cargo." />
              </div>
            </div>
          )}
          {step === 4 && (
            <div className="mx-auto max-w-xl py-6 text-center">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/15 text-primary">
                <Rocket className="h-8 w-8" aria-hidden />
              </span>
              <h1 className="mt-6 font-heading text-3xl font-bold">Tudo pronto!</h1>
              <p className="mt-3 text-muted">Seu painel mostra as trilhas obrigatórias, a próxima atividade recomendada e o botão “Continuar de onde parei”.</p>
              <Button size="lg" glow className="mt-8" icon={CheckCircle2} loading={complete.isPending} disabled={!termsOk} onClick={() => complete.mutate(undefined)}>
                Iniciar minha capacitação
              </Button>
              {!termsOk && <p className="mt-3 text-sm text-warning">Registre a ciência dos termos na etapa 3 para continuar.</p>}
            </div>
          )}
        </Card>

        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" icon={ArrowLeft} disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            Voltar
          </Button>
          {step < STEPS.length - 1 && (
            <Button icon={ArrowRight} disabled={!canAdvance} onClick={() => setStep((s) => s + 1)} className="flex-row-reverse">
              Avançar
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
