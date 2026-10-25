// Textos dos e-mails transacionais (texto simples, sem rastreadores).

export function inviteEmail(opts: { name: string; link: string; platform: string; organization: string; expiresHours: number }) {
  return {
    subject: `Seu acesso ao ${opts.platform}`,
    text: [
      `Olá, ${opts.name}!`,
      "",
      `Você foi convidado(a) para o ${opts.platform}, o ambiente de aprendizado e desenvolvimento do ${opts.organization}.`,
      "",
      "Para ativar seu acesso e criar sua senha, use o link abaixo:",
      opts.link,
      "",
      `O link é pessoal, vale por ${opts.expiresHours} horas e só pode ser usado uma vez.`,
      "Se você não esperava este convite, ignore esta mensagem.",
    ].join("\n"),
  };
}

export function resetEmail(opts: { name: string; link: string; platform: string; expiresMinutes: number }) {
  return {
    subject: `Redefinição de senha — ${opts.platform}`,
    text: [
      `Olá, ${opts.name}.`,
      "",
      "Recebemos um pedido para redefinir a sua senha. Para criar uma nova senha, use o link abaixo:",
      opts.link,
      "",
      `O link vale por ${opts.expiresMinutes} minutos e só pode ser usado uma vez.`,
      "Se não foi você, ignore esta mensagem: sua senha atual continua valendo.",
    ].join("\n"),
  };
}

export function notificationEmail(opts: { name: string; title: string; body: string; link: string | null; platform: string }) {
  return {
    subject: `${opts.title} — ${opts.platform}`,
    text: [`Olá, ${opts.name}.`, "", opts.body, "", opts.link ? `Acesse: ${opts.link}` : "", "", "Você pode ajustar as notificações por e-mail no seu perfil."].join("\n"),
  };
}
