// Reading a supplier's bill as it arrives by email (report Phase 3): the GST e-invoice QR in the PDF or photo, and failing that an IRN
// printed in its text. A PDF's QR is found among its embedded pictures (Flate or JPEG images, the way invoicing software draws it); a QR
// drawn as vector shapes is not read, and the accountant scans it on the bill form instead. Nothing leaves the server.
import { inflateSync } from "node:zlib";

import jsQR from "jsqr";
import jpeg from "jpeg-js";

const MAX_IMAGES = 25;
const MAX_PIXELS = 16_000_000;
const IRN_TEXT = /(?:^|[^0-9a-f])([0-9a-f]{64})(?![0-9a-f])/i;
const looksLikeEInvoice = (value) => typeof value === "string" && value.split(".").length === 3 && value.length > 100;

// { qr: raw QR text or null, irn: 64-character IRN found in the text or null }.
export function readBillDocument(bytes, { contentType = "", fileName = "" } = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const kind = kindOf(buffer, contentType, fileName);
  try {
    if (kind === "pdf") return readPdf(buffer);
    if (kind === "png") return { qr: qrIn(decodePng(buffer)), irn: null };
    if (kind === "jpeg") return { qr: qrIn(decodeJpeg(buffer)), irn: null };
  } catch {
    return { qr: null, irn: null };
  }
  return { qr: null, irn: null };
}

// A 64-character IRN anywhere in a text (the email's subject or body, a PDF's text), or null.
export function irnInText(value) {
  return IRN_TEXT.exec(String(value ?? ""))?.[1]?.toLowerCase() ?? null;
}

function kindOf(buffer, contentType, fileName) {
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buffer[0] === 0x89 && buffer.subarray(1, 4).toString("latin1") === "PNG") return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "jpeg";
  const hint = `${contentType} ${fileName}`.toLowerCase();
  return hint.includes("pdf") ? "pdf" : hint.includes("png") ? "png" : /jpe?g/.test(hint) ? "jpeg" : null;
}

// ---- pictures to RGBA

// An RGBA picture with a white margin (pictures cropped to the code have no quiet zone, which the reader needs), then read.
function qrIn(image) {
  if (!image || image.width < 21 || image.height < 21 || image.width * image.height > MAX_PIXELS) return null;
  const pad = Math.max(8, Math.round(Math.max(image.width, image.height) / 8));
  const width = image.width + pad * 2;
  const height = image.height + pad * 2;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < image.height; y += 1)
    data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((y + pad) * width + pad) * 4);
  const found = jsQR(data, width, height);
  return found?.data || null;
}

function decodeJpeg(buffer) {
  const decoded = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 });
  return { width: decoded.width, height: decoded.height, data: decoded.data };
}

function decodePng(buffer) {
  let offset = 8;
  let header = null;
  let palette = null;
  const parts = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("latin1");
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    else if (type === "PLTE") palette = body;
    else if (type === "IDAT") parts.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!header || header.interlace) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.color];
  if (!channels) return null;
  const raw = unpredict(inflateSync(Buffer.concat(parts)), header.width, header.height, channels, header.depth);
  return toRgba(raw, header.width, header.height, { channels, depth: header.depth, palette });
}

// PNG row filters (also a PDF's /Predictor 10–15): each row starts with its filter type.
function unpredict(data, width, height, channels, depth) {
  const stride = Math.ceil((width * channels * depth) / 8);
  const step = Math.max(1, Math.ceil((channels * depth) / 8));
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = data[y * (stride + 1)];
    const row = data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= step ? out[y * stride + x - step] : 0;
      const up = y ? out[(y - 1) * stride + x] : 0;
      const corner = y && x >= step ? out[(y - 1) * stride + x - step] : 0;
      let value = row[x] ?? 0;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      out[y * stride + x] = value & 0xff;
    }
  }
  return out;
}

