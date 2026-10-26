import type { ReactNode } from "react";
import { useBranding } from "../lib/branding";
import { Brand } from "./Brand";

/** Telas de acesso: painel institucional com a marca e o formulário ao lado (referência visual fornecida). */
export function AuthLayout({ aside, children }: { aside?: ReactNode; children: ReactNode }) {
  const { branding } = useBranding();
  return (
    <div className="dark brand-backdrop min-h-screen text-fg">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-10 px-6 py-10 sm:px-10 lg:grid-cols-2 lg:gap-16 lg:py-0">
        <section className="flex flex-col justify-center lg:py-16" aria-label="Apresentação">
          {aside ?? (
            <div className="max-w-lg">
              <Brand size="xl" onDark align="start" />
              <p className="mt-10 font-heading text-3xl leading-snug text-white sm:text-4xl">{branding.tagline}</p>
              <span className="mt-6 block h-1 w-16 rounded-full bg-brand" aria-hidden />
              <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-white/50">{branding.organizationName}</p>
            </div>
          )}
        </section>
        <section className="flex flex-col justify-center lg:py-16">
          <div className="mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">{children}</div>
        </section>
      </div>
      <footer className="pb-6 text-center text-xs text-white/40">
        Ambiente restrito a colaboradores autorizados · {branding.organizationName}
      </footer>
    </div>
  );
}

export function AuthTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="font-heading text-3xl font-medium text-white sm:text-[36px]">{title}</h1>
      {subtitle && <p className="mt-2 text-base text-white/65">{subtitle}</p>}
    </div>
  );
}
