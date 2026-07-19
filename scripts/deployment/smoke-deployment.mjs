const landingUrl = String(process.env.LANDING_URL || "").replace(/\/$/, "");
const webUrl = String(process.env.WEB_URL || "").replace(/\/$/, "");
if (!landingUrl || !webUrl) {
  throw new Error("LANDING_URL and WEB_URL are required.");
}

async function checkJson(url, expectedService, expectedStatus) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
      redirect: "error",
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
  } finally {
    clearTimeout(timer);
  }
}

await checkJson(`${landingUrl}/api/health`, "vercentlabs-landing", "operational");
await checkJson(`${webUrl}/api/health`, "vercent-erp-web", "alive");
await checkJson(`${webUrl}/api/readiness`, "vercent-erp-web", "ready");
console.log("Landing, web health and database readiness smoke checks passed.");
