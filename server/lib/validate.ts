import { z } from "zod";
import { badRequest } from "./errors.js";

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw badRequest("Dados inválidos. Revise os campos destacados.", details);
  }
  return result.data;
}

export const uuidParam = z.object({ id: z.string().uuid() });
export const zUuid = z.string().uuid();
export const zText = (max = 5000) => z.string().trim().max(max);
export const zRequiredText = (max = 500) => z.string().trim().min(1, "Campo obrigatório").max(max);
export const zOptionalUuid = z.string().uuid().nullable().optional();
