import http from "node:http";

// Kubernetes probes for the worker (no public exposure; the NetworkPolicy
// admits only the kubelet). Deliberately separate signals:
//   GET /livez   the process and its event loop are alive. A failing job,
//                an unreachable provider or a slow database never fails
//                this, so Kubernetes does not kill a healthy worker.
//   GET /readyz  polling has started and a poll cycle completed recently (or
//                one is still running inside its lease window). Used for
//                rollout readiness and alerting, not for restarts.
export function evaluateWorkerHealth(state, config, now = Date.now()) {
  const staleAfter = Math.max(config.worker.pollIntervalMilliseconds * 6, 120_000);
  if (state.stopping) return { live: true, ready: false, reason: "stopping" };
  if (!state.startedAt) return { live: true, ready: false, reason: "starting" };
  const pollRunning = state.pollStartedAt && (!state.pollCompletedAt || state.pollStartedAt > state.pollCompletedAt);
  if (pollRunning && now - state.pollStartedAt <= config.worker.leaseMilliseconds) return { live: true, ready: true, reason: "polling" };
  if (state.pollCompletedAt && now - state.pollCompletedAt <= staleAfter) return { live: true, ready: true, reason: "ok" };
  return { live: true, ready: false, reason: "poll-stale" };
}

export function startWorkerHealthServer(state, config, { port = config.worker.healthPort, host = "0.0.0.0" } = {}) {
  const server = http.createServer((request, response) => {
    const verdict = evaluateWorkerHealth(state, config);
    const send = (status, body) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(body));
    };
    if (request.method !== "GET") return send(405, { status: "method_not_allowed" });
    if (request.url === "/livez") return send(200, { status: "ok" });
    if (request.url === "/readyz") return send(verdict.ready ? 200 : 503, { status: verdict.ready ? "ok" : "unavailable", reason: verdict.reason });
    return send(404, { status: "not_found" });
  });
  server.listen(port, host);
  return { server, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
