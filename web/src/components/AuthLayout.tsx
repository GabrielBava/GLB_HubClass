import type { ReactNode } from "react";
import { useBranding } from "../lib/branding";
import { Brand } from "./Brand";
import { LifeTitle } from "./ui";

/**
 * Telas de acesso no padrão do simulador: fundo com a luz ambiente da marca (segue o tema claro ou escuro),
 * apresentação à esquerda com título em caixa alta e o formulário num cartão arredondado à direita.
 */
export function AuthLayout({ aside, children }: { aside?: ReactNode; children: ReactNode }) {
  const { branding } = useBranding();
  return (
    <div className="min-h-screen text-fg">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-10 px-6 py-10 sm:px-10 lg:grid-cols-2 lg:gap-16 lg:py-0">
        <section className="flex flex-col justify-center lg:py-16" aria-label="Apresentação">
          {aside ?? (
            <div className="max-w-xl">
              <Brand size="xl" align="start" />
              <p className="life-title mt-10 text-[1.75rem] sm:text-[2.1rem]">
                <LifeTitle text={branding.tagline} />
              </p>
              <span className="life-rule mt-5" aria-hidden />
              <p className="eyebrow mt-5">{branding.organizationName}</p>
            </div>
          )}
        </section>
        <section className="flex flex-col justify-center lg:py-16">
          <div className="lc-card mx-auto w-full max-w-md rounded-[24px] p-7 shadow-float sm:p-8">{children}</div>
        </section>
      </div>
      <footer className="pb-6 text-center text-xs text-muted">Ambiente restrito a colaboradores autorizados · {branding.organizationName}</footer>
    </div>
  );
}

export function AuthTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="life-title text-[1.85rem] sm:text-[2.1rem]">
        <LifeTitle text={title} />
      </h1>
      <span className="life-rule mt-3" aria-hidden />
      {subtitle && <p className="mt-3 text-[0.94rem] text-muted">{subtitle}</p>}
    </div>
  );
}
