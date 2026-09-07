/**
 * The one error taxonomy every module throws. `core/http` maps these onto
 * status codes, so a service never has to know it is being called over HTTP —
 * the same service can be driven by a route handler, a cron job, or a
 * LangChain tool and produce identical, typed failures.
 */
export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "POLICY_VIOLATION"
  | "UPSTREAM_FAILURE"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  POLICY_VIOLATION: 409,
  UPSTREAM_FAILURE: 502,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError("BAD_REQUEST", message, details);
  }
  static validation(message: string, details?: unknown) {
    return new AppError("VALIDATION_FAILED", message, details);
  }
  static unauthenticated(message = "Authentication required") {
    return new AppError("UNAUTHENTICATED", message);
  }
  static forbidden(message = "You do not have permission to perform this action") {
    return new AppError("FORBIDDEN", message);
  }
  static notFound(what: string) {
    return new AppError("NOT_FOUND", `${what} not found`);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError("CONFLICT", message, details);
  }
  /** A procurement guardrail refused the operation (budget, DOA, missing clause). */
  static policy(message: string, details?: unknown) {
    return new AppError("POLICY_VIOLATION", message, details);
  }
  static upstream(message: string, details?: unknown) {
    return new AppError("UPSTREAM_FAILURE", message, details);
  }
  static internal(message = "Internal error", details?: unknown) {
    return new AppError("INTERNAL", message, details);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Normalise anything thrown into an AppError without losing the message. */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  if (e instanceof Error) {
    if (/duplicate key|unique constraint/i.test(e.message)) {
      return AppError.conflict("That record already exists");
    }
    return AppError.internal(e.message);
  }
  return AppError.internal(String(e));
}
