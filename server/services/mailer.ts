import nodemailer from "nodemailer";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../config.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly configured: boolean;
  send(msg: MailMessage): Promise<void>;
  /** Mensagens "enviadas" sem SMTP (desenvolvimento e testes). */
  outbox: MailMessage[];
}

export function createMailer(config: AppConfig, log: FastifyBaseLogger): Mailer {
  const outbox: MailMessage[] = [];
  if (!config.smtp) {
    return {
      configured: false,
      outbox,
      async send(msg) {
        outbox.push(msg);
        if (outbox.length > 200) outbox.shift();
        if (config.env === "development") log.info({ to: msg.to, subject: msg.subject }, `E-mail (SMTP não configurado):\n${msg.text}`);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return {
    configured: true,
    outbox,
    async send(msg) {
      await transport.sendMail({ from: config.mailFrom, to: msg.to, subject: msg.subject, text: msg.text });
    },
  };
}