// Samples (1–16 bits, gray / gray+alpha / RGB / RGBA / palette / CMYK) to RGBA.
function toRgba(raw, width, height, { channels, depth, palette = null, cmyk = false, invert = false }) {
  const data = new Uint8ClampedArray(width * height * 4);
  const stride = Math.ceil((width * channels * depth) / 8);
  const max = (1 << Math.min(depth, 8)) - 1;
  const sample = (row, index) => {
    if (depth === 8) return raw[row * stride + index];
    if (depth === 16) return raw[row * stride + index * 2];
    const bit = index * depth;
    return (raw[row * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & max;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = x * channels;
      const at = (y * width + x) * 4;
      let r, g, b;
      if (palette) {
        const index = sample(y, base) * 3;
        r = palette[index]; g = palette[index + 1]; b = palette[index + 2];
      } else if (cmyk) {
        const [c, m, yellow, k] = [0, 1, 2, 3].map((n) => sample(y, base + n));
        r = 255 - Math.min(255, c + k); g = 255 - Math.min(255, m + k); b = 255 - Math.min(255, yellow + k);
      } else {
        const scale = (value) => (depth >= 8 ? value : Math.round((value * 255) / max));
        r = scale(sample(y, base));
        g = channels >= 3 ? scale(sample(y, base + 1)) : r;
        b = channels >= 3 ? scale(sample(y, base + 2)) : r;
      }
      if (invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
      data[at] = r; data[at + 1] = g; data[at + 2] = b; data[at + 3] = 255;
    }
  }
  return { width, height, data };
}

// ---- PDF

function readPdf(buffer) {
  const source = buffer.toString("latin1");
  const objects = pdfObjects(source, buffer);
  let qr = null;
  let images = 0;
  const texts = [];
  for (const object of objects) {
    if (!object.stream) continue;
    const dict = object.dict;
    if (/\/Subtype\s*\/Image\b/.test(dict)) {
      if (qr || images >= MAX_IMAGES) continue;
      images += 1;
      const found = qrIn(pdfImage(dict, object.stream, objects));
      if (found && (!qr || looksLikeEInvoice(found))) qr = found;
    } else if (!/\/Subtype\s*\/(?:Type1C|CIDFontType0C|OpenType|XML)\b|\/Length1\b|\/Type\s*\/(?:XRef|EmbeddedFile|Metadata)\b/.test(dict)) {
      const content = streamBytes(dict, object.stream);
      if (content && content.length < 4_000_000) texts.push(pdfText(content.toString("latin1")));
    }
  }
  return { qr, irn: irnInText(texts.join(" ")) };
}

// Every "n 0 obj << … >> stream … endstream" in the file, with its dictionary text and raw stream bytes.
function pdfObjects(source, buffer) {
  const objects = new Map();
  const list = [];
  const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let match;
  while ((match = pattern.exec(source))) {
    const start = match.index + match[0].length;
    const end = source.indexOf("endobj", start);
    if (end < 0) break;
    const body = source.slice(start, end);
    const streamAt = body.search(/\bstream\r?\n/);
    const object = { id: Number(match[1]), dict: streamAt >= 0 ? body.slice(0, streamAt) : body, stream: null };
    if (streamAt >= 0) {
      const dataStart = start + streamAt + (body.slice(streamAt, streamAt + 8).startsWith("stream\r\n") ? 8 : 7);
      const declared = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(object.dict);
      const stop = source.lastIndexOf("endstream", end);
      const length = declared && dataStart + Number(declared[1]) <= stop ? Number(declared[1]) : Math.max(0, stop - dataStart);
      object.stream = buffer.subarray(dataStart, dataStart + length);
    }
    objects.set(object.id, object);
    list.push(object);
    pattern.lastIndex = end;
  }
  list.byId = objects;
  return list;
}

const nameOf = (dict, key) => new RegExp(`/${key}\\s*/([A-Za-z0-9]+)`).exec(dict)?.[1] ?? null;
const numberOf = (dict, key) => { const value = new RegExp(`/${key}\\s+(\\d+)`).exec(dict); return value ? Number(value[1]) : null; };
const filtersOf = (dict) => {
  const array = /\/Filter\s*\[([^\]]*)\]/.exec(dict);
  if (array) return [...array[1].matchAll(/\/([A-Za-z0-9]+)/g)].map((entry) => entry[1]);
  const single = nameOf(dict, "Filter");
  return single ? [single] : [];
};

// The stream with its Flate compression undone (other filters: as stored), or null when it cannot be.
function streamBytes(dict, stream) {
  let data = stream;
  for (const filter of filtersOf(dict)) {
    if (filter === "FlateDecode" || filter === "Fl") {
      try { data = inflateSync(data); } catch { return null; }
    } else return filter === "DCTDecode" || filter === "DCT" ? data : null;
  }
  return data;
}

function pdfImage(dict, stream, objects) {
  const width = numberOf(dict, "Width");
  const height = numberOf(dict, "Height");
  if (!width || !height || width * height > MAX_PIXELS) return null;
  const filters = filtersOf(dict);
  const data = streamBytes(dict, stream);
  if (!data) return null;
  if (filters.includes("DCTDecode") || filters.includes("DCT")) return decodeJpeg(data);
  const mask = /\/ImageMask\s+true/.test(dict);
  const depth = mask ? 1 : numberOf(dict, "BitsPerComponent") ?? 8;
  let space = nameOf(dict, "ColorSpace");
  let palette = null;
  const reference = /\/ColorSpace\s+(\d+)\s+\d+\s+R/.exec(dict);
  const spaceText = reference ? objects.byId.get(Number(reference[1]))?.dict ?? "" : /\/ColorSpace\s*(\[[^\]]*\])/.exec(dict)?.[1] ?? "";
  if (spaceText) {
    if (/\/Indexed/.test(spaceText)) {
      const lookup = /<([0-9a-fA-F\s]+)>/.exec(spaceText);
      const lookupRef = /\/Indexed\s*(?:\/\w+|\[[^\]]*\]|\d+\s+\d+\s+R)\s*\d+\s*(\d+)\s+\d+\s+R/.exec(spaceText);
      if (lookup) palette = Buffer.from(lookup[1].replace(/\s/g, ""), "hex");
      else if (lookupRef) { const table = objects.byId.get(Number(lookupRef[1])); palette = table?.stream ? streamBytes(table.dict, table.stream) : null; }
      if (!palette) return null;
      space = "Indexed";
    } else if (/\/ICCBased/.test(spaceText)) {
      const profile = /\/ICCBased\s+(\d+)\s+\d+\s+R/.exec(spaceText);
      const n = profile ? numberOf(objects.byId.get(Number(profile[1]))?.dict ?? "", "N") : 3;
      space = n === 1 ? "DeviceGray" : n === 4 ? "DeviceCMYK" : "DeviceRGB";
    } else space = /DeviceGray|CalGray/.test(spaceText) ? "DeviceGray" : /CMYK/.test(spaceText) ? "DeviceCMYK" : "DeviceRGB";
  }
  const channels = mask || space === "DeviceGray" || space === "Indexed" ? 1 : space === "DeviceCMYK" ? 4 : 3;
  const predictor = numberOf(dict, "Predictor") ?? 1;
  const pixels = predictor >= 10 ? unpredict(data, width, height, channels, depth) : data;
  // An image mask paints where a sample is 0 (black ink on white) unless its /Decode says otherwise.
  const invert = mask && /\/Decode\s*\[\s*1\s+0\s*\]/.test(dict);
  return toRgba(pixels, width, height, { channels, depth, palette, cmyk: space === "DeviceCMYK", invert });
}

// The literal strings of a content stream's text operators, joined.
function pdfText(content) {
  const out = [];
  for (const match of content.matchAll(/\(((?:\\.|[^\\)])*)\)/g)) out.push(match[1].replace(/\\(.)/g, "$1"));
  for (const match of content.matchAll(/<([0-9a-fA-F]{2,})>\s*Tj/g)) {
    const bytes = Buffer.from(match[1], "hex");
    out.push(bytes.toString("latin1"), bytes.toString("utf16le"));
  }
  return out.join("");
}
