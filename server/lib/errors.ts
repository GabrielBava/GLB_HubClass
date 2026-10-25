export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "Sessão expirada. Entre novamente.") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "Você não tem permissão para acessar este recurso.", code = "forbidden") =>
  new HttpError(403, code, message);
export const notFound = (message = "Não encontrado.") => new HttpError(404, "not_found", message);
export const conflict = (message: string) => new HttpError(409, "conflict", message);
export const tooMany = (message = "Muitas tentativas. Aguarde um pouco e tente novamente.") =>
  new HttpError(429, "too_many_requests", message);
