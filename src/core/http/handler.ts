import { z } from "zod";
import { AppError } from "@/core/errors";
import { logger } from "@/core/logger";
import { problem } from "./responses";

export type RouteHandler<C = unknown> = (req: Request, ctx: C) => Promise<Response>;

/**
 * Wraps a route handler so every module's HTTP surface fails the same way:
 * thrown `AppError`s become their mapped status, anything else becomes a
 * logged 500 that does not leak internals to the caller.
 */
export function withRoute<C>(name: string, handler: RouteHandler<C>): RouteHandler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      if (!(e instanceof AppError) || e.status >= 500) {
        logger.error(`route ${name} failed`, {
          message: e instanceof Error ? e.message : String(e),
        });
      }
      return problem(e);
    }
  };
}

/** Parse a JSON body against a Zod schema, or throw a 422 with field errors. */
export async function parseJson<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw AppError.badRequest("Invalid JSON body");
  }
  return parseInput(schema, raw);
}

/** Parse an already-materialised value against a Zod schema. */
export function parseInput<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw AppError.validation("Validation failed", parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

/** Read a bounded integer query parameter. */
export function intParam(url: URL, key: string, fallback: number, max: number): number {
  const n = Number(url.searchParams.get(key) ?? fallback) || fallback;
  return Math.min(Math.max(1, n), max);
}
