import { HttpError } from "./http-errors.ts";

export const MAX_JSON_BYTES = 100_000;

// Bounds the bytes actually received; Content-Length may be absent or false.
export async function readJsonBody(request: Request, maximumBytes = MAX_JSON_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > maximumBytes) throw new HttpError(413, "The request is too large.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(413, "The request is too large.");
      }
      chunks.push(value);
    }
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON request.");
  }
}
