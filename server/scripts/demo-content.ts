import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Apostilas fictícias para demonstração. O texto é genérico e didático, escrito para o
 * ambiente de testes; não substitui os materiais oficiais que serão publicados pela empresa.
 */
export interface DemoSection {
  title: string;
  paragraphs: string[];
}

export interface DemoDocument {
  title: string;
  subtitle: string;
  sections: DemoSection[];
}

const INK = rgb(0.09, 0.11, 0.12);
const MUTED = rgb(0.42, 0.45, 0.47);
const ACCENT = rgb(0.12, 0.72, 0.45);

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > width && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderDemoPdf(doc: DemoDocument): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  pdf.setAuthor("LIFE CLASS — material de demonstração");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595;
  const H = 842;
  const M = 64;
  let page: PDFPage;
  let y = 0;
  let pageNo = 0;

  const footer = (p: PDFPage) => {
    p.drawText(`${doc.title} · Material fictício para demonstração · página ${pageNo}`, { x: M, y: 36, size: 8, font: regular, color: MUTED });
  };
  const newPage = () => {
    page = pdf.addPage([W, H]);
    pageNo++;
    y = H - M;
    footer(page);
  };

  // Capa
  newPage();
  page!.drawRectangle({ x: 0, y: H - 260, width: W, height: 260, color: rgb(0.05, 0.08, 0.07) });
  // Título em quantas linhas forem necessárias; subtítulo e traço descem junto.
  const titleLines = wrap(doc.title, bold, 26, W - 2 * M);
  titleLines.forEach((line, i) => page!.drawText(line, { x: M, y: H - 120 - i * 32, size: 26, font: bold, color: rgb(1, 1, 1) }));
  const below = H - 120 - (titleLines.length - 1) * 32;
  page!.drawText(doc.subtitle, { x: M, y: below - 34, size: 12, font: regular, color: rgb(0.75, 0.85, 0.8), maxWidth: W - 2 * M });
  page!.drawRectangle({ x: M, y: below - 62, width: 60, height: 4, color: ACCENT });
  page!.drawText("Sumário", { x: M, y: H - 320, size: 14, font: bold, color: INK });
  doc.sections.forEach((s, i) => {
    page!.drawText(`${i + 1}. ${s.title}`, { x: M, y: H - 350 - i * 20, size: 11, font: regular, color: INK });
  });

  for (const [i, section] of doc.sections.entries()) {
    newPage();
    page!.drawText(`${i + 1}. ${section.title}`, { x: M, y, size: 17, font: bold, color: INK });
    y -= 12;
    page!.drawRectangle({ x: M, y, width: 40, height: 3, color: ACCENT });
    y -= 26;
    for (const para of section.paragraphs) {
      const isBullet = para.startsWith("• ");
      const lines = wrap(para, regular, 11, W - 2 * M - (isBullet ? 14 : 0));
      for (const [li, line] of lines.entries()) {
        if (y < 70) newPage();
        page!.drawText(line, { x: M + (isBullet && li > 0 ? 14 : 0), y, size: 11, font: regular, color: INK, lineHeight: 15 });
        y -= 15.5;
      }
      y -= 8;
    }
  }
  return Buffer.from(await pdf.save());
}

