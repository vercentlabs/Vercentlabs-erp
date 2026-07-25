const landingUrl = String(process.env.LANDING_URL || "").replace(/\/$/, "");
const webUrl = String(process.env.WEB_URL || "").replace(/\/$/, "");
if (!landingUrl || !webUrl) {
  throw new Error("LANDING_URL and WEB_URL are required.");
}

function timeoutSignal(milliseconds = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function checkedFetch(url, options = {}) {
  const timeout = timeoutSignal();
  try {
    return await fetch(url, {
      cache: "no-store",
      redirect: "error",
      ...options,
      signal: timeout.signal,
    });
  } finally {
    timeout.clear();
  }
}

async function checkJson(url, expectedService, expectedStatus) {
  const response = await checkedFetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`${url} did not return JSON.`);
  }
  const data = await response.json();
  if (
    data.ok !== true ||
    data.service !== expectedService ||
    data.status !== expectedStatus
  ) {
    throw new Error(`${url} returned an unexpected service status.`);
  }
  return data;
}

async function checkLandingPage(pathname) {
  const url = `${landingUrl}${pathname}`;
  const response = await checkedFetch(url, {
    headers: { Accept: "text/html" },
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    throw new Error(`${url} did not return HTML.`);
  }
  const html = await response.text();
  if (!/VercentLabs/i.test(html)) {
    throw new Error(`${url} omitted the VercentLabs product identity.`);
  }
  if (/Application error: a client-side exception/i.test(html)) {
    throw new Error(`${url} contains a client-side application failure.`);
  }
  return response;
}

await checkJson(
  `${landingUrl}/api/health`,
  "vercentlabs-landing",
  "operational",
);
await checkJson(`${webUrl}/api/health`, "vercent-erp-web", "alive");
await checkJson(`${webUrl}/api/readiness`, "vercent-erp-web", "ready");

const landingRoutes = [
  "/",
  "/product",
  "/features",
  "/workflows",
  "/modules",
  "/pricing",
  "/book-demo",
  "/contact",
  "/security",
  "/status",
];
for (const pathname of landingRoutes) await checkLandingPage(pathname);

const homepage = await checkedFetch(landingUrl, {
  headers: { Accept: "text/html" },
});
for (const header of [
  "content-security-policy",
  "referrer-policy",
  "x-content-type-options",
  "x-frame-options",
]) {
  if (!homepage.headers.get(header)) {
    throw new Error(`Landing security header missing: ${header}.`);
  }
}

for (const pathname of [
  "/manifest.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
]) {
  const response = await checkedFetch(`${landingUrl}${pathname}`);
  if (!response.ok) {
    throw new Error(
      `${landingUrl}${pathname} returned HTTP ${response.status}.`,
    );
  }
}

const smokeEmail = String(process.env.SMOKE_LEAD_EMAIL || "").trim();
if (smokeEmail) {
  const response = await checkedFetch(`${landingUrl}/api/contact`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: new URL(landingUrl).origin,
      "User-Agent": "VercentLabs-Production-Smoke/1.0",
    },
    body: JSON.stringify({
      name: "Production Smoke Check",
      email: smokeEmail,
      company: String(
        process.env.SMOKE_LEAD_COMPANY || "VercentLabs QA",
      ).trim(),
      phone: "",
      interest: "Product pilot",
      teamSize: "",
      message:
        "Automated production smoke request. Safe to archive after delivery verification.",
      consent: true,
      website: "",
      startedAt: Date.now() - 2500,
    }),
  });
  const result = await response.json().catch(() => null);
  if (response.status !== 202 || result?.ok !== true) {
    throw new Error(
      `Live landing delivery smoke failed with HTTP ${response.status}: ${JSON.stringify(result)}`,
    );
  }
  console.log(`Live landing delivery accepted for ${smokeEmail}.`);
} else {
  console.log(
    "Live landing delivery was not submitted. Set SMOKE_LEAD_EMAIL to verify the deployed CRM/webhook destination.",
  );
}

console.log(
  `Landing pages (${landingRoutes.length}), public assets, security headers, web health and database readiness smoke checks passed.`,
);
