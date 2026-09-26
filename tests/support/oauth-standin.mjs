// A deterministic local stand-in for the OAuth 2.0 Authorization Code + PKCE
// flow of Google and Microsoft, so CI never needs real provider credentials.
// It validates what a real provider validates for this flow (client
// credentials, exact redirect_uri, S256 code_challenge vs code_verifier,
// single-use codes, refresh tokens) and lets tests switch behaviour:
//   consent "deny"        the authorize step returns error=access_denied
//   rotateRefreshTokens   refresh issues a new refresh token (default true)
//   expiresIn             access-token lifetime in seconds
//   failNextToken         the next token call answers 503
// Real-provider smoke tests stay optional and secret-gated.
//
// CLI (used by the Playwright config):
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... node tests/support/oauth-standin.mjs --port 3198
import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";

const unsignedJwt = (claims) =>
  `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.`;

export async function startOAuthStandIn({ port = 0, clients = {} } = {}) {
  const codes = new Map();
  const refreshTokens = new Map();
  const config = { consent: "allow", rotateRefreshTokens: true, expiresIn: 3600, failNextToken: false, account: { sub: "standin-user-1", email: "connected.user@example.test", name: "Connected User" } };
  const requests = [];

  const clientFor = (provider) => clients[provider];
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const readForm = (req) =>
    new Promise((resolve) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(raw))));
    });
  const readJson = (req) =>
    new Promise((resolve) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => resolve(raw ? JSON.parse(raw) : {}));
    });
  const issueTokens = (provider, scope, clientId) => {
    const refresh = `rt_${randomUUID()}`;
    refreshTokens.set(refresh, { provider, scope, clientId });
    return {
      access_token: `at_${randomUUID()}`,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: config.expiresIn,
      scope,
      id_token: unsignedJwt({ ...config.account, aud: clientId }),
    };
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://standin");
    const [, provider, step] = url.pathname.split("/");
    requests.push({ method: req.method, path: url.pathname });

    if (url.pathname === "/__control/config" && req.method === "POST") {
      Object.assign(config, await readJson(req));
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/__control/revoke" && req.method === "POST") {
      const { refreshToken } = await readJson(req);
      if (refreshToken) refreshTokens.delete(refreshToken);
      else refreshTokens.clear();
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/__control/requests") return send(res, 200, { requests });

    const client = clientFor(provider);
    if (!client) return send(res, 404, { error: "unknown_provider" });

    if (step === "authorize" && req.method === "GET") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      if (url.searchParams.get("client_id") !== client.clientId || !redirectUri) return send(res, 400, { error: "invalid_client" });
      if (url.searchParams.get("code_challenge_method") !== "S256" || !url.searchParams.get("code_challenge")) return send(res, 400, { error: "invalid_request", error_description: "PKCE S256 is required" });
      const target = new URL(redirectUri);
      if (config.consent === "deny") {
        target.searchParams.set("error", "access_denied");
      } else {
        const code = `code_${randomUUID()}`;
        codes.set(code, { challenge: url.searchParams.get("code_challenge"), redirectUri, clientId: client.clientId, scope: url.searchParams.get("scope") || "" });
        target.searchParams.set("code", code);
      }
      target.searchParams.set("state", state ?? "");
      res.writeHead(302, { Location: target.toString() });
      return res.end();
    }

    if (step === "token" && req.method === "POST") {
      const form = await readForm(req);
      if (config.failNextToken) {
        config.failNextToken = false;
        return send(res, 503, { error: "temporarily_unavailable" });
      }
      if (form.client_id !== client.clientId || form.client_secret !== client.clientSecret) return send(res, 401, { error: "invalid_client" });
      if (form.grant_type === "authorization_code") {
        const issued = codes.get(form.code);
        codes.delete(form.code);
        if (!issued) return send(res, 400, { error: "invalid_grant", error_description: "unknown or used code" });
        if (issued.redirectUri !== form.redirect_uri) return send(res, 400, { error: "invalid_grant", error_description: "redirect_uri mismatch" });
        const challenge = createHash("sha256").update(String(form.code_verifier || "")).digest("base64url");
        if (challenge !== issued.challenge) return send(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });
        return send(res, 200, issueTokens(provider, issued.scope, client.clientId));
      }
      if (form.grant_type === "refresh_token") {
        const known = refreshTokens.get(form.refresh_token);
        if (!known) return send(res, 400, { error: "invalid_grant", error_description: "refresh token revoked or unknown" });
        const tokens = issueTokens(provider, known.scope, client.clientId);
        if (!config.rotateRefreshTokens) {
          refreshTokens.delete(tokens.refresh_token);
          delete tokens.refresh_token;
        } else {
          refreshTokens.delete(form.refresh_token);
        }
        return send(res, 200, tokens);
      }
      return send(res, 400, { error: "unsupported_grant_type" });
    }
    return send(res, 404, { error: "not_found" });
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    config,
    requests,
    async setConfig(patch) {
      Object.assign(config, patch);
    },
    revokeAllRefreshTokens() {
      refreshTokens.clear();
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const portIndex = process.argv.indexOf("--port");
  const port = portIndex > 0 ? Number(process.argv[portIndex + 1]) : 3198;
  const clients = {};
  for (const [provider, prefix] of [["google", "GOOGLE"], ["microsoft", "MICROSOFT"]]) {
    const clientId = process.env[`${prefix}_OAUTH_CLIENT_ID`];
    const clientSecret = process.env[`${prefix}_OAUTH_CLIENT_SECRET`];
    if (clientId && clientSecret) clients[provider] = { clientId, clientSecret };
  }
  const standin = await startOAuthStandIn({ port, clients });
  console.log(`OAuth stand-in listening on ${standin.baseUrl}`);
}
