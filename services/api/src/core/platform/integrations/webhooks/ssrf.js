import dns from "node:dns/promises";
import net from "node:net";

export class SsrfError extends Error {
  constructor(message) {
    super(message);
    this.code = "SSRF_BLOCKED";
  }
}

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

const LOCALHOST_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);

// IPv4 ranges blocked unless WORKER_ALLOW_PRIVATE_WEBHOOK_TARGETS is set —
// this is a public SaaS product with no documented requirement for
// self-hosted customers to reach internal webhook endpoints (Prompt 13's
// own "default to public HTTP(S) endpoints" instruction), so the default
// posture rejects every one of these, including 169.254.169.254 (the
// cloud-provider instance-metadata address, the single most common real
// SSRF target in practice).
const BLOCKED_IPV4_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

const BLOCKED_IPV6_RANGES = [
  ["::", 128],
  ["::1", 128],
  ["fe80::", 10],
  ["fc00::", 7],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["64:ff9b::", 96], // NAT64 well-known prefix — can embed a blocked IPv4 target
];

function ipv4ToInt(address) {
  return address.split(".").reduce((accumulator, octet) => (accumulator << 8) + Number(octet), 0) >>> 0;
}

function isIpv4InRange(address, [rangeBase, prefixLength]) {
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (ipv4ToInt(address) & mask) === (ipv4ToInt(rangeBase) & mask);
}

function ipv6ToBigInt(address) {
  const buffer = ipv6ToBuffer(address);
  let value = 0n;
  for (const byte of buffer) value = (value << 8n) | BigInt(byte);
  return value;
}

function ipv6ToBuffer(address) {
  // Handles the "::" compression and IPv4-mapped suffix forms (e.g. ::ffff:127.0.0.1).
  let full = address;
  const v4MappedMatch = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(full);
  if (v4MappedMatch) {
    const ipv4Int = ipv4ToInt(v4MappedMatch[2]);
    const hex = ipv4Int.toString(16).padStart(8, "0");
    full = `${v4MappedMatch[1]}${hex.slice(0, 4)}:${hex.slice(4)}`;
  }
  const [head, tail = ""] = full.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts = full.includes("::")
    ? [...headParts, ...Array(Math.max(missing, 0)).fill("0"), ...tailParts]
    : full.split(":");
  const buffer = Buffer.alloc(16);
  parts.slice(0, 8).forEach((part, index) => buffer.writeUInt16BE(parseInt(part || "0", 16), index * 2));
  return buffer;
}

function isIpv6InRange(address, [rangeBase, prefixLength]) {
  const mask = prefixLength === 0 ? 0n : (0xffffffffffffffffffffffffffffffffn << BigInt(128 - prefixLength)) & 0xffffffffffffffffffffffffffffffffn;
  return (ipv6ToBigInt(address) & mask) === (ipv6ToBigInt(rangeBase) & mask);
}

// Real, non-optional check: rejects loopback/link-local/private/reserved
// addresses for both address families. `allowPrivate` exists only for
// local development/testing against a controlled fixture server — it is
// never enabled by default and is documented as a policy override, not a
// bypass a request can trigger on its own.
export function isBlockedAddress(address, { allowPrivate = false } = {}) {
  if (allowPrivate) return false;
  const family = net.isIP(address);
  if (family === 4) return BLOCKED_IPV4_RANGES.some((range) => isIpv4InRange(address, range));
  if (family === 6) {
    if (address.startsWith("::ffff:")) {
      const embedded = address.slice("::ffff:".length);
      if (net.isIP(embedded) === 4) return isBlockedAddress(embedded, { allowPrivate });
    }
    return BLOCKED_IPV6_RANGES.some((range) => isIpv6InRange(address, range));
  }
  return true; // not a parseable IP at all — never trust it
}

// Structural validation only: scheme allowlist + obvious localhost
// hostname aliases. Does NOT resolve DNS or inspect the destination IP —
// use resolveSafeAddress() for that (the real protection).
export function validateWebhookUrl(rawUrl, { allowPrivate = false } = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfError("The webhook endpoint URL is not a valid absolute URL.");
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new SsrfError(`The webhook endpoint scheme "${parsed.protocol}" is not allowed — only http/https.`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!allowPrivate && LOCALHOST_HOSTNAMES.has(hostname)) {
    throw new SsrfError("The webhook endpoint may not target localhost.");
  }
  if (net.isIP(hostname) && isBlockedAddress(hostname, { allowPrivate })) {
    throw new SsrfError("The webhook endpoint may not target a private, loopback or link-local address.");
  }
  return parsed;
}

// The real DNS-rebinding-resistant check (Part 29): resolves the hostname
// to its candidate IP addresses ONCE, validates every one of them, and
// returns the validated address for the caller to connect to DIRECTLY
// (see deliver.js's undici Agent with a pinned `lookup`) — there is no
// time gap between "resolve" and "connect" for an attacker's DNS server
// to exploit, because the same resolution result is what gets connected
// to. This closes classic DNS rebinding (a safe answer at check-time,
// an unsafe one moments later at connect-time) for the common single-
// request case. It does NOT protect against an HTTP redirect to a second,
// different hostname mid-request — deliver.js disables automatic
// redirect-following for exactly that reason and documents it.
export async function resolveSafeAddress(hostname, { allowPrivate = false } = {}) {
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname, { allowPrivate })) {
      throw new SsrfError(`Resolved address ${hostname} is not an allowed webhook destination.`);
    }
    return { address: hostname, family: net.isIP(hostname) };
  }
  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfError(`The webhook endpoint hostname "${hostname}" could not be resolved.`);
  }
  const safe = records.find((record) => !isBlockedAddress(record.address, { allowPrivate }));
  if (!safe) {
    throw new SsrfError(`The webhook endpoint hostname "${hostname}" resolves only to disallowed addresses.`);
  }
  return safe;
}
