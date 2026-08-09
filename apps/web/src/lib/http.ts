import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createLogger } from "@vercentlabs/observability";

const logger = createLogger("vercentlabs-web");

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export function ok(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    { ok: true, ...data },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function fail(
  message: string,
  status = 400,
  details?: Record<string, unknown>,
) {
  return NextResponse.json(
    { ok: false, message, ...details },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function failWithCode(error: HttpError) {
  return fail(
    error.message,
    error.status,
    error.code ? { code: error.code } : undefined,
  );
}

export async function readJson(request: Request): Promise<unknown> {
  const maximumBytes = 100_000;
  const length = Number(request.headers.get("content-length") || "0");
  if (length > maximumBytes)
    throw new HttpError(413, "The request is too large.");

  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Invalid JSON request.");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new HttpError(413, "The request is too large.");
      }
      chunks.push(value);
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    if (totalBytes > maximumBytes)
      throw new HttpError(413, "The request is too large.");
    throw new HttpError(400, "Invalid JSON request.");
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) return failWithCode(error);
  if (error instanceof ZodError) {
    return fail("Review the submitted fields.", 400, {
      errors: error.flatten().fieldErrors,
    });
  }
  logger.error("request_failed", { error });
  return fail("The request could not be completed.", 500);
}
