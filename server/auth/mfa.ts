import { authenticator } from "otplib";
import QRCode from "qrcode";
import { randomBytes } from "node:crypto";
import { sha256 } from "../lib/crypto.js";

authenticator.options = { window: 1, step: 30, digits: 6 };

export function generateMfaSecret(): string {
  return authenticator.generateSecret(20);
}

export async function mfaEnrollmentData(secret: string, account: string, issuer: string) {
  const uri = authenticator.keyuri(account, issuer, secret);
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  return { uri, qrDataUrl, secret };
}

/**
 * Valida o código TOTP e devolve o passo de tempo correspondente (ou null).
 * O passo é guardado para impedir a reutilização do mesmo código.
 */
export function verifyTotp(token: string, secret: string, lastStep: number | null): number | null {
  const clean = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const delta = authenticator.checkDelta(clean, secret);
  if (delta === null) return null;
  const step = Math.floor(Date.now() / 1000 / 30) + delta;
  if (lastStep !== null && step <= lastStep) return null;
  return step;
}

export function generateTotp(secret: string): string {
  return authenticator.generate(secret);
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(8);
    const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return sha256(code.trim().toLowerCase());
}
