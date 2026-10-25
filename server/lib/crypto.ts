import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Utilitários que dependem do segredo da aplicação (APP_SECRET). */
export class Secrets {
  private readonly encKey: Buffer;
  private readonly macKey: Buffer;

  constructor(appSecret: string) {
    const ikm = Buffer.from(appSecret, "utf8");
    this.encKey = Buffer.from(hkdfSync("sha256", ikm, Buffer.from("lifeclass"), Buffer.from("enc:v1"), 32));
    this.macKey = Buffer.from(hkdfSync("sha256", ikm, Buffer.from("lifeclass"), Buffer.from("mac:v1"), 32));
  }

  /** Hash irreversível com chave (ex.: IP nos registros de aceite dos termos). */
  hmac(value: string): string {
    return createHmac("sha256", this.macKey).update(value).digest("hex");
  }

  /** AES-256-GCM: usado para o segredo do MFA guardado no banco. */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encKey, iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
  }

  decrypt(payload: string): string {
    const [v, iv, tag, enc] = payload.split(".");
    if (v !== "v1" || !iv || !tag || !enc) throw new Error("Formato de dado cifrado inválido");
    const decipher = createDecipheriv("aes-256-gcm", this.encKey, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(enc, "base64url")), decipher.final()]).toString("utf8");
  }
}
