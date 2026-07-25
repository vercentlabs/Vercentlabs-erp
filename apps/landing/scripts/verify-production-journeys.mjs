import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const standaloneServer = path.join(
  appDirectory,
  ".next",
  "standalone",
  "apps",
  "landing",
  "server.js",
);
await access(standaloneServer);
const proxySecret = "landing-e2e-proxy-secret-32-characters-minimum";
const deliveries = [];
const rateCounts = new Map();

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not resolve mock-service address."));
        return;
      }
      resolve(address.port);
    });
  });
}

async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function requestBody(request, maximumBytes = 100_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) throw new Error("Mock request exceeded limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

const mockServer = http.createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/pipeline") {
      const commands = JSON.parse(await requestBody(request));
      const key = String(commands?.[0]?.[1] || "");
      const count = (rateCounts.get(key) || 0) + 1;
      rateCounts.set(key, count);
      json(response, 200, [{ result: count }, { result: 1 }]);
      return;
    }

    if (request.method === "POST" && request.url === "/capture") {
      const body = await requestBody(request);
      const timestamp = request.headers["x-vercent-capture-timestamp"];
      const fingerprint = request.headers["x-vercent-capture-fingerprint"];
      const signature = request.headers["x-vercent-capture-signature"];

      assert.equal(typeof timestamp, "string");
      assert.equal(typeof fingerprint, "string");
      assert.equal(typeof signature, "string");
      assert.ok(Math.abs(Date.now() - Number(timestamp)) < 60_000);

      const expected = createHmac("sha256", proxySecret)
        .update(`${timestamp}.${fingerprint}.${body}`)
        .digest();
      const received = Buffer.from(signature, "hex");
      assert.equal(received.length, expected.length);
      assert.ok(timingSafeEqual(received, expected));

      deliveries.push({
        body: JSON.parse(body),
        origin: request.headers.origin,
      });
      json(response, 202, { ok: true });
      return;
    }

    json(response, 404, { ok: false });
  } catch (error) {
    json(response, 500, {
      ok: false,
      message: error instanceof Error ? error.message : "Mock-service error",
    });
  }
});

const mockPort = await listen(mockServer);
const mockOrigin = `http://127.0.0.1:${mockPort}`;
const landingPort = await freePort();
const landingOrigin = `http://127.0.0.1:${landingPort}`;
let landingOutput = "";

const landing = spawn(process.execPath, [standaloneServer], {
  cwd: path.dirname(standaloneServer),
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(landingPort),
    NEXT_PUBLIC_SITE_URL: landingOrigin,
    NEXT_PUBLIC_ERP_APP_URL: "",
    NEXT_PUBLIC_CONTACT_EMAIL: "test@vercentlabs.invalid",
    FORM_ALLOWED_ORIGINS: landingOrigin,
    UPSTASH_REDIS_REST_URL: mockOrigin,
    UPSTASH_REDIS_REST_TOKEN: "landing-e2e-token",
    TRUSTED_PROXY_IP_HEADER: "x-vercent-test-client-ip",
    TRUSTED_PROXY_CLIENT_INDEX: "0",
    CRM_CAPTURE_URL: `${mockOrigin}/capture`,
    DEMO_CRM_CAPTURE_URL: `${mockOrigin}/capture`,
    CRM_CAPTURE_PROXY_SECRET: proxySecret,
    WEBHOOK_TIMEOUT_MS: "3000",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

landing.stdout.on("data", (chunk) => {
  landingOutput += chunk.toString();
});
landing.stderr.on("data", (chunk) => {
  landingOutput += chunk.toString();
});

async function stopLanding() {
  if (landing.exitCode !== null) return;
  landing.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => landing.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]);
  if (landing.exitCode === null) landing.kill("SIGKILL");
}