export const CONSORCIO_FUNDAMENTOS: DemoDocument = {
  title: "Fundamentos do Consórcio",
  subtitle: "Formação de Especialista de Consórcios · Módulo 1",
  sections: [
    {
      title: "O que é um consórcio",
      paragraphs: [
        "O consórcio é uma modalidade de compra planejada em que um grupo de pessoas, físicas ou jurídicas, se reúne para formar uma poupança comum. Todos os meses, cada participante paga uma parcela, e os recursos reunidos permitem que alguns integrantes sejam contemplados com uma carta de crédito para adquirir um bem ou serviço.",
        "No Brasil, o sistema é regulamentado pela Lei nº 11.795/2008. As administradoras precisam de autorização do Banco Central, que também fiscaliza as operações. Para o cliente, isso significa regras claras de funcionamento, prestação de contas e assembleias periódicas.",
        "Diferentemente de um financiamento, o consórcio não cobra juros. O custo está concentrado na taxa de administração e, quando previstos no contrato, no fundo de reserva e no seguro. Essa diferença é central na conversa com o cliente e deve ser explicada com exemplos numéricos.",
      ],
    },
    {
      title: "Grupo, cota e carta de crédito",
      paragraphs: [
        "O grupo é o conjunto de participantes com o mesmo prazo e o mesmo tipo de bem. Cada participação no grupo é chamada de cota. Uma mesma pessoa pode ter mais de uma cota, o que aumenta as chances de contemplação e o valor total de crédito disponível.",
        "A carta de crédito é o valor que o consorciado recebe ao ser contemplado. Ela pode ser usada para comprar o bem previsto no contrato e, em muitos casos, também para quitar um financiamento ou adquirir outro bem do mesmo segmento, conforme as regras do grupo.",
        "• Prazo do grupo: número de meses previsto para encerrar o plano.",
        "• Parcela: soma do fundo comum, da taxa de administração e de outros itens previstos no contrato.",
        "• Fundo comum: parte da parcela destinada à formação do crédito dos participantes.",
      ],
    },
    {
      title: "Contemplação por sorteio e por lance",
      paragraphs: [
        "Todos os meses a administradora realiza uma assembleia. Nela, os consorciados podem ser contemplados de duas formas: por sorteio, que independe de qualquer oferta e dá a todos os participantes em dia as mesmas chances, ou por lance, em que o consorciado oferece antecipar parte das parcelas.",
        "No lance, vence quem oferece o maior percentual, conforme as regras do grupo. Existem modalidades como o lance livre, em que o cliente escolhe o percentual, o lance fixo, com percentual predefinido, e o lance embutido, em que parte da própria carta de crédito é usada para compor a oferta.",
        "Explicar essas diferenças com clareza evita expectativas equivocadas. O especialista deve deixar explícito que a contemplação por sorteio não tem data garantida e que a estratégia de lance precisa caber no planejamento financeiro do cliente.",
      ],
    },
    {
      title: "Custos, reajustes e transparência",
      paragraphs: [
        "A taxa de administração remunera a administradora pela gestão do grupo e costuma ser expressa como um percentual sobre o valor do crédito, diluído ao longo do prazo. O fundo de reserva, quando existe, cobre eventuais inadimplências e despesas do grupo; ao final, o saldo é devolvido aos participantes.",
        "O valor do crédito e das parcelas é reajustado periodicamente por um índice definido em contrato, para preservar o poder de compra. É fundamental apresentar esse mecanismo ao cliente e mostrar como o reajuste afeta a parcela ao longo do tempo.",
        "Uma simulação honesta compara o custo total do consórcio com alternativas como o financiamento e a compra à vista com recursos investidos. O objetivo não é vender a qualquer custo, mas ajudar o cliente a escolher a melhor estratégia de aquisição.",
      ],
    },
    {
      title: "Da teoria à prática",
      paragraphs: [
        "Ao final deste módulo, você deve ser capaz de explicar, com suas palavras, a diferença entre sorteio e lance, interpretar a composição de uma parcela e apresentar os principais custos de um plano.",
        "Atividade sugerida: prepare um roteiro curto, de até três minutos, explicando o funcionamento do consórcio para um cliente que deseja comprar o primeiro imóvel. Use um exemplo com valores redondos e registre as dúvidas que surgirem para discutir com seu líder.",
        "Lembre-se: a conclusão desta trilha não substitui certificações ou habilitações profissionais exigidas para a função.",
      ],
    },
  ],
};

export const CONSORCIO_TAXAS: DemoDocument = {
  title: "Taxas, Prazos e Estratégias de Aquisição",
  subtitle: "Formação de Especialista de Consórcios · Módulo 2",
  sections: [
    {
      title: "Lendo uma simulação",
      paragraphs: [
        "Uma simulação de consórcio apresenta o valor da carta de crédito, o prazo do grupo, o percentual da taxa de administração, o fundo de reserva e a estimativa da parcela. Ler cada linha com o cliente reduz dúvidas e aumenta a confiança na recomendação.",
        "Exemplo didático: carta de R$ 100.000, prazo de 100 meses e taxa de administração de 15% sobre o crédito. O custo da taxa é de R$ 15.000, diluído no prazo. Sem considerar reajustes e outros itens, a parcela mensal estimada seria de R$ 1.150.",
      ],
    },
    {
      title: "Estratégias de lance",
      paragraphs: [
        "A estratégia de lance deve partir dos objetivos e da capacidade financeira do cliente. Um lance com recursos próprios antecipa a contemplação, mas reduz a liquidez. O lance embutido preserva o caixa do cliente, porém diminui o crédito efetivamente disponível.",
        "• Defina o prazo desejado para usar o crédito.",
        "• Verifique a reserva de emergência antes de sugerir lances com recursos próprios.",
        "• Registre a estratégia combinada no CRM para acompanhamento.",
      ],
    },
    {
      title: "Pós-venda e acompanhamento",
      paragraphs: [
        "O relacionamento continua depois da venda. Acompanhar as assembleias, avisar o cliente sobre oportunidades de lance e orientar o uso da carta de crédito são atitudes que fortalecem a confiança e geram indicações.",
        "Atividade acompanhada: elabore uma simulação completa para um caso real (com dados anonimizados) e apresente ao seu líder, que poderá aprovar, devolver com comentários ou solicitar ajustes.",
      ],
    },
  ],
};

