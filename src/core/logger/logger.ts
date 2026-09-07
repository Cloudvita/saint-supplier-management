type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (raw in LEVEL_ORDER) return LEVEL_ORDER[raw as Level];
  return process.env.NODE_ENV === "production" ? LEVEL_ORDER.info : LEVEL_ORDER.debug;
}

/** Keys whose values are never written to a log line, at any depth. */
const REDACT = /^(taxid|password|passwordhash|secret|token|authorization|apikey|api_key)$/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export type Logger = {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
};

function emit(level: Level, scope: string, bindings: Record<string, unknown>, msg: string, meta?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < threshold()) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(redact(bindings) as Record<string, unknown>),
    ...((meta ? redact(meta) : undefined) as Record<string, unknown> | undefined),
  };
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(JSON.stringify(line));
}

/**
 * Structured logger. Every module gets its own scoped instance
 * (`createLogger("suppliers")`) so log lines are attributable to a module
 * without the module knowing anything about the transport.
 */
export function createLogger(scope: string, bindings: Record<string, unknown> = {}): Logger {
  return {
    debug: (m, meta) => emit("debug", scope, bindings, m, meta),
    info: (m, meta) => emit("info", scope, bindings, m, meta),
    warn: (m, meta) => emit("warn", scope, bindings, m, meta),
    error: (m, meta) => emit("error", scope, bindings, m, meta),
    child: (extra) => createLogger(scope, { ...bindings, ...extra }),
  };
}

export const logger = createLogger("saint");