async function fetchWithTimeout(url, options = {}, timeout = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function waitUntilReady() {
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    if (landing.exitCode !== null) {
      throw new Error(
        `Landing server exited before readiness.\n${landingOutput}`,
      );
    }
    try {
      const response = await fetchWithTimeout(
        `${landingOrigin}/api/health`,
        {},
        1500,
      );
      if (response.ok) return;
    } catch {
      // Continue until the production server is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`Landing server did not become ready.\n${landingOutput}`);
}

const publicRoutes = [
  "/",
  "/about",
  "/api-developers",
  "/book-demo",
  "/careers",
  "/changelog",
  "/comparison",
  "/contact",
  "/customers",
  "/features",
  "/help",
  "/how-it-works",
  "/industries",
  "/industries/manufacturing",
  "/industries/distribution",
  "/industries/retail",
  "/industries/professional-services",
  "/industries/construction",
  "/industries/multi-company",
  "/login",
  "/modules",
  "/modules/accounting",
  "/modules/procurement",
  "/modules/sales",
  "/modules/crm",
  "/modules/stock",
  "/modules/manufacturing",
  "/modules/projects",
  "/modules/assets",
  "/modules/point-of-sale",
  "/modules/quality",
  "/modules/support",
  "/modules/hr-payroll",
  "/partner",
  "/pricing",
  "/privacy",
  "/product",
  "/request-received",
  "/security",
  "/status",
  "/terms",
  "/workflows",
];

async function assertPage(route) {
  const response = await fetchWithTimeout(`${landingOrigin}${route}`, {
    headers: { Accept: "text/html" },
    redirect: "manual",
  });
  assert.equal(response.status, 200, `${route} returned ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  assert.match(contentType, /text\/html/);
  const html = await response.text();
  assert.match(html, /VercentLabs/i, `${route} omitted the product identity`);
  assert.doesNotMatch(html, /Application error: a client-side exception/i);
  return { response, html };
}

function validPayload(overrides = {}) {
  return {
    name: "Test Operator",
    email: "operator@example.test",
    company: "Example Operations",
    phone: "+91 98765 43210",
    interest: "ERP discovery",
    teamSize: "",
    message: "We need to validate a complete customer workflow.",
    consent: true,
    website: "",
    startedAt: Date.now() - 2500,
    ...overrides,
  };
}

async function submit(pathname, payload, options = {}) {
  return fetchWithTimeout(`${landingOrigin}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": options.contentType || "application/json",
      Origin: options.origin || landingOrigin,
      "x-vercent-test-client-ip": options.ip || "203.0.113.10",
    },
    body:
      (options.contentType || "application/json") === "application/json"
        ? JSON.stringify(payload)
        : String(payload),
  });
}

function internalLinks(html) {
  const links = new Set();
  for (const match of html.matchAll(/href=["']([^"']+)["']/g)) {
    const href = match[1].replaceAll("&amp;", "&");
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    const parsed = new URL(href, landingOrigin);
    if (
      parsed.origin !== landingOrigin ||
      parsed.pathname.startsWith("/_next/")
    ) {
      continue;
    }
    links.add(parsed.pathname + parsed.search);
  }
  return links;
}

