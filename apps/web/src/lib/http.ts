import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function ok(data: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export function fail(
  message: string,
  status = 400,
  details?: Record<string, unknown>,
) {
  return NextResponse.json({ ok: false, message, ...details }, { status });
}

export async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") || "0");
  if (length > 100_000) throw new HttpError(413, "The request is too large.");
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON request.");
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) return fail(error.message, error.status);
  if (error instanceof ZodError) {
    return fail("Review the submitted fields.", 400, {
      errors: error.flatten().fieldErrors,
    });
  }
  console.error(error);
  return fail("The request could not be completed.", 500);
}
