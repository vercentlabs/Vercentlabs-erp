import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const nextBinary = require.resolve("next/dist/bin/next");
const proxySecret = "browser-e2e-proxy-secret-32-characters-minimum";
const deliveries = [];
const counts = new Map();

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not resolve test-service address."));
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
    if (total > maximumBytes) throw new Error("Test request exceeded limit.");
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
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      json(response, 200, [{ result: count }, { result: 1 }]);
      return;
    }

    if (request.method === "POST" && request.url === "/capture") {
      const body = await requestBody(request);
      const timestamp = request.headers["x-vercentlabs-capture-timestamp"];
      const fingerprint = request.headers["x-vercentlabs-capture-fingerprint"];
      const signature = request.headers["x-vercentlabs-capture-signature"];

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

      deliveries.push(JSON.parse(body));
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

const landing = spawn(
  process.execPath,
  [nextBinary, "start", "-H", "127.0.0.1", "-p", String(landingPort)],
  {
    cwd: appDirectory,
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_PUBLIC_SITE_URL: landingOrigin,
      NEXT_PUBLIC_ERP_APP_URL: "",
      NEXT_PUBLIC_CONTACT_EMAIL: "test@vercentlabs.invalid",
      FORM_ALLOWED_ORIGINS: landingOrigin,
      UPSTASH_REDIS_REST_URL: mockOrigin,
      UPSTASH_REDIS_REST_TOKEN: "browser-e2e-token",
      TRUSTED_PROXY_IP_HEADER: "x-test-client-ip",
      TRUSTED_PROXY_CLIENT_INDEX: "0",
      CRM_CAPTURE_URL: `${mockOrigin}/capture`,
      DEMO_CRM_CAPTURE_URL: `${mockOrigin}/capture`,
      CRM_CAPTURE_PROXY_SECRET: proxySecret,
      WEBHOOK_TIMEOUT_MS: "3000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

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

async function waitUntilReady() {
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    if (landing.exitCode !== null) {
      throw new Error(
        `Landing server exited before readiness.\n${landingOutput}`,
      );
    }
    try {
      const response = await fetch(`${landingOrigin}/api/health`, {
        cache: "no-store",
      });
      if (response.ok) return;
    } catch {
      // Continue until the production server is available.
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`Landing server did not become ready.\n${landingOutput}`);
}

const browserRoutes = [
  "/",
  "/product",
  "/features",
  "/workflows",
  "/modules",
  "/industries",
  "/pricing",
  "/contact",
  "/book-demo",
  "/security",
  "/privacy",
  "/terms",
];

const viewports = [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

async function assertNoHorizontalOverflow(page, route, viewport) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const offenders = [...document.querySelectorAll("body *")]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.position === "fixed" || style.position === "absolute")
          return false;
        const box = element.getBoundingClientRect();
        return (
          box.width > 0 && (box.left < -2 || box.right > root.clientWidth + 2)
        );
      })
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        className: String(element.className || "").slice(0, 120),
        text: String(element.textContent || "")
          .trim()
          .slice(0, 80),
      }));

    return {
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      offenders,
    };
  });

  assert.ok(
    result.scrollWidth <= result.clientWidth + 2,
    `${route} overflows at ${viewport.width}px: ${JSON.stringify(result)}`,
  );
}

async function fillContactForm(page) {
  await page.getByLabel("Full name").fill("Browser Test Operator");
  await page.getByLabel("Work email").fill("browser-contact@example.test");
  await page.getByLabel("Organisation").fill("Browser Test Operations");
  await page.getByLabel("Discussion area").selectOption("Product pilot");
  await page
    .getByLabel("Business problem or requirement")
    .fill("Validate the public contact journey from a real browser session.");
  await page.getByRole("checkbox").check();
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Send enquiry" }).click();
  await page
    .getByText("Your enquiry has been delivered to Vercentlabs.")
    .waitFor();
}

