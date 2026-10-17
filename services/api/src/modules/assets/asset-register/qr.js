// A minimal QR Code encoder for asset labels: byte mode, error correction level M, versions 3–5 (up to 84 bytes),
// mask pattern 0. Enough for an asset's lookup payload; it carries no authority — a scan is only a lookup that rechecks access.
const EC_CODEWORDS = { 1: 10, 2: 16, 3: 26, 4: 18, 5: 24 }; // level M, per block
const DATA_CODEWORDS = { 1: 16, 2: 28, 3: 44, 4: 32, 5: 43 }; // level M data per block
const BLOCKS = { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2 };
const ALIGNMENT = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30] };

// GF(256) arithmetic with the QR polynomial 0x11D.
const EXP = new Array(512);
const LOG = new Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i += 1) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) { next[j] ^= poly[j]; next[j + 1] ^= mul(poly[j], EXP[i]); }
    poly = next;
  }
  return poly;
}
function ecc(data, degree) {
  const gen = generator(degree);
  const rest = [...data, ...new Array(degree).fill(0)];
  for (let i = 0; i < data.length; i += 1) {
    const factor = rest[i];
    if (factor !== 0) for (let j = 0; j < gen.length; j += 1) rest[i + j] ^= mul(gen[j], factor);
  }
  return rest.slice(data.length);
}

function codewords(bytes, version) {
  const capacity = DATA_CODEWORDS[version] * BLOCKS[version];
  const bits = [];
  const push = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0; data.length < capacity; pad += 1) data.push(pad % 2 ? 0x11 : 0xec);
  // Split into blocks, add error correction, interleave.
  const blocks = [];
  for (let b = 0; b < BLOCKS[version]; b += 1) blocks.push(data.slice(b * DATA_CODEWORDS[version], (b + 1) * DATA_CODEWORDS[version]));
  const eccBlocks = blocks.map((block) => ecc(block, EC_CODEWORDS[version]));
  const out = [];
  for (let i = 0; i < DATA_CODEWORDS[version]; i += 1) for (const block of blocks) out.push(block[i]);
  for (let i = 0; i < EC_CODEWORDS[version]; i += 1) for (const block of eccBlocks) out.push(block[i]);
  return out;
}

// The 15-bit format information for level M with the given mask.
function formatBits(mask) {
  const data = (0b00 << 3) | mask; // M = 00
  let rem = data << 10;
  for (let i = 14; i >= 10; i -= 1) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  return ((data << 10) | rem) ^ 0x5412;
}

export function qrMatrix(text) {
  const bytes = [...Buffer.from(String(text), "utf8")];
  // Versions 3–5 only: every configuration this encoder emits is checked module for module against a reference encoder.
  const version = [3, 4, 5].find((v) => DATA_CODEWORDS[v] * BLOCKS[v] >= bytes.length + 2);
  if (!version) throw new Error("QR payload too long");
  const size = 17 + 4 * version;
  const grid = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c, dark) => { grid[r][c] = dark; reserved[r][c] = true; };
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r += 1) for (let c = -1; c <= 7; c += 1) {
      const rr = r0 + r; const cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      set(rr, cc, r >= 0 && r <= 6 && c >= 0 && c <= 6 && ring !== 2);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i += 1) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const centers = ALIGNMENT[version];
  for (const r of centers) for (const c of centers) {
    if (reserved[r][c]) continue;
    for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  // Format areas (filled below) and the dark module.
  for (let i = 0; i < 9; i += 1) { if (!reserved[8][i]) reserved[8][i] = true; if (!reserved[i][8]) reserved[i][8] = true; }
  for (let i = 0; i < 8; i += 1) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }
  reserved[size - 8][8] = true;
  // Data, in the zigzag order, with mask 0 ((row + col) % 2 === 0) applied.
  const words = codewords(bytes, version);
  const stream = [];
  for (const w of words) for (let i = 7; i >= 0; i -= 1) stream.push((w >> i) & 1);
  let k = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let n = 0; n < size; n += 1) {
      const row = upward ? size - 1 - n : n;
      for (let d = 0; d < 2; d += 1) {
        const c = col - d;
        if (reserved[row][c]) continue;
        const bit = k < stream.length ? stream[k] : 0;
        k += 1;
        grid[row][c] = Boolean(bit) !== ((row + c) % 2 === 0);
      }
    }
    upward = !upward;
  }
  // Format information, twice (bit 0 is the least significant).
  const f = formatBits(0);
  const bit = (i) => ((f >> i) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) grid[i][8] = bit(i);
  grid[7][8] = bit(6); grid[8][8] = bit(7); grid[8][7] = bit(8);
  for (let i = 9; i <= 14; i += 1) grid[8][14 - i] = bit(i);
  for (let i = 0; i <= 7; i += 1) grid[8][size - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i += 1) grid[size - 15 + i][8] = bit(i);
  grid[size - 8][8] = true;
  return grid.map((row) => row.map(Boolean));
}

// The matrix as a compact SVG (a 4-module quiet zone), for screens and printed labels.
export function qrSvg(text, { scale = 4 } = {}) {
  const m = qrMatrix(text);
  const n = m.length + 8;
  let path = "";
  m.forEach((row, r) => row.forEach((dark, c) => { if (dark) path += `M${c + 4} ${r + 4}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * scale}" height="${n * scale}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
