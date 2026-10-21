// Signup — reading a business's public website (MVP 44). Up to 2 pages (the home page and one About / Services / Products / Menu page),
// only their visible text, at most about 3,000 words. Anyone can type any address, so: https only (an http:// address is tried as
// https://), never our own servers or private networks (the outgoing-webhook address guard, re-checked after every redirect and pinned
// for the connection), at most 3 redirects and 1 MB per page, HTML only, 4 seconds per page.
import { Agent, request as undiciRequest } from "undici";

import { SsrfError, resolveSafeAddress, validateWebhookUrl } from "../../platform/integrations/webhooks/ssrf.js";

const MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_WORDS = 3000;
const PAGE_TIMEOUT_MS = 4000;
const NEXT_PAGE = /^(about( us)?|services|our services|products|our products|menu|what we do)$/i;

export class WebsiteReadError extends Error {
  constructor(message, reason = "unreadable") {
    super(message);
    this.name = "WebsiteReadError";
    this.reason = reason;
  }
}

// "sharmatextiles.in", "http://x.in/" → "https://sharmatextiles.in"; null for anything that isn't a web address.
export function normalizeWebsite(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".") || url.username || url.password) return null;
  url.protocol = "https:";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
// The visible text of a page (title, headings, paragraphs, menu words); scripts, styles, images and markup dropped.
export function visibleText(html) {
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim());
  const description = decode(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ?? "").trim();
  const body = decode(html
    .replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/header|\/footer|\/nav)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  return { title, text: [title, description, body].filter(Boolean).join("\n") };
}
// The first About / Services / Products / Menu link on the same site.
export function nextPageLink(html, base) {
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = decode(match[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!NEXT_PAGE.test(label)) continue;
    try {
      const url = new URL(match[1], base);
      if (url.hostname === new URL(base).hostname) return url.toString();
    } catch { /* not a link */ }
  }
  return null;
}

async function readBody(body) {
  const chunks = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.length;
    if (total > MAX_BYTES) { chunks.push(chunk.subarray(0, MAX_BYTES - (total - chunk.length))); break; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// One page, following at most 3 redirects, each one validated again. Returns { url, html } or throws WebsiteReadError.
async function fetchPage(address, { signal, allowPrivate = false }) {
  let url = address;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let parsed;
    try {
      parsed = validateWebhookUrl(url, { allowPrivate });
    } catch (error) {
      throw new WebsiteReadError(error instanceof SsrfError ? "That address can't be read." : "Not a web address.", "blocked");
    }
    if (parsed.protocol !== "https:") throw new WebsiteReadError("Only https addresses are read.", "blocked");
    const agent = new Agent({ connect: { lookup: (hostname, _options, callback) => {
      resolveSafeAddress(hostname, { allowPrivate }).then((safe) => callback(null, [{ address: safe.address, family: safe.family }])).catch((error) => callback(error));
    } } });
    try {
      const response = await undiciRequest(parsed, {
        method: "GET", dispatcher: agent, maxRedirections: 0, headersTimeout: PAGE_TIMEOUT_MS, bodyTimeout: PAGE_TIMEOUT_MS, signal,
        headers: { "user-agent": "Mozilla/5.0 (compatible; VercentlabsSetup/1.0; +https://vercentlabs.com)", accept: "text/html,application/xhtml+xml", "accept-language": "en-IN,en;q=0.8" },
      });
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        await response.body.dump().catch(() => undefined);
        url = new URL(String(response.headers.location), parsed).toString().replace(/^http:/, "https:");
        continue;
      }
      const type = String(response.headers["content-type"] ?? "");
      if (response.statusCode !== 200 || !/text\/html|application\/xhtml/i.test(type)) {
        await response.body.dump().catch(() => undefined);
        throw new WebsiteReadError("The page is not a readable web page.", "unreadable");
      }
      return { url: parsed.toString(), html: await readBody(response.body) };
    } catch (error) {
      if (error instanceof WebsiteReadError) throw error;
      throw new WebsiteReadError(error instanceof SsrfError ? "That address can't be read." : "The website could not be reached.", error instanceof SsrfError ? "blocked" : "unreachable");
    } finally {
      await agent.close().catch(() => undefined);
    }
  }
  throw new WebsiteReadError("Too many redirects.", "unreachable");
}

// Reads the home page and one more page; returns { text, title, pages } (text trimmed to about 3,000 words), or throws WebsiteReadError
// (also when there is almost no text). `signal` ends everything at the overall deadline.
export async function readWebsite(website, { signal, allowPrivate = false } = {}) {
  const start = normalizeWebsite(website);
  if (!start) throw new WebsiteReadError("Not a web address.", "blocked");
  const home = await fetchPage(start, { signal, allowPrivate });
  const first = visibleText(home.html);
  const parts = [first.text];
  const pages = [home.url];
  const next = nextPageLink(home.html, home.url);
  if (next && next !== home.url) {
    try {
      const more = await fetchPage(next, { signal, allowPrivate });
      parts.push(visibleText(more.html).text);
      pages.push(more.url);
    } catch { /* the home page is enough */ }
  }
  const words = parts.join("\n").split(/\s+/).filter(Boolean);
  if (words.length < 15) throw new WebsiteReadError("The website has almost no text.", "empty");
  return { title: first.title, text: words.slice(0, MAX_WORDS).join(" "), pages };
}