async function fillDemoForm(page) {
  await page.getByLabel("Full name").fill("Browser Demo Operator");
  await page.getByLabel("Work email").fill("browser-demo@example.test");
  await page.getByLabel("Organisation").fill("Browser Demo Operations");
  await page.getByLabel("Area to review").selectOption("Released CRM workflow");
  await page.getByLabel("Approximate team size").selectOption("11–50");
  await page
    .getByLabel("What should the walkthrough prove?")
    .fill("Validate released CRM, permissions and approval boundaries.");
  await page.getByRole("checkbox").check();
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Request focused demo" }).click();
  await page.waitForURL(/\/request-received\?kind=demo$/, { timeout: 10_000 });
  await page
    .getByRole("heading", { name: /context is with the Vercentlabs team/i })
    .waitFor();
}

let browser;
try {
  await waitUntilReady();
  browser = await chromium.launch({ headless: true });

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport,
      extraHTTPHeaders: {
        "x-test-client-ip": `203.0.113.${viewport.width % 200}`,
      },
    });
    const page = await context.newPage();

    for (const route of browserRoutes) {
      const response = await page.goto(`${landingOrigin}${route}`, {
        waitUntil: "networkidle",
      });
      assert.equal(
        response?.status(),
        200,
        `${route} failed at ${viewport.width}px`,
      );
      await page.locator("main#main-content.marketing-main").waitFor();
      await page.locator("h1").first().waitFor();
      await assertNoHorizontalOverflow(page, route, viewport);
    }

    await context.close();
  }

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { "x-test-client-ip": "203.0.113.90" },
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(landingOrigin, { waitUntil: "networkidle" });

  await mobilePage.keyboard.press("Tab");
  assert.equal(
    await mobilePage.evaluate(() =>
      document.activeElement?.textContent?.trim(),
    ),
    "Skip to main content",
  );
  await mobilePage.keyboard.press("Enter");
  assert.equal(
    await mobilePage.evaluate(() => document.activeElement?.id),
    "main-content",
  );

  const menuButton = mobilePage.getByRole("button", {
    name: "Open navigation",
  });
  await menuButton.click();
  const dialog = mobilePage.getByRole("dialog", { name: "Mobile navigation" });
  await dialog.waitFor();
  assert.equal(
    await mobilePage.evaluate(() => document.body.style.overflow),
    "hidden",
  );
  await mobilePage.keyboard.press("Shift+Tab");
  assert.equal(
    await mobilePage.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"]')),
    ),
    true,
  );
  await mobilePage.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(
    await menuButton.evaluate((element) => element === document.activeElement),
    true,
  );

  await mobilePage.getByRole("tab", { name: /Pipeline/ }).click();
  assert.equal(
    await mobilePage
      .getByRole("tab", { name: /Pipeline/ })
      .getAttribute("aria-selected"),
    "true",
  );
  await mobilePage.getByRole("tab", { name: /Pipeline/ }).press("ArrowRight");
  assert.equal(
    await mobilePage
      .getByRole("tab", { name: /Approval trail/ })
      .getAttribute("aria-selected"),
    "true",
  );
  await mobilePage.getByRole("button", { name: "Approve preview" }).click();
  await mobilePage.getByText("Command approved").waitFor();
  await mobileContext.close();

  const formContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { "x-test-client-ip": "203.0.113.91" },
  });
  const formPage = await formContext.newPage();
  await formPage.goto(`${landingOrigin}/contact`, { waitUntil: "networkidle" });
  await fillContactForm(formPage);
  assert.equal(deliveries.at(-1)?.customData?.requestKind, "contact");

  await formPage.goto(`${landingOrigin}/book-demo`, {
    waitUntil: "networkidle",
  });
  await fillDemoForm(formPage);
  assert.equal(deliveries.at(-1)?.customData?.requestKind, "demo");
  await formContext.close();

  const reducedContext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    reducedMotion: "reduce",
  });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(landingOrigin, { waitUntil: "networkidle" });
  const hiddenReveals = await reducedPage
    .locator('[data-reveal][data-revealed="false"]')
    .count();
  assert.equal(hiddenReveals, 0, "Reduced-motion mode left content hidden.");
  await reducedContext.close();

  console.log(
    `Browser journeys verified at ${viewports.length} viewports across ${browserRoutes.length} routes, keyboard navigation, product interactions and live form delivery.`,
  );
} finally {
  if (browser) await browser.close();
  await stopLanding();
  await new Promise((resolve) => mockServer.close(resolve));
}