try {
  await waitUntilReady();

  const discoveredLinks = new Set();
  for (const route of publicRoutes) {
    const { html } = await assertPage(route);
    for (const href of internalLinks(html)) discoveredLinks.add(href);
  }

  for (const href of discoveredLinks) {
    const response = await fetchWithTimeout(`${landingOrigin}${href}`, {
      redirect: "manual",
    });
    assert.ok(
      response.status >= 200 && response.status < 400,
      `Internal link ${href} returned ${response.status}`,
    );
  }

  async function redirectDestination(response, label) {
    const location = response.headers.get("location");
    if ([307, 308].includes(response.status) && location) {
      return new URL(location, landingOrigin);
    }
    if (response.status === 200) {
      const html = await response.text();
      const encoded = html.match(/content="1;url=([^"]+)"/)?.[1];
      assert.ok(encoded, `${label} omitted its Next.js redirect destination`);
      return new URL(encoded, landingOrigin);
    }
    assert.fail(`${label} returned unexpected status ${response.status}`);
  }

  const signupRedirect = await fetchWithTimeout(`${landingOrigin}/signup`, {
    redirect: "manual",
  });
  const signupDestination = await redirectDestination(
    signupRedirect,
    "/signup",
  );
  assert.ok(
    signupDestination.pathname === "/book-demo" ||
      signupDestination.pathname === "/signup",
    `/signup redirected to unexpected destination ${signupDestination}`,
  );

  const legacyVerifyRedirect = await fetchWithTimeout(
    `${landingOrigin}/signup/verify`,
    { redirect: "manual" },
  );
  assert.equal(
    (await redirectDestination(legacyVerifyRedirect, "/signup/verify"))
      .pathname,
    "/request-received",
  );

  for (const asset of [
    "/icon",
    "/opengraph-image",
    "/manifest.webmanifest",
    "/robots.txt",
    "/sitemap.xml",
  ]) {
    const response = await fetchWithTimeout(`${landingOrigin}${asset}`);
    assert.equal(response.status, 200, `${asset} returned ${response.status}`);
  }

  const home = await fetchWithTimeout(landingOrigin);
  for (const header of [
    "content-security-policy",
    "cross-origin-opener-policy",
    "referrer-policy",
    "x-content-type-options",
    "x-frame-options",
  ]) {
    assert.ok(home.headers.get(header), `Security header missing: ${header}`);
  }

  const contact = await submit("/api/contact", validPayload());
  assert.equal(contact.status, 202);
  assert.equal((await contact.json()).ok, true);
  assert.equal(deliveries.at(-1)?.body?.customData?.requestKind, "contact");

  const demo = await submit(
    "/api/demo",
    validPayload({
      interest: "Released CRM workflow",
      teamSize: "11–50",
      message: "Show the released CRM and permission boundaries.",
    }),
    { ip: "203.0.113.11" },
  );
  assert.equal(demo.status, 202);
  assert.equal((await demo.json()).ok, true);
  assert.equal(deliveries.at(-1)?.body?.customData?.requestKind, "demo");

  const legacy = await submit(
    "/api/signup",
    validPayload({
      interest: "Mobile CRM",
      teamSize: "1–10",
      message: "Review the mobile CRM journey.",
    }),
    { ip: "203.0.113.12" },
  );
  assert.equal(legacy.status, 202);
  assert.equal(legacy.headers.get("deprecation"), "true");

  const invalidOrigin = await submit("/api/contact", validPayload(), {
    origin: "https://attacker.example",
    ip: "203.0.113.13",
  });
  assert.equal(invalidOrigin.status, 403);

  const invalidContentType = await submit(
    "/api/contact",
    JSON.stringify(validPayload()),
    {
      contentType: "text/plain",
      ip: "203.0.113.14",
    },
  );
  assert.equal(invalidContentType.status, 415);

  const invalidPayload = await submit(
    "/api/contact",
    validPayload({ email: "not-an-email" }),
    { ip: "203.0.113.15" },
  );
  assert.equal(invalidPayload.status, 400);

  const invalidDemoInterest = await submit(
    "/api/demo",
    validPayload({ interest: "Unreleased finance automation" }),
    { ip: "203.0.113.17" },
  );
  assert.equal(invalidDemoInterest.status, 400);

  const tooFast = await submit(
    "/api/contact",
    validPayload({ startedAt: Date.now() }),
    { ip: "203.0.113.18" },
  );
  assert.equal(tooFast.status, 400);

  const missingProxy = await fetchWithTimeout(`${landingOrigin}/api/contact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: landingOrigin,
    },
    body: JSON.stringify(validPayload()),
  });
  assert.equal(missingProxy.status, 503);

  const oversized = await submit("/api/contact", "x".repeat(50_100), {
    contentType: "text/plain",
    ip: "203.0.113.19",
  });
  assert.equal(oversized.status, 415);

  const oversizedJson = await fetchWithTimeout(`${landingOrigin}/api/contact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: landingOrigin,
      "x-vercent-test-client-ip": "203.0.113.19",
    },
    body: JSON.stringify({ payload: "x".repeat(50_100) }),
  });
  assert.equal(oversizedJson.status, 413);

  const deliveriesBeforeHoneypot = deliveries.length;
  const honeypot = await submit(
    "/api/contact",
    validPayload({ website: "https://bot.example" }),
    { ip: "203.0.113.16" },
  );
  assert.equal(honeypot.status, 202);
  assert.equal(deliveries.length, deliveriesBeforeHoneypot);

  let limitedResponse;
  for (let index = 0; index < 6; index += 1) {
    limitedResponse = await submit(
      "/api/contact",
      validPayload({
        email: `rate-${index}@example.test`,
        message: `Rate-limit verification request number ${index + 1}.`,
      }),
      { ip: "203.0.113.20" },
    );
  }
  assert.equal(limitedResponse?.status, 429);
  assert.ok(Number(limitedResponse?.headers.get("retry-after")) >= 1);

  console.log(
    `Production landing journeys verified across ${publicRoutes.length} HTML routes, signed CRM delivery, abuse controls and security headers.`,
  );
} finally {
  await stopLanding();
  await new Promise((resolve) => mockServer.close(resolve));
}
