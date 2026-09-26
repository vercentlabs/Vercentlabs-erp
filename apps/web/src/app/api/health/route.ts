// Liveness (Kubernetes livenessProbe): the Node process and its event loop
// answer. Deliberately no database or provider call — a slow dependency must
// never get a healthy pod restarted. Public, unauthenticated, no data.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
