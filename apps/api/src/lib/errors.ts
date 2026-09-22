/**
 * Structured API errors. Every error returned by NATIO has a stable `code`,
 * an HTTP status, a human message and optional `param`/`details`.
 */
export type ErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "permission_error"
  | "not_found_error"
  | "idempotency_error"
  | "rate_limit_error"
  | "state_error"
  | "provider_error"
  | "risk_error"
  | "internal_error";

export class ApiError extends Error {
  readonly status: number;
  readonly type: ErrorType;
  readonly code: string;
  readonly param?: string;
  readonly details?: unknown;

  constructor(status: number, type: ErrorType, code: string, message: string, opts: { param?: string; details?: unknown } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.type = type;
    this.code = code;
    this.param = opts.param;
    this.details = opts.details;
  }

  toJSON() {
    return {
      error: {
        type: this.type,
        code: this.code,
        message: this.message,
        ...(this.param ? { param: this.param } : {}),
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export const Errors = {
  validation: (message: string, details?: unknown, param?: string) =>
    new ApiError(422, "invalid_request_error", "validation_failed", message, { details, param }),
  badRequest: (code: string, message: string, param?: string) => new ApiError(400, "invalid_request_error", code, message, { param }),
  unauthorized: (message = "Authentication required") => new ApiError(401, "authentication_error", "unauthorized", message),
  invalidApiKey: () => new ApiError(401, "authentication_error", "invalid_api_key", "Invalid or revoked API key"),
  forbidden: (message = "You do not have permission to perform this action") =>
    new ApiError(403, "permission_error", "forbidden", message),
  ipNotAllowed: () => new ApiError(403, "permission_error", "ip_not_allowed", "Request IP is not in the project allow-list"),
  notFound: (entity: string, id?: string) =>
    new ApiError(404, "not_found_error", "resource_not_found", id ? `${entity} ${id} was not found` : `${entity} was not found`),
  conflict: (code: string, message: string) => new ApiError(409, "state_error", code, message),
  idempotencyMismatch: () =>
    new ApiError(
      422,
      "idempotency_error",
      "idempotency_key_reused",
      "Idempotency-Key was already used with a different request payload",
    ),
  idempotencyInProgress: () =>
    new ApiError(409, "idempotency_error", "idempotency_in_progress", "A request with this Idempotency-Key is still being processed"),
  invalidTransition: (entity: string, from: string, to: string) =>
    new ApiError(409, "state_error", "invalid_state_transition", `${entity} cannot move from ${from} to ${to}`),
  rateLimited: () => new ApiError(429, "rate_limit_error", "rate_limited", "Too many requests"),
  providerUnavailable: () =>
    new ApiError(503, "provider_error", "no_route_available", "No eligible provider is available for this request"),
  internal: () => new ApiError(500, "internal_error", "internal_error", "An internal error occurred"),
};
