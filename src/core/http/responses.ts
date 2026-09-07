import { NextResponse } from "next/server";
import { AppError, toAppError } from "@/core/errors";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function created<T>(data: T) {
  return NextResponse.json(data, { status: 201 });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

/** Uniform error body: `{ error, code, details? }`. */
export function problem(e: unknown) {
  const err: AppError = toAppError(e);
  return NextResponse.json(
    {
      error: err.message,
      code: err.code,
      ...(err.details !== undefined ? { details: err.details } : {}),
    },
    { status: err.status }
  );
}
