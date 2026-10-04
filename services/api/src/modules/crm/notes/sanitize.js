// Note formatting, made safe on the server. The editor sends HTML; only
// paragraphs, line breaks, bullets, numbered lists, bold, italic and links
// survive. Every other tag is dropped (its text kept), script and style
// blocks are removed with their content, attributes are discarded except a
// link's address, and only http, https and mailto links are kept. Text is
// re-escaped, so nothing the user typed can run in a browser.

const ALLOWED = new Map([
  ["p", "p"], ["div", "p"], ["br", "br"], ["ul", "ul"], ["ol", "ol"], ["li", "li"],
  ["strong", "strong"], ["b", "strong"], ["em", "em"], ["i", "em"], ["a", "a"],
]);
const VOID = new Set(["br"]);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|noscript|svg|math)\b[\s\S]*?<\/\1\s*>/gi;
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

const escapeText = (value) => value.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_match, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function linkTarget(attributes) {
  const match = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
  if (!match) return null;
  // entities and control characters are how "java&#115;cript:" sneaks past a prefix check
  const href = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "").replace(/[\u0000- \u007f]+/g, "").trim();
  return SAFE_LINK.test(href) ? href : null;
}

export function sanitizeNoteHtml(input) {
  const source = String(input ?? "").replace(/<!--[\s\S]*?-->/g, "").replace(DROP_WITH_CONTENT, "");
  const out = [];
  const open = [];
  const tag = /<\s*(\/?)\s*([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let last = 0;
  for (let match = tag.exec(source); match; match = tag.exec(source)) {
    out.push(escapeText(source.slice(last, match.index)));
    last = tag.lastIndex;
    const closing = match[1] === "/";
    const name = ALLOWED.get(match[2].toLowerCase());
    if (!name) continue;
    if (VOID.has(name)) { if (!closing) out.push("<br>"); continue; }
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at < 0) continue;
      while (open.length > at) out.push(`</${open.pop()}>`);
      continue;
    }
    if (name === "a") {
      const href = linkTarget(match[3]);
      if (!href) continue;
      out.push(`<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer nofollow">`);
    } else out.push(`<${name}>`);
    open.push(name);
  }
  out.push(escapeText(source.slice(last).replace(/<[^>]*$/, "")));
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join("").replace(/<p>\s*<\/p>/g, "").trim();
}

// The note as plain text: for search, the timeline and the list preview.
export function noteHtmlToText(html) {
  return decodeEntities(String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li>/gi, "\n• ")
    .replace(/<\/(p|li|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