export const BOAS_VINDAS: DemoDocument = {
  title: "Guia de Boas-vindas",
  subtitle: "Institucional · Grupo Life Brasil (conteúdo fictício de demonstração)",
  sections: [
    {
      title: "Bem-vindo ao Grupo Life Brasil",
      paragraphs: [
        "Este guia apresenta, de forma resumida, como funciona o seu início na empresa e como usar o LIFE CLASS, o ambiente de aprendizado e desenvolvimento do grupo. Os textos institucionais definitivos — história, missão, visão e valores — serão publicados pela equipe responsável.",
        "Nosso princípio de formação é simples: aprender, praticar e executar. Cada trilha combina leitura, exercícios de fixação, simulações e atividades acompanhadas pelo seu líder.",
      ],
    },
    {
      title: "Como estudar no LIFE CLASS",
      paragraphs: [
        "• Comece pelas trilhas obrigatórias indicadas no seu painel.",
        "• Leia as apostilas no leitor da plataforma; o progresso é salvo automaticamente.",
        "• Registre anotações e dúvidas nas páginas. Suas anotações são privadas.",
        "• Ao final de cada módulo, responda aos exercícios de fixação.",
        "• Envie as atividades práticas e acompanhe o feedback do seu líder.",
      ],
    },
    {
      title: "Confidencialidade",
      paragraphs: [
        "Os materiais de formação são de uso interno. Cada página exibida contém uma marca d'água com seu nome e identificador, para rastrear eventuais compartilhamentos indevidos. Não fotografe, imprima ou repasse conteúdos a terceiros.",
        "Em caso de dúvida sobre o uso de um material, fale com seu líder ou com o suporte do LIFE CLASS.",
      ],
    },
  ],
};

export const LGPD: DemoDocument = {
  title: "LGPD, Segurança e Confidencialidade",
  subtitle: "Institucional · Fundamentos para todos os colaboradores",
  sections: [
    {
      title: "Por que a LGPD importa no dia a dia",
      paragraphs: [
        "A Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018) estabelece regras para o tratamento de dados de pessoas físicas. Em serviços financeiros, lidamos com informações sensíveis de clientes, como renda, patrimônio e objetivos de vida.",
        "Tratar dados com finalidade clara, coletar apenas o necessário e proteger as informações contra acessos indevidos são deveres de todos os colaboradores.",
      ],
    },
    {
      title: "Boas práticas",
      paragraphs: [
        "• Use apenas os sistemas oficiais para registrar dados de clientes.",
        "• Não envie planilhas com dados pessoais por canais não autorizados.",
        "• Bloqueie a tela ao se afastar do computador.",
        "• Desconfie de mensagens que pedem senhas ou códigos de verificação.",
        "• Comunique imediatamente qualquer suspeita de incidente de segurança.",
      ],
    },
  ],
};

export const RAMPAGEM: DemoDocument = {
  title: "Rampagem Comercial — 7 Dias",
  subtitle: "Academia Comercial · Microconteúdos para a primeira semana",
  sections: [
    {
      title: "Dias 1 e 2 — Prospecção e abordagem",
      paragraphs: [
        "Nos primeiros dias, o foco é conhecer o perfil de cliente ideal e praticar a abordagem inicial. Prepare um roteiro de apresentação de 30 segundos e treine com seu líder.",
      ],
    },
    {
      title: "Dias 3 a 5 — Qualificação e discovery",
      paragraphs: [
        "Qualificar é entender se existe necessidade, momento e capacidade de decisão. No discovery, as perguntas abertas ajudam o cliente a explicar objetivos e preocupações. Registre tudo no CRM.",
      ],
    },
    {
      title: "Dias 6 e 7 — Primeiras atividades supervisionadas",
      paragraphs: [
        "Realize ligações acompanhadas, registre as atividades no CRM e receba feedback estruturado. A rampagem termina com a validação do líder.",
      ],
    },
  ],
};

/** Capa fictícia (PNG) para itens da biblioteca de demonstração: carvão, faixa laranja e título. */
export async function renderDemoCover(title: string, subtitle: string): Promise<Buffer> {
  const { createCanvas, GlobalFonts } = await import("@napi-rs/canvas");
  const { STANDARD_FONTS_DIR } = await import("../services/documents/pdf.js");
  const path = await import("node:path");
  GlobalFonts.registerFromPath(path.join(STANDARD_FONTS_DIR, "LiberationSans-Bold.ttf"), "LCCoverBold");
  GlobalFonts.registerFromPath(path.join(STANDARD_FONTS_DIR, "LiberationSans-Regular.ttf"), "LCCover");
  const W = 600;
  const H = 800;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#F05A00";
  ctx.fillRect(0, 0, 18, H);
  // Linhas finas, como nos materiais do guia de identidade.
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.moveTo(260 + i * 60, 0);
    ctx.lineTo(420 + i * 60, H);
    ctx.stroke();
  }
  ctx.fillStyle = "#F05A00";
  ctx.font = "bold 22px LCCoverBold";
  ctx.fillText(subtitle.toUpperCase(), 60, 120);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 50px LCCoverBold";
  const words = title.split(" ");
  let line = "";
  let y = 220;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > W - 120 && line) {
      ctx.fillText(line, 60, y);
      line = w;
      y += 62;
    } else line = test;
  }
  if (line) ctx.fillText(line, 60, y);
  ctx.fillStyle = "#F05A00";
  ctx.fillRect(60, y + 40, 90, 6);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "22px LCCover";
  ctx.fillText("Grupo Life Brasil · material de demonstração", 60, H - 60);
  return canvas.toBuffer("image/png");
}
