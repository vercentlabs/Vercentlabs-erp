// How a lead or deal reached the business (its medium), shared by the API and the web. Odoo calls it the UTM medium; utm_medium values a
// website or ad sends are read into one of these.
export const CRM_MEDIUMS = Object.freeze([
  { code: "organic_search", label: "Organic search", utm: ["organic", "seo", "search"] },
  { code: "paid_search", label: "Paid search", utm: ["cpc", "ppc", "paid_search", "paidsearch", "sem", "google_ads", "adwords"] },
  { code: "social", label: "Social media", utm: ["social", "organic_social"] },
  { code: "paid_social", label: "Paid social", utm: ["paid_social", "paidsocial", "facebook_ads", "meta_ads", "instagram_ads", "linkedin_ads"] },
  { code: "email", label: "Email", utm: ["email", "newsletter", "e-mail", "mail"] },
  { code: "referral", label: "Referral", utm: ["referral", "partner", "affiliate"] },
  { code: "display", label: "Display / banner", utm: ["display", "banner", "cpm"] },
  { code: "direct", label: "Direct", utm: ["direct", "none", "(none)"] },
  { code: "event", label: "Event / trade show", utm: ["event", "expo", "trade_show", "webinar"] },
  { code: "marketplace", label: "Marketplace (IndiaMART, JustDial…)", utm: ["marketplace", "indiamart", "justdial", "tradeindia"] },
  { code: "offline", label: "Print / offline", utm: ["print", "offline", "qr", "sms", "whatsapp"] },
  { code: "other", label: "Other", utm: [] },
].map((entry) => Object.freeze(entry)));

const BY_CODE = new Map(CRM_MEDIUMS.map((entry) => [entry.code, entry]));
export const crmMediumLabel = (code) => BY_CODE.get(code)?.label ?? null;
export const isCrmMedium = (code) => BY_CODE.has(code);

// A utm_medium as a medium code (null when it means nothing we know).
export function mediumFromUtm(value) {
  const key = String(value ?? "").trim().toLowerCase();
  if (!key) return null;
  if (BY_CODE.has(key)) return key;
  return CRM_MEDIUMS.find((entry) => entry.utm.includes(key))?.code ?? "other";
}
