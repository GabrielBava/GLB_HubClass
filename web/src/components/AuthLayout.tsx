import type { ReactNode } from "react";
import { useBranding } from "../lib/branding";
import { Brand } from "./Brand";

/** Telas de acesso: painel institucional com a marca e o formulário ao lado (referência visual fornecida). */
export function AuthLayout({ aside, children }: { aside?: ReactNode; children: ReactNode }) {
  const { branding } = useBranding();
  return (
    <div className="dark brand-backdrop min-h-screen text-fg">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-10 px-5 py-10 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:py-0">
        <section className="flex flex-col justify-center lg:py-16" aria-label="Apresentação">
          {aside ?? (
            <div className="text-center lg:text-center">
              <Brand size="xl" onDark className="justify-center" />
              <p className="mx-auto mt-6 max-w-md text-lg leading-relaxed text-white/70">{branding.tagline}</p>
              <p className="mt-2 text-sm text-white/45">{branding.organizationName}</p>
            </div>
          )}
        </section>
        <section className="flex flex-col justify-center lg:py-16">
          <div className="mx-auto w-full max-w-md">{children}</div>
        </section>
      </div>
      <footer className="pb-6 text-center text-xs text-white/35">
        Ambiente restrito a colaboradores autorizados · {branding.organizationName}
      </footer>
    </div>
  );
}

export function AuthTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="font-heading text-3xl font-bold text-white sm:text-[34px]">{title}</h1>
      {subtitle && <p className="mt-2 text-base text-white/65">{subtitle}</p>}
    </div>
  );
}
