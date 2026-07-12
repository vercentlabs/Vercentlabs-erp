const fallbackSiteUrl = "http://localhost:3000";

function normalizeUrl(value: string | undefined): string {
  const candidate = value?.trim() || fallbackSiteUrl;

  try {
    return new URL(candidate).origin;
  } catch {
    return fallbackSiteUrl;
  }
}

export const siteConfig = {
  name: "VercentLabs",
  productName: "Vercent ERP",
  title: "Vercent ERP — One Connected Enterprise Platform",
  description:
    "Connect finance, sales, procurement, inventory, manufacturing, people, projects and analytics through one enterprise ERP platform.",
  siteUrl: normalizeUrl(process.env.NEXT_PUBLIC_SITE_URL),
  appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3001",
  email: "vercentlabs@gmail.com",
  locale: "en_IN",
  themeColor: "#080c18",
} as const;
