/**
 * Dados FICTÍCIOS de demonstração: áreas e trilhas do catálogo inicial, apostilas geradas,
 * avaliações, atividades práticas, usuários e algum progresso para os painéis.
 *
 * Uso: npm run seed            (só roda em banco vazio)
 * As senhas dos usuários de demonstração são aleatórias e ficam em data/demo-credentials.txt
 * (fora do Git). Administradores e líderes configuram o MFA no primeiro login.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../auth/password.js";
import {
  accessRules,
  answers,
  assessments,
  attempts,
  contentProgress,
  contents,
  contentVersions,
  departments,
  enrollments,
  feedbacks,
  jobTitles,
  knowledgeAreas,
  leaderAreas,
  libraryItems,
  modules,
  practicalActivities,
  practicalSubmissions,
  questions,
  teamLeaders,
  teams,
  termsAcceptances,
  termsVersions,
  trackJobTitles,
  tracks,
  users,
} from "../db/schema.js";
import { ingestDocument } from "../services/documents/pipeline.js";
import { refreshEnrollment } from "../services/progress.js";
import { BOAS_VINDAS, CONSORCIO_FUNDAMENTOS, CONSORCIO_TAXAS, LGPD, RAMPAGEM, renderDemoPdf, type DemoDocument } from "./demo-content.js";

const config = loadConfig();
if (config.env === "production" && !process.argv.includes("--force")) {
  console.error("Recusado: o seed de demonstração não deve rodar em produção (use --force se tiver certeza).");
  process.exit(1);
}
config.processDocumentsInline = true;
const app = await buildApp(config);
const { db } = app.ctx;

const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(knowledgeAreas);
if (Number(n) > 0) {
  console.log("O banco já tem dados. Para recriar a demonstração, apague a pasta data/ (banco embutido) e rode novamente.");
  await app.close();
  process.exit(0);
}

const credentials: string[] = [];
const genPassword = () => `Demo-${randomBytes(6).toString("base64url")}-${Math.floor(Math.random() * 90 + 10)}`;

// ---------------------------------------------------------------- Termos
const [terms] = await db
  .insert(termsVersions)
  .values({
    version: "1.0",
    title: "Termos de uso, confidencialidade e aviso de privacidade",
    isCurrent: true,
    body: [
      "1. Finalidade. O LIFE CLASS é o ambiente corporativo de capacitação do Grupo Life Brasil. O acesso é pessoal, intransferível e limitado aos conteúdos liberados para você.",
      "2. Confidencialidade. Apostilas, metodologias, vídeos e demais materiais são de propriedade da empresa ou de seus licenciantes e destinam-se exclusivamente ao uso interno. É proibido copiar, fotografar, imprimir, gravar, distribuir ou compartilhar esses conteúdos com terceiros, dentro ou fora da empresa, sem autorização expressa.",
      "3. Rastreabilidade. As páginas exibidas contêm marca d'água com seu nome, identificador interno e data da sessão. Acessos e eventos relevantes (abertura de documentos, tentativas de impressão, downloads autorizados) são registrados para fins de segurança e auditoria.",
      "4. Dados tratados. Tratamos dados de identificação (nome, e-mail, cargo, área e equipe), dados de uso educacional (progresso, tempo ativo de leitura, notas, entregas e feedbacks) e registros de segurança (data, endereço IP e navegador das sessões). As anotações pessoais são privadas e não são compartilhadas com líderes.",
      "5. Uso dos indicadores. Os indicadores servem à gestão educacional e ao desenvolvimento profissional. Seu líder acompanha progresso, notas e entregas da equipe; não há monitoramento contínuo de horários de uso.",
      "6. Retenção e direitos. Os dados são mantidos pelos prazos definidos na política de retenção e excluídos ou anonimizados ao final. Você pode consultar e exportar seus dados no seu perfil e falar com o encarregado de proteção de dados pelo contato indicado na plataforma.",
      "7. Segurança da conta. Mantenha sua senha em sigilo e comunique imediatamente qualquer suspeita de uso indevido.",
      "Texto provisório de demonstração: a versão oficial deve ser validada pelas áreas jurídica e de privacidade.",
    ].join("\n\n"),
  })
  .returning();

// ---------------------------------------------------------------- Organização
const deptNames = ["Planejamento Financeiro", "Consórcios", "Seguros e Proteção", "Investimentos", "Comercial", "Gestão e Pessoas"];
const deps = await db.insert(departments).values(deptNames.map((name) => ({ name }))).returning();
const dep = (name: string) => deps.find((d) => d.name === name)!.id;

const jobs = await db
  .insert(jobTitles)
  .values([
    { name: "Planejador Financeiro", departmentId: dep("Planejamento Financeiro") },
    { name: "Especialista de Consórcios", departmentId: dep("Consórcios") },
    { name: "Especialista de Seguros", departmentId: dep("Seguros e Proteção") },
    { name: "Assessor de Investimentos", departmentId: dep("Investimentos") },
    { name: "Executivo Comercial", departmentId: dep("Comercial") },
    { name: "SDR", departmentId: dep("Comercial") },
    { name: "Líder de Equipe", departmentId: dep("Gestão e Pessoas") },
    { name: "Analista de Pessoas", departmentId: dep("Gestão e Pessoas") },
  ])
  .returning();
const job = (name: string) => jobs.find((j) => j.name === name)!.id;

const teamRows = await db
  .insert(teams)
  .values([
    { name: "Consórcios — Equipe Sul", departmentId: dep("Consórcios") },
    { name: "Planejamento — Equipe Centro", departmentId: dep("Planejamento Financeiro") },
    { name: "Comercial — Equipe Norte", departmentId: dep("Comercial") },
  ])
  .returning();
const team = (name: string) => teamRows.find((t) => t.name.startsWith(name))!.id;

// ---------------------------------------------------------------- Catálogo inicial (seção 4)
const catalog: { code: string; name: string; icon: string; color: string; description: string; tracks: string[] }[] = [
  {
    code: "A",
    name: "Institucional — Grupo Life Brasil",
    icon: "Landmark",
    color: "#F36B22",
    description: "Cultura, estrutura, processos, ferramentas, conduta e segurança da informação.",
    tracks: [
      "Boas-vindas e onboarding",
      "História da empresa",
      "Cultura, missão, visão e valores",
      "Estrutura organizacional",
      "Áreas de atuação",
      "Produtos e serviços",
      "Processos internos",
      "Ferramentas e sistemas",
      "Conduta e ética profissional",
      "LGPD, segurança e confidencialidade",
    ],
  },
  {
    code: "B",
    name: "Planejamento Financeiro",
    icon: "LineChart",
    color: "#252522",
    description: "Da qualificação ao plano financeiro e ao relacionamento de longo prazo.",
    tracks: [
      "Formação de Planejador Financeiro",
      "Fundamentos do Planejamento Financeiro",
      "Qualificação e Discovery",
      "Diagnóstico Financeiro",
      "Condução de V1 e V2",
      "Metodologias de Planejamento",
      "Construção de Plano Financeiro",
      "Relacionamento e Pós-Venda",
      "Planejamento Patrimonial",
      "Integração com Especialistas",
    ],
  },
  {
    code: "C",
    name: "Consórcios",
    icon: "Building2",
    color: "#C83C35",
    description: "Conhecimento técnico e comercial para recomendar consórcios com segurança.",
    tracks: [
      "Formação de Especialista de Consórcios",
      "Fundamentos e Funcionamento do Consórcio",
      "Administradoras e Modalidades",
      "Taxas, Custos, Prazos e Reajustes",
      "Simulações e Estratégias de Aquisição",
      "Lances e Contemplação",
      "Consórcio de Imóveis",
      "Consórcio de Veículos",
      "Estratégias Patrimoniais com Consórcios",
      "Venda Consultiva",
      "Objeções e Negociação",
      "Pós-Venda e Acompanhamento",
    ],
  },
  {
    code: "D",
    name: "Seguros e Proteção",
    icon: "ShieldCheck",
    color: "#B44F19",
    description: "Análise de necessidades, produtos de proteção e pós-venda.",
    tracks: [
      "Formação de Especialista de Seguros",
      "Fundamentos de Seguros",
      "Seguro de Vida",
      "Seguro Auto",
      "Seguro Residencial",
      "Seguro Empresarial",
      "Proteção Patrimonial",
      "Análise de Necessidades",
      "Cotação e Apresentação",
      "Pós-Venda e Sinistros",
    ],
  },
  {
    code: "E",
    name: "Investimentos",
    icon: "TrendingUp",
    color: "#3A3935",
    description: "Mercado financeiro, produtos, suitability e responsabilidade profissional.",
    tracks: [
      "Formação de Assessor de Investimentos",
      "Mercado Financeiro",
      "Produtos de Investimento",
      "Renda Fixa e Renda Variável",
      "Fundos de Investimento",
      "Previdência",
      "Perfil do Investidor e Suitability",
      "Atendimento e Relacionamento",
      "Ética, Compliance e Responsabilidades Profissionais",
    ],
  },
  {
    code: "F",
    name: "Academia Comercial",
    icon: "Target",
    color: "#E0601C",
    description: "Prospecção, discovery, negociação, CRM e fidelização.",
    tracks: [
      "Rampagem Comercial — 7 dias",
      "Formação Comercial",
      "Prospecção Ativa",
      "Técnicas de Abordagem",
      "Qualificação de Leads",
      "Técnicas de Discovery",
      "SPIN Selling e outras metodologias",
      "Construção de Valor",
      "Contorno de Objeções",
      "Negociação",
      "Fechamento de Vendas",
      "Gestão de CRM",
      "Cross-Sell e Up-Sell",
      "Relacionamento e Fidelização",
    ],
  },
  {
    code: "G",
    name: "Liderança e Gestão",
    icon: "Users",
    color: "#8A3A12",
    description: "Gestão de pessoas, indicadores e desenvolvimento de equipes.",
    tracks: [
      "Formação de Líderes",
      "Gestão de Equipes",
      "Gestão de Indicadores",
      "Coaching Comercial",
      "Desenvolvimento de Colaboradores",
      "Acompanhamento de Performance",
      "Feedback e Plano de Desenvolvimento",
    ],
  },
  {
    code: "H",
    name: "Biblioteca e Desenvolvimento",
    icon: "Library",
    color: "#77766F",
    description: "Leituras, artigos, podcasts e materiais de desenvolvimento pessoal e profissional.",
    tracks: [],
  },
];

const areaIds: Record<string, string> = {};
const trackIds: Record<string, string> = {};
for (const [i, a] of catalog.entries()) {
  const slug = a.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const [area] = await db.insert(knowledgeAreas).values({ code: a.code, slug, name: a.name, description: a.description, icon: a.icon, color: a.color, sortOrder: i }).returning();
  areaIds[a.code] = area!.id;
  for (const [j, title] of a.tracks.entries()) {
    const formation = title.startsWith("Formação") || title.startsWith("Rampagem");
    const [t] = await db
      .insert(tracks)
      .values({
        areaId: area!.id,
        title,
        summary: formation ? `Trilha completa de ${title.replace("Formação de ", "").toLowerCase()}.` : `${title}: conteúdos em preparação pela área responsável.`,
        description: formation
          ? "Trilha estruturada no modelo Aprenda → Entenda → Demonstre → Execute → Valide, com apostilas, exercícios de fixação, simulações e atividades acompanhadas pelo líder."
          : "Esta trilha faz parte do catálogo inicial e receberá módulos e materiais em breve.",
        level: formation ? "basico" : j % 3 === 0 ? "basico" : j % 3 === 1 ? "intermediario" : "avancado",
        mode: a.code === "A" && (title.startsWith("Boas-vindas") || title.startsWith("LGPD")) ? "obrigatoria" : "opcional",
        specialty: a.code === "F" || title.includes("Venda") || title.includes("Objeções") ? "Comercial" : a.code === "G" ? "Gestão" : "Técnica",
        status: "published",
        publishedAt: new Date(),
        sortOrder: j,
        ownerName: a.name.split(" — ")[0]!,
      })
      .returning();
    trackIds[title] = t!.id;
  }
}

// Público recomendado por cargo (filtro do catálogo e "Minha jornada").
const recommend: [string, string][] = [
  ["Formação de Especialista de Consórcios", "Especialista de Consórcios"],
  ["Fundamentos e Funcionamento do Consórcio", "Especialista de Consórcios"],
  ["Formação de Planejador Financeiro", "Planejador Financeiro"],
  ["Qualificação e Discovery", "Planejador Financeiro"],
  ["Formação de Especialista de Seguros", "Especialista de Seguros"],
  ["Formação de Assessor de Investimentos", "Assessor de Investimentos"],
  ["Rampagem Comercial — 7 dias", "Executivo Comercial"],
  ["Rampagem Comercial — 7 dias", "SDR"],
  ["Formação de Líderes", "Líder de Equipe"],
];
await db.insert(trackJobTitles).values(recommend.map(([t, j]) => ({ trackId: trackIds[t]!, jobTitleId: job(j) })));

// ---------------------------------------------------------------- Usuários (fictícios)
async function addUser(opts: { name: string; email: string; role: "admin" | "leader" | "collaborator"; job?: string; dept?: string; team?: string }) {
  const password = genPassword();
  const [u] = await db
    .insert(users)
    .values({
      name: opts.name,
      email: opts.email,
      role: opts.role,
      status: "active",
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      jobTitleId: opts.job ? job(opts.job) : null,
      departmentId: opts.dept ? dep(opts.dept) : null,
      teamId: opts.team ? team(opts.team) : null,
      onboardingCompletedAt: opts.role === "collaborator" ? new Date() : null,
      lastActivityAt: new Date(),
    })
    .returning();
  credentials.push(`${opts.role.padEnd(12)} ${opts.email.padEnd(42)} ${password}`);
  return u!;
}

const admin = await addUser({ name: "Administração LIFE CLASS", email: "admin.demo@exemplo.com.br", role: "admin", dept: "Gestão e Pessoas" });
const leaderCons = await addUser({ name: "Renata Alves (Líder Consórcios)", email: "renata.lider@exemplo.com.br", role: "leader", job: "Líder de Equipe", dept: "Consórcios" });
const leaderPlan = await addUser({ name: "Marcos Lima (Líder Planejamento)", email: "marcos.lider@exemplo.com.br", role: "leader", job: "Líder de Equipe", dept: "Planejamento Financeiro" });
const ana = await addUser({ name: "Ana Souza", email: "ana.souza@exemplo.com.br", role: "collaborator", job: "Especialista de Consórcios", dept: "Consórcios", team: "Consórcios" });
const bruno = await addUser({ name: "Bruno Carvalho", email: "bruno.carvalho@exemplo.com.br", role: "collaborator", job: "Especialista de Consórcios", dept: "Consórcios", team: "Consórcios" });
const carla = await addUser({ name: "Carla Mendes", email: "carla.mendes@exemplo.com.br", role: "collaborator", job: "Especialista de Consórcios", dept: "Consórcios", team: "Consórcios" });
const diego = await addUser({ name: "Diego Rocha", email: "diego.rocha@exemplo.com.br", role: "collaborator", job: "Planejador Financeiro", dept: "Planejamento Financeiro", team: "Planejamento" });
const elisa = await addUser({ name: "Elisa Martins", email: "elisa.martins@exemplo.com.br", role: "collaborator", job: "Planejador Financeiro", dept: "Planejamento Financeiro", team: "Planejamento" });
await addUser({ name: "Felipe Nunes", email: "felipe.nunes@exemplo.com.br", role: "collaborator", job: "Executivo Comercial", dept: "Comercial", team: "Comercial" });

await db.insert(leaderAreas).values([
  { userId: leaderCons.id, areaId: areaIds.C! },
  { userId: leaderPlan.id, areaId: areaIds.B! },
]);
await db.insert(teamLeaders).values([
  { teamId: team("Consórcios"), userId: leaderCons.id },
  { teamId: team("Planejamento"), userId: leaderPlan.id },
]);

// ---------------------------------------------------------------- Regras de acesso
await db.insert(accessRules).values([
  { subjectType: "everyone", resourceType: "area", resourceId: areaIds.A!, note: "Institucional para todos", grantedBy: admin.id },
  { subjectType: "job_title", subjectId: job("Especialista de Consórcios"), resourceType: "area", resourceId: areaIds.C!, grantedBy: admin.id },
  { subjectType: "job_title", subjectId: job("Planejador Financeiro"), resourceType: "area", resourceId: areaIds.B!, grantedBy: admin.id },
  { subjectType: "department", subjectId: dep("Comercial"), resourceType: "area", resourceId: areaIds.F!, grantedBy: admin.id },
  { subjectType: "job_title", subjectId: job("Especialista de Consórcios"), resourceType: "track", resourceId: trackIds["Rampagem Comercial — 7 dias"]!, grantedBy: admin.id },
  { subjectType: "job_title", subjectId: job("Planejador Financeiro"), resourceType: "track", resourceId: trackIds["Rampagem Comercial — 7 dias"]!, grantedBy: admin.id },
]);

// ---------------------------------------------------------------- Conteúdos de demonstração
async function addModule(trackTitle: string, title: string, opts: { code?: string; description?: string; status?: "draft" | "published"; requiresPrevious?: boolean; sort: number }) {
  const [m] = await db
    .insert(modules)
    .values({
      trackId: trackIds[trackTitle]!,
      code: opts.code ?? null,
      title,
      description: opts.description ?? "",
      status: opts.status ?? "published",
      requiresPrevious: opts.requiresPrevious ?? false,
      sortOrder: opts.sort,
    })
    .returning();
  return m!;
}

async function addDocument(moduleId: string, doc: DemoDocument, opts: { sort: number; objective: string; factor?: number }) {
  const [c] = await db
    .insert(contents)
    .values({
      moduleId,
      type: "document",
      title: doc.title,
      description: doc.subtitle,
      learningObjective: opts.objective,
      ownerName: "Área responsável (demonstração)",
      status: "published",
      publishedAt: new Date(),
      sortOrder: opts.sort,
      readingFactor: opts.factor ?? 1,
      createdBy: admin.id,
    })
    .returning();
  const pdf = await renderDemoPdf(doc);
  await ingestDocument(app.ctx, { buffer: pdf, filename: `${doc.title}.pdf`, contentId: c!.id, userId: admin.id, changeNotes: "Versão inicial de demonstração", isMajor: true });
  return c!;
}

async function addAssessment(trackTitle: string, moduleId: string | null, title: string, kind: "fixation" | "final" | "case_study", qs: { type: string; prompt: string; context?: string; options: object; answerKey: object; explanation?: string; points?: number }[]) {
  const [a] = await db
    .insert(assessments)
    .values({ trackId: trackIds[trackTitle]!, moduleId, title, kind, passingScore: 80, maxAttempts: 3, status: "published", createdBy: admin.id, feedbackMode: "after_submit" })
    .returning();
  await db.insert(questions).values(
    qs.map((q, i) => ({
      assessmentId: a!.id,
      type: q.type as never,
      prompt: q.prompt,
      context: q.context ?? "",
      options: q.options as Record<string, unknown>,
      answerKey: q.answerKey as Record<string, unknown>,
      explanation: q.explanation ?? "",
      points: q.points ?? 1,
      sortOrder: i,
    })),
  );
  return a!;
}

async function addActivity(trackTitle: string, moduleId: string, title: string, stage: "demonstrate" | "execute", instructions: string, competency: string) {
  const [act] = await db
    .insert(practicalActivities)
    .values({ trackId: trackIds[trackTitle]!, moduleId, title, stage, instructions, competency, status: "published", requiresValidation: true })
    .returning();
  return act!;
}

// Institucional: Boas-vindas (obrigatória para todos)
const onb = "Boas-vindas e onboarding";
const mOnb = await addModule(onb, "Conheça o LIFE CLASS e o Grupo", { sort: 0, description: "Primeiros passos na empresa e na plataforma." });
const cOnb = await addDocument(mOnb.id, BOAS_VINDAS, { sort: 0, objective: "Entender como estudar no LIFE CLASS e as regras de confidencialidade." });
await addAssessment(onb, mOnb.id, "Fixação: primeiros passos", "fixation", [
  {
    type: "true_false",
    prompt: "Minhas anotações no LIFE CLASS são privadas e não ficam visíveis para o líder.",
    options: {},
    answerKey: { value: true },
    explanation: "As anotações pessoais são privadas. Dúvidas só ficam visíveis quando você as publica no espaço de comentários.",
  },
  {
    type: "ordering",
    prompt: "Ordene a estrutura pedagógica das trilhas.",
    options: { items: [{ id: "a", text: "Aprenda" }, { id: "b", text: "Entenda" }, { id: "c", text: "Demonstre" }, { id: "d", text: "Execute" }, { id: "e", text: "Valide" }] },
    answerKey: { order: ["a", "b", "c", "d", "e"] },
  },
]);
const lgpd = "LGPD, segurança e confidencialidade";
const mLgpd = await addModule(lgpd, "Proteção de dados no dia a dia", { sort: 0 });
await addDocument(mLgpd.id, LGPD, { sort: 0, objective: "Aplicar boas práticas de proteção de dados pessoais." });

// Consórcios: Formação completa
const fc = "Formação de Especialista de Consórcios";
await db
  .update(tracks)
  .set({
    mode: "opcional",
    level: "basico",
    requiresLeaderValidation: true,
    certificateEnabled: true,
    objectives: "Explicar o funcionamento do consórcio, interpretar custos e simulações e conduzir uma venda consultiva com ética.",
    prerequisitesText: "Concluir a trilha de Boas-vindas e onboarding.",
    summary: "Do funcionamento do consórcio à venda consultiva, com simulações e validação prática.",
  })
  .where(eq(tracks.id, trackIds[fc]!));
const m1 = await addModule(fc, "Funcionamento e contemplação", { sort: 0, code: "M1", description: "Grupo, cota, carta de crédito, sorteio e lance." });
const c1 = await addDocument(m1.id, CONSORCIO_FUNDAMENTOS, { sort: 0, objective: "Explicar o funcionamento do consórcio e as formas de contemplação." });
const a1 = await addAssessment(fc, m1.id, "Fixação: funcionamento e contemplação", "fixation", [
  {
    type: "single_choice",
    prompt: "Qual forma de contemplação depende de uma oferta do consorciado?",
    options: { choices: [{ id: "a", text: "Sorteio" }, { id: "b", text: "Lance" }, { id: "c", text: "Assembleia extraordinária" }] },
    answerKey: { correct: "b" },
    explanation: "No lance, o consorciado oferece antecipar parcelas; o sorteio independe de oferta.",
  },
  {
    type: "true_false",
    prompt: "O consórcio cobra juros da mesma forma que um financiamento.",
    options: {},
    answerKey: { value: false },
    explanation: "Não há juros: o custo está na taxa de administração e, quando previstos, no fundo de reserva e no seguro.",
  },
  {
    type: "matching",
    prompt: "Associe cada termo à sua definição.",
    options: {
      left: [{ id: "g", text: "Grupo" }, { id: "q", text: "Cota" }, { id: "c", text: "Carta de crédito" }],
      right: [
        { id: "1", text: "Conjunto de participantes com o mesmo prazo e tipo de bem" },
        { id: "2", text: "Cada participação no grupo" },
        { id: "3", text: "Valor recebido na contemplação" },
      ],
    },
    answerKey: { pairs: { g: "1", q: "2", c: "3" } },
  },
  {
    type: "multiple_choice",
    prompt: "Quais itens podem compor a parcela de um consórcio? (marque todos que se aplicam)",
    options: { choices: [{ id: "a", text: "Fundo comum" }, { id: "b", text: "Taxa de administração" }, { id: "c", text: "Juros compostos" }, { id: "d", text: "Fundo de reserva, quando previsto" }] },
    answerKey: { correct: ["a", "b", "d"] },
  },
]);
await addActivity(fc, m1.id, "Explique sorteio e lance para um cliente", "demonstrate", "Escreva (ou grave e envie o link) um roteiro de até 3 minutos explicando a diferença entre sorteio e lance para um cliente que quer comprar o primeiro imóvel.", "Explicar contemplação");
const m2 = await addModule(fc, "Taxas, prazos e estratégias", { sort: 1, code: "M2", requiresPrevious: true, description: "Leitura de simulações, custos e estratégias de lance." });
await addDocument(m2.id, CONSORCIO_TAXAS, { sort: 0, objective: "Interpretar uma simulação e propor estratégias de aquisição.", factor: 1.3 });
await addAssessment(fc, m2.id, "Fixação: taxas e simulações", "fixation", [
  {
    type: "numeric",
    prompt: "Carta de crédito de R$ 100.000 com taxa de administração de 15%. Qual é o custo total da taxa, em reais?",
    options: { unit: "R$" },
    answerKey: { value: 15000, tolerance: 0 },
    explanation: "15% de R$ 100.000 = R$ 15.000, diluídos ao longo do prazo.",
  },
  {
    type: "numeric",
    prompt: "No mesmo exemplo, com prazo de 100 meses e sem reajustes, qual é a parcela mensal estimada (R$)?",
    options: { unit: "R$" },
    answerKey: { value: 1150, tolerance: 1 },
    explanation: "(R$ 100.000 + R$ 15.000) ÷ 100 = R$ 1.150.",
  },
]);
await addActivity(fc, m2.id, "Simulação completa acompanhada", "execute", "Elabore uma simulação para um caso real (dados anonimizados), apresente ao seu líder e registre a estratégia combinada no CRM. Envie o resumo e o link do registro.", "Simular e recomendar estratégia de aquisição");
await addAssessment(fc, null, "Estudo de caso final", "case_study", [
  {
    type: "essay",
    prompt: "Recomende uma estratégia de aquisição para o caso e justifique.",
    context: "Cliente de 34 anos, renda de R$ 12.000, reserva de emergência de 6 meses, quer comprar um imóvel de R$ 400.000 em até 3 anos.",
    options: { minWords: 80 },
    answerKey: { guidance: "Avaliar consórcio com estratégia de lance compatível com a reserva, comparar com financiamento e reforçar a preservação da reserva de emergência." },
    points: 5,
  },
]);

// Planejamento Financeiro: espaço para a trilha existente (M0 a M9), sem alterar o conteúdo original.
const fp = "Formação de Planejador Financeiro";
await db
  .update(tracks)
  .set({
    summary: "Estrutura preparada para receber os módulos M0 a M9 da trilha oficial de Planejamento Financeiro.",
    description: "Os módulos M0 a M9 da trilha existente serão incorporados como estão, enviando cada apostila original como nova versão do respectivo conteúdo.",
  })
  .where(eq(tracks.id, trackIds[fp]!));
for (let i = 0; i <= 9; i++) {
  await addModule(fp, `Módulo M${i}`, { sort: i, code: `M${i}`, status: "draft", description: "A ser preenchido com a apostila original da trilha de Planejamento Financeiro." });
}

// Academia Comercial: rampagem de 7 dias
const ramp = "Rampagem Comercial — 7 dias";
await db.update(tracks).set({ isRampUp: true, rampDays: 7, summary: "Primeira semana com microconteúdos, simulações e atividades supervisionadas." }).where(eq(tracks.id, trackIds[ramp]!));
const mRamp = await addModule(ramp, "Semana 1", { sort: 0 });
await addDocument(mRamp.id, RAMPAGEM, { sort: 0, objective: "Organizar a primeira semana de atividades comerciais." });
await addActivity(ramp, mRamp.id, "Registre a primeira atividade comercial no CRM", "execute", "Faça uma ligação acompanhada pelo líder e registre a atividade no CRM. Envie o link do registro.", "Registrar atividade comercial");

// ---------------------------------------------------------------- Biblioteca
await db.insert(libraryItems).values([
  { title: "A Psicologia Financeira", author: "Morgan Housel", category: "Finanças pessoais", theme: "Comportamento e dinheiro", type: "book", license: "external_only", level: "basico", estimatedMinutes: 360, description: "Indicação de leitura: como emoções e hábitos influenciam decisões financeiras. Consulte a obra em livrarias ou bibliotecas.", coverColor: "#252522", sortOrder: 0 },
  { title: "Rápido e Devagar", author: "Daniel Kahneman", category: "Comportamento", theme: "Tomada de decisão", type: "book", license: "external_only", level: "intermediario", estimatedMinutes: 720, description: "Indicação de leitura sobre os dois sistemas de pensamento e vieses que afetam escolhas — útil para conversas com clientes.", coverColor: "#1E3A8A", sortOrder: 1 },
  { title: "Alcançando Excelência em Vendas: SPIN Selling", author: "Neil Rackham", category: "Vendas", theme: "Venda consultiva", type: "book", license: "external_only", level: "intermediario", estimatedMinutes: 420, description: "Indicação de leitura sobre perguntas de Situação, Problema, Implicação e Necessidade de solução.", coverColor: "#9A3412", sortOrder: 2 },
  { title: "O Investidor Inteligente", author: "Benjamin Graham", category: "Investimentos", theme: "Investimento em valor", type: "book", license: "external_only", level: "avancado", estimatedMinutes: 900, description: "Indicação clássica sobre disciplina e margem de segurança em investimentos.", coverColor: "#374151", sortOrder: 3 },
  { title: "Checklist de discovery (artigo interno)", author: "Academia Comercial", category: "Vendas", theme: "Discovery", type: "article", license: "own", level: "basico", estimatedMinutes: 8, description: "Artigo interno fictício com perguntas de discovery para a primeira conversa.", coverColor: "#B91C1C", sortOrder: 4 },
  { title: "Podcast: rotina do planejador", author: "Grupo Life Brasil", category: "Desenvolvimento", theme: "Rotina profissional", type: "podcast", license: "own", level: "basico", estimatedMinutes: 25, description: "Episódio interno (fictício) sobre organização da agenda e acompanhamento de clientes.", coverColor: "#6D28D9", sortOrder: 5 },
]);

// ---------------------------------------------------------------- Progresso de demonstração
const allCollabs = [ana, bruno, carla, diego, elisa];
for (const u of [...allCollabs, admin, leaderCons, leaderPlan]) {
  if (u.role === "collaborator") await db.insert(termsAcceptances).values({ userId: u.id, termsVersionId: terms!.id });
}
const due = (days: number) => new Date(Date.now() + days * 86_400_000);
for (const u of [ana, bruno, carla]) {
  await db.insert(enrollments).values({ userId: u.id, trackId: trackIds[fc]!, source: "leader", assignedBy: leaderCons.id, isMandatory: true, dueDate: u === carla ? due(-3) : due(20) });
}
for (const u of [diego, elisa]) {
  await db.insert(enrollments).values({ userId: u.id, trackId: trackIds[ramp]!, source: "leader", assignedBy: leaderPlan.id, isMandatory: false, dueDate: due(10) });
}

async function readAll(userId: string, contentId: string) {
  const [c] = await db.select().from(contents).where(eq(contents.id, contentId));
  const [v] = await db.select().from(contentVersions).where(eq(contentVersions.id, c!.currentVersionId!));
  const pagesRead = Array.from({ length: v!.pageCount }, (_, i) => i + 1);
  await db.insert(contentProgress).values({ userId, contentId, versionId: v!.id, status: "completed", percent: 100, pagesRead, lastPage: v!.pageCount, activeSeconds: 900, viewSeconds: 1100, startedAt: due(-6), completedAt: due(-5) });
}
await readAll(ana.id, cOnb.id);
await readAll(ana.id, c1.id);
await readAll(bruno.id, c1.id);
await db.insert(contentProgress).values({ userId: carla.id, contentId: c1.id, versionId: (await db.select().from(contents).where(eq(contents.id, c1.id)))[0]!.currentVersionId, status: "in_progress", percent: 33, pagesRead: [1, 2], lastPage: 3, activeSeconds: 240, viewSeconds: 400, startedAt: due(-2) });

// Ana passou na fixação e enviou a atividade (aguarda validação); Bruno reprovou duas vezes.
const qsA1 = await db.select().from(questions).where(eq(questions.assessmentId, a1.id));
async function attempt(userId: string, number: number, correct: boolean) {
  const [at] = await db
    .insert(attempts)
    .values({ assessmentId: a1.id, userId, attemptNumber: number, status: "graded", questionIds: qsA1.map((q) => q.id), startedAt: due(-4), submittedAt: due(-4), score: correct ? 100 : 50, passed: correct, gradedAt: due(-4) })
    .returning();
  await db.insert(answers).values(qsA1.map((q, i) => ({ attemptId: at!.id, questionId: q.id, response: null, isCorrect: correct || i % 2 === 0, pointsAwarded: correct || i % 2 === 0 ? 1 : 0, maxPoints: 1 })));
}
await attempt(ana.id, 1, true);
await attempt(bruno.id, 1, false);
await attempt(bruno.id, 2, false);
const [act1] = await db.select().from(practicalActivities).where(eq(practicalActivities.moduleId, m1.id));
await db.insert(practicalSubmissions).values({ activityId: act1!.id, userId: ana.id, body: "Roteiro: no sorteio todos os participantes em dia concorrem igualmente; no lance, você pode antecipar parcelas para aumentar a chance de contemplação, sempre preservando sua reserva de emergência...", status: "submitted" });
await db.insert(feedbacks).values({ userId: ana.id, authorId: leaderCons.id, kind: "feedback", body: "Ótimo ritmo na formação! Na próxima simulação, inclua o efeito do reajuste anual na parcela.", trackId: trackIds[fc]! });

for (const u of [ana, bruno, carla]) await refreshEnrollment(app.ctx, u.id, trackIds[fc]!);
await refreshEnrollment(app.ctx, ana.id, trackIds[onb]!);

// ---------------------------------------------------------------- Credenciais locais
mkdirSync(config.dataDir, { recursive: true });
const file = path.join(config.dataDir, "demo-credentials.txt");
writeFileSync(
  file,
  [
    "LIFE CLASS — usuários FICTÍCIOS de demonstração (não versionar, não usar em produção)",
    "Administradores e líderes configuram a verificação em duas etapas (MFA) no primeiro login.",
    "",
    ...credentials,
    "",
  ].join("\n"),
  { mode: 0o600 },
);
console.log(`\nDemonstração criada. Credenciais geradas em: ${file}\n`);
console.log(credentials.join("\n"));
await app.close();
