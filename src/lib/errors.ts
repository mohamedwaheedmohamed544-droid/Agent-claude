export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const unauthorized = (m = "Authentication required") => new AppError(401, "unauthorized", m);
export const forbidden = (m = "You do not have permission to perform this action") => new AppError(403, "forbidden", m);
export const notFound = (m = "Not found") => new AppError(404, "not_found", m);
export const badRequest = (m: string, details?: unknown) => new AppError(400, "bad_request", m, details);
export const conflict = (m: string) => new AppError(409, "conflict", m);
export const tooMany = (m = "Too many requests, please slow down") => new AppError(429, "rate_limited", m);
export const unavailable = (m: string) => new AppError(503, "unavailable", m);
