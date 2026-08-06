export function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

/** A short, non-guessable id for correlating a submission across client logs, server logs, and support. */
export function generateRequestId(): string {
  return crypto.randomUUID();
}
